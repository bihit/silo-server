# Silo – inoffizieller Windows-Test-Build / unofficial Windows test build

**Deutsch** · [English](#english)

Dieses Paket enthält eine **inoffizielle** Variante des Medienservers
[Silo](https://github.com/Silo-Server/silo-server), die **nativ unter Windows**
läuft, also ohne Docker, WSL oder virtuelle Maschine. Sie ist zum **Testen**
gedacht. Silo Media hat sie nicht erstellt und leistet keinen Support dafür.
Fehler dieses Builds bitte im Repository dieses Releases melden, nicht beim
Silo-Projekt, außer sie treten auch mit einem offiziellen Silo-Build auf.

Enthalten sind Silo, PostgreSQL 18 mit pgvector, Garnet (Redis-kompatibel),
FFmpeg und Shawl (Dienst-Wrapper). Go, Node oder MSYS2 werden nicht benötigt.

## Installation

1. `SiloWindowsTest-<Version>-Setup.exe` (oder die `.msi`) ausführen.
   Standardordner: `C:\Program Files\SiloWindowsTest`.
2. Am Ende **„Starten“** wählen bzw. im Startmenü **„Silo einrichten“**
   ausführen. Das Skript fragt nach Administratorrechten und
   - erzeugt zufällige Passwörter und den Schlüssel (`config\`, nur für
     Administratoren lesbar),
   - legt die PostgreSQL-Datenbank an,
   - registriert die Dienste `silo-postgresql`, `silo-garnet`, `silo-server`,
   - startet alles und öffnet `http://127.0.0.1:8020`.
3. Beim ersten Aufruf das Administratorkonto anlegen und Bibliotheken
   hinzufügen.

| Port | Zweck |
|---|---|
| 8020 | Weboberfläche, API, Streaming |
| 8021 | Jellyfin-kompatible Apps |
| 5432, 6379 | PostgreSQL, Garnet – nur 127.0.0.1 |

Ist ein Port belegt: `config\ports.json` anlegen, zum Beispiel
`{"Silo": 8030, "Jellyfin": 8031, "PostgreSQL": 5433}`, und „Silo einrichten“
erneut ausführen.

**Firewall:** Es wird kein Port freigegeben. Für andere Geräte im Netz
8020/8021 selbst in der Windows-Firewall freigeben.

**Medienordner:** Silo liest Medien als Konto `NT SERVICE\silo-server`. Bei
Bedarf Leserechte geben:
`icacls "D:\Filme" /grant "NT SERVICE\silo-server:(OI)(CI)RX"`

**Nur Direktwiedergabe:** Wer keine Transcodierung will, führt
`silo-server\deploy\windows\Setup-Silo.ps1 -StreamCopyOnly` aus, bevor Silo das
erste Mal läuft. Später lässt sich das in den Admin-Einstellungen umstellen.

**Sprache:** Die Oberfläche folgt der Browsersprache (Deutsch oder Englisch).
`?lang=en` bzw. `?lang=de` an die Adresse hängen, um umzuschalten.

Bekannte Einschränkung: Einige Admin-Seiten (Bibliotheken, Benutzer,
Einladungen, fehlende Episoden) sind in diesem Build fest auf Deutsch.

**Sicherungen:** Silo sichert jede Nacht um 04:00 die Datenbank nach
`data\silo\artwork\backups`. Zusätzlich:
`silo-server\deploy\windows\Backup-Silo.ps1`.

**Deinstallation:** Entfernt die Programme und die Dienste. `data`, `config`,
`logs` und `backups` bleiben erhalten und müssen bei Bedarf von Hand gelöscht
werden.

---

## English

An **unofficial** build of the [Silo](https://github.com/Silo-Server/silo-server)
media server that runs **natively on Windows** (no Docker, WSL or VM), meant
for **testing**. It is not made or supported by Silo Media; please report
problems in this release's repository unless they also happen with an
official Silo build.

1. Run `SiloWindowsTest-<version>-Setup.exe` (or the `.msi`); default folder
   `C:\Program Files\SiloWindowsTest`.
2. Choose **Launch** at the end, or run **"Silo einrichten"** (set up Silo)
   from the Start menu. It asks for administrator rights, creates random
   secrets, the PostgreSQL database and the three Windows services, starts
   them and opens `http://127.0.0.1:8020`.
3. Create the administrator account on first visit.

Ports: 8020 web/API/streaming, 8021 Jellyfin-compatible apps; PostgreSQL and
Garnet listen on 127.0.0.1 only. Override them in `config\ports.json`. No
firewall port is opened. Give `NT SERVICE\silo-server` read access to media
folders outside the system's default permissions. The UI follows the browser
language (German or English; `?lang=en` / `?lang=de`); a few admin pages
(libraries, users, invitations, missing episodes) are German-only in this
build. Uninstalling removes
programs and services; `data`, `config`, `logs` and `backups` are kept.

Licenses: see `THIRD-PARTY-NOTICES.md` and `silo-server\LICENSE`
(AGPL-3.0-or-later). The Silo name and logo are trademarks of Silo Media
L.L.C. (`silo-server\TRADEMARK.md`).
