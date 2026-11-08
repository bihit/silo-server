# Shared helpers for the native Windows install of Silo.
#
# Layout (InstallRoot is the folder that contains the silo-server checkout):
#   <InstallRoot>\silo-server         source checkout (this repository)
#   <InstallRoot>\runtime             installed programs: silo, garnet, dotnet, shawl, ffmpeg, node
#   <InstallRoot>\data                PostgreSQL cluster, Silo data, Garnet working dir
#   <InstallRoot>\config              silo.env and other secrets (restricted ACL)
#   <InstallRoot>\logs                service logs
#   <InstallRoot>\backups             database dumps and config copies
#
# Windows PowerShell 5.1 compatible. Secrets are never written to the console.

Set-StrictMode -Version Latest

$script:Versions = [ordered]@{
    Go          = '1.26.9'
    GoSha256    = 'd722201a9c0c086d1610e111c48203009af690892ed708072bd5ae20160e7a59'
    Node        = '24.22.0'
    Pnpm        = '10.32.1'
    Garnet      = '2.2.3'
    GarnetSha256 = '5cd130686ab415b13c59d36d048a6faded81e707ffe6da5953f98beeb79f9f16'
    DotNet      = '10.0'
    Shawl       = '1.9.0'
    ShawlSha256 = 'f883c5d09c9beae2efaeabd8513e7d3f57cd1d0864cec3df4f4a7b6ee904351c'
    PgVector    = 'v0.8.7'
}

$script:Ports = [ordered]@{
    Silo       = 8020   # web UI, native API, media streaming
    Jellyfin   = 8021   # Jellyfin/Emby compatibility listener (separate server in Silo)
    PostgreSQL = 5432   # loopback only
    Garnet     = 6379   # loopback only
}

$script:ServiceNames = [ordered]@{
    PostgreSQL = 'silo-postgresql'
    Garnet     = 'silo-garnet'
    Silo       = 'silo-server'
}

function Get-SiloVersions { $script:Versions }
# Ports come from the defaults above, overridden key by key by
# <InstallRoot>\config\ports.json (for example {"Silo": 8030, "Jellyfin": 8031})
# when another program already uses one of them.
function Get-SiloPorts {
    $ports = [ordered]@{}
    foreach ($key in $script:Ports.Keys) { $ports[$key] = $script:Ports[$key] }
    $file = Join-Path (Get-SiloLayout).Config 'ports.json'
    if (Test-Path -LiteralPath $file) {
        $override = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        foreach ($p in $override.PSObject.Properties) {
            if (-not $ports.Contains($p.Name)) { throw "ports.json: unbekannter Schluessel $($p.Name) (erlaubt: $($ports.Keys -join ', '))" }
            $value = [int]$p.Value
            if ($value -lt 1 -or $value -gt 65535) { throw "ports.json: $($p.Name)=$($p.Value) ist kein gueltiger Port" }
            $ports[$p.Name] = $value
        }
    }
    $ports
}
function Get-SiloServiceNames { $script:ServiceNames }

