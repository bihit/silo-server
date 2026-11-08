<#
.SYNOPSIS
  Starts PostgreSQL, Garnet and Silo of this installation.
.DESCRIPTION
  -Mode Service  starts the Windows services (needs Administrator rights).
  -Mode Process  starts the programs directly in hidden consoles, for testing
                 before the services exist. Logs: logs\garnet, logs\silo.
  -Mode Auto     (default) uses the services when they are installed.
  Ports are checked first; a port held by another program is reported, never freed.
#>
[CmdletBinding()]
param([ValidateSet('Auto', 'Service', 'Process')][string]$Mode = 'Auto')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
$ports = Get-SiloPorts
$names = Get-SiloServiceNames
Use-SiloProcessPath

if ($Mode -eq 'Auto') { $Mode = if (Test-SiloServicesInstalled) { 'Service' } else { 'Process' } }
foreach ($f in @($layout.SiloExe, $layout.GarnetExe, $layout.EnvFile)) { if (-not (Test-Path $f)) { throw "Fehlt: $f (Install-SiloDependencies.ps1, Build-Silo.ps1 -Install, Initialize-SiloInstance.ps1)." } }

function Assert-PortFree([int]$Port, [string]$For) {
    $owner = @(Get-SiloPortOwner -Port $Port)
    if ($owner.Count -gt 0) {
        $o = $owner[0]
        $ours = $o.Path -and ($o.Path.StartsWith($layout.Runtime, [StringComparison]::OrdinalIgnoreCase) -or $o.Path.StartsWith($layout.PgBin, [StringComparison]::OrdinalIgnoreCase))
        if ($ours) { return $false }
        throw "Port $Port ($For) ist von $($o.Name) (PID $($o.ProcessId)) belegt. Nichts wurde beendet; bitte Konflikt pruefen."
    }
    return $true
}

$envValues = Read-SiloEnvFile $layout.EnvFile
if ($envValues.Contains('PORT') -and $envValues['PORT'] -ne "$($ports.Silo)") { Write-SiloWarn "silo.env: PORT=$($envValues['PORT'])" }

if ($Mode -eq 'Service') {
    Assert-SiloAdmin 'Dienste starten'
    foreach ($svcName in @($names.PostgreSQL, $names.Garnet, $names.Silo)) {
        $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
        if (-not $svc) { throw "Dienst $svcName fehlt; Install-SiloServices.ps1 ausfuehren." }
        if ($svc.Status -ne 'Running') {
            Write-SiloStep "Starte Dienst $svcName"
            Start-Service $svcName
            (Get-Service $svcName).WaitForStatus('Running', [TimeSpan]::FromSeconds(90))
        } else { Write-SiloOk "$svcName laeuft bereits" }
    }
} else {
    if (Test-SiloServicesInstalled) { Write-SiloWarn 'Dienste sind installiert; Prozessmodus nur verwenden, wenn die Dienste gestoppt sind.' }
    Write-SiloStep 'PostgreSQL'
    $pgCtl = Join-Path $layout.PgBin 'pg_ctl.exe'
    & $pgCtl status -D $layout.PgData | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-SiloOk 'laeuft bereits' }
    else {
        [void](Assert-PortFree $ports.PostgreSQL 'PostgreSQL')
        try { Invoke-SiloStarter -FilePath $pgCtl -What 'pg_ctl start (siehe logs\postgresql)' -Arguments @('start', '-D', $layout.PgData, '-w', '-t', '60', '-l', (Join-Path $layout.Logs 'postgresql\pg_ctl.log')) }
        catch { Write-SiloPgDiagnostics -Port $ports.PostgreSQL; throw }
        Write-SiloOk "127.0.0.1:$($ports.PostgreSQL)"
    }

    Write-SiloStep 'Garnet'
    if (Get-SiloRunProcess 'garnet') { Write-SiloOk 'laeuft bereits' }
    elseif (Assert-PortFree $ports.Garnet 'Garnet') {
        $env:DOTNET_ROOT = $layout.DotNet
        $p = Start-SiloConsoleProcess -Name 'garnet' -FilePath $layout.GarnetExe -Arguments @('--config-import-path', (Join-Path $layout.Config 'garnet.conf')) -WorkingDirectory $layout.GarnetData -LogFile (Join-Path $layout.Logs 'garnet\garnet.log')
        if (-not (Wait-SiloPort -Port $ports.Garnet -TimeoutSeconds 30)) { throw 'Garnet lauscht nicht; siehe logs\garnet\garnet.log' }
        Write-SiloOk "PID $($p.Id), 127.0.0.1:$($ports.Garnet)"
    } else { throw "Port $($ports.Garnet) ist von einem Garnet-Prozess dieser Installation belegt, der nicht ueber Start-Silo.ps1 gestartet wurde." }

    Write-SiloStep 'Silo'
    if (Get-SiloRunProcess 'silo') { Write-SiloOk 'laeuft bereits' }
    else {
        [void](Assert-PortFree $ports.Silo 'Silo')
        [void](Assert-PortFree $ports.Jellyfin 'Jellyfin-Kompatibilitaet')
        $p = Start-SiloConsoleProcess -Name 'silo' -FilePath $layout.SiloExe -Arguments @('-env', $layout.EnvFile) -WorkingDirectory $layout.SiloHome -LogFile (Join-Path $layout.Logs 'silo\silo.log')
        Write-SiloOk "PID $($p.Id)"
    }
}

Write-SiloStep 'Warte auf HTTP'
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($ports.Silo)/api/v1/ready" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) { throw "Silo meldet nicht bereit auf http://127.0.0.1:$($ports.Silo)/api/v1/ready; siehe $(Join-Path $layout.Logs 'silo')" }
Write-SiloOk "Weboberflaeche: http://localhost:$($ports.Silo)"
Write-SiloOk "Jellyfin/Emby-Kompatibilitaet: http://localhost:$($ports.Jellyfin)"
exit 0
