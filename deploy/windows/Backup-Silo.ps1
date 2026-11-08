<#
.SYNOPSIS
  Backs up the Silo database and configuration into backups\<timestamp>.
.DESCRIPTION
  - silo.dump: pg_dump custom format of the silo database (Silo may keep running).
  - config\:   silo.env (with SECRET_KEY), garnet.conf and the password files.
               Without SECRET_KEY the encrypted settings in the dump cannot be read.
  - artwork\:  only with -IncludeArtwork (data\silo\artwork; can be re-fetched).
  The backup folder gets the same restricted ACL as config (SYSTEM, Administrators).
  Copy it to a second disk; a backup on the same drive does not survive a disk failure.
#>
[CmdletBinding()]
param([switch]$IncludeArtwork)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SiloWindows.psm1') -Force
$layout = Get-SiloLayout
$ports = Get-SiloPorts
Use-SiloProcessPath -Prepend @($layout.PgBin)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $layout.Backups $stamp
New-Item -ItemType Directory -Path $target | Out-Null
Set-SiloPrivateAcl -Path $target

Write-SiloStep 'Datenbank (pg_dump)'
$old = $env:PGPASSWORD
$env:PGPASSWORD = Get-SiloSecretValue $layout.PgSuperSecret
try {
    Invoke-SiloNative -FilePath (Join-Path $layout.PgBin 'pg_dump.exe') -What 'pg_dump' -Arguments @(
        '-h', '127.0.0.1', '-p', "$($ports.PostgreSQL)", '-U', 'postgres', '-d', 'silo', '-Fc', '-f', (Join-Path $target 'silo.dump'))
} finally { $env:PGPASSWORD = $old }
Write-SiloOk ("silo.dump, {0:N1} MB" -f ((Get-Item (Join-Path $target 'silo.dump')).Length / 1MB))

Write-SiloStep 'Konfiguration'
Copy-Item -Recurse -Path $layout.Config -Destination (Join-Path $target 'config')
Write-SiloOk 'config\ kopiert (enthaelt Geheimnisse)'

if ($IncludeArtwork) {
    Write-SiloStep 'Artwork'
    Copy-Item -Recurse -Path (Join-Path $layout.SiloData 'artwork') -Destination (Join-Path $target 'artwork')
    Write-SiloOk 'artwork\ kopiert'
}
Write-SiloStep "Sicherung: $target"