function Get-SiloLayout {
    param([string]$InstallRoot)
    if (-not $InstallRoot) {
        $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $InstallRoot = Split-Path $repo -Parent
    }
    $InstallRoot = (Resolve-Path $InstallRoot).Path
    $msys = 'C:\msys64'
    # A packaged install ships PostgreSQL in runtime\pgsql; a source install
    # uses the MSYS2 UCRT64 one.
    $pgBin = Join-Path $InstallRoot 'runtime\pgsql\bin'
    if (-not (Test-Path (Join-Path $pgBin 'pg_ctl.exe'))) { $pgBin = Join-Path $msys 'ucrt64\bin' }
    [pscustomobject]@{
        InstallRoot   = $InstallRoot
        Repo          = Join-Path $InstallRoot 'silo-server'
        Runtime       = Join-Path $InstallRoot 'runtime'
        SiloHome      = Join-Path $InstallRoot 'runtime\silo'
        SiloBin       = Join-Path $InstallRoot 'runtime\silo\bin'
        SiloExe       = Join-Path $InstallRoot 'runtime\silo\bin\silo.exe'
        Garnet        = Join-Path $InstallRoot 'runtime\garnet'
        GarnetExe     = Join-Path $InstallRoot 'runtime\garnet\GarnetServer.exe'
        DotNet        = Join-Path $InstallRoot 'runtime\dotnet'
        Shawl         = Join-Path $InstallRoot 'runtime\shawl\shawl.exe'
        FFmpegDir     = Join-Path $InstallRoot 'runtime\ffmpeg'
        FFmpegExe     = Join-Path $InstallRoot 'runtime\ffmpeg\ffmpeg.exe'
        Node          = Join-Path $InstallRoot 'runtime\node'
        Build         = Join-Path $InstallRoot 'build'
        Data          = Join-Path $InstallRoot 'data'
        PgData        = Join-Path $InstallRoot 'data\postgres'
        SiloData      = Join-Path $InstallRoot 'data\silo'
        GarnetData    = Join-Path $InstallRoot 'data\garnet'
        Config        = Join-Path $InstallRoot 'config'
        EnvFile       = Join-Path $InstallRoot 'config\silo.env'
        PgSuperSecret = Join-Path $InstallRoot 'config\postgres-superuser.secret'
        GarnetSecret  = Join-Path $InstallRoot 'config\garnet.secret'
        Logs          = Join-Path $InstallRoot 'logs'
        Backups       = Join-Path $InstallRoot 'backups'
        Msys          = $msys
        MsysBin       = Join-Path $msys 'ucrt64\bin'
        PgBin         = $pgBin
        MsysBash      = Join-Path $msys 'usr\bin\bash.exe'
        GoRoot        = Join-Path $env:LOCALAPPDATA 'Programs\go'
    }
}

# The machine PATH on this host lacks System32; restore the Windows basics for
# this process only and put the given folders first.
function Use-SiloProcessPath {
    param([string[]]$Prepend = @())
    $base = @("$env:SystemRoot\System32", $env:SystemRoot, "$env:SystemRoot\System32\Wbem", "$env:SystemRoot\System32\WindowsPowerShell\v1.0")
    $current = @($env:PATH -split ';' | Where-Object { $_ })
    $env:PATH = (@($Prepend) + $base + $current | Select-Object -Unique) -join ';'
}

function Write-SiloStep { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-SiloOk   { param([string]$Message) Write-Host "    OK  $Message" -ForegroundColor Green }
function Write-SiloWarn { param([string]$Message) Write-Host "    !!  $Message" -ForegroundColor Yellow }

function Assert-SiloAdmin {
    param([string]$Reason)
    $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administratorrechte erforderlich: $Reason. Bitte PowerShell 'Als Administrator ausfuehren'."
    }
}

function Invoke-SiloNative {
    # Runs a native program, throws with its name on a non-zero exit code.
    param([Parameter(Mandatory)][string]$FilePath, [string[]]$Arguments = @(), [string]$What)
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        if (-not $What) { $What = [IO.Path]::GetFileName($FilePath) }
        throw "$What ist mit Exitcode $LASTEXITCODE fehlgeschlagen."
    }
}

