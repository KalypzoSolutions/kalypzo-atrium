# Deployment

## Bestandteile

- `Dockerfile`: Multi-Stage (base → deps → build → prod-deps → runtime), `node:24.22.0-bookworm-slim` mit Digest, Chromium (Playwright) für PDF, läuft als Benutzer `app` (UID 10001), Healthcheck auf `/api/v1/health`.
- `docker-compose.yml`: `db` (PostgreSQL 17, Volume `db-data`, `pg_isready`-Healthcheck), `app`, `website`, optional `nginx` (Profil `proxy`) und `db-backup` (Profil `backup`).
- `docker-compose.dokploy.yml`: Dokploy-Stack mit MinIO im Stack; `docker-compose.dokploy-external-s3.yml`: derselbe Stack **ohne** MinIO für einen externen S3-Dienst (siehe „Dokploy mit externem S3“).
- `docker-compose.dev.yml`: nur PostgreSQL + MinIO für lokale Entwicklung (Ports nur auf `127.0.0.1`).
- `deploy/nginx/nginx.conf`: nginx-Vorlage (HTTP→HTTPS, TLS, Größengrenzen je Pfad, Proxy-Header), `deploy/backup/`: Sicherungsdienst.

Gehärtet: `read_only` Dateisystem (tmpfs `/tmp` mit Größengrenze), `cap_drop: ALL`, `no-new-privileges`, `init: true` (tini als PID 1),
App-Port nur auf `127.0.0.1`, Speicher-/CPU-/Prozessgrenzen und Log-Rotation je Dienst (siehe „Ressourcen und Logs“).

### Image-Versionen (Issue #74)

Alle Images sind mit **fester Version und Digest** gepinnt (`name:tag@sha256:…`): Node `24.22.0-bookworm-slim` (App und Website, gleiche
Basis), `postgres:17.11-alpine3.24` (auch Basis von `deploy/backup/Dockerfile`, damit `pg_dump` zur Server-Version passt),
`nginx:1.30.6-alpine3.24` (stable), `bitnamilegacy/minio:2025.5.24-debian-12-r5`, `bitnamilegacy/minio-client:2025.7.21-debian-12-r3`.
Updates: Tag **und** Digest gemeinsam anheben (Dependabot `docker` für `/`, `/website`; für die Compose-Dateien und
`/deploy/backup` ist das Ökosystem `docker-compose` bzw. ein weiterer `docker`-Eintrag nötig). Beim Postgres-Update `db` und
`deploy/backup/Dockerfile` zusammen ändern; ein **Major**-Wechsel (17 → 18) braucht Dump/Restore oder `pg_upgrade`.

### Herunterfahren

`docker compose stop` sendet SIGTERM; die Wartezeit bis zum harten Abbruch ist je Dienst gesetzt (`stop_grace_period`: app 30 s,
db/db-backup 60 s, website 15 s). adapter-node schließt dabei den HTTP-Server geordnet. Hintergrundjobs, Chromium und der
DB-Pool reagieren in der App noch **nicht** auf das Herunterfahren (offen, App-Code) – Updates daher möglichst außerhalb
laufender Jobs (Jahresbeitrag-Versand, Wiederherstellung) einspielen.

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
# in .env: INTERN_DOMAIN=intern.example.org (andere Hostnamen beantwortet nginx nicht)
docker compose --profile proxy up -d
```

`deploy/nginx/nginx.conf` ist eine Vorlage des offiziellen Images (`/etc/nginx/templates/`): beim Start wird nur `${INTERN_DOMAIN}`
ersetzt. Enthalten: Default-Server, der unbekannte Hosts abweist (`444` bzw. `ssl_reject_handshake`), TLS nach Mozilla
„intermediate“ mit Session-Cache und ohne Session-Tickets, `limit_req` für Anmeldung/Passwort-Reset (30/min je IP, Burst 30),
Größengrenzen je Pfad (siehe „Upload-Grenzen“), ungepuffertes Durchreichen für Sicherungs-Upload und -Download
(`proxy_request_buffering off`, `proxy_buffering off`, `proxy_max_temp_file_size 0`, Timeouts bis 30 min) sowie für den Live-Stream der
Whiteboards (`/api/v1/modules/whiteboard/boards/<id>/live`, Server-Sent Events: `proxy_buffering off`, Timeout 1 h; die App sendet alle 20 s einen
Heartbeat und `X-Accel-Buffering: no`). **Live-Bearbeitung setzt genau eine App-Instanz voraus** (Verteilung im Prozess). Eigener Proxy/Traefik:
SSE nicht puffern, Lese-Timeout > 20 s. HSTS und weitere
Sicherheits-Header setzt die App selbst; der auskommentierte Website-Block ergänzt sie für die Stammeswebsite.

`ORIGIN` muss exakt der öffentliche URL entsprechen (`https://…`); davon hängen Cookie-Flags (`Secure`), CSRF und Better-Auth-Redirects ab.

## Dokploy (Git-Deployment mit App, PostgreSQL und S3)

`docker-compose.dokploy.yml` startet den kompletten Stack: `db` (PostgreSQL 17), `storage` (MinIO, nur intern) und `app`
(wird aus dem `Dockerfile` des Repositories gebaut). Variablen-Vorlage: `.env.dokploy.example`.

1. In Dokploy: Projekt → *Create Service* → **Compose** → Provider **Git** (Repository, Branch `staging` oder `main`),
   Compose-Pfad `./docker-compose.dokploy.yml`, Typ *Docker Compose*.
