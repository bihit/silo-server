<#
.SYNOPSIS
  Stops and removes the three Silo services. Data, configuration, logs and
  programs stay; Start-Silo.ps1 -Mode Process keeps working afterwards.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
Assert-SiloAdmin 'Dienste entfernen'
Use-SiloProcessPath
$names = Get-SiloServiceNames
foreach ($n in @($names.Silo, $names.Garnet, $names.PostgreSQL)) {
    $svc = Get-Service $n -ErrorAction SilentlyContinue
    if (-not $svc) { Write-SiloOk "$n nicht vorhanden"; continue }
    if ($svc.Status -ne 'Stopped') { Write-SiloStep "Stoppe $n"; Stop-Service $n; (Get-Service $n).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(120)) }
    Invoke-SiloNative -FilePath "$env:SystemRoot\System32\sc.exe" -Arguments @('delete', $n) -What "sc delete $n" | Out-Null
    Write-SiloOk "$n entfernt"
}