function ConvertTo-SiloArgumentString {
    # Windows command-line quoting for one argument list (CommandLineToArgvW rules).
    param([string[]]$Arguments)
    ($Arguments | ForEach-Object {
        if ($_ -eq '') { '""' }
        elseif ($_ -notmatch '[\s"]') { $_ }
        else { '"' + (($_ -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' }
    }) -join ' '
}

function Invoke-SiloStarter {
    # Runs a program that launches a background server (pg_ctl start). It is
    # started without inheriting this session's handles, and only the program
    # itself is awaited, not the server it leaves running.
    param([Parameter(Mandatory)][string]$FilePath, [string[]]$Arguments = @(), [string]$What, [int]$TimeoutSeconds = 120)
    if (-not $What) { $What = [IO.Path]::GetFileName($FilePath) }
    $p = Start-Process -FilePath $FilePath -ArgumentList (ConvertTo-SiloArgumentString $Arguments) -WindowStyle Hidden -PassThru
    $null = $p.Handle
    if (-not $p.WaitForExit($TimeoutSeconds * 1000)) { throw "$What hat nach $TimeoutSeconds s nicht geantwortet." }
    if ($p.ExitCode -ne 0) { throw "$What ist mit Exitcode $($p.ExitCode) fehlgeschlagen." }
}

function Invoke-SiloMsys {
    # Runs a bash command in the MSYS2 UCRT64 environment.
    param([Parameter(Mandatory)][string]$Command, [string]$What = 'MSYS2-Befehl')
    $layout = Get-SiloLayout
    $old = @{ MSYSTEM = $env:MSYSTEM; CHERE_INVOKING = $env:CHERE_INVOKING }
    $env:MSYSTEM = 'UCRT64'; $env:CHERE_INVOKING = '1'
    try { Invoke-SiloNative -FilePath $layout.MsysBash -Arguments @('-lc', $Command) -What $What }
    finally { $env:MSYSTEM = $old.MSYSTEM; $env:CHERE_INVOKING = $old.CHERE_INVOKING }
}

function Invoke-SiloMsysCapture {
    # Like Invoke-SiloMsys, but returns the command's output lines.
    param([Parameter(Mandatory)][string]$Command)
    $layout = Get-SiloLayout
    $old = @{ MSYSTEM = $env:MSYSTEM; CHERE_INVOKING = $env:CHERE_INVOKING }
    $env:MSYSTEM = 'UCRT64'; $env:CHERE_INVOKING = '1'
    try {
        $out = & $layout.MsysBash -lc $Command
        if ($LASTEXITCODE -ne 0) { throw "MSYS2-Befehl fehlgeschlagen ($LASTEXITCODE): $Command" }
        return $out
    } finally { $env:MSYSTEM = $old.MSYSTEM; $env:CHERE_INVOKING = $old.CHERE_INVOKING }
}

function Get-SiloDownload {
    # Downloads into a fresh directory and verifies the SHA-256 before use.
    param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][string]$Sha256, [Parameter(Mandatory)][string]$FileName)
    $dir = Join-Path $env:TEMP ("silo-dl-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $target = Join-Path $dir $FileName
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $progress = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    try { Invoke-WebRequest -Uri $Url -OutFile $target -UseBasicParsing } finally { $ProgressPreference = $progress }
    $actual = (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256.ToLowerInvariant()) {
        Remove-Item -Recurse -Force $dir
        throw "Pruefsumme stimmt nicht fuer $Url (erwartet $Sha256, erhalten $actual)."
    }
    return $target
}

function New-SiloSecret {
    # Random secret from the OS CSPRNG. Hex keeps it safe inside URLs.
    param([int]$Bytes = 32, [ValidateSet('hex', 'base64')][string]$Format = 'hex')
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    if ($Format -eq 'base64') { return [Convert]::ToBase64String($buffer) }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Set-SiloPrivateAcl {
    # Only SYSTEM, Administrators and the named accounts may read the item.
    param([Parameter(Mandatory)][string]$Path, [string[]]$Readers = @(), [string[]]$Writers = @())
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
    $isDir = (Get-Item -LiteralPath $Path).PSIsContainer
    $inherit = if ($isDir) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    $none = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $sids = @(
        @{ Id = (New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'); Rights = 'FullControl' },       # SYSTEM
        @{ Id = (New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'); Rights = 'FullControl' }    # Administrators
    )
    foreach ($w in $Writers) { $sids += @{ Id = (New-Object Security.Principal.NTAccount $w); Rights = 'Modify' } }
    foreach ($r in $Readers) { $sids += @{ Id = (New-Object Security.Principal.NTAccount $r); Rights = 'ReadAndExecute' } }
    foreach ($s in $sids) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($s.Id, $s.Rights, $inherit, $none, $allow)))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Grant-SiloAccess {
    # Adds an inheritable allow rule without touching existing ones.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Account, [ValidateSet('ReadAndExecute', 'Modify')][string]$Rights = 'ReadAndExecute')
    $acl = Get-Acl -LiteralPath $Path
    $isDir = (Get-Item -LiteralPath $Path).PSIsContainer
    $inherit = if ($isDir) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.NTAccount $Account), $Rights, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Read-SiloEnvFile {
    # Parses KEY=VALUE lines; values are returned, never printed.
    param([Parameter(Mandatory)][string]$Path)
    $values = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path)) { return $values }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $values[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
    }
    return $values
}

function Get-SiloSecretValue {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "Geheimnisdatei fehlt: $Path. Zuerst Initialize-SiloInstance.ps1 ausfuehren." }
    return (Get-Content -LiteralPath $Path -Raw).Trim()
}

function Get-SiloPortOwner {
    # Returns listeners on a TCP port with their process, or nothing.
    param([Parameter(Mandatory)][int]$Port)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    foreach ($l in $listeners) {
        $p = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
        $path = $null
        if ($p) { try { $path = $p.Path } catch { $path = $null } }
        [pscustomobject]@{ Port = $Port; Address = $l.LocalAddress; ProcessId = $l.OwningProcess; Name = $(if ($p) { $p.ProcessName } else { '?' }); Path = $path }
    }
}

function Get-SiloOwnedProcess {
    # Processes started from this installation's runtime folder (or PostgreSQL
    # on this cluster). Nothing else is ever stopped by these scripts.
    $layout = Get-SiloLayout
    $runtime = $layout.Runtime.TrimEnd('\') + '\'
    Get-CimInstance Win32_Process | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtime, [StringComparison]::OrdinalIgnoreCase)) -or
        ($_.Name -eq 'postgres.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($layout.PgData, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    }
}

function Wait-SiloPort {
    param([int]$Port, [int]$TimeoutSeconds = 60, [switch]$Closed)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $open = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -gt 0
        if ($open -ne [bool]$Closed) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Invoke-SiloPsql {
    # Runs SQL as the PostgreSQL superuser over loopback. The password goes
    # through PGPASSWORD for this process only.
    param([Parameter(Mandatory)][string]$Sql, [string]$Database = 'postgres', [switch]$Scalar)
    $layout = Get-SiloLayout
    $psql = Join-Path $layout.PgBin 'psql.exe'
    $old = $env:PGPASSWORD
    $oldOptions = $env:PGOPTIONS
    $env:PGPASSWORD = Get-SiloSecretValue $layout.PgSuperSecret
    $env:PGOPTIONS = '-c client_min_messages=warning'
    try {
        $psqlArgs = @('-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', "$((Get-SiloPorts).PostgreSQL)", '-U', 'postgres', '-d', $Database)
        if ($Scalar) { $psqlArgs += @('-t', '-A') }
        $out = $Sql | & $psql @psqlArgs 2>&1
        if ($LASTEXITCODE -ne 0) { throw "psql fehlgeschlagen: $($out -join ' ')" }
        return $out
    } finally { $env:PGPASSWORD = $old; $env:PGOPTIONS = $oldOptions }
}

function Send-SiloCtrlC {
    # Delivers Ctrl+C to the console of one process, the shutdown signal Silo
    # and Garnet handle (SIGINT). A separate helper process attaches to that
    # console, so this PowerShell session never receives the event.
    param([Parameter(Mandatory)][int]$ProcessId)
    $helper = @"
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class SiloCtrl {
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetConsoleCtrlHandler(IntPtr h, bool add);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);
  public static int Send(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) return Marshal.GetLastWin32Error();
    SetConsoleCtrlHandler(IntPtr.Zero, true);
    if (!GenerateConsoleCtrlEvent(0, 0)) return Marshal.GetLastWin32Error();
    return 0;
  }
}
'@
exit [SiloCtrl]::Send($ProcessId)
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))
    $p = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -WindowStyle Hidden -Wait -PassThru
    return $p.ExitCode
}

