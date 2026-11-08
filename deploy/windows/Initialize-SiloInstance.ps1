<#
.SYNOPSIS
  Creates or completes the local Silo instance: folders, secrets, PostgreSQL
  cluster and database, Garnet config, silo.env, migrations and first settings.
.DESCRIPTION
  Safe to re-run. Nothing that exists is overwritten:
    - an existing PostgreSQL cluster, role, database or extension is kept,
    - existing keys in silo.env (SECRET_KEY above all) are kept; missing ones are added,
    - server settings are only inserted when the row is absent, so values
      changed later in the admin UI stay.
  Secrets are generated with the OS CSPRNG and never printed.
  Run Build-Silo.ps1 first; migrations need runtime\silo\bin\silo.exe.
#>
[CmdletBinding()]
param(
    # Turn video and download transcoding off: Silo then serves only direct
    # play and stream copies. Without it Silo's own defaults apply.
    [switch]$StreamCopyOnly
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
$ports = Get-SiloPorts
Use-SiloProcessPath -Prepend @($layout.PgBin)

$pgBin = $layout.PgBin
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgLogDir = Join-Path $layout.Logs 'postgresql'

# --- Folders ------------------------------------------------------------------
Write-SiloStep 'Ordner'
foreach ($dir in @($layout.Data, $layout.SiloData, (Join-Path $layout.SiloData 'artwork'), (Join-Path $layout.SiloData 'transcode'),
        (Join-Path $layout.SiloData 'compat'), (Join-Path $layout.SiloData 'plugins'), $layout.GarnetData,
        $layout.Logs, $pgLogDir, (Join-Path $layout.Logs 'garnet'), (Join-Path $layout.Logs 'silo'), $layout.Backups)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
if (-not (Test-Path $layout.Config)) {
    New-Item -ItemType Directory -Path $layout.Config | Out-Null
    Set-SiloPrivateAcl -Path $layout.Config
}
Write-SiloOk $layout.InstallRoot

function New-SecretFile([string]$Path, [string]$Value) {
    if (Test-Path -LiteralPath $Path) { return $false }
    [IO.File]::WriteAllText($Path, $Value, (New-Object Text.UTF8Encoding $false))
    Set-SiloPrivateAcl -Path $Path
    return $true
}

# --- Secrets ------------------------------------------------------------------
Write-SiloStep 'Geheimnisse'
if (New-SecretFile $layout.PgSuperSecret (New-SiloSecret -Bytes 24)) { Write-SiloOk 'PostgreSQL-Superuser-Passwort erzeugt' } else { Write-SiloOk 'PostgreSQL-Superuser-Passwort vorhanden' }
if (New-SecretFile $layout.GarnetSecret (New-SiloSecret -Bytes 24)) { Write-SiloOk 'Garnet-Passwort erzeugt' } else { Write-SiloOk 'Garnet-Passwort vorhanden' }

$envValues = Read-SiloEnvFile $layout.EnvFile
$siloDbPassword = $null
if ($envValues.Contains('DATABASE_URL')) {
    $m = [regex]::Match($envValues['DATABASE_URL'], '^postgres(?:ql)?://silo:([^@]+)@')
    if ($m.Success) { $siloDbPassword = [Uri]::UnescapeDataString($m.Groups[1].Value) }
}
if (-not $siloDbPassword) { $siloDbPassword = New-SiloSecret -Bytes 24 }
$garnetPassword = Get-SiloSecretValue $layout.GarnetSecret

$wanted = [ordered]@{
    DATABASE_URL = "postgres://silo:$siloDbPassword@127.0.0.1:$($ports.PostgreSQL)/silo?sslmode=disable"
    SECRET_KEY   = (New-SiloSecret -Bytes 48 -Format base64)
    REDIS_URL    = "redis://:$garnetPassword@127.0.0.1:$($ports.Garnet)/0"
    PORT         = "$($ports.Silo)"
    JF_PORT      = "$($ports.Jellyfin)"
    MODE         = 'integrated'
}
$added = @()
$lines = @()
if (Test-Path -LiteralPath $layout.EnvFile) { $lines = @(Get-Content -LiteralPath $layout.EnvFile) }
else { $lines = @('# Silo bootstrap configuration (native Windows). Secrets: do not share or commit.', '# Back up SECRET_KEY separately: without it encrypted settings cannot be read.') }
foreach ($key in $wanted.Keys) {
    if (-not $envValues.Contains($key)) { $lines += "$key=$($wanted[$key])"; $added += $key }
}
foreach ($key in @('PORT', 'JF_PORT')) {
    if ($envValues.Contains($key) -and $envValues[$key] -ne $wanted[$key]) { Write-SiloWarn "silo.env setzt $key=$($envValues[$key]) (Vorgabe $($wanted[$key])); vorhandener Wert bleibt." }
}
if ($added.Count -gt 0) {
    $isNew = -not (Test-Path -LiteralPath $layout.EnvFile)
    [IO.File]::WriteAllLines($layout.EnvFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
    if ($isNew) { Set-SiloPrivateAcl -Path $layout.EnvFile }
    Write-SiloOk ("silo.env ergaenzt: " + ($added -join ', '))
} else { Write-SiloOk 'silo.env vollstaendig, unveraendert' }

# Garnet reads its password from a protected config file, never the command line.
$garnetConf = Join-Path $layout.Config 'garnet.conf'
$garnetJson = [ordered]@{
    Address = '127.0.0.1'; Port = $ports.Garnet; EnableLua = $true; ProtectedMode = 'yes'
    AuthenticationMode = 'Password'; Password = $garnetPassword
    LogMemorySize = '512m'; IndexMemorySize = '64m'; LogLevel = 'Warning'
} | ConvertTo-Json
[IO.File]::WriteAllText($garnetConf, $garnetJson, (New-Object Text.UTF8Encoding $false))
Set-SiloPrivateAcl -Path $garnetConf
Write-SiloOk 'garnet.conf geschrieben (nur 127.0.0.1)'

# --- PostgreSQL cluster ---------------------------------------------------------
Write-SiloStep 'PostgreSQL-Cluster'
# initdb and pg_ctl drop the Administrators group (restricted token). Below
# Program Files only administrators may write, so the running user gets write
# access to the cluster and its log folder by name.
New-Item -ItemType Directory -Force -Path $layout.PgData | Out-Null
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
Grant-SiloAccess -Path $layout.PgData -Account $me -Rights Modify
Grant-SiloAccess -Path $pgLogDir -Account $me -Rights Modify
if (Test-Path (Join-Path $layout.PgData 'PG_VERSION')) {
    Write-SiloOk "vorhanden: $($layout.PgData) (Version $((Get-Content (Join-Path $layout.PgData 'PG_VERSION')).Trim()))"
} else {
    if ((Test-Path $layout.PgData) -and (Get-ChildItem -Force $layout.PgData | Select-Object -First 1)) {
        throw "$($layout.PgData) ist nicht leer, enthaelt aber keinen PostgreSQL-Cluster. Bitte pruefen; es wird nichts ueberschrieben."
    }
    # initdb drops the Administrators group (restricted token), so the password
    # file must be readable by the user itself: a user-only file in TEMP.
    $pwFile = Join-Path $env:TEMP ('silo-initdb-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($pwFile, (Get-SiloSecretValue $layout.PgSuperSecret), (New-Object Text.UTF8Encoding $false))
        $acl = Get-Acl -LiteralPath $pwFile
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User, 'Read', 'Allow')))
        Set-Acl -LiteralPath $pwFile -AclObject $acl
        Invoke-SiloNative -FilePath (Join-Path $pgBin 'initdb.exe') -What 'initdb' -Arguments @(
            '-D', $layout.PgData, '-U', 'postgres', "--pwfile=$pwFile", '--auth=scram-sha-256',
            '-E', 'UTF8', '--locale-provider=icu', '--icu-locale=und', '--locale=C', '--data-checksums')
    } finally { Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue }
    Write-SiloOk "initialisiert: $($layout.PgData)"
}
# Loopback-only listener and logging into logs\postgresql. Kept in its own
# include file so postgresql.conf stays as initdb wrote it.
$pgConf = Join-Path $layout.PgData 'postgresql.conf'
$siloConfName = 'silo-windows.conf'
$siloConf = @(
    '# Managed by deploy\windows\Initialize-SiloInstance.ps1',
    "listen_addresses = '127.0.0.1'",
    "port = $($ports.PostgreSQL)",
    'max_connections = 100',
    'shared_buffers = 512MB',
    "password_encryption = 'scram-sha-256'",
    'logging_collector = on',
    "log_directory = '$($pgLogDir.Replace('\', '/'))'",
    "log_filename = 'postgresql-%Y-%m-%d.log'",
    'log_rotation_age = 1d',
    'log_truncate_on_rotation = off'
)
[IO.File]::WriteAllLines((Join-Path $layout.PgData $siloConfName), [string[]]$siloConf, (New-Object Text.UTF8Encoding $false))
if (-not (Select-String -Path $pgConf -SimpleMatch "include_if_exists = '$siloConfName'" -Quiet)) {
    Add-Content -Path $pgConf -Value "`ninclude_if_exists = '$siloConfName'" -Encoding ascii
}

