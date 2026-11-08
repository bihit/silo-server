<#
.SYNOPSIS
  Stages a self-contained Windows package and builds the MSI and EXE installers.
.DESCRIPTION
  Collects into <InstallRoot>\build\package\root everything a test machine needs,
  without Go, Node or MSYS2:
    runtime\silo     the bundle from Build-Silo.ps1 (silo.exe, DLLs, vips modules)
    runtime\pgsql    PostgreSQL 18 + pgvector from MSYS2 UCRT64 (bin, lib, share)
    runtime\garnet, runtime\dotnet, runtime\shawl, runtime\ffmpeg
    silo-server\     the deploy\windows scripts and the license files
  No data, configuration, secrets or logs of this machine are copied: those
  folders are created on the target by Setup-Silo.ps1.
  With the WiX Toolset 5 'wix' command on PATH (or -Wix) it then builds
  out\<Name>-<Version>.msi and out\<Name>-<Version>-Setup.exe.
#>
[CmdletBinding()]
param(
    [string]$Version = '0.1.0',
    [string]$Wix,
    [switch]$SkipInstallers
)
$ErrorActionPreference = 'Stop'
$scripts = Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $scripts 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
Use-SiloProcessPath -Prepend @($layout.MsysBin)

$pkg = Join-Path $layout.Build 'package'
$root = Join-Path $pkg 'root'
$out = Join-Path $pkg 'out'
if (Test-Path $root) { Remove-Item -Recurse -Force $root }
New-Item -ItemType Directory -Force -Path $root, $out | Out-Null
$rt = Join-Path $root 'runtime'

# --- Silo ---------------------------------------------------------------------
Write-SiloStep 'Silo'
$dist = Join-Path $layout.Build 'silo-dist'
if (-not (Test-Path (Join-Path $dist 'bin\silo.exe'))) { throw 'build\silo-dist fehlt; zuerst Build-Silo.ps1 ausfuehren.' }
Copy-Item -Recurse $dist (Join-Path $rt 'silo')
Write-SiloOk (Get-Content (Join-Path $dist 'BUILD') | Where-Object { $_ -match '^revision=' })