function Get-SiloRunFile { param([string]$Name) Join-Path (Get-SiloLayout).Data "run\$Name.json" }

function Save-SiloRunInfo {
    param([string]$Name, [int]$ProcessId)
    $proc = Get-Process -Id $ProcessId
    $file = Get-SiloRunFile $Name
    New-Item -ItemType Directory -Force (Split-Path $file -Parent) | Out-Null
    [ordered]@{ ProcessId = $ProcessId; StartTime = $proc.StartTime.ToUniversalTime().ToString('o'); Path = $proc.Path } | ConvertTo-Json | Set-Content -Path $file -Encoding ascii
}

function Get-SiloRunProcess {
    # The process recorded by Start-Silo.ps1, only if PID, start time and path
    # still match; a reused PID is never mistaken for it.
    param([string]$Name)
    $file = Get-SiloRunFile $Name
    if (-not (Test-Path $file)) { return $null }
    $info = Get-Content $file -Raw | ConvertFrom-Json
    $proc = Get-Process -Id $info.ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { return $null }
    try {
        if ($proc.StartTime.ToUniversalTime().ToString('o') -ne $info.StartTime) { return $null }
        if ($proc.Path -ne $info.Path) { return $null }
    } catch { return $null }
    return $proc
}

function Start-SiloConsoleProcess {
    # Starts a console program in its own hidden console, appending stdout and
    # stderr to a log file. Returns the program's process (not the cmd host).
    param([string]$Name, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [string]$LogFile)
    $quoted = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $cmdLine = '/d /s /c ""' + $FilePath + '" ' + $quoted + ' >> "' + $LogFile + '" 2>&1"'
    $host_ = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList $cmdLine -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(15)
    $child = $null
    while (-not $child -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($host_.Id)" | Where-Object { $_.ExecutablePath -eq $FilePath } | Select-Object -First 1
        if ($host_.HasExited -and -not $child) { break }
    }
    if (-not $child) { throw "$Name ist sofort beendet worden; siehe $LogFile" }
    Save-SiloRunInfo -Name $Name -ProcessId $child.ProcessId
    return Get-Process -Id $child.ProcessId
}

