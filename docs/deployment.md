# Deployment

## Bestandteile

- `Dockerfile`: Multi-Stage (deps → build → prod-deps → runtime), Node 24 slim, Chromium (Playwright) für PDF, läuft als Benutzer `app` (UID 10001), Healthcheck auf `/api/v1/health`.
- `docker-compose.yml`: `db` (PostgreSQL 17, Volume `db-data`, `pg_isready`-Healthcheck), `app`, optional `nginx` (Profil `proxy`).
- `docker-compose.dev.yml`: nur PostgreSQL + MinIO für lokale Entwicklung.
- `deploy/nginx/nginx.conf`: HTTP→HTTPS-Redirect, TLS-Terminierung, Proxy-Header.

Gehärtet: `read_only` Dateisystem (tmpfs `/tmp`), `cap_drop: ALL`, `no-new-privileges`, App-Port nur auf `127.0.0.1`.

## Installation

```bash
git clone <repo> && cd ep-intern-2.0
cp .env.example .env
# POSTGRES_PASSWORD, APP_SECRET (openssl rand -base64 48), ORIGIN, INITIAL_ADMIN_* setzen
docker compose up -d --build
docker compose ps        # app und db "healthy"
```

Mit Nginx/HTTPS:

```bash
mkdir -p deploy/nginx/certs   # fullchain.pem + privkey.pem ablegen
docker compose --profile proxy up -d
```

`ORIGIN` muss exakt der öffentliche URL entsprechen (`https://…`); davon hängen Cookie-Flags (`Secure`), CSRF und Better-Auth-Redirects ab.

## Dokploy (Git-Deployment mit App, PostgreSQL und S3)

`docker-compose.dokploy.yml` startet den kompletten Stack: `db` (PostgreSQL 17), `storage` (MinIO, nur intern) und `app`
(wird aus dem `Dockerfile` des Repositories gebaut). Variablen-Vorlage: `.env.dokploy.example`.

1. In Dokploy: Projekt → *Create Service* → **Compose** → Provider **Git** (Repository, Branch `staging` oder `main`),
   Compose-Pfad `./docker-compose.dokploy.yml`, Typ *Docker Compose*.
