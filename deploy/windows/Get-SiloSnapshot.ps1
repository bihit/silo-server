<#
.SYNOPSIS
  Read-only troubleshooting snapshot of the native Windows install of Silo,
  the counterpart of silo-snapshot.sh from the silo-troubleshooting skill
  for hosts without Docker.

.DESCRIPTION
  Collects services, processes, ports, HTTP health, build, PostgreSQL state,
  disks, media folder reachability, ffmpeg and a summary of warnings and
  errors from the Silo log. It changes nothing: no restarts, no writes, no
  database changes. Secrets, tokens and IP addresses are masked; the
  configuration and the environment are never printed.

.EXAMPLE
  .\Get-SiloSnapshot.ps1
  .\Get-SiloSnapshot.ps1 -SinceHours 24 -Top 30
#>
[CmdletBinding()]
param(
    [int]$SinceHours = 6,
    [int]$Top = 25,
    [int]$RecentLines = 30
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
$ports = Get-SiloPorts
Use-SiloProcessPath

function Section { param([string]$Title) ''; "===== $Title =====" }

# Second net behind Silo's own redaction: credentials, bearer tokens, API
# keys and IP addresses never reach the output.
function Protect-Line {
    param([string]$Line)
    $l = $Line
    $l = $l -replace '(?i)(postgres(ql)?|rediss?)://[^@/\s]+@', '$1://[REDACTED]@'
    $l = $l -replace '(?i)(bearer )[A-Za-z0-9._~+/=-]+', '$1[REDACTED]'
    $l = $l -replace 'sa_[A-Za-z0-9_-]{8,}', 'sa_[REDACTED]'
    $l = $l -replace '(?i)([A-Za-z_-]*(secret|password|token|api_?key|master_?key)[A-Za-z_-]*=)("?)[^\s",&]+', '$1$3[REDACTED]'
    $l = $l -replace '(?i)(client_ip|remote_addr|remote_ip|ip)=("?)[^\s"]+', '$1=$2[IP]'
    $l = $l -replace '\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b', '[IP]'
    $l = $l -replace '\b([0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}\b', '[IP]'
    return $l
}

# Reads a log another process is still writing to.
function Read-SharedLines {
    param([string]$Path)
    $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
    try { while ($null -ne ($line = $sr.ReadLine())) { $line } } finally { $sr.Dispose() }
}

function Format-Size { param([double]$Bytes) if ($Bytes -ge 1TB) { '{0:N1} TB' -f ($Bytes / 1TB) } elseif ($Bytes -ge 1GB) { '{0:N1} GB' -f ($Bytes / 1GB) } else { '{0:N0} MB' -f ($Bytes / 1MB) } }

Section 'Zeit und System'
(Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
$os = Get-CimInstance Win32_OperatingSystem
'{0} {1}, Uptime {2:N1} Tage, RAM frei {3} von {4}' -f $os.Caption, $os.Version, ((Get-Date) - $os.LastBootUpTime).TotalDays, (Format-Size ($os.FreePhysicalMemory * 1KB)), (Format-Size ($os.TotalVisibleMemorySize * 1KB))

Section 'Silo-Build'
$buildFile = Join-Path $layout.SiloHome 'BUILD'
if (Test-Path $buildFile) { Get-Content $buildFile } else { 'BUILD-Datei fehlt' }

Section 'Dienste'
$serviceNames = @((Get-SiloServiceNames).Values) + 'silo-caddy'
foreach ($n in $serviceNames) {
    $s = Get-CimInstance Win32_Service -Filter "Name='$n'"
    if ($s) { '{0,-16} {1,-8} {2,-10} PID {3}' -f $n, $s.State, $s.StartMode, $s.ProcessId } else { '{0,-16} nicht installiert' -f $n }
}
$shawlLogs = @(Get-ChildItem (Join-Path $layout.Logs 'silo') -Filter 'shawl_for_silo-server_*.log' -ErrorAction SilentlyContinue)
$launches = @($shawlLogs | ForEach-Object { Select-String -Path $_.FullName -SimpleMatch '********** LAUNCH **********' } | ForEach-Object { $_.Line.Substring(0, 19) } | Sort-Object)
'silo-server Dienststarts (Shawl-Logs): {0}, letzter {1}' -f $launches.Count, $(if ($launches.Count) { $launches[-1] } else { '-' })

Section 'Prozesse'
foreach ($p in @(Get-SiloOwnedProcess)) {
    $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    if (-not $gp) { continue }
    '{0,-18} PID {1,-7} RAM {2,-9} CPU-Zeit {3,8:N0} s  Threads {4,-4} Handles {5,-6} seit {6}' -f $p.Name, $p.ProcessId, (Format-Size $gp.WorkingSet64), $gp.TotalProcessorTime.TotalSeconds, $gp.Threads.Count, $gp.HandleCount, $gp.StartTime.ToString('yyyy-MM-dd HH:mm')
}

Section 'Ports (nur Bindungsart, keine Adressen)'
foreach ($entry in @(@($ports.Silo, 'Silo Web/API/Streaming'), @($ports.Jellyfin, 'Jellyfin-Kompatibilitaet'), @(8096, 'Jellyfin/Emby-Standardport, nur Info'), @($ports.PostgreSQL, 'PostgreSQL'), @($ports.Garnet, 'Garnet'))) {
    $owners = @(Get-SiloPortOwner -Port $entry[0])
    if ($owners.Count -eq 0) { '{0,-6} frei  {1}' -f $entry[0], $entry[1]; continue }
    $scope = if (@($owners | Where-Object { $_.Address -notin @('127.0.0.1', '::1') }).Count) { 'alle/externe Schnittstellen' } else { 'nur Loopback' }
    '{0,-6} {1,-14} {2,-28} {3}' -f $entry[0], (($owners | Select-Object -ExpandProperty Name -Unique) -join ','), $scope, $entry[1]
}

Section 'HTTP-Health'
foreach ($url in @("http://127.0.0.1:$($ports.Silo)/api/v1/health", "http://127.0.0.1:$($ports.Silo)/api/v1/ready", "http://127.0.0.1:$($ports.Jellyfin)/System/Info/Public")) {
    $u = [uri]$url
    $label = '{0} {1}' -f $u.Port, $u.PathAndQuery
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        $body = ''
        if ($u.PathAndQuery -like '/api/v1/*') {
            $b = Protect-Line ($r.Content -replace '\s+', ' ')
            $body = ' ' + $b.Substring(0, [Math]::Min(300, $b.Length))
        }
        '{0} {1,-26} {2,5} ms{3}' -f $r.StatusCode, $label, $sw.ElapsedMilliseconds, $body
    } catch { 'FEHLER {0}: {1}' -f $label, (Protect-Line $_.Exception.Message) }
}

Section 'PostgreSQL'
try {
    Invoke-SiloPsql -Database silo -Scalar -Sql "select 'Version: ' || current_setting('server_version') || ', DB-Groesse: ' || pg_size_pretty(pg_database_size('silo'));"
    Invoke-SiloPsql -Database silo -Sql "select coalesce(state,'(bg)') as state, count(*) as verbindungen, coalesce(max(extract(epoch from now()-query_start))::int,0) as aelteste_s from pg_stat_activity where datname='silo' group by 1 order by 2 desc;"
    Invoke-SiloPsql -Database silo -Scalar -Sql "select 'Wartende Sperren: ' || count(*) from pg_locks where not granted;"
} catch { 'FEHLER: ' + (Protect-Line $_.Exception.Message) }
$pgLog = Get-ChildItem (Join-Path $layout.Logs 'postgresql') -Filter 'postgresql-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 2
$pgIssues = @($pgLog | ForEach-Object { Read-SharedLines $_.FullName } | Where-Object { $_ -match '\b(FATAL|PANIC|ERROR):' })
"FATAL/PANIC/ERROR in den letzten beiden PostgreSQL-Logs: $($pgIssues.Count) (auch fehlerhafte manuelle Abfragen zaehlen mit)"
$pgIssues | ForEach-Object { ($_ -replace '^.*?\b(FATAL|PANIC|ERROR):\s*', '$1: ') -replace ' at character \d+$', '' } |
    Group-Object | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object { '{0,6} {1}' -f $_.Count, (Protect-Line $_.Name) }

Section 'Laufwerke'
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    $pct = if ($_.Size) { 100 * $_.FreeSpace / $_.Size } else { 0 }
    '{0} {1,-16} frei {2,9} von {3,9} ({4,5:N1} %){5}' -f $_.DeviceID, $_.VolumeName, (Format-Size $_.FreeSpace), (Format-Size $_.Size), $pct, $(if ($pct -lt 5) { '  <-- knapp' } else { '' })
}