$startedHere = $false
& $pgCtl status -D $layout.PgData | Out-Null
if ($LASTEXITCODE -ne 0) {
    $owner = @(Get-SiloPortOwner -Port $ports.PostgreSQL)
    if ($owner.Count -gt 0) { throw "Port $($ports.PostgreSQL) ist durch $($owner[0].Name) (PID $($owner[0].ProcessId)) belegt; PostgreSQL fuer Silo kann nicht starten." }
    # Use the service only when it runs this installation's cluster; a service
    # of the same name may belong to another installation on this machine.
    $svc = Get-CimInstance Win32_Service -Filter "Name='$((Get-SiloServiceNames).PostgreSQL)'" -ErrorAction SilentlyContinue
    if ($svc -and $svc.PathName -and $svc.PathName.IndexOf($layout.PgData, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Start-Service $svc.Name }
    else {
        Invoke-SiloStarter -FilePath $pgCtl -What 'pg_ctl start (siehe logs\postgresql)' -Arguments @('start', '-D', $layout.PgData, '-w', '-t', '60', '-l', (Join-Path $pgLogDir 'pg_ctl.log'))
        $startedHere = $true
    }
    if (-not (Wait-SiloPort -Port $ports.PostgreSQL -TimeoutSeconds 60)) { throw 'PostgreSQL lauscht nicht auf Port ' + $ports.PostgreSQL }
}
Write-SiloOk "laeuft auf 127.0.0.1:$($ports.PostgreSQL)"

Write-SiloStep 'Rolle, Datenbank, Erweiterungen'
$roleExists = (Invoke-SiloPsql -Scalar -Sql "SELECT 1 FROM pg_roles WHERE rolname = 'silo';") -join ''
$escaped = $siloDbPassword.Replace("'", "''")
if ($roleExists -ne '1') {
    Invoke-SiloPsql -Sql "CREATE ROLE silo LOGIN PASSWORD '$escaped';" | Out-Null
    Write-SiloOk 'Rolle silo angelegt (kein Superuser)'
} else {
    # Keep role and silo.env in step: the password in silo.env is authoritative.
    Invoke-SiloPsql -Sql "ALTER ROLE silo LOGIN PASSWORD '$escaped';" | Out-Null
    Write-SiloOk 'Rolle silo vorhanden'
}
$dbExists = (Invoke-SiloPsql -Scalar -Sql "SELECT 1 FROM pg_database WHERE datname = 'silo';") -join ''
if ($dbExists -ne '1') {
    Invoke-SiloPsql -Sql "CREATE DATABASE silo OWNER silo;" | Out-Null
    Write-SiloOk 'Datenbank silo angelegt'
} else { Write-SiloOk 'Datenbank silo vorhanden' }
# vector is not a trusted extension, so the superuser creates all three; the
# migrations then find them with CREATE EXTENSION IF NOT EXISTS.
Invoke-SiloPsql -Database 'silo' -Sql @'
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
'@ | Out-Null
$ext = Invoke-SiloPsql -Database 'silo' -Scalar -Sql "SELECT string_agg(extname || ' ' || extversion, ', ' ORDER BY extname) FROM pg_extension WHERE extname IN ('vector','citext','pg_trgm');"
Write-SiloOk "Erweiterungen: $($ext -join '')"

# --- Migrations ---------------------------------------------------------------
Write-SiloStep 'Migrationen'
if (-not (Test-Path $layout.SiloExe)) { throw "silo.exe fehlt ($($layout.SiloExe)). Zuerst Build-Silo.ps1 -Install ausfuehren." }
Push-Location $layout.SiloHome
try { Invoke-SiloNative -FilePath $layout.SiloExe -Arguments @('-env', $layout.EnvFile, '--migrate-only') -What 'silo --migrate-only' }
finally { Pop-Location }
Write-SiloOk 'Schema aktuell'

# --- First settings -------------------------------------------------------------
Write-SiloStep 'Servereinstellungen (nur fehlende werden gesetzt)'
$settings = [ordered]@{}
if ($StreamCopyOnly) {
    $settings['playback.transcode_enabled'] = 'false'
    $settings['download.transcode_enabled'] = 'false'
}
$common = [ordered]@{
    'playback.hw_accel'               = 'none'
    'playback.ffmpeg_path'            = $layout.FFmpegExe
    'playback.transcode_dir'          = (Join-Path $layout.SiloData 'transcode')
    'artwork.local_path'              = (Join-Path $layout.SiloData 'artwork')
    'jellyfin_compat.web_install_dir' = (Join-Path $layout.SiloData 'compat\jellyfin-web')
    'jellyfin_compat.web_dir'         = (Join-Path $layout.SiloData 'compat\jellyfin-web\current')
    'jellyfin_compat.public_url'      = "http://127.0.0.1:$($ports.Jellyfin)"
    'server.lan_discovery'            = 'false'
    'audiobookshelf_compat.enabled'   = 'false'
}
foreach ($key in $common.Keys) { $settings[$key] = $common[$key] }
# The migrations seed Linux defaults for several of these keys, so a missing
# row is no sign of a fresh value. Each key is written once by this script and
# recorded; afterwards it is left alone, so admin UI changes are kept.
$stateFile = Join-Path $layout.Data 'applied-settings.json'
$applied = @()
if (Test-Path $stateFile) { $applied = @((Get-Content $stateFile -Raw | ConvertFrom-Json)) }
$pending = @($settings.Keys | Where-Object { $applied -notcontains $_ })
if ($pending.Count -gt 0) {
    $values = ($pending | ForEach-Object { "('" + $_.Replace("'", "''") + "', '" + $settings[$_].Replace("'", "''") + "')" }) -join ",`n"
    Invoke-SiloPsql -Database 'silo' -Sql "INSERT INTO server_settings (key, value) VALUES`n$values`nON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;" | Out-Null
    ConvertTo-Json -InputObject @($applied + $pending) | Set-Content -Path $stateFile -Encoding ascii
}
$current = Invoke-SiloPsql -Database 'silo' -Scalar -Sql ("SELECT key || '=' || value FROM server_settings WHERE key IN (" + (($settings.Keys | ForEach-Object { "'$_'" }) -join ',') + ") ORDER BY key;")
foreach ($row in $current) {
    $k, $val = $row -split '=', 2
    if ($settings[$k] -ne $val) { Write-SiloWarn "$k = $val (spaeter geaendert, bleibt)" }
    elseif ($pending -contains $k) { Write-SiloOk "$k = $val (gesetzt)" }
    else { Write-SiloOk "$k = $val" }
}

if ($startedHere) {
    Invoke-SiloNative -FilePath $pgCtl -What 'pg_ctl stop' -Arguments @('stop', '-D', $layout.PgData, '-m', 'fast', '-w')
    Write-SiloOk 'PostgreSQL wieder gestoppt (wurde nur fuer die Einrichtung gestartet)'
}
Write-SiloStep 'Instanz eingerichtet.'
