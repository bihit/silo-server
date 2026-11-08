<#
.SYNOPSIS
  Shows services, processes, ports and HTTP health of this Silo installation.
  Read-only; also reports who holds ports 8020, 8021 and 8096.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
$ports = Get-SiloPorts
Use-SiloProcessPath

Write-SiloStep 'Dienste'
foreach ($n in (Get-SiloServiceNames).Values) {
    $s = Get-CimInstance Win32_Service -Filter "Name='$n'"
    if ($s) { "    {0,-16} {1,-8} {2,-12} {3}" -f $n, $s.State, $s.StartMode, $s.StartName } else { "    {0,-16} nicht installiert" -f $n }
}
Write-SiloStep 'Prozessmodus'
foreach ($n in 'silo', 'garnet') { $p = Get-SiloRunProcess $n; "    {0,-8} {1}" -f $n, $(if ($p) { "PID $($p.Id)" } else { '-' }) }

Write-SiloStep 'Ports'
foreach ($entry in @(@($ports.Silo, 'Silo Web/API/Streaming'), @($ports.Jellyfin, 'Jellyfin/Emby-Kompatibilitaet'), @(8096, 'Jellyfin/Emby-Standardport, nur Info'), @($ports.PostgreSQL, 'PostgreSQL'), @($ports.Garnet, 'Garnet'))) {
    $owners = @(Get-SiloPortOwner -Port $entry[0])
    if ($owners.Count -eq 0) { "    {0,-6} frei             {1}" -f $entry[0], $entry[1] }
    foreach ($o in $owners) { "    {0,-6} {1,-16} PID {2,-7} {3,-14} {4}" -f $entry[0], $o.Address, $o.ProcessId, $o.Name, $entry[1] }
}

Write-SiloStep 'HTTP'
foreach ($url in @("http://127.0.0.1:$($ports.Silo)/api/v1/health", "http://127.0.0.1:$($ports.Silo)/api/v1/ready", "http://127.0.0.1:$($ports.Jellyfin)/System/Info/Public")) {
    try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5; "    {0} {1}" -f $r.StatusCode, $url }
    catch { "    FEHLER {0}: {1}" -f $url, $_.Exception.Message }
}
if (Test-Path (Join-Path $layout.SiloHome 'BUILD')) { Write-SiloStep 'Build'; Get-Content (Join-Path $layout.SiloHome 'BUILD') | ForEach-Object { "    $_" } }