Section 'Bibliotheksordner erreichbar'
try {
    $paths = @(Invoke-SiloPsql -Database silo -Scalar -Sql "select distinct path from media_folder_paths order by 1;" | Where-Object { $_ })
    $missing = @($paths | Where-Object { -not (Test-Path -LiteralPath $_) })
    "{0} Pfade, {1} nicht erreichbar" -f $paths.Count, $missing.Count
    $missing | ForEach-Object { "  FEHLT: $_" }
} catch { 'FEHLER: ' + (Protect-Line $_.Exception.Message) }

Section 'ffmpeg'
foreach ($exe in @($layout.FFmpegExe, (Join-Path $layout.FFmpegDir 'ffprobe.exe'))) {
    if (Test-Path $exe) { $v = @(& $exe -hide_banner -version); $v[0] } else { "fehlt: $exe" }
}
$global:LASTEXITCODE = 0

Section "Haeufigste Warnungen und Fehler, letzte $SinceHours h"
$cutoff = (Get-Date).AddHours(-$SinceHours)
$logFiles = Get-ChildItem (Join-Path $layout.Logs 'silo') -Filter 'silo_r*.log' | Where-Object { $_.LastWriteTime -ge $cutoff } | Sort-Object LastWriteTime
$groups = @{}
$recent = New-Object System.Collections.Generic.List[string]
$pattern = '^time=(\S+) level=(WARN|ERROR) msg="((?:[^"\\]|\\.)*)"'
foreach ($f in $logFiles) {
    foreach ($line in (Read-SharedLines $f.FullName)) {
        $m = [regex]::Match($line, $pattern)
        if (-not $m.Success) { continue }
        if ([datetimeoffset]::Parse($m.Groups[1].Value).LocalDateTime -lt $cutoff) { continue }
        $key = '{0} {1}' -f $m.Groups[2].Value, $m.Groups[3].Value
        if ($groups.ContainsKey($key)) { $groups[$key]++ } else { $groups[$key] = 1 }
        $recent.Add($line)
    }
}
$err = ($groups.GetEnumerator() | Where-Object { $_.Key -like 'ERROR *' } | Measure-Object -Property Value -Sum).Sum
$warn = ($groups.GetEnumerator() | Where-Object { $_.Key -like 'WARN *' } | Measure-Object -Property Value -Sum).Sum
'Gesamt: {0} Fehler, {1} Warnungen' -f [int]$err, [int]$warn
$groups.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First $Top | ForEach-Object { '{0,6} {1}' -f $_.Value, (Protect-Line $_.Key) }

Section "Letzte $RecentLines Warnungen/Fehler (maskiert)"
$recent | Select-Object -Last $RecentLines | ForEach-Object { $t = Protect-Line $_; if ($t.Length -gt 400) { $t.Substring(0, 400) + ' ...' } else { $t } }

''
'Snapshot fertig. Vor dem Weitergeben auf private Angaben (Namen, Pfade, Titel) pruefen.'
