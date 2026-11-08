<#
.SYNOPSIS
  One-step setup of an installed package: instance, Windows services, start.
.DESCRIPTION
  Runs after the MSI/EXE installer copied the files (or after a source
  install built runtime\silo). It
    1. creates config, secrets, the PostgreSQL cluster and the database
       (Initialize-SiloInstance.ps1),
    2. registers silo-postgresql, silo-garnet and silo-server as Windows
       services (Install-SiloServices.ps1),
    3. starts them and waits until Silo answers.
  Safe to re-run; nothing that exists is overwritten. It opens no firewall
  port: the web UI is reachable on this computer until you allow more.
  Restarts itself elevated when it is not run as Administrator.
#>
[CmdletBinding()]
param(
    # Turn video and download transcoding off (direct play and stream copies only).
    [switch]$StreamCopyOnly,
    # Keep the window open at the end (used by the Start menu shortcut).
    [switch]$Pause
)
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Pause')
    if ($StreamCopyOnly) { $argList += '-StreamCopyOnly' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs
    return
}

try {
    Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
    $layout = Get-SiloLayout
    $ports = Get-SiloPorts
    if (-not (Test-Path $layout.SiloExe)) { throw "silo.exe fehlt ($($layout.SiloExe)). Installation unvollstaendig?" }

    & (Join-Path $PSScriptRoot 'Initialize-SiloInstance.ps1') -StreamCopyOnly:$StreamCopyOnly
    & (Join-Path $PSScriptRoot 'Install-SiloServices.ps1')
    & (Join-Path $PSScriptRoot 'Start-Silo.ps1') -Mode Service

    Write-SiloStep 'Warten auf Silo'
    $url = "http://127.0.0.1:$($ports.Silo)"
    $ready = $false
    for ($i = 0; $i -lt 120 -and -not $ready; $i++) {
        try { $ready = (Invoke-WebRequest "$url/api/v1/ready" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { Start-Sleep -Seconds 2 }
    }
    if ($ready) {
        Write-SiloOk "Silo laeuft: $url  (Jellyfin-Apps: Port $($ports.Jellyfin))"
        Write-Host '    Beim ersten Aufruf legst du das Administratorkonto an.'
        Write-Host '    Andere Geraete im Netz erreichen Silo erst, wenn du die Ports in der Windows-Firewall freigibst.'
        Start-Process $url
    } else {
        Write-SiloWarn "Silo antwortet noch nicht. Logs: $(Join-Path $layout.Logs 'silo')"
    }
} catch {
    Write-Host "FEHLER: $($_.Exception.Message)" -ForegroundColor Red
    if ($Pause) { Read-Host 'Enter zum Schliessen' | Out-Null }
    exit 1
}
if ($Pause) { Read-Host 'Enter zum Schliessen' | Out-Null }