2. Reiter **Environment**: Inhalt von `.env.dokploy.example` einfügen und ausfüllen
   (Pflicht: `ORIGIN`, `APP_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
   für den ersten Administrator `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD`).
3. Reiter **Domains**: Domain auf Service `app`, Port `3000`, HTTPS aktivieren. `ORIGIN` muss exakt diese URL sein.
4. **Deploy**. Beim ersten Start laufen Migrationen, Modul-Sync und das Anlegen des Administrators automatisch;
   Storage (`S3_*`) und E-Mail (`SMTP_*`) werden in die Einstellungen übernommen, **solange sie dort noch nicht
   gesetzt sind** (spätere Änderungen in der Oberfläche bleiben erhalten).
5. Anmelden, Passwort ändern, in „Module“ die Fachmodule aktivieren, `INITIAL_ADMIN_*` aus der Environment entfernen.

Hinweise:
- Der Server greift intern per `http://storage:9000` auf den Objektspeicher zu. Belege und Dokumente laufen über die
  App; Browser benötigen keinen Zugriff auf den Speicher. Sollen Browser direkt per signierter URL hochladen
  (`/storage/upload-url`), `storage` über eine eigene Domain veröffentlichen und `S3_ENDPOINT` darauf setzen.
- Das MinIO-Image `bitnamilegacy/minio` ist eingefroren (keine Sicherheitsupdates). Für den dauerhaften Betrieb
  einen externen S3-Dienst verwenden: Service `storage` entfernen, `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/Keys setzen.
- Backups: Volumes `db-data` und `s3-data` sichern (Dokploy-Backups oder `pg_dump`), `APP_SECRET` getrennt aufbewahren.
- Uploads/Importe sind auf 110 MB begrenzt (`BODY_SIZE_LIMIT` im `Dockerfile`; ein Proxy-Limit muss mindestens so hoch sein).
- Geprüft: Stack lokal gebaut und gestartet (alle Dienste healthy), Anmeldung, PDF-Erzeugung mit Chromium im
  `read_only`-Container, Beleg-Upload und -Download über MinIO.

## Umgebungsvariablen

| Variable | Beschreibung |
|---|---|
| `POSTGRES_DB/USER/PASSWORD` | Datenbank-Container (Passwort Pflicht) |
| `APP_SECRET` | Pflicht, ≥ 32 Zeichen. **Nicht ändern**, ohne Secrets neu einzugeben (siehe [Sicherheit](security.md)) |
| `ORIGIN` | Pflicht, öffentliche URL |
| `BACKUP_MAX_BYTES` | optional: größte hochladbare Sicherungsdatei in Byte (Standard 4 GB) |
| `APP_PORT` | Host-Port (Bind 127.0.0.1) |
| `INITIAL_ADMIN_EMAIL/PASSWORD` | Bootstrap; Passwort ≥ 12 Zeichen |
| `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE` | optional: Vorbelegung der Storage-Einstellungen beim ersten Start |
| `SMTP_HOST/PORT/SECURE/USER/PASSWORD/FROM` | optional: Vorbelegung der E-Mail-Einstellungen beim ersten Start |
| `ADDRESS_HEADER`, `XFF_DEPTH`, `PROTOCOL_HEADER`, `HOST_HEADER` | in `docker-compose.yml` gesetzt (adapter-node) |

### Proxy-Header

Hinter einem Reverse Proxy sieht die App nur dessen IP. `ADDRESS_HEADER=X-Forwarded-For` mit `XFF_DEPTH=1` liest die Client-IP als **letzten** Eintrag (von einem Proxy gesetzt) – Voraussetzung ist, dass genau ein vertrauenswürdiger Proxy davorsteht (Nginx-Konfiguration setzt `X-Forwarded-For $remote_addr`, ersetzt also clientseitige Werte). `PROTOCOL_HEADER`/`HOST_HEADER` sorgen für korrektes `https` und Host. Bei mehreren Proxys `XFF_DEPTH` anpassen. Die IP geht in Rate Limits und Audit-Logs ein.

## Erster Start

Beim Start laufen Migrationen und Synchronisation automatisch. Existiert noch kein Administrator und sind `INITIAL_ADMIN_*` gesetzt, wird er angelegt. Danach die Variablen aus der `.env` entfernen und das Passwort ändern.

Anschließend in der Oberfläche unter **Administration → Einstellungen** (`/admin/settings/…`) konfigurieren: Allgemein (Systemname),
E-Mail-Versand (SMTP), Speicher (S3), KI, PDF. Die Suche auf `/admin` bzw. Strg+K findet einzelne Felder (z. B. „smtp“, „logo“).

## S3 / MinIO

- Einstellungen `core.storage.*`: Endpoint (leer = AWS), Region (`auto` für R2), Bucket, Access Key, Secret, *Path-Style* (für MinIO aktivieren).
- Bucket privat lassen; Zugriff erfolgt per Server oder signierten URLs. Für Browser-Uploads über signierte URLs muss CORS am Bucket den eigenen `ORIGIN` für `PUT` erlauben.
- Verbindungstest auf der Storage-Seite.

## Chromium

Der PDF-Service startet Chromium mit `--no-sandbox` (im Container ohne User-Namespaces üblich). Seiten werden ohne JavaScript gerendert, externe Requests blockiert. Das Image enthält Chromium (~400 MB). Für lokale Läufe: `npx playwright install chromium`.

## Bildverarbeitung (sharp)

`core.images` nutzt die native Bibliothek `sharp` (libvips). Sie kommt als **vorgebaute** Optionalpakete `@img/sharp-<plattform>` und `@img/sharp-libvips-<plattform>` und braucht deshalb kein Install-Skript: `npm ci --ignore-scripts` im `bookworm-slim`-Image funktioniert ohne Compiler oder Systempakete. Voraussetzung: `package-lock.json` enthält die Pakete für `linux-x64` (`@img/sharp-linux-x64`, `@img/sharp-libvips-linux-x64`) – bei einem Lockfile, das nur unter Windows/macOS erzeugt wurde, prüfen (`grep sharp-linux-x64 package-lock.json`); für ARM-Server entsprechend `linux-arm64`. `sharp` steht in `dependencies` (wird mit `--omit=dev` installiert). HEIC/HEIF unterstützt der Prebuild nicht.

## Healthchecks

- App: `GET /api/v1/health` (Docker-Healthcheck).
- DB: `pg_isready`; `app` startet erst nach „healthy“.

## Backups

- **Datensicherung in der App** (Verwaltung → Datensicherung, Recht `core.system.backup`): verschlüsselte Datei `.epbackup`
  (Sicherungs-Passwort, AES-256-GCM, scrypt) mit allen oder ausgewählten Bereichen, optional inkl. Dateien aus S3 und inkl. Zugangsdaten.
  Wiederherstellen oder Zusammenführen auch auf einem **neuen Server mit anderem `APP_SECRET`** (Werte werden neu verschlüsselt).
  Upload in 8-MB-Stücken (passt zu `BODY_SIZE_LIMIT`), Grenze `BACKUP_MAX_BYTES` (Standard 4 GB). Temp-Dateien liegen in
  `$TMPDIR/ep-backup` (Platz in Archivgröße nötig, Aufräumen nach 1 h). Während einer Wiederherstellung pausieren Hintergrundjobs;
  nur ein Wartungsvorgang je Prozess, nicht für mehrere Instanzen ausgelegt.
- PostgreSQL: `docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB | gzip > backup.sql.gz`
- Objektspeicher separat sichern (Bucket-Versionierung/Replikation).
- `APP_SECRET` getrennt und sicher aufbewahren – ohne ihn sind verschlüsselte Einstellungen nicht lesbar.

## Updates

```bash
git pull
docker compose build app
docker compose up -d app     # Migrationen laufen beim Start
```

Vorher Backup erstellen. Modulmigrationen aktiver Module werden beim Start ebenfalls angewendet. Rollback: Image des Vorversion starten und Datenbank aus Backup wiederherstellen (Migrationen sind nicht automatisch umkehrbar).

## Betrieb mit mehreren Instanzen

Rate Limiter und Login-Sperre sind prozesslokal. Für mehrere App-Instanzen ist ein gemeinsamer Store nötig (nicht Teil der ersten Version).

## Stammeswebsite

Die öffentliche Website liegt in `website/`: die **alte Website** (`CrayonGamerHD-Philipp/edelweisspiraten-website`, Ordner `web/`,
SvelteKit, adapter-node, eigenes `package.json` und `Dockerfile`), bei der nur das Backend getauscht ist – statt PocketBase
holt sie **Termine, Galerien und Gruppen serverseitig** über die Website-Endpunkte (`/api/v1/modules/<modul>/website/…`) mit einem API-Key
(`website/src/lib/server/backend.ts`). Gruppen (Menü, Startseite, Gruppenseiten `/meute/<slug>`, `/sippe/<slug>`, Kontakt) kommen ebenfalls aus dem Backend; Ämter und CPD sind wie früher statisch, die häufigen Fragen stehen
fest im Code (`website/src/lib/faqs.ts`), die Download-Seite entfällt (`/download` → 308 auf `/`). Der Key erreicht nie den
Browser; Galeriebilder liefert die Website über `/bilder/galerie/…` aus, die Terminvorschau der Gruppenseiten über `/api/termine`.

1. **API-Key anlegen**: im Intern-Bereich unter **Administration → API-Keys** einen Key mit den Scopes
   `events.website.read galleries.website.read members.website.read` erstellen (ein Benutzerkonto, das diese Rechte hat).
   Die Module müssen aktiv sein, sonst liefert die API `404 module_disabled`.
2. **Umgebungsvariablen** (Vorlage `website/.env.example`):

   | Variable | Bedeutung |
   |---|---|
   | `WEBSITE_API_URL` | Basis-URL des Intern-Bereichs, **intern** erreichbar (Standard `http://app:3000` im selben Docker-Netz) |
   | `WEBSITE_API_KEY` | der Key aus Schritt 1 (`epk_…`) |
   | `ORIGIN` | öffentliche Adresse der Website – adapter-node braucht sie für den CSRF-Origin-Check |

3. **Starten**: Die Website ist als Dienst `website` in `docker-compose.yml` und `docker-compose.dokploy.yml` enthalten
   und startet mit dem Stack als **eigener Container** (Build aus `website/`, Port 3001, nur im internen Netz mit `app`
   verbunden: `WEBSITE_API_URL=http://app:3000`). Variablen im Stack:

   | Variable | Bedeutung |
   |---|---|
   | `WEBSITE_API_KEY` | Key aus Schritt 1; fehlt er, laufen die statischen Seiten, Termine und Galerie zeigen eine Fehlerseite |
   | `WEBSITE_ORIGIN` | öffentliche Adresse der Website (Standard `https://edelweisspiraten-bremen.de`), setzt `ORIGIN` |
   | `WEBSITE_PORT` | nur `docker-compose.yml`: Port-Bind auf 127.0.0.1 (Standard 3001) |

   Erstinstallation: Stack starten → im Intern-Bereich Key anlegen → `WEBSITE_API_KEY` setzen → `docker compose up -d website`
   (Dokploy: Variable eintragen, neu deployen). Der Container läuft als Benutzer `node`, schreibgeschützt, Healthcheck auf `/`.

   Einzeln ohne Compose:

   ```bash
   cd website
   docker build -t ep-website .
   docker run -d --name ep-website -p 127.0.0.1:3001:3001 --env-file .env ep-website
   ```

4. **Reverse-Proxy/Domain**: die Website-Domain (z. B. `edelweisspiraten-bremen.de`) auf Port 3001 leiten (Dokploy: Domain auf
   Service `website`, Port 3001; nginx-Profil: Beispielblock am Ende von `deploy/nginx/nginx.conf`), den
   Intern-Bereich weiter auf seiner eigenen Domain. `WEBSITE_API_URL` sollte nicht über das Internet laufen, wenn beide auf
   demselben Server stehen.

Die Website speichert API-Antworten 60 s im Arbeitsspeicher und zeigt bei Ausfall des Intern-Bereichs den letzten guten Stand
weiter; ohne gespeicherten Stand zeigen Termine und Galerie eine Fehlerseite. Rate-Limits je Key: 120 Anfragen/60 s für JSON,
600/60 s für Bilder (Galeriebilder werden mit `max-age=3600` ausgeliefert).

Ohne Docker (PM2, `website/ecosystem.config.cjs`):

```bash
cd website
npm ci
npm run build && WEBSITE_API_KEY=epk_… WEBSITE_API_URL=http://127.0.0.1:3000 PORT=3001 node build
```