# --- PostgreSQL from MSYS2 ------------------------------------------------------
Write-SiloStep 'PostgreSQL'
function ConvertTo-MsysPath([string]$p) { '/' + $p.Substring(0, 1).ToLower() + $p.Substring(2).Replace('\', '/') }
$ucrt = Join-Path $layout.Msys 'ucrt64'
$pg = Join-Path $rt 'pgsql'
$pgBinOut = Join-Path $pg 'bin'
New-Item -ItemType Directory -Force -Path $pgBinOut | Out-Null
$programs = 'postgres', 'pg_ctl', 'initdb', 'psql', 'pg_dump', 'pg_dumpall', 'pg_restore', 'pg_isready', 'pg_controldata', 'pg_upgrade', 'pg_resetwal', 'pg_checksums'
$targets = @()
foreach ($p in $programs) {
    $src = Join-Path $layout.MsysBin "$p.exe"
    if (-not (Test-Path $src)) { throw "Fehlt: $src" }
    Copy-Item $src $pgBinOut
    $targets += $src
}
Copy-Item -Recurse (Join-Path $ucrt 'lib\postgresql') (Join-Path $pg 'lib\postgresql')
Copy-Item -Recurse (Join-Path $ucrt 'share\postgresql') (Join-Path $pg 'share\postgresql')
# Modules whose runtime is not installed (PL/Perl, PL/Python, PL/Tcl) stay
# out; Silo uses none of them.
$dropped = @()
foreach ($mod in Get-ChildItem (Join-Path $ucrt 'lib\postgresql') -Filter *.dll) {
    $missing = Invoke-SiloMsysCapture "ldd '$(ConvertTo-MsysPath $mod.FullName)' | grep -v 'api-ms-win-' | grep -c 'not found' || true"
    if ([int]($missing | Select-Object -Last 1) -eq 0) { $targets += $mod.FullName }
    else { Remove-Item (Join-Path $pg "lib\postgresql\$($mod.Name)"); $dropped += $mod.BaseName }
}
if ($dropped.Count -gt 0) { Write-SiloOk "ohne Laufzeit weggelassen: $($dropped -join ', ')" }
foreach ($ext in 'vector', 'citext', 'pg_trgm') {
    if (-not (Test-Path (Join-Path $pg "share\postgresql\extension\$ext.control"))) { throw "Erweiterung $ext fehlt in MSYS2." }
}
$dlls = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
foreach ($t in $targets) {
    foreach ($line in (Invoke-SiloMsysCapture "ldd '$(ConvertTo-MsysPath $t)'")) {
        $m = [regex]::Match($line, '=>\s+(/ucrt64/bin/\S+\.dll)')
        if ($m.Success) { [void]$dlls.Add((Join-Path $layout.MsysBin ([IO.Path]::GetFileName($m.Groups[1].Value)))) }
        if ($line -match 'not found' -and $line -notmatch 'api-ms-win-') { throw "Fehlende DLL fuer ${t}: $line" }
    }
}
foreach ($dll in $dlls) { Copy-Item $dll $pgBinOut }
$pgVersion = (& (Join-Path $pgBinOut 'postgres.exe') -V).Trim()
Write-SiloOk "$pgVersion, $($dlls.Count) DLLs, Erweiterungen vector/citext/pg_trgm"

# --- Garnet, .NET, Shawl, FFmpeg ----------------------------------------------------
Write-SiloStep 'Garnet, .NET, Shawl, FFmpeg'
foreach ($name in 'garnet', 'dotnet', 'shawl', 'ffmpeg') {
    $src = Join-Path $layout.Runtime $name
    if (-not (Test-Path $src)) { throw "Fehlt: $src (Install-SiloDependencies.ps1)" }
    Copy-Item -Recurse $src (Join-Path $rt $name)
}
$ffVersion = ((& (Join-Path $rt 'ffmpeg\ffmpeg.exe') -hide_banner -version 2>&1) | Select-Object -First 1)
$global:LASTEXITCODE = 0
Write-SiloOk $ffVersion

# --- Scripts and notices -------------------------------------------------------------
Write-SiloStep 'Skripte und Lizenzen'
$repoOut = Join-Path $root 'silo-server'
$scriptsOut = Join-Path $repoOut 'deploy\windows'
New-Item -ItemType Directory -Force -Path $scriptsOut | Out-Null
foreach ($f in 'SiloWindows.psm1', 'Setup-Silo.ps1', 'Initialize-SiloInstance.ps1', 'Install-SiloServices.ps1', 'Uninstall-SiloServices.ps1',
        'Start-Silo.ps1', 'Stop-Silo.ps1', 'Get-SiloStatus.ps1', 'Get-SiloSnapshot.ps1', 'Backup-Silo.ps1', 'Install-SiloHttps.ps1', 'README.md') {
    Copy-Item (Join-Path $scripts $f) $scriptsOut
}
foreach ($f in 'LICENSE', 'NOTICE', 'TRADEMARK.md', 'PLATFORM-EXCEPTION.md') {
    $src = Join-Path $layout.Repo $f
    if (Test-Path $src) { Copy-Item $src $repoOut }
}
Copy-Item (Join-Path $PSScriptRoot 'THIRD-PARTY-NOTICES.md') $root
Copy-Item (Join-Path $PSScriptRoot 'README-PACKAGE.md') (Join-Path $root 'README.md')
$build = Get-Content (Join-Path $dist 'BUILD')
@("version=$Version") + $build + @("postgresql=$pgVersion", "ffmpeg=$ffVersion") | Set-Content -Encoding ascii (Join-Path $root 'PACKAGE')

# Nothing personal may travel: no config, data, logs or secrets in the stage.
foreach ($bad in 'config', 'data', 'logs', 'backups') {
    if (Test-Path (Join-Path $root $bad)) { throw "Ordner $bad darf nicht im Paket sein." }
}
$secretish = @(Get-ChildItem -Recurse $root -File -Include *.env, *.secret, applied-settings.json -ErrorAction SilentlyContinue)
# Garnet's own sample garnet.conf ships with the release; ours carries a password.
$secretish += @(Get-ChildItem -Recurse $root -File -Filter garnet.conf | Where-Object { (Get-Content $_.FullName -Raw) -match '"Password"\s*:' })
if ($secretish.Count -gt 0) { throw "Geheimnisdateien im Paket: $($secretish.FullName -join ', ')" }
$size = (Get-ChildItem -Recurse $root -File | Measure-Object Length -Sum).Sum
Write-SiloOk ("{0:N0} MB in {1}" -f ($size / 1MB), $root)

if ($SkipInstallers) { Write-SiloStep 'Paket bereit (ohne Installer).'; return }

# --- Installers (WiX Toolset 5) ---------------------------------------------------------
Write-SiloStep 'MSI und EXE (WiX 5)'
if (-not $Wix) { $Wix = (Get-Command wix -ErrorAction SilentlyContinue).Source }
if (-not $Wix -or -not (Test-Path $Wix)) { throw 'wix nicht gefunden: WiX Toolset 5 installieren oder -Wix angeben.' }
# The WixToolset.Bal.wixext 5.0.2 package ships its DLL under the newer name
# WixToolset.BootstrapperApplications.wixext.dll, which "wix -ext" by package
# id does not find; name the file directly when it is in the cache.
$balExt = 'WixToolset.Bal.wixext'
$balDll = Join-Path $env:USERPROFILE '.wix\extensions\WixToolset.Bal.wixext\5.0.2\wixext5\WixToolset.BootstrapperApplications.wixext.dll'
if (Test-Path $balDll) { $balExt = $balDll }
$name = 'SiloWindowsTest'
$msi = Join-Path $out "$name-$Version.msi"
$exe = Join-Path $out "$name-$Version-Setup.exe"
$wixArgs = @('-arch', 'x64', '-d', "Version=$Version", '-d', "StageDir=$root", '-ext', 'WixToolset.UI.wixext', '-ext', 'WixToolset.Util.wixext')
Invoke-SiloNative -FilePath $Wix -What 'wix build (MSI)' -Arguments (@('build', (Join-Path $PSScriptRoot 'Package.wxs')) + $wixArgs + @('-o', $msi))
Invoke-SiloNative -FilePath $Wix -What 'wix build (EXE)' -Arguments @('build', (Join-Path $PSScriptRoot 'Bundle.wxs'), '-arch', 'x64',
    '-d', "Version=$Version", '-d', "MsiPath=$msi", '-d', "LicenseFile=$(Join-Path $PSScriptRoot 'License.rtf')",
    '-ext', 'WixToolset.Util.wixext', '-ext', $balExt, '-o', $exe)
foreach ($f in $msi, $exe) {
    $h = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower()
    "$h  $([IO.Path]::GetFileName($f))" | Add-Content -Encoding ascii (Join-Path $out 'SHA256SUMS.txt')
    Write-SiloOk ("{0} ({1:N0} MB)" -f $f, ((Get-Item $f).Length / 1MB))
}
Write-SiloStep 'Installer fertig.'
