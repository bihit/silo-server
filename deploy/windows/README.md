# Silo nativ unter Windows – aus dem Quellcode bauen und betreiben

Betrieb ohne Docker, WSL oder Linux-VM. Alle Befehle in einer PowerShell
(Windows PowerShell 5.1 genügt). Dienste starten, stoppen und registrieren
braucht eine PowerShell „Als Administrator“.

Diese Datei richtet sich an Entwickler, die Silo selbst bauen. Wer nur
installieren will, nimmt den Installer aus den Releases (siehe README.md im
Hauptordner).

## Adressen und Ports

| Zweck | Adresse |
|---|---|
| Weboberfläche, native API, Medienstreaming | http://localhost:8020 |
| Jellyfin/Emby-kompatible API (eigener Listener in Silo) | http://localhost:8021 |
| PostgreSQL 18 + pgvector | 127.0.0.1:5432 (nur lokal) |
| Garnet (Redis-kompatibel) | 127.0.0.1:6379 (nur lokal, Passwort) |
| Jellyfin/Emby-Standardport | 8096, wird von Silo nicht benutzt |

Silo bindet 8020 und 8021 an alle Netzwerkschnittstellen (so funktioniert
`PORT`/`JF_PORT`). Die Windows-Firewall blockiert eingehend standardmäßig;
für 8020/8021 gibt es keine Freigabe, also ist Silo nur lokal erreichbar.
Audiobookshelf-Kompatibilität (sonst Port 13378) und LAN-Erkennung (mDNS)
sind ausgeschaltet.

## Befehle

```powershell
$s = 'C:\Silo\silo-server\deploy\windows'
& "$s\Start-Silo.ps1"            # startet Dienste (oder Prozessmodus, falls keine Dienste)
& "$s\Stop-Silo.ps1"             # stoppt Silo, Garnet, PostgreSQL (sauber, Ctrl+C)
& "$s\Stop-Silo.ps1" -KeepDatabase   # nur Silo stoppen
& "$s\Get-SiloStatus.ps1"        # Dienste, Ports, HTTP-Status, Build
& "$s\Backup-Silo.ps1"           # Datenbank + Konfiguration sichern
```

Neustart: `Stop-Silo.ps1` und danach `Start-Silo.ps1`, oder als Administrator
`Restart-Service silo-server`.

## Einrichtung von Grund auf (wiederholbar)

```powershell
& "$s\Install-SiloDependencies.ps1"   # Go, MSYS2 (gcc, libvips, PostgreSQL), pgvector, Node, Garnet, .NET, Shawl, FFmpeg
& "$s\Build-Silo.ps1" -Install        # Frontend + silo.exe + DLLs nach runtime\silo
& "$s\Initialize-SiloInstance.ps1"    # Ordner, Geheimnisse, Cluster, DB, Migrationen, Einstellungen
& "$s\Install-SiloServices.ps1"       # Windows-Dienste (Administrator)
& "$s\Start-Silo.ps1"
```

Jedes Skript prüft Vorhandenes und überschreibt keine Daten, Schlüssel oder
Einstellungen. `Initialize-SiloInstance.ps1` setzt jede Servereinstellung nur
einmal (protokolliert in `data\applied-settings.json`); spätere Änderungen in
der Oberfläche bleiben erhalten.

## Pfade

| Inhalt | Pfad |
|---|---|
| Quellcode | `C:\Silo\silo-server` |
| Programm (silo.exe + DLLs) | `C:\Silo\runtime\silo\bin` |
| vorherige Programmversion | `C:\Silo\runtime\silo.previous` |
| Garnet, .NET, Shawl, FFmpeg, Node | `C:\Silo\runtime\…` |
| Konfiguration und Geheimnisse | `C:\Silo\config` (nur SYSTEM/Administratoren; Dienste lesen nur ihre eigene Datei) |
| PostgreSQL-Daten | `C:\Silo\data\postgres` |
| Silo-Daten (Artwork, Remux-Temp, Jellyfin-Web) | `C:\Silo\data\silo` |
| Logs | `C:\Silo\logs\{silo,garnet,postgresql}` |
| Sicherungen | `C:\Silo\backups` |
| Build-Werkzeuge | `%LOCALAPPDATA%\Programs\go`, `C:\msys64` |