function Stop-SiloRunProcess {
    # Graceful stop through Ctrl+C, forced only after the timeout, and only for
    # the recorded process of this installation.
    param([string]$Name, [int]$TimeoutSeconds = 60)
    $proc = Get-SiloRunProcess $Name
    if (-not $proc) { Remove-Item (Get-SiloRunFile $Name) -ErrorAction SilentlyContinue; return 'not-running' }
    $rc = Send-SiloCtrlC -ProcessId $proc.Id
    if ($rc -ne 0) { Write-SiloWarn "Ctrl+C an $Name (PID $($proc.Id)) nicht zustellbar (Win32-Fehler $rc)" }
    if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
        Write-SiloWarn "$Name hat nach $TimeoutSeconds s nicht beendet; erzwinge Ende von PID $($proc.Id)"
        Stop-Process -Id $proc.Id -Force
        $proc.WaitForExit(10000) | Out-Null
        Remove-Item (Get-SiloRunFile $Name) -ErrorAction SilentlyContinue
        return 'killed'
    }
    Remove-Item (Get-SiloRunFile $Name) -ErrorAction SilentlyContinue
    return 'stopped'
}

function Test-SiloServicesInstalled {
    $names = Get-SiloServiceNames
    return [bool](Get-Service -Name $names.Silo -ErrorAction SilentlyContinue)
}

Export-ModuleMember -Function *
