# Silo für Windows – inoffizieller Test-Build

**Deutsch** · [English](#english)

> [!WARNING]
> Dies ist ein **inoffizieller Community-Build** des Medienservers
> [Silo](https://github.com/Silo-Server/silo-server), angepasst für den
> **nativen Betrieb unter Windows**. Er wurde **nicht** von Silo Media
> erstellt und wird von Silo Media **nicht unterstützt**. Er ist zum
> **Testen** gedacht. Fehler dieses Builds bitte hier unter
> [Issues](https://github.com/bihit/silo-server/issues) melden, nicht beim
> Silo-Projekt.

Silo ist ein selbst gehosteter Medienserver für Filme, Serien, Musik, Hörbücher
und E-Books. Dieser Build läuft **direkt unter Windows**, ohne Docker, ohne WSL
und ohne virtuelle Maschine. Der Installer bringt alles mit, was Silo braucht:

| Komponente | Zweck |
|---|---|
| Silo (Windows-Port) | Weboberfläche, API, Streaming, Jellyfin-kompatible Schnittstelle |
| PostgreSQL 18 + pgvector | Datenbank (nur auf 127.0.0.1 erreichbar) |
| Garnet | Redis-kompatibler Cache (nur auf 127.0.0.1, mit Passwort) |
| FFmpeg 8 | Medienanalyse und Wiedergabe |
| Shawl | betreibt Silo und Garnet als Windows-Dienste |

Go, Node.js oder MSYS2 müssen **nicht** installiert sein.

## Inhalt

- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Erste Schritte](#erste-schritte)
- [Medienordner freigeben](#medienordner-freigeben)
- [Zugriff von anderen Geräten](#zugriff-von-anderen-geräten)
- [Ports ändern](#ports-ändern)
- [Bedienung](#bedienung)
- [Ordner](#ordner)
- [Sicherungen](#sicherungen)
- [Update](#update)
- [Deinstallation](#deinstallation)
- [Fehlerbehebung](#fehlerbehebung)
- [Bekannte Einschränkungen](#bekannte-einschränkungen)
- [Aus dem Quellcode bauen](#aus-dem-quellcode-bauen)
- [Lizenzen und Marken](#lizenzen-und-marken)

## Voraussetzungen

- Windows 10 oder 11 (64 Bit) oder Windows Server 2019/2022
- Ein Konto mit **Administratorrechten** für Installation und Einrichtung
- Etwa **1 GB** freier Speicher für das Programm, dazu Platz für die
  Datenbank und Vorschaubilder (wächst mit der Bibliothek)
- Freie Ports **8020** und **8021** (sonst siehe [Ports ändern](#ports-ändern)),
  außerdem lokal 5432 (PostgreSQL) und 6379 (Garnet)

## Installation

1. Unter **[Releases](https://github.com/bihit/silo-server/releases)** die
   neueste Version öffnen und **`SiloWindowsTest-<Version>-Setup.exe`**
   herunterladen.
   Optional mit `SHA256SUMS.txt` prüfen:
   `Get-FileHash .\SiloWindowsTest-0.1.0-Setup.exe -Algorithm SHA256`
2. Die Datei starten. Der Installer ist nicht signiert, deshalb warnt Windows
   SmartScreen: **„Weitere Informationen“ → „Trotzdem ausführen“**.
3. Lizenz bestätigen und **Installieren** wählen, dann die Rückfrage der
   Benutzerkontensteuerung mit „Ja“ beantworten.
   Standardordner: `C:\Program Files\SiloWindowsTest`.
4. Am Ende auf **„Starten“** klicken. Es öffnet sich ein Fenster, das noch
   einmal Administratorrechte anfordert und dann
   - zufällige Passwörter und den geheimen Schlüssel erzeugt,
   - die Datenbank anlegt und vorbereitet,
   - die Windows-Dienste `silo-postgresql`, `silo-garnet` und `silo-server`
     einrichtet und startet,
   - im Browser **http://127.0.0.1:8020** öffnet.

   Das dauert beim ersten Mal etwa eine bis drei Minuten.

**Alternativ als MSI:** `SiloWindowsTest-<Version>.msi` installieren und danach
im Startmenü **„Silo Windows Test“ → „Silo einrichten (Setup)“** ausführen.

> Wer **keine Transcodierung** möchte (nur Direktwiedergabe und Remux), führt
> die Einrichtung einmal so aus, bevor Silo das erste Mal startet:
> ```powershell
> & "C:\Program Files\SiloWindowsTest\silo-server\deploy\windows\Setup-Silo.ps1" -StreamCopyOnly
> ```

## Erste Schritte

1. **http://127.0.0.1:8020** öffnen (Startmenü: „Silo öffnen“).
2. Beim ersten Aufruf das **Administratorkonto** anlegen.
3. Unter **Admin → Bibliotheken** eine Bibliothek hinzufügen und den
   Medienordner angeben, z. B. `D:\Filme`.
4. Der erste Scan läuft im Hintergrund; Titel erscheinen nach und nach.

**Sprache:** Die Oberfläche folgt der Sprache des Browsers (Deutsch oder
Englisch). Umschalten pro Browser mit `?lang=de` oder `?lang=en` am Ende der
Adresse, z. B. `http://127.0.0.1:8020/?lang=en`.

## Medienordner freigeben

Silo läuft als Windows-Dienst unter dem Konto **`NT SERVICE\silo-server`**.
Darf dieses Konto einen Medienordner nicht lesen, bleibt die Bibliothek leer.
Leserechte geben (PowerShell als Administrator):

```powershell
icacls "D:\Filme" /grant "NT SERVICE\silo-server:(OI)(CI)RX"
```

Verbundene Netzlaufwerke (`Z:\`) sind für Dienste nicht sichtbar; stattdessen
den UNC-Pfad verwenden (`\\NAS\Filme`). Der Dienst greift im Netz als
Computerkonto zu. Das klappt in einer Windows-Domäne; bei einem Heim-NAS ist
zusätzliche Einrichtung nötig. Zum Testen sind lokale Laufwerke am
einfachsten.

## Zugriff von anderen Geräten

Die Einrichtung öffnet **keine** Firewall-Ports. Silo ist zunächst nur auf dem
eigenen PC erreichbar. Für Handy, Fernseher oder andere PCs im Heimnetz die
Ports freigeben (PowerShell als Administrator):

```powershell
New-NetFirewallRule -DisplayName "Silo (Web und Apps)" -Direction Inbound -Protocol TCP -LocalPort 8020,8021 -Action Allow -Profile Private
```

Dann im Netz `http://<IP-des-PCs>:8020` aufrufen. **Jellyfin-Apps**
(Android, Android TV, Fire TV, iOS, Swiftfin, Infuse …) verbinden sich mit
`http://<IP-des-PCs>:8021`.

Silo **nicht** ungeschützt per Router-Portweiterleitung ins Internet stellen.
Für den Zugriff von unterwegs eignet sich ein VPN (z. B. WireGuard, Tailscale)
oder HTTPS über einen Reverse-Proxy; das Skript
`silo-server\deploy\windows\Install-SiloHttps.ps1` richtet Caddy mit einem
Let's-Encrypt-Zertifikat für eine eigene Domain ein.

## Ports ändern

Sind 8020, 8021, 5432 oder 6379 belegt, im Installationsordner die Datei
`config\ports.json` anlegen, zum Beispiel:

```json
{ "Silo": 8030, "Jellyfin": 8031, "PostgreSQL": 5433, "Garnet": 6380 }
```

Danach **„Silo einrichten (Setup)“** erneut ausführen. Vorhandene Daten
bleiben erhalten.

## Bedienung

Die Dienste starten automatisch mit Windows. Für Hand-Bedienung PowerShell
**als Administrator** öffnen:

```powershell
$s = "C:\Program Files\SiloWindowsTest\silo-server\deploy\windows"
& "$s\Get-SiloStatus.ps1"         # Dienste, Ports, HTTP-Status, Version
& "$s\Stop-Silo.ps1"              # alles sauber stoppen
& "$s\Start-Silo.ps1"             # alles starten
Restart-Service silo-server       # nur Silo neu starten
& "$s\Get-SiloSnapshot.ps1"       # Diagnosebericht (ohne Passwörter, ohne IPs)
```

## Ordner

Alles liegt im Installationsordner (Standard
`C:\Program Files\SiloWindowsTest`):

| Ordner | Inhalt |
|---|---|
| `runtime\` | Programme (Silo, PostgreSQL, Garnet, .NET, Shawl, FFmpeg) |
| `config\` | `silo.env`, Passwörter, Ports – **nur für Administratoren lesbar, nicht weitergeben** |
| `data\postgres` | Datenbank |
| `data\silo` | Vorschaubilder, Avatare, Remux-Zwischendateien, nächtliche Sicherungen |
| `logs\` | Protokolle von Silo, Garnet und PostgreSQL |
| `backups\` | Sicherungen von `Backup-Silo.ps1` |

## Sicherungen

- Silo sichert **jede Nacht um 04:00** die Datenbank und hochgeladene Dateien
  nach `data\silo\artwork\backups` und behält 7 Kopien. Einstellbar unter
  **Admin → Sicherungen**; dort lässt sich auch wiederherstellen.
- Zusätzlich Datenbank **und Konfiguration** sichern:
  ```powershell
  & "C:\Program Files\SiloWindowsTest\silo-server\deploy\windows\Backup-Silo.ps1"
  ```
- Der `SECRET_KEY` in `config\silo.env` ist nötig, um verschlüsselte
  Einstellungen wiederherzustellen. Die Sicherungen am besten auf ein zweites
  Laufwerk kopieren.

## Update

1. Vorher sichern (siehe oben).
2. Die neue `Setup.exe` aus den Releases ausführen. Sie ersetzt die
   Programmdateien; Datenbank, Konfiguration und Bibliotheken bleiben
   erhalten.
3. Am Ende **„Starten“** wählen (bzw. „Silo einrichten (Setup)“), damit die
   Dienste wieder eingerichtet werden. Beim ersten Start einer neuen Version
   sichert Silo die Datenbank selbst und aktualisiert sie dann.

## Deinstallation

**Einstellungen → Apps → „Silo Windows Test Build (inoffiziell)“ →
Deinstallieren.** Dabei werden die Dienste gestoppt und entfernt und die
Programme gelöscht. **Datenbank, Konfiguration, Logs und Sicherungen bleiben
erhalten** (`data`, `config`, `logs`, `backups` im Installationsordner). Wer
alles entfernen möchte, löscht diesen Ordner danach von Hand.

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| Browser zeigt „Seite nicht erreichbar“ | `Get-SiloStatus.ps1` ausführen; nach dem ersten Start ein bis zwei Minuten warten. Logs: `logs\silo` |
| Einrichtung meldet „Port … ist belegt“ | Anderes Programm nutzt den Port: [Ports ändern](#ports-ändern) |
| Bibliothek bleibt leer | Leserechte für `NT SERVICE\silo-server` geben, siehe [Medienordner freigeben](#medienordner-freigeben); Netzlaufwerk als UNC-Pfad angeben |
| Andere Geräte erreichen Silo nicht | Firewall-Regel anlegen, siehe [Zugriff von anderen Geräten](#zugriff-von-anderen-geräten) |
| Jellyfin-App findet den Server nicht | Adresse mit Port **8021** eingeben, nicht 8020 |
| SmartScreen blockiert den Installer | „Weitere Informationen“ → „Trotzdem ausführen“ (der Build ist nicht signiert) |

Für einen Fehlerbericht bitte die Ausgabe von `Get-SiloSnapshot.ps1` anhängen.
Sie enthält keine Passwörter und keine IP-Adressen, trotzdem vor dem Posten
einmal durchsehen.

## Bekannte Einschränkungen

- Test-Build: nicht signiert, nicht offiziell, Fehler sind möglich.
- Einige Admin-Seiten (Bibliotheken, Benutzer, Einladungen, fehlende
  Episoden) sind in diesem Build fest auf Deutsch.
- Das Einbrennen von Text-Untertiteln bei der Transcodierung schlägt unter
  Windows noch fehl.
- Der Metadaten-Anbieter „Extended Attributes“ liefert unter Windows nichts.
- Hardware-Beschleunigung ist ausgeschaltet (`playback.hw_accel=none`); sie
  ist für Windows nicht getestet.

## Aus dem Quellcode bauen

Der Windows-Port liegt in diesem Branch. Bauen und Einrichten aus dem
Quellcode (Go, MSYS2, Node.js) beschreibt
[`deploy/windows/README.md`](deploy/windows/README.md); die Installer entstehen
mit [`deploy/windows/package/Build-SiloPackage.ps1`](deploy/windows/package/Build-SiloPackage.ps1)
(WiX Toolset 5). Die ursprüngliche Silo-README steht in
[`README-upstream.md`](README-upstream.md).

## Lizenzen und Marken

Silo steht unter der **GNU Affero General Public License v3.0 oder später**
mit der Plattform-Ausnahme des Silo-Projekts ([LICENSE](LICENSE),
[PLATFORM-EXCEPTION.md](PLATFORM-EXCEPTION.md)). Dieser Fork und seine
Änderungen stehen unter derselben Lizenz; der vollständige Quellcode jeder
Release-Version liegt in diesem Repository. Die mitgelieferten Komponenten
und ihre Lizenzen nennt
[`THIRD-PARTY-NOTICES.md`](deploy/windows/package/THIRD-PARTY-NOTICES.md).

Der Name **Silo** und das Silo-Logo sind Marken der **Silo Media L.L.C.**
([TRADEMARK.md](TRADEMARK.md)). Dieser Build ist ein inoffizielles
Community-Projekt, das auf Silo basiert, und wird nicht von Silo Media
erstellt, geprüft oder unterstützt.

---

## English

> [!WARNING]
> This is an **unofficial community build** of the
> [Silo](https://github.com/Silo-Server/silo-server) media server, adapted to
> run **natively on Windows**. It is **not** made or supported by Silo Media
> and is meant for **testing**. Please report problems with this build in this
> repository's [Issues](https://github.com/bihit/silo-server/issues), not
> upstream.

**What you get:** Silo plus everything it needs – PostgreSQL 18 with pgvector,
Garnet (Redis-compatible), FFmpeg 8 and Shawl – running as Windows services.
No Docker, WSL, VM, Go, Node.js or MSYS2 required.

**Requirements:** Windows 10/11 x64 or Windows Server 2019/2022, an
administrator account, about 1 GB for the program plus room for the database,
and free ports 8020 and 8021.

**Install**

1. Download `SiloWindowsTest-<version>-Setup.exe` from
   [Releases](https://github.com/bihit/silo-server/releases) (checksums in
   `SHA256SUMS.txt`). SmartScreen will warn because the build is not signed:
   *More info → Run anyway*.
2. Install (default folder `C:\Program Files\SiloWindowsTest`), then click
   **Launch**. The setup window asks for administrator rights, generates random
   secrets, creates the database and the services `silo-postgresql`,
   `silo-garnet` and `silo-server`, starts them and opens
   **http://127.0.0.1:8020**.
   With the MSI instead, run **Start menu → Silo Windows Test → "Silo
   einrichten (Setup)"** afterwards.
3. Create the administrator account and add a library (Admin → Libraries).

**Media access:** the service runs as `NT SERVICE\silo-server`. Grant read
access where needed:
`icacls "D:\Movies" /grant "NT SERVICE\silo-server:(OI)(CI)RX"`.
Mapped network drives are invisible to services; use UNC paths (the service
uses the computer account on the network, which works in a domain; a home NAS
needs extra setup – local drives are easiest for testing).

**Other devices:** no firewall port is opened. To allow your home network:
`New-NetFirewallRule -DisplayName "Silo" -Direction Inbound -Protocol TCP -LocalPort 8020,8021 -Action Allow -Profile Private`.
Web: `http://<pc-ip>:8020`; Jellyfin apps: `http://<pc-ip>:8021`. Do not
expose Silo to the internet through router port forwarding; use a VPN or
HTTPS (`deploy\windows\Install-SiloHttps.ps1`).

**Ports in use?** Create `config\ports.json` in the install folder, e.g.
`{"Silo": 8030, "Jellyfin": 8031}`, and run the setup again.

**Direct play only:** run
`Setup-Silo.ps1 -StreamCopyOnly` (in `silo-server\deploy\windows`) before the
first start to turn transcoding off.

**Language:** the UI follows the browser language (German or English);
switch with `?lang=en` or `?lang=de`. A few admin pages are German-only in
this build.

**Backups:** nightly at 04:00 into `data\silo\artwork\backups` (Admin →
Backups), plus `Backup-Silo.ps1` for database and configuration. Keep the
`SECRET_KEY` from `config\silo.env` safe.

**Update:** back up, run the new `Setup.exe`, choose **Launch** at the end.
Data and settings stay.

**Uninstall:** Settings → Apps → "Silo Windows Test Build (inoffiziell)".
Services and programs are removed; `data`, `config`, `logs` and `backups`
stay in the install folder until you delete it.

**Troubleshooting:** `Get-SiloStatus.ps1` and the logs in `logs\silo`; for bug
reports attach the output of `Get-SiloSnapshot.ps1` (no passwords or IPs, but
please review it before posting).

**Build from source:** see [`deploy/windows/README.md`](deploy/windows/README.md)
and [`deploy/windows/package`](deploy/windows/package). The original Silo
README is [`README-upstream.md`](README-upstream.md).

**License:** AGPL-3.0-or-later with the Silo platform exception; bundled
components are listed in
[`THIRD-PARTY-NOTICES.md`](deploy/windows/package/THIRD-PARTY-NOTICES.md). The
Silo name and logo are trademarks of Silo Media L.L.C.; this is an unofficial
community build based on Silo.
