<#
.SYNOPSIS
  Builds the web frontend and a native silo.exe, then bundles the DLLs it needs.
.DESCRIPTION
  Output goes to <InstallRoot>\build\silo-dist\ (bin\silo.exe, its MinGW DLLs,
  and lib\vips-modules-* so libvips finds its HEIF module relative to bin).
  With -Install the bundle replaces runtime\silo; the silo-server service, if
  it runs, is stopped first and started again afterwards. No other process is
  touched. The build never needs Administrator rights; -Install does only when
  it has to stop or start the service.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$SkipFrontend
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
$v = Get-SiloVersions
Use-SiloProcessPath -Prepend @($layout.MsysBin, (Join-Path $layout.GoRoot 'bin'), $layout.Node)

foreach ($tool in @((Join-Path $layout.GoRoot 'bin\go.exe'), (Join-Path $layout.MsysBin 'gcc.exe'), (Join-Path $layout.MsysBin 'pkg-config.exe'), (Join-Path $layout.Node 'node.exe'))) {
    if (-not (Test-Path $tool)) { throw "Werkzeug fehlt: $tool. Zuerst Install-SiloDependencies.ps1 ausfuehren." }
}

Push-Location $layout.Repo
try {
    $revision = (& git rev-parse HEAD).Trim()
    $dirty = if (& git status --porcelain) { 'true' } else { 'false' }
    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
    Write-SiloStep "Quelle: $branch @ $revision (dirty=$dirty)"

    # --- Frontend (embedded into silo.exe through go:embed of web/dist) ---------
    if (-not $SkipFrontend) {
        Write-SiloStep "Frontend (pnpm $($v.Pnpm))"
        $env:COREPACK_HOME = Join-Path $layout.Runtime 'corepack'
        $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
        $corepack = Join-Path $layout.Node 'corepack.cmd'
        Push-Location (Join-Path $layout.Repo 'web')
        try {
            Invoke-SiloNative -FilePath $corepack -Arguments @("pnpm@$($v.Pnpm)", 'install', '--frozen-lockfile') -What 'pnpm install'
            Invoke-SiloNative -FilePath $corepack -Arguments @("pnpm@$($v.Pnpm)", 'run', 'build') -What 'pnpm run build'
        } finally { Pop-Location }
        Write-SiloOk 'web\dist gebaut'
    } elseif (-not (Test-Path (Join-Path $layout.Repo 'web\dist\index.html'))) {
        throw 'web\dist fehlt; ohne -SkipFrontend bauen.'
    }

    # --- Go ---------------------------------------------------------------------
    Write-SiloStep 'silo.exe (CGO, MinGW UCRT64, libvips)'
    $env:CGO_ENABLED = '1'; $env:CC = 'gcc'; $env:GOTOOLCHAIN = 'local'; $env:PKG_CONFIG = 'pkg-config'
    $dist = Join-Path $layout.Build 'silo-dist'
    if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
    $distBin = Join-Path $dist 'bin'
    New-Item -ItemType Directory -Force $distBin | Out-Null
    $pkg = 'github.com/Silo-Server/silo-server/internal/buildinfo'
    $builtAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $ldflags = "-X $pkg.revisionOverride=$revision -X $pkg.dirtyOverride=$dirty -X $pkg.buildNumberOverride= -X $pkg.builtAtOverride=$builtAt"
    Invoke-SiloNative -FilePath 'go' -Arguments @('build', '-trimpath', '-ldflags', $ldflags, '-o', (Join-Path $distBin 'silo.exe'), './cmd/silo/') -What 'go build'
    Write-SiloOk (Join-Path $distBin 'silo.exe')
} finally { Pop-Location }

