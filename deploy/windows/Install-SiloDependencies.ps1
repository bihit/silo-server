<#
.SYNOPSIS
  Installs or verifies the build toolchain and runtime programs for native Silo on Windows.
.DESCRIPTION
  Idempotent: existing installations are checked and kept. Every download is
  verified against a pinned SHA-256 (or the publisher's checksum list).
    - Go (build)                      %LOCALAPPDATA%\Programs\go
    - MSYS2 UCRT64: gcc, pkgconf, libvips (build), PostgreSQL 18 + pgvector (runtime)
    - Node.js LTS + pnpm (frontend build)  runtime\node
    - Garnet (Redis-compatible) + private .NET runtime   runtime\garnet, runtime\dotnet
    - Shawl (service wrapper)          runtime\shawl
    - FFmpeg/FFprobe copy              runtime\ffmpeg
  Needs Administrator rights only if C:\msys64 does not exist yet.
#>
[CmdletBinding()]
param(
    # Existing FFmpeg build to copy into runtime\ffmpeg (needs ffmpeg.exe and ffprobe.exe).
    [string]$FFmpegSource = (Join-Path $env:LOCALAPPDATA 'Programs\FFmpeg\bin')
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
$v = Get-SiloVersions
Use-SiloProcessPath
New-Item -ItemType Directory -Force -Path $layout.Runtime, $layout.Build | Out-Null

# --- Go -------------------------------------------------------------------
Write-SiloStep "Go $($v.Go)"
$goExe = Join-Path $layout.GoRoot 'bin\go.exe'
if (Test-Path $goExe) {
    $have = (& $goExe env GOVERSION).Trim()
    if ($have -ne "go$($v.Go)") { Write-SiloWarn "Vorhanden: $have (erwartet go$($v.Go)); wird beibehalten, Mindestversion laut go.mod ist 1.26.4." }
    else { Write-SiloOk $have }
} else {
    $zip = Get-SiloDownload -Url "https://go.dev/dl/go$($v.Go).windows-amd64.zip" -Sha256 $v.GoSha256 -FileName 'go.zip'
    Expand-Archive $zip -DestinationPath (Split-Path $layout.GoRoot -Parent)
    Write-SiloOk "installiert nach $($layout.GoRoot)"
}

# --- MSYS2 ------------------------------------------------------------------
Write-SiloStep 'MSYS2 UCRT64 (gcc, pkgconf, libvips, PostgreSQL)'
if (-not (Test-Path $layout.MsysBash)) {
    Assert-SiloAdmin 'MSYS2 wird nach C:\msys64 entpackt'
    $rel = Invoke-RestMethod 'https://api.github.com/repos/msys2/msys2-installer/releases/latest'
    $asset = $rel.assets | Where-Object { $_.name -match '^msys2-base-x86_64-\d+\.sfx\.exe$' } | Select-Object -First 1
    if (-not $asset -or -not $asset.digest) { throw 'MSYS2-Release ohne Pruefsumme gefunden; Abbruch.' }
    $sfx = Get-SiloDownload -Url $asset.browser_download_url -Sha256 ($asset.digest -replace '^sha256:', '') -FileName $asset.name
    Invoke-SiloNative -FilePath $sfx -Arguments @('-y', '-oC:\') -What 'MSYS2-Entpacken'
    Invoke-SiloMsys 'echo MSYS2 initialisiert' 'MSYS2-Erststart'
    Invoke-SiloMsys 'pacman -Syuu --noconfirm' 'MSYS2-Update (1)'
    Invoke-SiloMsys 'pacman -Syuu --noconfirm' 'MSYS2-Update (2)'
}
# Keep PostgreSQL on its major version: a pacman upgrade to a new major would
# leave the cluster unreadable until pg_upgrade.
$pacmanConf = Join-Path $layout.Msys 'etc\pacman.conf'
$conf = Get-Content $pacmanConf
if (-not ($conf -match '^\s*IgnorePkg\s*=.*mingw-w64-ucrt-x86_64-postgresql')) {
    $conf = $conf | ForEach-Object { if ($_ -match '^\s*#\s*IgnorePkg\s*=') { 'IgnorePkg   = mingw-w64-ucrt-x86_64-postgresql' } else { $_ } }
    Set-Content -Path $pacmanConf -Value $conf -Encoding ascii
    Write-SiloOk 'PostgreSQL-Paket gegen Major-Upgrades gesperrt (IgnorePkg)'
}
# libheif lets libvips load its HEIF/AVIF module, as Debian's libvips42 does.
Invoke-SiloMsys 'pacman -S --needed --noconfirm mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-pkgconf mingw-w64-ucrt-x86_64-libvips mingw-w64-ucrt-x86_64-libheif mingw-w64-ucrt-x86_64-postgresql make git >/dev/null 2>&1' 'pacman-Installation'
Invoke-SiloMsys 'pacman -Q mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-libvips mingw-w64-ucrt-x86_64-postgresql' 'pacman-Abfrage'

# --- pgvector -----------------------------------------------------------------
Write-SiloStep "pgvector $($v.PgVector)"
$vectorControl = Join-Path $layout.Msys 'ucrt64\share\postgresql\extension\vector.control'
$wantVersion = $v.PgVector.TrimStart('v')
$installed = $null
if (Test-Path $vectorControl) {
    $m = Select-String -Path $vectorControl -Pattern "default_version\s*=\s*'([^']+)'"
    if ($m) { $installed = $m.Matches[0].Groups[1].Value }
}
if ($installed -eq $wantVersion) { Write-SiloOk "vector $installed installiert" }
else {
    $src = Join-Path $layout.Build 'pgvector'
    if (Test-Path $src) { Remove-Item -Recurse -Force $src }
    Invoke-SiloNative -FilePath 'git' -Arguments @('-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', $v.PgVector, 'https://github.com/pgvector/pgvector.git', $src) -What 'pgvector-Klon'
    $msysSrc = '/' + $src.Substring(0, 1).ToLower() + $src.Substring(2).Replace('\', '/')
    Invoke-SiloMsys "cd '$msysSrc' && make OPTFLAGS='' >/dev/null && make install >/dev/null" 'pgvector-Build'
    Write-SiloOk "vector $wantVersion gebaut und installiert"
}

# --- Node.js + pnpm ----------------------------------------------------------
Write-SiloStep "Node.js $($v.Node) + pnpm $($v.Pnpm)"
$nodeExe = Join-Path $layout.Node 'node.exe'
if ((Test-Path $nodeExe) -and ((& $nodeExe --version).Trim() -eq "v$($v.Node)")) { Write-SiloOk "node v$($v.Node)" }
else {
    $name = "node-v$($v.Node)-win-x64"
    $sums = (Invoke-WebRequest "https://nodejs.org/dist/v$($v.Node)/SHASUMS256.txt" -UseBasicParsing).Content -split "`n"
    $line = $sums | Where-Object { $_ -match "\s$name\.zip$" }
    if (-not $line) { throw "Keine Pruefsumme fuer $name.zip gefunden." }
    $zip = Get-SiloDownload -Url "https://nodejs.org/dist/v$($v.Node)/$name.zip" -Sha256 (($line -split '\s+')[0]) -FileName "$name.zip"
    $tmp = Join-Path (Split-Path $zip -Parent) 'x'
    Expand-Archive $zip -DestinationPath $tmp
    if (Test-Path $layout.Node) { Remove-Item -Recurse -Force $layout.Node }
    Move-Item (Join-Path $tmp $name) $layout.Node
    Write-SiloOk "installiert nach $($layout.Node)"
}

# --- .NET runtime for Garnet ------------------------------------------------
Write-SiloStep ".NET $($v.DotNet) Runtime (privat, nur fuer Garnet)"
$dotnetExe = Join-Path $layout.DotNet 'dotnet.exe'
$haveRuntime = (Test-Path $dotnetExe) -and ((& $dotnetExe --list-runtimes) -match "^Microsoft\.NETCore\.App $([regex]::Escape($v.DotNet))\.")
if ($haveRuntime) { Write-SiloOk ((@(& $dotnetExe --list-runtimes) -match 'Microsoft\.NETCore\.App') -join '; ') }
else {
    $installer = Join-Path $env:TEMP ("dotnet-install-" + [guid]::NewGuid().ToString('N') + '.ps1')
    Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installer -UseBasicParsing
    $sig = Get-AuthenticodeSignature $installer
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "dotnet-install.ps1 ist nicht gueltig von Microsoft signiert ($($sig.Status))." }
    & $installer -Runtime dotnet -Channel $v.DotNet -InstallDir $layout.DotNet -NoPath
    Remove-Item $installer -Force
    Write-SiloOk "installiert nach $($layout.DotNet)"
}

# --- Garnet -----------------------------------------------------------------
Write-SiloStep "Garnet $($v.Garnet)"
$versionFile = Join-Path $layout.Garnet 'VERSION'
if ((Test-Path $layout.GarnetExe) -and (Test-Path $versionFile) -and ((Get-Content $versionFile -Raw).Trim() -eq $v.Garnet)) { Write-SiloOk "Garnet $($v.Garnet)" }
else {
    $zip = Get-SiloDownload -Url "https://github.com/microsoft/garnet/releases/download/v$($v.Garnet)/win-x64-based-readytorun.zip" -Sha256 $v.GarnetSha256 -FileName 'garnet.zip'
    $tmp = Join-Path (Split-Path $zip -Parent) 'x'
    Expand-Archive $zip -DestinationPath $tmp
    if (Test-Path $layout.Garnet) { Remove-Item -Recurse -Force $layout.Garnet }
    Move-Item (Join-Path $tmp 'net10.0') $layout.Garnet
    Set-Content -Path $versionFile -Value $v.Garnet -Encoding ascii
    Write-SiloOk "installiert nach $($layout.Garnet)"
}

# --- Shawl ------------------------------------------------------------------
Write-SiloStep "Shawl $($v.Shawl)"
if ((Test-Path $layout.Shawl) -and ((& $layout.Shawl --version) -match [regex]::Escape($v.Shawl))) { Write-SiloOk (& $layout.Shawl --version) }
else {
    $zip = Get-SiloDownload -Url "https://github.com/mtkennerly/shawl/releases/download/v$($v.Shawl)/shawl-v$($v.Shawl)-win64.zip" -Sha256 $v.ShawlSha256 -FileName 'shawl.zip'
    $dir = Split-Path $layout.Shawl -Parent
    New-Item -ItemType Directory -Force $dir | Out-Null
    Expand-Archive $zip -DestinationPath $dir -Force
    Write-SiloOk "installiert nach $dir"
}

# --- FFmpeg -----------------------------------------------------------------
Write-SiloStep 'FFmpeg/FFprobe'
$srcFFmpeg = Join-Path $FFmpegSource 'ffmpeg.exe'
$srcFFprobe = Join-Path $FFmpegSource 'ffprobe.exe'
if (-not (Test-Path $layout.FFmpegExe)) {
    if (-not ((Test-Path $srcFFmpeg) -and (Test-Path $srcFFprobe))) { throw "FFmpeg nicht gefunden unter $FFmpegSource. Mit -FFmpegSource auf den bin-Ordner eines FFmpeg-Builds (7.1 oder neuer) zeigen." }
    New-Item -ItemType Directory -Force $layout.FFmpegDir | Out-Null
    Copy-Item $srcFFmpeg, $srcFFprobe -Destination $layout.FFmpegDir
    Get-ChildItem $FFmpegSource -Filter *.dll -ErrorAction SilentlyContinue | Copy-Item -Destination $layout.FFmpegDir
}
Write-SiloOk ((& $layout.FFmpegExe -hide_banner -version | Select-Object -First 1))

Write-SiloStep 'Abhaengigkeiten vollstaendig.'