2. Reiter **Environment**: Inhalt von `.env.dokploy.example` einfügen und ausfüllen
   (Pflicht: `ORIGIN`, `APP_SECRET`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY` – alle zufällig, z. B. `openssl rand -hex 24`; für den ersten Administrator
   `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD`; für die automatische Sicherung `COMPOSE_PROFILES=backup` + `RESTIC_*`).
3. Reiter **Domains**: Domain auf Service `app`, Port `3000`, HTTPS aktivieren. `ORIGIN` muss exakt diese URL sein.
4. **Deploy**. Beim ersten Start laufen Migrationen, Modul-Sync und das Anlegen des Administrators automatisch;
   Storage (`S3_*`) und E-Mail (`SMTP_*`) werden in die Einstellungen übernommen, **solange sie dort noch nicht
   gesetzt sind** (spätere Änderungen in der Oberfläche bleiben erhalten).
5. Anmelden, Passwort ändern, in „Module“ die Fachmodule aktivieren, `INITIAL_ADMIN_*` aus der Environment entfernen.

Hinweise:
- Der Server greift intern per `http://storage:9000` auf den Objektspeicher zu. Belege und Dokumente laufen über die
  App; Browser benötigen keinen Zugriff auf den Speicher. Sollen Browser direkt per signierter URL hochladen
  (`/storage/upload-url`), `storage` über eine eigene Domain veröffentlichen und `S3_ENDPOINT` darauf setzen.
- Das MinIO-Image `bitnamilegacy/minio` ist eingefroren (keine Sicherheitsupdates); die App arbeitet mit einem eigenen
  MinIO-Benutzer ohne Admin-Rechte – siehe „Objektspeicher (MinIO) absichern“. Für den dauerhaften Betrieb wird ein
  externer S3-Dienst empfohlen.
- Backups: Dienst `db-backup` (Profil `backup`) – Dokploy-eigene Datenbank-Backups gelten nur für von Dokploy verwaltete
  Datenbanken, **nicht** für `db` in diesem Stack. Siehe „Automatische Sicherung“. `APP_SECRET` getrennt aufbewahren.
- Uploads/Importe: Traefik (Dokploy) begrenzt die Body-Größe nicht; es gilt `BODY_SIZE_LIMIT=110M` aus dem `Dockerfile` und
  danach die fachlichen Grenzen (Tabelle „Upload-Grenzen“).
- Geprüft: Stack lokal gebaut und gestartet (alle Dienste healthy), Anmeldung, PDF-Erzeugung mit Chromium im
  `read_only`-Container, Beleg-Upload und -Download über MinIO.

## Dokploy mit externem S3 (empfohlen für Produktion)

`docker-compose.dokploy-external-s3.yml` entspricht `docker-compose.dokploy.yml`, aber **ohne** `storage`/`storage-init` und
ohne Volume `s3-data`; die App spricht einen externen S3-kompatiblen Dienst an (Hetzner Object Storage, Cloudflare R2,
Backblaze B2, AWS S3 …). Variablen-Vorlage: `.env.dokploy-external-s3.example`.

1. Beim Anbieter einen **privaten** Bucket und einen Zugangsschlüssel nur für diesen Bucket anlegen (Lesen, Schreiben,
   Löschen, Auflisten; keine Rechte auf andere Buckets).
2. In Dokploy wie oben anlegen, Compose-Pfad `./docker-compose.dokploy-external-s3.yml`.
3. Environment: Pflicht `ORIGIN`, `APP_SECRET`, `POSTGRES_PASSWORD`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`; `S3_ENDPOINT` (leer = AWS), `S3_FORCE_PATH_STYLE` (Standard `false`, `true` nur für Anbieter ohne
   virtuelle Host-Namen). `MINIO_*` entfällt.
4. Deploy → unter **Administration → Einstellungen → Speicher** „Verbindung testen“ und einen Beleg hoch-/herunterladen.

Hinweise:
- `S3_*` werden nur beim **ersten** Start übernommen; bei einer bestehenden Datenbank zählen die Speicher-Einstellungen in der
  Oberfläche (dort umstellen).
- Sicherung (`COMPOSE_PROFILES=backup`): `db-backup` spiegelt standardmäßig den externen Bucket mit dem App-Zugang; besser
  `BACKUP_S3_ACCESS_KEY_ID/SECRET_ACCESS_KEY` mit Nur-Lese-Schlüssel setzen. Ohne Endpoint (AWS) `BACKUP_S3_ENDPOINT` setzen, sonst
  wird nur die Datenbank gesichert. `RESTIC_REPOSITORY` nie in den App-Bucket legen.
- **Umzug** vom MinIO-Stack: Wartungsfenster, `rclone sync` vom MinIO-Bucket (Volume `s3-data`, intern `ep-intern-<env>-storage:9000`)
  in den neuen Bucket, Speicher-Einstellungen in der Oberfläche umstellen, testen, dann Compose-Pfad in Dokploy wechseln und
  deployen. Das Volume `s3-data` erst nach erfolgreicher Prüfung löschen.
- Browser-Uploads über signierte URLs (`/storage/upload-url`) brauchen CORS am Bucket für den eigenen `ORIGIN` (`PUT`).

## Umgebungsvariablen

| Variable | Beschreibung |
|---|---|
| `POSTGRES_DB/USER/PASSWORD` | Datenbank-Container (Passwort Pflicht) |
| `APP_SECRET` | Pflicht, ≥ 32 Zeichen, zufällig. **Nicht ändern**, ohne Secrets neu einzugeben (siehe [Sicherheit](security.md)). Mit `NODE_ENV=production` (Image) bricht der Start ab, wenn es der Build-Platzhalter ist oder < 6 verschiedene Zeichen hat |
| `ORIGIN` | Pflicht, öffentliche URL. Mit `NODE_ENV=production` muss sie gesetzt sein und `https://` verwenden (Ausnahme `localhost`/`127.0.0.1` für Demo/E2E) |
| `JOBS_DAILY_WINDOW` | optional: Zeitfenster der täglichen Hintergrundjobs (Mails, Zusammenfassungen) als `von-bis` in vollen Stunden Europe/Berlin, Standard `6-20` |
| `BACKUP_MAX_BYTES` | optional: größte hochladbare Sicherungsdatei in Byte (Standard 4 GB) |
| `BACKUP_TMP_DIR` | Temp-Verzeichnis der Datensicherung (absolut; Standard `os.tmpdir()/ep-backup`). Im Image/Compose `/var/tmp/ep-backup` auf dem Volume `backup-tmp` |
| `MINIO_ROOT_USER/PASSWORD` | nur Dokploy-Stack: Root-Zugang von MinIO (nicht für die App) |
| `*_MEM_LIMIT`, `*_CPUS` | Ressourcengrenzen je Dienst (`APP_`, `DB_`, `STORAGE_`, `WEBSITE_`, `NGINX_`, `BACKUP_`), siehe „Ressourcen und Logs“ |
| `INTERN_DOMAIN` | nur nginx-Profil: Hostname des Intern-Bereichs |
| `COMPOSE_PROFILES` | z. B. `proxy,backup` – schaltet nginx bzw. den Sicherungsdienst ein |
| `RESTIC_*`, `BACKUP_*` | Sicherungsdienst, siehe „Automatische Sicherung“ |
| `APP_PORT` | Host-Port (Bind 127.0.0.1) |
| `INITIAL_ADMIN_EMAIL/PASSWORD` | Bootstrap; Passwort ≥ 12 Zeichen |
| `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE` | optional: Vorbelegung der Storage-Einstellungen beim ersten Start |
| `SMTP_HOST/PORT/SECURE/USER/PASSWORD/FROM` | optional: Vorbelegung der E-Mail-Einstellungen beim ersten Start |
| `ADDRESS_HEADER`, `XFF_DEPTH`, `PROTOCOL_HEADER`, `HOST_HEADER` | in `docker-compose.yml` gesetzt (adapter-node) |

### Proxy-Header

Hinter einem Reverse Proxy sieht die App nur dessen IP. `ADDRESS_HEADER=X-Forwarded-For` mit `XFF_DEPTH=1` liest die Client-IP als **letzten** Eintrag (von einem Proxy gesetzt) – Voraussetzung ist, dass genau ein vertrauenswürdiger Proxy davorsteht (Nginx-Konfiguration setzt `X-Forwarded-For $remote_addr`, ersetzt also clientseitige Werte). `PROTOCOL_HEADER`/`HOST_HEADER` sorgen für korrektes `https` und Host. Bei mehreren Proxys `XFF_DEPTH` anpassen. Die IP geht in Rate Limits und Audit-Logs ein.

**Eine IP-Quelle für alles (#42):** Maßgeblich ist ausschließlich `event.getClientAddress()` (adapter-node mit den Variablen oben, zählt
`X-Forwarded-For` von **rechts**). `hooks.server.ts` entfernt einen vom Client mitgeschickten Header `x-ep-client-ip` und setzt ihn neu
mit dieser Adresse; Better Auth liest (`advanced.ipAddress.ipAddressHeaders`) **nur** diesen Header, die Auth-Form-Actions und der
Login-Audit nutzen denselben Helfer (`src/lib/server/core/auth/client-ip.ts`). Eine eigene Auswertung des ersten `X-Forwarded-For`-Eintrags
gibt es nicht mehr – ein gefälschter `X-Forwarded-For`-Wert ändert weder Rate-Limit noch Audit-IP.

| Proxy | Verhalten | Einstellung |
|---|---|---|
| mitgeliefertes nginx (`deploy/nginx`) | **überschreibt** `X-Forwarded-For` mit `$remote_addr` | `XFF_DEPTH=1` |
| Traefik (Dokploy, `docker-compose.dokploy.yml`) | **hängt an** (Client-Wert bleibt links stehen); rechts steht die von Traefik gesehene Adresse | `XFF_DEPTH=1`, solange Traefik der einzige Proxy vor der App ist |
| Cloudflare → Traefik/nginx | zwei Proxys hängen an | `XFF_DEPTH=2` (rechts Cloudflare-Kante, davor der Client) **und** der innere Proxy darf nur Cloudflare-IPs annehmen; alternativ `ADDRESS_HEADER=CF-Connecting-IP`, wenn die App ausschließlich über Cloudflare erreichbar ist |

Faustregel: `XFF_DEPTH` = Anzahl der vertrauenswürdigen Proxys, die anhängen. Ist die App zusätzlich direkt (ohne Proxy) erreichbar, kann
jede*r die Kette vorgeben – Port 3000 daher nie öffentlich freigeben.

## Erster Start

Beim Start laufen Migrationen und Synchronisation automatisch. Existiert noch kein Administrator und sind `INITIAL_ADMIN_*` gesetzt, wird er angelegt. Danach die Variablen aus der `.env` entfernen und das Passwort ändern.

Anschließend in der Oberfläche unter **Administration → Einstellungen** (`/admin/settings/…`) konfigurieren: Allgemein (Systemname),
E-Mail-Versand (SMTP), Speicher (S3), KI, PDF. Die Suche auf `/admin` bzw. Strg+K findet einzelne Felder (z. B. „smtp“, „logo“).

## S3 / MinIO

- Einstellungen `core.storage.*`: Endpoint (leer = AWS), Region (`auto` für R2), Bucket, Access Key, Secret, *Path-Style* (für MinIO aktivieren).
- Bucket privat lassen; Zugriff erfolgt per Server oder signierten URLs. Für Browser-Uploads über signierte URLs muss CORS am Bucket den eigenen `ORIGIN` für `PUT` erlauben.
- Verbindungstest auf der Storage-Seite.

### Objektspeicher (MinIO) absichern (Issue #41)

Im Dokploy-Stack sind Root- und App-Zugang getrennt:

- `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` bekommen nur `storage` und der Einmal-Container `storage-init`.
- `storage-init` (MinIO-Client, läuft bei jedem Deploy, idempotent) legt den Bucket `S3_BUCKET` privat an, erstellt die Policy
  `ep-intern-app` (nur `s3:GetObject|PutObject|DeleteObject`, Multipart-Abbruch/-Liste auf `S3_BUCKET/*`, `ListBucket`/`GetBucketLocation`
  auf den Bucket) und den Benutzer `S3_ACCESS_KEY_ID` mit dieser Policy. `app` startet erst nach erfolgreichem `storage-init`.
  Der App-Schlüssel kann damit keine Buckets anlegen/löschen, keine Policies/Benutzer ändern und keine anderen Buckets lesen.
- Ohne `MINIO_ROOT_*` (alte Installationen) gilt weiter der App-Zugang als Root; `storage-init` schreibt dann eine **Warnung** ins Log
  und ändert nichts.

**Migration einer bestehenden Installation** (bisher `S3_*` = Root):

1. In der Environment `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` auf die **bisherigen** Werte von `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`
   setzen (der Root-Zugang bleibt damit unverändert, die Daten im Volume `s3-data` bleiben lesbar).
2. Neue App-Werte erzeugen: `S3_ACCESS_KEY_ID=$(openssl rand -hex 12)`, `S3_SECRET_ACCESS_KEY=$(openssl rand -hex 24)`; deployen.
   Im Log von `storage-init`: „Bucket … und App-Benutzer eingerichtet“.
3. **Wichtig:** Die App liest `S3_*` nur beim ersten Start; danach gelten die Einstellungen in der Datenbank. Unter
   **Administration → Einstellungen → Speicher** Access Key und Secret auf die neuen App-Werte ändern, „Verbindung testen“,
   einen Beleg hoch- und herunterladen.
4. Optional später das Root-Passwort ändern (`MINIO_ROOT_PASSWORD` neu, deployen) – der App-Zugang ist davon unabhängig.

Prüfen: mit dem App-Schlüssel schlägt eine Admin-Abfrage fehl (`mc admin info <alias>` → *Access Denied*), Upload/Download im
App-Bucket funktionieren.

**Image**: `minio/minio` wird nicht mehr auf Docker Hub veröffentlicht (Quell-Releases ohne Images); `bitnamilegacy/minio` ist seit
2025-08 eingefroren. Gepinnt bleibt die bisher genutzte Version `2025.5.24-debian-12-r5`, damit ein Deploy nichts am Datenbestand
ändert. Angriffsfläche: nur im internen Netz, App ohne Root-Zugang. Optionen für den Dauerbetrieb (Entscheidung offen):
(a) **externer S3-Dienst** (empfohlen; Hetzner Object Storage, Cloudflare R2, Backblaze B2 …): `storage`/`storage-init` entfernen,
Daten per `rclone sync` umziehen, Speicher-Einstellungen umstellen; (b) gepflegter MinIO-Community-Build (z. B. `pgsty/minio`,
offizielles Layout `server /data`, Healthcheck ohne `curl`) – Wechsel braucht Test von Datenpfad, Benutzer-ID und Healthcheck;
(c) Garage/SeaweedFS (andere Verwaltung, Daten per `rclone` umziehen).

## Chromium

Der PDF-Service startet Chromium mit `--no-sandbox` (im Container ohne User-Namespaces üblich). Seiten werden ohne JavaScript gerendert, externe Requests blockiert. Das Image enthält Chromium (~400 MB). Für lokale Läufe: `npx playwright install chromium`.

## Bildverarbeitung (sharp)

`core.images` nutzt die native Bibliothek `sharp` (libvips). Sie kommt als **vorgebaute** Optionalpakete `@img/sharp-<plattform>` und `@img/sharp-libvips-<plattform>` und braucht deshalb kein Install-Skript: `npm ci --ignore-scripts` im `bookworm-slim`-Image funktioniert ohne Compiler oder Systempakete. Voraussetzung: `package-lock.json` enthält die Pakete für `linux-x64` (`@img/sharp-linux-x64`, `@img/sharp-libvips-linux-x64`) – bei einem Lockfile, das nur unter Windows/macOS erzeugt wurde, prüfen (`grep sharp-linux-x64 package-lock.json`); für ARM-Server entsprechend `linux-arm64`. `sharp` steht in `dependencies` (wird mit `--omit=dev` installiert). HEIC/HEIF unterstützt der Prebuild nicht.

Härtung (ab sharp 0.35.5, Issue #6): `src/lib/server/core/images/index.ts` sperrt beim Laden **alle** libvips-Loader
(`sharp.block({ operation: ['VipsForeignLoad'] })`) und gibt nur JPEG, PNG, WebP, GIF (`nsgif`) und HEIF (für AVIF) wieder frei
(`ALLOWED_VIPS_LOADERS`). SVG/librsvg, TIFF, PDF, Magick, OpenSlide, FITS, Matrix, VIPS, JPEG 2000/XL, RAW und UltraHDR sind damit
prozessweit nicht erreichbar. Zusätzlich prüft `sniffImageFormat` die Datei-Signatur (JPEG `FF D8 FF`, PNG, `GIF87a/89a`,
`RIFF…WEBP`, AVIF = `ftyp` mit Marke `avif`/`avis` ohne HEVC-Marke) **vor** dem ersten sharp-Aufruf; das von libvips erkannte
Format muss dazu passen. Neue Eingabeformate brauchen beide Stellen. Nach einem sharp-Update im Docker-Image prüfen, dass
das Linux-Binary lädt: `docker compose run --rm app node -e "console.log(require('sharp').versions)"`.

## Ressourcen und Logs (Issue #39)

Jeder Dienst hat Speicher-, CPU- und Prozessgrenzen sowie Log-Rotation (YAML-Anker `x-logging`: `json-file`, `max-size 10m`,
`max-file 5` → höchstens 50 MB Logs je Container). Grenzen sind **Obergrenzen**, keine Reservierungen; bei Überschreitung des
Speichers beendet der Kernel nur diesen Container (`restart: unless-stopped` startet ihn neu), PostgreSQL bleibt unberührt.
`cpu_shares` gibt der Datenbank bei Engpässen Vorrang. `cpus` darf die Kernzahl des Hosts nicht übersteigen (sonst startet der
Dienst nicht) – die Standardwerte sind deshalb ≤ 1,0.

| Dienst | `mem_limit` (Variable) | `cpus` | `pids_limit` | Begründung |
|---|---|---|---|---|
| `app` | 1536m (`APP_MEM_LIMIT`) | 1.0 (`APP_CPUS`) | 1024 | Node + Chromium (PDF, 300–500 MB je Lauf) + sharp (Bilder bis 50 MP); tmpfs `/tmp` (256 MB) zählt mit; Chromium braucht viele Threads |
| `db` | 1g (`DB_MEM_LIMIT`) | 1.0 (`DB_CPUS`) | 256 | PostgreSQL mit Standard-`shared_buffers` (128 MB), ≤ 10 Verbindungen; `shm_size 256m` |
| `storage` (Dokploy) | 512m (`STORAGE_MEM_LIMIT`) | 0.5 (`STORAGE_CPUS`) | 256 | MinIO Single-Node |
| `website` | 256m (`WEBSITE_MEM_LIMIT`) | 0.5 (`WEBSITE_CPUS`) | 128 | SvelteKit-SSR mit 60-s-Cache |
| `nginx` | 128m (`NGINX_MEM_LIMIT`) | 0.5 (`NGINX_CPUS`) | 128 | nur Proxy |
| `db-backup` | 512m (`BACKUP_MEM_LIMIT`) | 0.5 (`BACKUP_CPUS`) | 256 | pg_dump, rclone, restic (Index im RAM) |
| `storage-init` | 128m | 0.5 | 64 | Einmal-Lauf |

Empfehlung **4 GB RAM / 2 vCPU** (Standardwerte): bei größeren Servern `APP_CPUS=2`, `DB_CPUS=2`. Empfehlung **2 GB RAM**:
`APP_MEM_LIMIT=1024m`, `DB_MEM_LIMIT=512m`, `STORAGE_MEM_LIMIT=256m`, `WEBSITE_MEM_LIMIT=192m`, `BACKUP_MEM_LIMIT=256m`, dazu
1–2 GB Swap auf dem Host; große PDF-Massenläufe und Sicherungen mit Dateien dann nicht parallel starten. Kontrolle:
`docker stats`, `docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.LogConfig}}' <container>`.

## Upload-Grenzen (Issue #25)

Kette: **Proxy ≥ Node (`BODY_SIZE_LIMIT`) ≥ fachliche Grenze**. Node (`BODY_SIZE_LIMIT=110M` im `Dockerfile`) gilt global; nginx setzt
je Pfad engere Grenzen, damit große Bodies nur dort ankommen, wo sie gebraucht werden.

| Pfad / Fall | nginx `client_max_body_size` | Node | fachliche Grenze (Code) |
|---|---|---|---|
| Seiten und Form-Actions (`/`, z. B. Logo, Profilbild) | 10 MB | 110 MB | Logo/Profilbild 2 MB |
| `/login`, `/forgot-password`, `/reset-password`, `/api/auth/*` | 64 KB (+ `limit_req`) | 110 MB | – |
| REST-JSON `/api/v1/*` | 2 MB | 110 MB | 1 MB (`MAX_BODY_BYTES`, `api/router.ts`) |
| Modul-Uploads `/api/v1/modules/*` | 110 MB | 110 MB | Dateien `core.storage.maxFileSizeMb` (Standard 50 MB), Auslagen-Anhänge 50 MB, öffentliches Multipart 30 MB (`MAX_MULTIPART_BYTES`; Kosten-Link, Upload-Link), Galerie 25 MB, Artikelbilder 15 MB, Belege/Dokumente 10 MB, Kassen-Import 5 MB, Gruppenbild 2 MB, Aktions-Import 200 MB (`MAX_ARCHIVE_BYTES`) |
| Sicherung hochladen `/admin/backup/import/upload/*` | 9 MB, ungepuffert | 110 MB | 8 MB je Stück (`UPLOAD_CHUNK_BYTES`), Datei ≤ `BACKUP_MAX_BYTES` (4 GB) |
| Sicherung herunterladen `/admin/backup/export/*` | Antwort ungepuffert, 30 min | – | bis 4 GB |

Dokploy/Traefik setzt keine Body-Grenze: dort gilt nur Node (110 MB) und die fachliche Grenze.

**Bekannte Widersprüche (offen, App-Code):** Aktions-Import erlaubt 200 MB, der Export packt bis 250 MB Belege – über 110 MB scheitert
der Upload am Node-Limit (Fehler von adapter-node statt deutscher JSON-Meldung); `core.storage.maxFileSizeMb` lässt bis 5000 MB zu,
wirksam sind höchstens 110 MB. Upload-Handler puffern den Body vor der Größenprüfung, `readBody` liest chunked JSON bis zum
Node-Limit. Lösung (andere Teams): Aktions-Import/-Export auf ≤ 100 MB abstimmen oder gestückelt hochladen, streamendes `readBody`,
gemeinsamer Upload-Helfer mit `Content-Length`-Pflicht.

## Healthchecks

- App: `GET /api/v1/health` (Docker-Healthcheck): prüft die Datenbank (`SELECT 1`, Timeout 2 s) → `200 { status, database }`,
  sonst `503 unavailable` (ohne Fehlerdetails). Wird nicht im `api_log` protokolliert.
- DB: `pg_isready`; `app` startet erst nach „healthy“.

## Backups

- **Datensicherung in der App** (Verwaltung → Datensicherung, Recht `core.system.backup`): verschlüsselte Datei `.atriumbackup`
  (ältere Sicherungen `.epbackup` lassen sich weiter einspielen)
  (Sicherungs-Passwort, AES-256-GCM, scrypt) mit allen oder ausgewählten Bereichen, optional inkl. Dateien aus S3 und inkl. Zugangsdaten.
  Wiederherstellen oder Zusammenführen auch auf einem **neuen Server mit anderem `APP_SECRET`** (Werte werden neu verschlüsselt).
  Upload in 8-MB-Stücken (passt zu `BODY_SIZE_LIMIT`), Grenze `BACKUP_MAX_BYTES` (Standard 4 GB). Temp-Dateien liegen in
  `BACKUP_TMP_DIR` (Image/Compose: `/var/tmp/ep-backup` auf dem **Plattenvolume `backup-tmp`**, ohne Variable `os.tmpdir()/ep-backup`;
  Aufräumen nach 1 h). `/tmp` ist im Container ein tmpfs im Arbeitsspeicher mit **256 MB** Grenze – große Sicherungen dürfen dort nicht
  landen (Issue #38). Platzbedarf auf dem Volume ≈ **2 × größte Sicherung** (Upload + Export gleichzeitig); die Freiplatzprüfung misst
  dieses Volume und antwortet mit 503 „Zu wenig Speicherplatz für die Datensicherung“. Während einer Wiederherstellung pausieren
  Hintergrundjobs; nur ein Wartungsvorgang je Prozess, nicht für mehrere Instanzen ausgelegt.
- **Automatische Sicherung**: Dienst `db-backup`, siehe unten. Manuell: `docker compose exec db pg_dump -U $POSTGRES_USER -Fc $POSTGRES_DB > backup.dump`
- `APP_SECRET` getrennt und sicher aufbewahren – ohne ihn sind verschlüsselte Einstellungen nicht lesbar.

### Automatische Sicherung (Dienst `db-backup`, Issue #40)

`deploy/backup/` (Image auf Basis `postgres:17.11-alpine3.24` + restic + rclone), in beiden Compose-Dateien als Profil `backup`
(einschalten mit `COMPOSE_PROFILES=backup`, unter nginx `COMPOSE_PROFILES=proxy,backup`). Ablauf täglich um `BACKUP_TIME`
(Standard 02:30, `TZ` Standard Europe/Berlin):

1. `pg_dump --format=custom` der App-Datenbank nach `/work/db/<db>.dump`,
2. `rclone sync` des App-Buckets nach `/work/objects` (inkrementell; Quelle `BACKUP_S3_*`, im Dokploy-Stack standardmäßig MinIO mit
   dem App-Zugang; leer = nur Datenbank),
3. `restic backup /work` → verschlüsseltes (AES-256, Schlüssel `RESTIC_PASSWORD`), dedupliziertes Repository `RESTIC_REPOSITORY`,
4. Aufbewahrung `restic forget --prune`: **7 täglich / 4 wöchentlich / 6 monatlich** (`BACKUP_KEEP_*`), sonntags `restic check` (5 % der Daten).

| Variable | Bedeutung |
|---|---|
| `RESTIC_PASSWORD` | **Pflicht**, ≥ 20 Zeichen, zufällig (`openssl rand -base64 32`). Getrennt vom Server aufbewahren – ohne ihn ist keine Sicherung lesbar |
| `RESTIC_REPOSITORY` | Ziel. Standard `/backups/restic` (Volume `backup-repo` auf **demselben Host**, schützt nur vor Fehlbedienung – Log-Hinweis). Für Offsite z. B. `s3:https://fsn1.your-objectstorage.com/ep-intern-backup`, `b2:bucket:pfad`, `rest:https://…` |
| `BACKUP_REPO_ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION` | Zugang zum S3-Ziel (eigener Schlüssel, nur für dieses Bucket; am besten mit Objekt-Sperre/Versionierung beim Anbieter) |
| `BACKUP_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION/FORCE_PATH_STYLE` | Quelle Objektspeicher (Lesezugriff genügt). `docker-compose.yml`: ohne Angabe nur DB |
| `BACKUP_TIME`, `BACKUP_KEEP_DAILY/WEEKLY/MONTHLY`, `BACKUP_RUN_ON_START` | Zeitplan, Aufbewahrung, Sofortlauf beim Start |
| `BACKUP_HEARTBEAT_URL` | GET nach jedem Erfolg (z. B. healthchecks.io – meldet auch ausbleibende Läufe) |
| `BACKUP_NOTIFY_URL` | POST mit Fehlertext bei jedem Fehlschlag (z. B. ntfy-Thema mit Mail-Weiterleitung) |

Fehlschläge stehen als `SICHERUNG FEHLGESCHLAGEN` im Log (`docker compose logs db-backup`); der Container wird `unhealthy`, wenn die
letzte erfolgreiche Sicherung älter als 26 h ist (`BACKUP_MAX_AGE_HOURS`). Für eine Benachrichtigung ohne eigenen Dienst
`BACKUP_HEARTBEAT_URL` setzen. Befehle:

```bash
docker compose run --rm db-backup run          # sofort sichern
docker compose run --rm db-backup snapshots    # Snapshots auflisten
docker compose run --rm db-backup check        # Repository vollständig prüfen
```

Der letzte Dump und der Bucket-Spiegel liegen zusätzlich **unverschlüsselt** im Volume `backup-work` auf dem Host (Arbeitskopie).
Löschfristen für Sicherungen (z. B. ausgetretene Mitglieder) sind fachlich noch festzulegen (Issue #30): durch die Aufbewahrung
verschwinden gelöschte Daten spätestens nach 6 Monaten aus den Sicherungen. Aufbewahrungspflicht für Belege (bis 10 Jahre) wird
durch die Sicherung **nicht** erfüllt – das ist Aufgabe der Ablage im laufenden System bzw. eines Jahresarchivs.

### Wiederherstellung und Restore-Probe

Wiederherstellung auf einem **frischen Server** (gleiches Verfahren für die Probe, dann auf einem Staging-Server):

```bash
# 1. Repository erreichbar machen: gleiche RESTIC_*/BACKUP_REPO_*-Werte in .env, Stack ohne App starten
docker compose up -d db
# 2. Snapshot in das Arbeitsvolume holen
docker compose run --rm db-backup restore latest /work/restore
# 3. Datenbank einspielen (leere oder zu ersetzende DB; Objekte werden ersetzt)
docker compose run --rm db-backup restore-db /work/restore/work/db/ep_intern.dump
# 4. Dateien zurück in den Bucket (mit Schreibzugang, z. B. MinIO-Root im Dokploy-Stack)
docker compose run --rm --entrypoint sh -e RCLONE_CONFIG_DST_TYPE=s3 -e RCLONE_CONFIG_DST_PROVIDER=Other \
  -e RCLONE_CONFIG_DST_ENDPOINT=http://storage:9000 -e RCLONE_CONFIG_DST_ACCESS_KEY_ID=… \
  -e RCLONE_CONFIG_DST_SECRET_ACCESS_KEY=… -e RCLONE_CONFIG_DST_FORCE_PATH_STYLE=true \
  db-backup -c 'rclone copy /work/restore/work/objects dst:ep-intern'
# 5. App mit DEMSELBEN APP_SECRET starten (sonst sind verschlüsselte Einstellungen/IBANs unlesbar)
docker compose up -d
```

Unter Dokploy die Befehle auf dem Server im Projektverzeichnis mit dem Projektnamen ausführen (`docker compose -p <projekt> …`)
oder `docker exec` in den laufenden `db-backup`-Container (`ep-backup snapshots`). Das Verzeichnis `/work/restore` wird nicht mitgesichert.

**Restore-Probe (halbjährlich, Ergebnis mit Datum im Vereinsprotokoll festhalten):**

- [ ] `snapshots` zeigt tägliche Snapshots bis gestern; Heartbeat-Dienst meldet keine Ausfälle.
- [ ] Auf einem Testserver (nie produktiv!) mit Kopie von `.env` (`APP_SECRET`, `RESTIC_*`) die Schritte 1–5 ausführen.
- [ ] Anmeldung als Administrator*in klappt; Mitgliederzahl, letzte Kassenbuchung und letzte Aktion entsprechen dem Stand des Snapshots.
- [ ] Ein älterer Beleg und ein Mitgliedsdokument lassen sich herunterladen und öffnen (Objektspeicher vollständig).
- [ ] Eine verschlüsselte Einstellung ist lesbar (z. B. IBAN in der Kasse, SMTP-Verbindungstest) → `APP_SECRET` stimmt.
- [ ] `check` ohne Fehler; Dauer der Wiederherstellung notieren.
- [ ] Testserver und wiederhergestellte Daten danach löschen (personenbezogene Daten).
- [ ] Fehlermeldung testen: `RESTIC_REPOSITORY` absichtlich falsch setzen, `run` → Log `SICHERUNG FEHLGESCHLAGEN` und Alarm über `BACKUP_NOTIFY_URL`.

## Updates

```bash
git pull
docker compose build app
docker compose up -d app     # Migrationen laufen beim Start
```

Vorher Backup erstellen. Modulmigrationen aktiver Module werden beim Start ebenfalls angewendet. Rollback: Image des Vorversion starten und Datenbank aus Backup wiederherstellen (Migrationen sind nicht automatisch umkehrbar).

## CI (GitHub Actions)

`.github/workflows/ci.yml` läuft bei jedem Push auf `main`/`staging` und bei jedem Pull Request auf Linux (`ubuntu-latest`,
Node aus `.nvmrc` = Version des `Dockerfile`, `TZ=UTC` wie im Container):

| Job | Schritte |
|---|---|
| `verify` | `npm ci` → Lockfile enthält `@img/sharp-linux-x64` → `npx prettier --check src tests docs` → `npm run check` → `npx eslint .` → `npx vitest run --coverage` (Artefakt `coverage`, lcov) → `npm run build` → `npm audit --omit=dev --audit-level=high` |
| `website` | in `website/`: `npm ci` → `svelte-check` (bricht ab, wenn es **mehr** als die 5 bekannten Altfehler werden) → `npm run build` → `npm audit --omit=dev --audit-level=high` |
| `e2e` | `needs: verify`, nur **nightly** (03:15 UTC) und per *Run workflow* (`workflow_dispatch`): `npx playwright install --with-deps chromium` → `npx playwright test` (`CI=true`, eigener Server), Artefakt `playwright-report` (Bericht + `test-results/`) |

- Coverage: `@vitest/coverage-v8`, Block `test.coverage` in `vite.config.ts` (Reporter `text-summary` + `lcov`, Bereich `src/lib/**/*.ts`).
  Lokal: `npx vitest run --coverage` → `coverage/lcov-report/index.html`. Schwellen siehe `vite.config.ts` (schrittweise anheben).
- Updates: `.github/dependabot.yml` (npm Root und `website/`, Docker Root und `website/`, GitHub Actions; wöchentlich, Ziel `staging`,
  Minor/Patch gebündelt).
- `npm audit` meldet derzeit nur Low/Moderate (Root: `cookie` < 0.7 über `@sveltejs/kit` 2 – erst mit Kit 3 behoben; `esbuild` über
  `drizzle-kit`, nur Entwicklung). Website: `--omit=dev` ohne Befund, mit Dev-Abhängigkeiten 3 × Low (`cookie`).
- **Manuell im GitHub-Repository einzurichten** (nicht per Datei möglich): Branch-Protection für `main` und `staging` mit Pflicht-Checks
  `verify` und `website` („Require status checks to pass“, „Require a pull request before merging“), *Dependabot alerts* und
  *security updates* aktivieren. **Dokploy** deployt weiterhin bei jedem Push auf den Branch – Autodeploy erst nach grüner CI gibt es
  nur, wenn Pushes ausschließlich über geschützte PRs laufen oder Dokploy per Webhook aus der CI ausgelöst wird.

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
   `events.website.read galleries.website.read members.website.read offices.website.read website.content.read messages.website.contact` erstellen (ein Benutzerkonto, das diese
   Rechte hat; `offices.website.read` für die Seite „Unser Team“, `website.content.read` für Banner, FAQ und Blog – Modul `website` aktivieren;
   `messages.website.contact` für das Kontaktformular – Anfragen landen im Posteingang „Stamm“ des Moduls `messages`, ohne Stamm-Adresse
   (`core.organization.email`) in „Nicht zugeordnet“). Ein bestehender Key bekommt neue Scopes nicht nachträglich: neuen Key anlegen und
   `WEBSITE_API_KEY` ersetzen.
   Die Module müssen aktiv sein, sonst liefert die API `404 module_disabled`.
2. **Umgebungsvariablen** (Vorlage `website/.env.example`):

   | Variable | Bedeutung |
   |---|---|
   | `WEBSITE_API_URL` | Basis-URL des Intern-Bereichs, **intern** erreichbar (Standard `http://app:3000` im selben Docker-Netz) |
   | `WEBSITE_API_KEY` | der Key aus Schritt 1 (`epk_…`) |
   | `ORIGIN` | öffentliche Adresse der Website – adapter-node braucht sie für den CSRF-Origin-Check |

3. **Starten**: Die Website ist als Dienst `website` in `docker-compose.yml` und `docker-compose.dokploy.yml` enthalten
   und startet mit dem Stack als **eigener Container** (Build aus `website/`, Port 3001, nur im internen Netz mit `app`
   verbunden: `WEBSITE_API_URL=http://app:3000`, in Dokploy `http://ep-intern-<DEPLOY_ENV>-app:3000`, siehe unten). Variablen im Stack:

   | Variable | Bedeutung |
   |---|---|
   | `WEBSITE_API_KEY` | Key aus Schritt 1; fehlt er, laufen die statischen Seiten, Termine und Galerie zeigen eine Fehlerseite |
   | `WEBSITE_ORIGIN` | öffentliche Adresse der Website (Standard `https://edelweisspiraten-bremen.de`), setzt `ORIGIN` |
   | `WEBSITE_PORT` | nur `docker-compose.yml`: Port-Bind auf 127.0.0.1 (Standard 3001) |

   Erstinstallation: Stack starten → im Intern-Bereich Key anlegen → `WEBSITE_API_KEY` setzen → `docker compose up -d website`
   (Dokploy: Variable eintragen, neu deployen). Der Container läuft als Benutzer `node`, schreibgeschützt, Healthcheck auf `/`.

   **Mehrere Stacks auf einem Dokploy-Server (Staging + Produktion)**: `app` und `website` hängen im gemeinsamen
   `dokploy-network`, in dem auch die gleichnamigen Dienste des anderen Stacks stecken. Ein Name wie `app` löst dort reihum
   auf **beide** Stacks auf – Folge waren sporadische 401 „API-Key wird nicht akzeptiert“ (Anfrage landete im anderen Stack
   mit eigener Datenbank) und damit 503-Fehlerseiten. Deshalb setzt jeder Stack `DEPLOY_ENV` (`prod`, `staging`, Standard
   `prod`); die Dienste sprechen sich über Aliase im stackeigenen Netz `internal` an: `ep-intern-<DEPLOY_ENV>-app`, `-db`,
   `-storage`, `-website` (letzterer auch im `dokploy-network`). Prüfen im Website-Container: `getent hosts ep-intern-prod-app` liefert genau **eine** Adresse.
   Bestehende Installationen: `DEPLOY_ENV` setzen und neu deployen genügt (Volumes und internes Netz behalten ihre Namen).
   Der gespeicherte Speicher-Endpunkt `http://storage:9000` bleibt gültig – mehrdeutig sind nur Dienste im gemeinsamen Netz
   (`app`, `website`), `db`/`storage` hängen nur im stackeigenen Netz. Ein Umstellen auf `ep-intern-<DEPLOY_ENV>-storage` ist
   optional und verwirft den gespeicherten Secret-Key (Ziel-Bindung, neu eintragen).

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

## App auf dem Handy und Push-Benachrichtigungen

- Die Oberfläche ist eine installierbare Web-App (Manifest `/manifest.webmanifest` mit Icons aus dem Logo, Service Worker `src/service-worker.ts`).
  **HTTPS ist Pflicht** (ohne sichere Verbindung gibt es weder Installation noch Push; `localhost` gilt als sicher).
- Push braucht nichts zusätzlich: Die VAPID-Schlüssel erzeugt der Server beim ersten Bedarf selbst und speichert sie verschlüsselt in der
  Datenbank (sie wandern mit der Datensicherung). Ausgehende HTTPS-Verbindungen zu den Push-Diensten (`fcm.googleapis.com`,
  `*.push.apple.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`) müssen erlaubt sein.
- **Android**: Chrome/Edge/Firefox können Push auch ohne Installation; „Zum Startbildschirm hinzufügen“ öffnet die App ohne Browserleiste.
- **iPhone/iPad** (ab iOS/iPadOS 16.4): Push nur, wenn die App über Safari → Teilen → „Zum Home-Bildschirm“ hinzugefügt und von dort geöffnet
  wurde; danach im Profil unter „Benachrichtigungen“ aktivieren (Hinweis erscheint dort automatisch).
- Abschalten: Einstellungen → Benachrichtigungen → „Push-Benachrichtigungen“ aus (alles geht dann per E-Mail).

## Nachrichten (E-Mail an Mitglieder und Gruppen) – Zustellbarkeit

Das Modul `messages` sendet jede Mail einzeln über den SMTP-Server aus den Systemeinstellungen. Damit sie nicht im Spam landen:

- **Absenderadresse**: Persönliche Adressen (`vorname.nachname@domain`, Einstellung `messages.domain`) funktionieren nur, wenn der Mailserver das Senden als
  diese Adressen erlaubt (Alias oder Catch-all für die Domain). Stimmt die Domain nicht mit `core.smtp.from` überein, zeigt die Oberfläche einen Hinweis.
- **DNS** der Absender-Domain: SPF (Mailserver eintragen), DKIM (Signatur am Mailserver aktivieren, Schlüssel im DNS) und DMARC (`_dmarc`-Eintrag); dazu
  Reverse-DNS (rDNS) der Server-IP. Neue Domains langsam „aufwärmen“ (zuerst kleine Gruppen).
- **Inhalt**: Aussehen „Einfach“ verursacht den geringsten Spam-Wert; Betreff nicht in Großbuchstaben und ohne viele Ausrufezeichen; keine Link-Verkürzer.
- Prüfen mit einer Testmail an einen Spam-Checker (z. B. mail-tester.com). Der Spam-Wert hängt am Mailserver und DNS, nicht nur an der Anwendung.

### Posteingang (Antworten empfangen, Catch-all per IMAP)

Damit Antworten auf persönliche, Amts-, Gruppen- und Stamm-Adressen ankommen, ruft das Modul ein **Catch-all-Postfach** per IMAP ab und
ordnet jede Mail dem passenden Postfach zu (Oberfläche: Nachrichten → Posteingang).

1. Beim Mailanbieter ein Postfach (z. B. `catchall@stamm.de`) anlegen und als **Catch-all** der Domain einrichten: Mails an alle Adressen
   ohne eigenes Postfach landen dort. Adressen mit echtem Postfach bekommen ihre Mails weiterhin dort (nicht im Posteingang der App).
2. Administration → Einstellungen → Module → Nachrichten: `Posteingang: …` – IMAP-Server, Port (993 = TLS), Benutzer, Passwort, Ordner
   (`INBOX`) und Ablageordner (`Importiert`, wird angelegt). Danach „Catch-all-Postfach abrufen“ einschalten.
3. Mit dem Recht `messages.inbox.manage` „Jetzt abrufen“ im Posteingang prüfen; Fehler stehen dort als Hinweis „Letzter Abruf fehlgeschlagen“.

- Der Job `messages.inbox-poll` läuft **jede Minute**. Übernommene Mails werden auf dem Server in den Ablageordner verschoben (Sicherung);
  die Aufbewahrung in der App steuert `messages.inbox.retentionDays` (Standard 365 Tage), nicht zugeordnete Mails und Papierkorb 30 Tage.
- Zuordnung über `Delivered-To`/`X-Original-To` (auch Bcc) und An/Cc. Der Mailserver sollte einen dieser Kopfzeilen setzen (bei
  Catch-all üblich). Spam-Bewertung kommt vom Mailserver (`X-Spam-Flag`), die Absenderprüfung aus `Authentication-Results`.
- Mit eingeschaltetem Posteingang gehen Antworten immer an die **Absenderadresse** (nicht mehr an die Konto-Adresse).
- Benachrichtigungen gehen an die Konto-Adresse; liegt diese selbst auf der Catch-all-Domain, wird die Benachrichtigung beim Abruf
  übersprungen (Kopfzeile `X-EP-Intern`) – keine Schleife, die Person sieht die Mail im Posteingang.
- Nur **eine** Instanz darf abrufen (Sperre je Prozess; mehrere Instanzen würden über die Job-Sperre trotzdem nur einmal je Minute laufen).
- Demo: `docker compose -f docker-compose.demo.yml up -d` (GreenMail auf `127.0.0.1:1143`), dann `node scripts/seed-demo-inbox.mjs`.

## Module installieren: Supervisor und Neubau im Container (Kalypzo Atrium)

Das Image startet `node scripts/supervisor.mjs` statt `node build`. Der Supervisor startet die App als Kindprozess
und baut sie neu, wenn unter Administration → Module → Installieren Module eingespielt werden:

1. Module der laufenden Generation kopieren, Auftrag einspielen (Inhalt muss zum Inhaltshash der Vorschau passen),
   eigene npm-Pakete der Module installieren (`--ignore-scripts`),
2. `svelte-kit sync` + `vite build` in eine neue **Generation** (`/data/atrium/gen/<id>`),
3. **Probelauf** (`ATRIUM_VERIFY_ONLY=1`: Module laden und prüfen, ohne Datenbank),
4. Tausch und Neustart (App wird per IPC geordnet beendet), **Health-Prüfung** (120 s) – sonst Rückkehr zur vorigen Generation.

Die Ausfallzeit entspricht dem Neustart (einige Sekunden). Ohne eigene Generation läuft der mitgelieferte Build.
Kommt ein neues Image mit anderer Core-Version, baut der Supervisor die Module der laufenden Generation beim Start neu
(bis dahin läuft der mitgelieferte Build; `HEALTHCHECK start-period` 15 min).

| Variable | Standard (Image) | Bedeutung |
|---|---|---|
| `ATRIUM_MODULE_INSTALL` | `supervisor` | `off` = nur Vorschau, `copy` = Entwicklung (`vite dev`), `supervisor` = Neubau |
| `ATRIUM_DATA_DIR` | `/data/atrium` | Volume: `gen/`, `state.json`, `status.json`, `staging/`, `results/`, `logs/`, Caches |
| `ATRIUM_BUILD_HEAP` | `3072` | Heap des Neubaus in MB |
| `ATRIUM_VITE_CACHE`, `npm_config_cache`, `TMPDIR` | unter `/data/atrium` | Schreibbare Orte, das Dateisystem bleibt `read_only` |

Compose (`docker-compose.dokploy*.yml`): Volume `atrium-data:/data/atrium`, `mem_limit` Standard **4g** (Neubau),
`stop_grace_period` 45 s. Ausgehend nötig: `api.github.com`, `codeload.github.com` (Quellen) und ggf. `registry.npmjs.org`
(Module mit eigenen npm-Paketen). Das Image enthält dafür alle Abhängigkeiten und die Quellen (größer als vorher).

**Messwerte:** lokal (Windows, 8 Kerne) dauert ein Neubau mit allen 14 Fachmodulen etwa 40–60 s; im Container mit
`--cpus 1 --memory 3g` noch nicht gemessen (Phase 0 offen).

Lokal: `node scripts/demo-server.mjs` startet ebenfalls über den Supervisor (Daten in `.data/atrium`, PGlite bleibt
im Elternprozess offen); `.data/stop` beendet App und Datenbank geordnet.

### Frisches Deployment mit Modulen (Seed)

Ein neuer Server holt seine Module beim ersten Start selbst, wenn eine **Seed-Liste** vorliegt: Datei
`deploy/modules.seed.json`, Pfad in `ATRIUM_MODULES_SEED` oder das JSON direkt in `ATRIUM_MODULES_SEED` (Compose):

```json
{ "schema": 1, "sources": [
  { "source": "github:org/ep-intern-modules", "commit": "<voller Commit, 40 Zeichen>",
    "modules": ["members", "actions", "treasury"], "contentHashes": { "members": "sha256-…" } }
] }
```

Nur volle Commits (keine Branches), `modules` fehlt = alle Module der Quelle, `contentHashes` optional (Abweichung bricht ab).
Der Supervisor lädt die Archive (Token optional `ATRIUM_GITHUB_TOKEN`/`GITHUB_TOKEN`), baut eine Generation und merkt sich den
Seed (`state.json` → `seed`); bis dahin läuft der mitgelieferte Build. Die App übernimmt die Module danach als installiert
(`module_install`, Herkunft GitHub).

### Updates, Entfernen, Wiederherstellen

- **Updates**: Administration → Module → „Nach Updates suchen“ vergleicht je Modul aus GitHub den gespeicherten Commit mit dem Kopf
  des Refs; „Aktualisieren“ öffnet die Installation mit vorbelegter Quelle. Die Vorschau zeigt geänderte Dateien, neue Migrationen und
  Rechte. Vorher eine Datensicherung erstellen (Migrationen sind nicht rückgängig zu machen).
- **Entfernen** (nur deaktivierte Module, die kein anderes braucht): Standard **Daten behalten** – Schema, Einstellungen, Rechte und
  Dateien bleiben und sind nach erneuter Installation wieder da. „Daten löschen“ (Bestätigung mit der Modul-ID) löscht Schema,
  Migrationsstand, Zustand, Rechte samt Rollen-/Einzelrechten, Rollen-Verleihungen, Einstellungen, Benachrichtigungs-Einstellungen,
  Job-Läufe und Dateien. Danach Neubau ohne das Modul.
- **Wiederherstellen**: Die Herkunft der Module (`module_install`, Verlauf) gehört zum Sicherungsbereich „Einstellungen“; jede Sicherung
  enthält zudem je Modul Quelle, Commit und Inhaltshash. Fehlt ein Modul auf dem Zielserver, nennt der Import die Quelle mit Link zur
  Installation. Fehlen nach einer Wiederherstellung (oder nach Verlust des Volumes) installierte Module im laufenden Stand, bietet die
  Seite „Installiert“ **„Aus der Datenbank wiederherstellen“** (GitHub-Module am gespeicherten Commit; ZIP-Module nur, solange die Datei
  unter `/data/atrium/sources/` liegt).