`data\silo\transcode` ist der von Silo verlangte „Transcode“-Ordner. Er nimmt
nur die Segmente der HLS-Kopie (Remux) auf; dort wird nichts neu kodiert.

## Automatischer Start

Drei Windows-Dienste unter virtuellen Dienstkonten (`NT SERVICE\<Name>`,
kein Passwort, keine Administratorrechte):

| Dienst | Start | Programm |
|---|---|---|
| `silo-postgresql` | automatisch | `pg_ctl register` (nativer PostgreSQL-Dienst) |
| `silo-garnet` | automatisch | Shawl → `GarnetServer.exe` |
| `silo-server` | automatisch (verzögert), hängt von beiden ab | Shawl → `silo.exe -env config\silo.env` |

Shawl stoppt Silo und Garnet mit Ctrl+C (Silo fährt sauber herunter) und
beendet mit dem Dienst alle Kindprozesse (FFmpeg). Bei einem Absturz startet
der Dienst nach 10 s neu. Silo liest Medien als `NT SERVICE\silo-server`. Wo
dieses Konto nicht lesen darf:
`icacls "<Ordner>" /grant "NT SERVICE\silo-server:(OI)(CI)RX"`.

## Kein Transcoding

1. Einstellungen: `playback.transcode_enabled=false`,
   `download.transcode_enabled=false`, `playback.hw_accel=none`.
2. Code-Sperre (nur in diesem Branch): Bei abgeschaltetem Transcoding
   lehnen die Planer der nativen API (v1/v3) und der Jellyfin-Kompatibilität
   jede Route ab, die Video oder Audio kodiert oder Untertitel einbrennt.
   Antwort: `transcoding_disabled` bzw. `PlaybackUnavailable` mit Begründung.
3. Notbremse vor jedem Wiedergabe-FFmpeg-Start (HLS, Remux,
   Download-Vorbereitung): erlaubt sind nur `copy` für Video und Audio,
   Bitstream-Filter und Untertitel-Textkonvertierung; Encoder und Filtergraphen
   werden mit Fehler abgelehnt.

Wer `playback.transcode_enabled` in der Oberfläche wieder einschaltet, hebt
alle drei Stufen auf.

## Backup

```powershell
& "$s\Backup-Silo.ps1"                 # backups\<Zeitstempel>\silo.dump + config\
& "$s\Backup-Silo.ps1" -IncludeArtwork
```

Die Sicherung enthält `SECRET_KEY`; ohne ihn sind verschlüsselte Einstellungen
nicht lesbar. Den Ordner auf ein zweites Laufwerk kopieren.

Wiederherstellen (Silo gestoppt, PostgreSQL läuft):
`pg_restore -h 127.0.0.1 -U postgres -d silo --clean --if-exists <silo.dump>`
mit dem Passwort aus `config\postgres-superuser.secret`, dazu die gesicherte
`config\silo.env` zurückkopieren.

## Update

```powershell
cd 'C:\Silo\silo-server'
& "$s\Backup-Silo.ps1"
git fetch origin
git rebase origin/main                 # lokale Windows-Anpassungen bleiben oben
& "$s\Build-Silo.ps1" -Install         # stoppt und startet silo-server selbst
```

Migrationen laufen beim Start automatisch. Rückweg: Dienst stoppen,
`runtime\silo.previous` zurück nach `runtime\silo` benennen; das
Datenbankschema bleibt dabei auf dem neueren Stand, deshalb vor dem Update
sichern. MSYS2 (`pacman -Syu`) aktualisiert PostgreSQL nicht auf eine neue
Hauptversion (`IgnorePkg`); silo.exe bringt eigene Kopien seiner DLLs mit.

## Bekannte Einschränkungen unter Windows

- NTFS kennt keine `user.*`-Dateiattribute: der Metadaten-Provider „Extended
  Attributes“ liefert unter Windows nichts.
- Medien, die ein Gerät nicht unverändert abspielen kann, werden abgelehnt
  statt umgewandelt; das gilt auch für Bild-Untertitel (PGS/VobSub), die ein
  Client nicht selbst darstellt.
- Teile der Go-Testsuite setzen Linux voraus (Shell-Skripte als Fake-FFmpeg,
  `/dev/dri`, chmod); sie scheitern unter Windows schon ohne diese Anpassungen.
