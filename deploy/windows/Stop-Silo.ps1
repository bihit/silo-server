<#
.SYNOPSIS
  Stops Silo, Garnet and PostgreSQL of this installation, in that order.
.DESCRIPTION
  Silo and Garnet receive Ctrl+C and shut down gracefully; only after the
  timeout is the recorded process of this installation ended. PostgreSQL stops
  with pg_ctl (fast mode). Other programs, whatever port they use, are
  never touched. -Mode works as in Start-Silo.ps1. -KeepDatabase leaves
  PostgreSQL and Garnet running.
#>
[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Service', 'Process')][string]$Mode = 'Auto',
    [switch]$KeepDatabase,
    [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
$names = Get-SiloServiceNames
Use-SiloProcessPath

if ($Mode -eq 'Auto') {
    $Mode = 'Process'
    if ((Test-SiloServicesInstalled) -and ((Get-Service $names.Silo).Status -ne 'Stopped' -or (Get-Service $names.PostgreSQL -ErrorAction SilentlyContinue | Where-Object Status -ne 'Stopped'))) { $Mode = 'Service' }
    if ((Get-SiloRunProcess 'silo') -or (Get-SiloRunProcess 'garnet')) { $Mode = 'Process' }
}

$order = @($names.Silo)
if (-not $KeepDatabase) { $order += @($names.Garnet, $names.PostgreSQL) }

if ($Mode -eq 'Service') {
    Assert-SiloAdmin 'Dienste stoppen'
    foreach ($svcName in $order) {
        $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
        if (-not $svc -or $svc.Status -eq 'Stopped') { Write-SiloOk "$svcName ist gestoppt"; continue }
        Write-SiloStep "Stoppe Dienst $svcName"
        Stop-Service $svcName
        (Get-Service $svcName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds($TimeoutSeconds + 30))
        Write-SiloOk 'gestoppt'
    }
} else {
    Write-SiloStep 'Silo'
    Write-SiloOk (Stop-SiloRunProcess -Name 'silo' -TimeoutSeconds $TimeoutSeconds)
    if (-not $KeepDatabase) {
        Write-SiloStep 'Garnet'
        Write-SiloOk (Stop-SiloRunProcess -Name 'garnet' -TimeoutSeconds 20)
        Write-SiloStep 'PostgreSQL'
        $pgCtl = Join-Path $layout.PgBin 'pg_ctl.exe'
        & $pgCtl status -D $layout.PgData | Out-Null
        if ($LASTEXITCODE -eq 0) { Invoke-SiloNative -FilePath $pgCtl -What 'pg_ctl stop' -Arguments @('stop', '-D', $layout.PgData, '-m', 'fast', '-w', '-t', '60'); Write-SiloOk 'gestoppt' }
        else { Write-SiloOk 'ist gestoppt' }
    }
}
$left = @(Get-SiloOwnedProcess | Where-Object { $KeepDatabase -eq $false -or $_.ExecutablePath -like "$($layout.SiloHome)*" })
if ($left.Count -gt 0) { Write-SiloWarn ("Noch laufende Prozesse dieser Installation: " + (($left | ForEach-Object { "$($_.Name) ($($_.ProcessId))" }) -join ', ')) }
else { Write-SiloStep 'Alles gestoppt.' }
