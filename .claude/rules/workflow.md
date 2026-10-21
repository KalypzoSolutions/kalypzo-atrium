# Arbeitsweise

## Kommunikation
- Antworten auf **Deutsch**, knapp, mit klarem Ergebnis zuerst; Tabellen/Listen für Überblick. Ehrlich über Lücken.
- Der Nutzer schreibt oft knapp und mit Tippfehlern – Absicht sinnvoll deuten, bei echten Mehrdeutigkeiten gezielt (kurz,
  mit Empfehlung) per `AskUserQuestion` nachfragen; Vorgaben des Nutzers nicht ungefragt umdeuten.
- Größere Vorhaben: Plan erstellen und freigeben lassen, dann in **Phasen** umsetzen; jede Phase lauffähig + geprüft.
- Nichts committen/pushen ohne Aufforderung. Git (Stand 2026-10-21): Hauptbranch `main`, Arbeitsbranch `staging` (beide auch auf `origin`),
  Historie ab „Initial commit: EP Intern 2.0“ (34 Commits). Einen Branch `master` gibt es nicht mehr.

## Demo-Server (Port 4300, PGlite, Daten in `.data/pglite`)
```bash
npm run build
node scripts/demo-server.mjs        # Bash-Tool mit run_in_background: true; wartet auf http://127.0.0.1:4300/login → 200
touch .data/stop                    # SAUBER beenden (Server räumt auf und beendet sich); Datei danach löschen
```
- **Nie** mit `Stop-Process -Force`/`kill` beenden: das beschädigte die PGlite-Datenbank (`RuntimeError: Aborted()`;
  Sicherung `.data/pglite-corrupt-*`). Bei Datenbankschaden `.data/pglite` verschieben, Server startet frisch,
  Module in `/modules` bzw. per `POST /api/v1/modules/<id>/enable` neu aktivieren.
- Port belegt (`EADDRINUSE 54330`) → es läuft noch ein Server: erst `.data/stop` anlegen.
- `npx playwright test` baut ebenfalls nach `build/`: danach den Demo-Server neu starten, nie parallel laufen lassen.
- Demo-Pool ist auf 1 Verbindung begrenzt (`DATABASE_POOL_MAX=1`), weil PGlite nur eine Sitzung hat.
- Demo-Daten nach frischer DB: `node scripts/seed-demo.mjs` (Core) → `node scripts/seed-demo-modules.mjs` (Mitglieder mit
  Geschwistern, Aktionen „Kopenhagen 2026“/„Herbstfahrt 2026“, Module aktivieren) → `setup-demo-storage.mjs`, `setup-demo-mail.mjs`
  → `seed-demo-receipts.mjs` → `node scripts/seed-demo-treasury.mjs` (Konten, Zahler, Buchungen, Sammelzahlung, überfällige
  Rechnung, Beispiel-Kontoauszug `.data/demo-kontoauszug.csv`) → `node scripts/seed-demo-galleries.mjs` (Galerien mit
  Beispielbildern, braucht MinIO). Weitere Seeds: `seed-demo-treasury-extras.mjs`, `seed-demo-offices.mjs`, `seed-demo-orders.mjs`,
  `seed-demo-files.mjs`, `seed-demo-website.mjs` (Website-Demodaten + API-Key, siehe `website.md`). `npx playwright install chromium` ist für PDFs nötig.
- Demo-Daten: Admin `admin@demo.test`; weitere Beispielbenutzer/Aktionen lege per API an (Login `POST /api/auth/sign-in/email`
  mit Header `Origin: http://localhost:4300`, danach Cookie-Jar für `/api/v1/…`).

## Demo-Storage (S3 / MinIO per Docker)
```bash
docker compose -f docker-compose.demo.yml up -d      # MinIO: API :9100, Konsole :9101 (demo-access / demo-secret-key-2026)
node scripts/setup-demo-storage.mjs                  # hinterlegt Endpoint/Bucket/Keys in den Systemeinstellungen
node scripts/seed-demo-receipts.mjs                  # Beispiel-Belege an die Demo-Aktion + Bericht nach .data/demo-report.pdf
```
- Docker Desktop muss laufen. `minio/minio` wird nicht mehr auf Docker Hub veröffentlicht → `bitnamilegacy/minio`.
- Einstellungen liegen in der Demo-DB (`.data/pglite`): Storage bleibt nach Neustart konfiguriert.

## Visuelle Prüfung (immer bei UI-Änderungen)
```bash
node scripts/screenshots.mjs --out .data/shots --mobile /modules/actions /modules/actions/<id>
node scripts/screenshots.mjs --out .data/shots --tab Kalkulation /modules/actions/<id>
```
Danach die PNGs mit dem Read-Tool ansehen und kritisch beurteilen (Abschneidungen, Überlappungen, Leerräume, Mobil,
Dunkelmodus). Unter Git-Bash Pfad-Argumente mit `MSYS_NO_PATHCONV=1` schützen (`/modules/…` würde sonst umgeschrieben).

## Parallele Agents (Lehren)
- Aufteilung nach **Dateien/Verantwortung**, Vertrag (`schemas.ts`, Migration, Funktionssignaturen) vorher selbst schreiben.
- Jeder Agent bekommt: eindeutige Dateiliste, „fasse nichts anderes an“, Prüfbefehle, kurzen Berichtswunsch.
- **Misstraue Erfolgsmeldungen**: nach dem Lauf `npm run check`, Tests, und per `grep`/Änderungszeit prüfen, dass Änderungen
  wirklich in den Dateien stehen. Schon vorgekommen: Patch-Skripte wurden von anderen Agents überschrieben/doppelt
  ausgeführt → doppelte Imports/Deklarationen/Testblöcke; andere Änderungen kamen gar nicht an.
- Gleichzeitig nur **einer** baut/startet den Demo-Server (gemeinsames `build/`, gemeinsame Ports).
- Nach Agent-Arbeit `npx prettier --write` auf geänderte Bereiche, dann prüfen.

## Werkzeug-Fallen (Windows / Git-Bash)
- Mehrere Heredocs in einem Bash-Aufruf mit Anführungszeichen brechen gelegentlich („unexpected EOF“) → Dateien mit dem
  Write-Tool anlegen, Python-/Node-Skripte als Datei ablegen (Scratchpad) und ausführen.
- ESM-Import absoluter Windows-Pfade nur als `file:///C:/…`.
- `curl` mit Dateipfaden unter `/tmp` kann in Git-Bash scheitern → relative Pfade im Projekt nutzen.
- Skriptdateien für Einmalaufgaben gehören ins Scratchpad, nicht ins Repo.