# --- DLL bundle ---------------------------------------------------------------
Write-SiloStep 'DLLs buendeln'
function ConvertTo-MsysPath([string]$p) { '/' + $p.Substring(0, 1).ToLower() + $p.Substring(2).Replace('\', '/') }
$vipsModules = Get-ChildItem (Join-Path $layout.Msys 'ucrt64\lib') -Directory -Filter 'vips-modules-*' | Select-Object -First 1
$targets = @(Join-Path $distBin 'silo.exe')
if ($vipsModules) {
    # Only modules whose dependencies are installed; jxl, magick, openslide and
    # poppler stay out unless their libraries are present.
    $modDest = Join-Path $dist ('lib\' + $vipsModules.Name)
    New-Item -ItemType Directory -Force $modDest | Out-Null
    foreach ($mod in Get-ChildItem $vipsModules.FullName -Filter *.dll) {
        # api-ms-win-* are API sets the Windows loader resolves; ldd cannot.
        $missing = Invoke-SiloMsysCapture "ldd '$(ConvertTo-MsysPath $mod.FullName)' | grep -v 'api-ms-win-' | grep -c 'not found' || true"
        if ([int]($missing | Select-Object -Last 1) -eq 0) { Copy-Item $mod.FullName $modDest; $targets += (Join-Path $modDest $mod.Name) }
    }
}
$dlls = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
foreach ($t in $targets) {
    $out = Invoke-SiloMsysCapture "ldd '$(ConvertTo-MsysPath $t)'"
    foreach ($line in $out) {
        $m = [regex]::Match($line, '=>\s+(/ucrt64/bin/\S+\.dll)')
        if ($m.Success) { [void]$dlls.Add((Join-Path $layout.MsysBin ([IO.Path]::GetFileName($m.Groups[1].Value)))) }
        if ($line -match 'not found' -and $line -notmatch 'api-ms-win-') { throw "Fehlende DLL fuer ${t}: $line" }
    }
}
foreach ($dll in $dlls) { Copy-Item $dll $distBin }
Write-SiloOk "$($dlls.Count) DLLs aus MSYS2 UCRT64, vips-Module: $(@(Get-ChildItem -Recurse (Join-Path $dist 'lib') -Filter *.dll -ErrorAction SilentlyContinue).Name -join ', ')"

# A plain Windows process with only System32 on PATH must load silo.exe; a
# missing DLL ends it with STATUS_DLL_NOT_FOUND (0xC0000135) before main runs.
$psi = New-Object Diagnostics.ProcessStartInfo (Join-Path $distBin 'silo.exe'), '-h'
$psi.UseShellExecute = $false; $psi.RedirectStandardError = $true; $psi.RedirectStandardOutput = $true
$psi.WorkingDirectory = $distBin
$psi.EnvironmentVariables['PATH'] = "$env:SystemRoot\System32;$env:SystemRoot"
$probe = [Diagnostics.Process]::Start($psi)
$null = $probe.StandardError.ReadToEnd(); $null = $probe.StandardOutput.ReadToEnd()
$probe.WaitForExit()
if ($probe.ExitCode -ne 0) { throw ("Ladetest von silo.exe ohne MSYS2 im PATH fehlgeschlagen: Exitcode 0x{0:X8}" -f $probe.ExitCode) }
Write-SiloOk 'Ladetest ohne MSYS2 im PATH bestanden'
Set-Content -Path (Join-Path $dist 'BUILD') -Value "branch=$branch`nrevision=$revision`ndirty=$dirty`nbuilt_at=$builtAt" -Encoding ascii

# --- Install --------------------------------------------------------------------
if ($Install) {
    Write-SiloStep "Installation nach $($layout.SiloHome)"
    $svcName = (Get-SiloServiceNames).Silo
    $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
    $wasRunning = $svc -and $svc.Status -eq 'Running'
    if ($wasRunning) { Assert-SiloAdmin "Dienst $svcName stoppen"; Stop-Service $svcName; (Get-Service $svcName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90)) }
    $running = @(Get-SiloOwnedProcess | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($layout.SiloHome, [StringComparison]::OrdinalIgnoreCase) })
    if ($running.Count -gt 0) { throw "silo.exe laeuft noch (PID $($running[0].ProcessId)). Zuerst Stop-Silo.ps1 ausfuehren." }
    if (Test-Path $layout.SiloHome) {
        $previous = $layout.SiloHome + '.previous'
        if (Test-Path $previous) { Remove-Item -Recurse -Force $previous }
        Move-Item $layout.SiloHome $previous
        Write-SiloOk "vorherige Version gesichert: $previous"
    }
    Copy-Item -Recurse $dist $layout.SiloHome
    if ($wasRunning) { Start-Service $svcName; Write-SiloOk "Dienst $svcName wieder gestartet" }
    Write-SiloOk $layout.SiloExe
}
Write-SiloStep 'Build fertig.'
