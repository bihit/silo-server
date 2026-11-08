<#
.SYNOPSIS
  Registers PostgreSQL, Garnet and Silo as Windows services that start with Windows.
.DESCRIPTION
  Needs Administrator rights once, for registration. The services themselves
  run under virtual service accounts (NT SERVICE\<name>): no password, no
  administrator rights, write access only to their own data and log folders.
    silo-postgresql  pg_ctl register, automatic start
    silo-garnet      Shawl wrapper, automatic start
    silo-server      Shawl wrapper, delayed automatic start, depends on both
  Shawl stops Silo and Garnet with Ctrl+C (graceful shutdown) and ends their
  child processes (FFmpeg) with the service. Crashes restart after 10 s.
  Re-running updates an existing registration. Running process-mode instances
  must be stopped first (Stop-Silo.ps1 -Mode Process).
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
Assert-SiloAdmin 'Dienste registrieren und Ordnerrechte fuer die Dienstkonten setzen'
$layout = Get-SiloLayout
$names = Get-SiloServiceNames
Use-SiloProcessPath
$sc = "$env:SystemRoot\System32\sc.exe"

if ((Get-SiloRunProcess 'silo') -or (Get-SiloRunProcess 'garnet')) { throw 'Silo/Garnet laufen im Prozessmodus. Zuerst Stop-Silo.ps1 -Mode Process ausfuehren.' }
& (Join-Path $layout.PgBin 'pg_ctl.exe') status -D $layout.PgData | Out-Null
if ($LASTEXITCODE -eq 0 -and -not (Get-Service $names.PostgreSQL -ErrorAction SilentlyContinue)) { throw 'PostgreSQL laeuft im Prozessmodus. Zuerst Stop-Silo.ps1 -Mode Process ausfuehren.' }

function Set-ServiceAccount([string]$Name, [string]$Description, [string]$Start) {
    # A virtual account takes no password; any password= argument, even an
    # empty one, makes ChangeServiceConfig fail with 1057.
    Invoke-SiloNative -FilePath $sc -Arguments @('config', $Name, 'obj=', "NT SERVICE\$Name") -What "sc config $Name (Konto)" | Out-Null
    Invoke-SiloNative -FilePath $sc -Arguments @('config', $Name, 'start=', $Start) -What "sc config $Name (Starttyp)" | Out-Null
    Invoke-SiloNative -FilePath $sc -Arguments @('description', $Name, $Description) -What "sc description $Name" | Out-Null
    Invoke-SiloNative -FilePath $sc -Arguments @('failure', $Name, 'reset=', '86400', 'actions=', 'restart/10000/restart/30000/""/0') -What "sc failure $Name" | Out-Null
}
function Remove-ServiceIfPresent([string]$Name, [string]$Marker) {
    $svc = Get-Service $Name -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    # Replace only a service of this installation, never one of the same name
    # that runs another installation's programs or data.
    $path = (Get-CimInstance Win32_Service -Filter "Name='$Name'").PathName
    if (-not $path -or $path.IndexOf($Marker, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Dienst $Name gehoert zu einer anderen Installation ($path). Nichts geaendert."
    }
    if ($svc.Status -ne 'Stopped') { Stop-Service $Name; (Get-Service $Name).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90)) }
    Invoke-SiloNative -FilePath $sc -Arguments @('delete', $Name) -What "sc delete $Name" | Out-Null
    for ($i = 0; $i -lt 20 -and (Get-Service $Name -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
}

# --- PostgreSQL ----------------------------------------------------------------
Write-SiloStep $names.PostgreSQL
Remove-ServiceIfPresent $names.PostgreSQL $layout.PgData
Invoke-SiloNative -FilePath (Join-Path $layout.PgBin 'pg_ctl.exe') -What 'pg_ctl register' -Arguments @('register', '-N', $names.PostgreSQL, '-D', $layout.PgData, '-S', 'auto', '-w', '-t', '120')
Set-ServiceAccount $names.PostgreSQL 'PostgreSQL 18 fuer Silo (nur 127.0.0.1)' 'auto'
Write-SiloOk "NT SERVICE\$($names.PostgreSQL)"

# --- Garnet --------------------------------------------------------------------
Write-SiloStep $names.Garnet
Remove-ServiceIfPresent $names.Garnet $layout.GarnetExe
Invoke-SiloNative -FilePath $layout.Shawl -What 'shawl add (garnet)' -Arguments @(
    'add', '--name', $names.Garnet, '--cwd', $layout.GarnetData,
    '--env', "DOTNET_ROOT=$($layout.DotNet)",
    '--log-dir', (Join-Path $layout.Logs 'garnet'), '--log-cmd-as', 'garnet', '--log-rotate', 'daily', '--log-retain', '14',
    '--stop-timeout', '20000', '--restart-if-not', '0', '--restart-delay', '5000', '--kill-process-tree',
    '--', $layout.GarnetExe, '--config-import-path', (Join-Path $layout.Config 'garnet.conf'))
Set-ServiceAccount $names.Garnet 'Garnet (Redis-kompatibel) fuer Silo (nur 127.0.0.1)' 'auto'
Write-SiloOk "NT SERVICE\$($names.Garnet)"

# --- Silo ----------------------------------------------------------------------
Write-SiloStep $names.Silo
Remove-ServiceIfPresent $names.Silo $layout.SiloExe
Invoke-SiloNative -FilePath $layout.Shawl -What 'shawl add (silo)' -Arguments @(
    'add', '--name', $names.Silo, '--cwd', $layout.SiloHome,
    '--dependencies', "$($names.PostgreSQL),$($names.Garnet)",
    # pg_dump and pg_restore for Silo's backups, from the same PostgreSQL.
    '--path', $layout.PgBin,
    '--log-dir', (Join-Path $layout.Logs 'silo'), '--log-cmd-as', 'silo', '--log-rotate', 'daily', '--log-retain', '14',
    '--stop-timeout', '60000', '--restart-if-not', '0', '--restart-delay', '10000', '--kill-process-tree',
    '--', $layout.SiloExe, '-env', $layout.EnvFile)
Set-ServiceAccount $names.Silo 'Silo Medienserver (Web/API/Streaming auf Port 8020, Jellyfin-Kompatibilitaet auf 8021)' 'delayed-auto'
Write-SiloOk "NT SERVICE\$($names.Silo)"

# --- Folder rights for the virtual accounts ---------------------------------------
Write-SiloStep 'Ordnerrechte'
$pgAcct = "NT SERVICE\$($names.PostgreSQL)"; $gAcct = "NT SERVICE\$($names.Garnet)"; $sAcct = "NT SERVICE\$($names.Silo)"
Grant-SiloAccess -Path $layout.PgData -Account $pgAcct -Rights Modify
Grant-SiloAccess -Path (Join-Path $layout.Logs 'postgresql') -Account $pgAcct -Rights Modify
Grant-SiloAccess -Path $layout.GarnetData -Account $gAcct -Rights Modify
Grant-SiloAccess -Path (Join-Path $layout.Logs 'garnet') -Account $gAcct -Rights Modify
Grant-SiloAccess -Path $layout.SiloData -Account $sAcct -Rights Modify
Grant-SiloAccess -Path (Join-Path $layout.Logs 'silo') -Account $sAcct -Rights Modify
# Secrets: each account reads only its own file; the config folder itself
# only lists for them.
Grant-SiloAccess -Path $layout.Config -Account $gAcct -Rights ReadAndExecute
Grant-SiloAccess -Path $layout.Config -Account $sAcct -Rights ReadAndExecute
Set-SiloPrivateAcl -Path (Join-Path $layout.Config 'garnet.conf') -Readers @($gAcct)
Set-SiloPrivateAcl -Path $layout.EnvFile -Readers @($sAcct)
Set-SiloPrivateAcl -Path $layout.PgSuperSecret
Set-SiloPrivateAcl -Path $layout.GarnetSecret
# Folder-level read on config would let the accounts read the other secrets
# through inheritance; the explicit file ACLs above are protected (no inheritance).
Write-SiloOk 'Dienstkonten haben Schreibrechte nur auf ihre Daten- und Logordner'

Write-SiloStep 'Medienordner'
Write-SiloWarn "Silo liest Medien als $sAcct. Darf dieses Konto einen Medienordner nicht lesen, braucht es Leserechte, z. B.:"
Write-Host "      icacls `"<Medienordner>`" /grant `"${sAcct}:(OI)(CI)RX`""
Write-SiloStep 'Dienste registriert. Start: Start-Silo.ps1 -Mode Service'
