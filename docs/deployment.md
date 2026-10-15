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

## Umgebungsvariablen

| Variable | Beschreibung |
|---|---|
| `POSTGRES_DB/USER/PASSWORD` | Datenbank-Container (Passwort Pflicht) |
| `APP_SECRET` | Pflicht, ≥ 32 Zeichen. **Nicht ändern**, ohne Secrets neu einzugeben (siehe [Sicherheit](security.md)) |
| `ORIGIN` | Pflicht, öffentliche URL |
| `APP_PORT` | Host-Port (Bind 127.0.0.1) |
| `INITIAL_ADMIN_EMAIL/PASSWORD` | Bootstrap; Passwort ≥ 12 Zeichen |
| `ADDRESS_HEADER`, `XFF_DEPTH`, `PROTOCOL_HEADER`, `HOST_HEADER` | in `docker-compose.yml` gesetzt (adapter-node) |

### Proxy-Header

Hinter einem Reverse Proxy sieht die App nur dessen IP. `ADDRESS_HEADER=X-Forwarded-For` mit `XFF_DEPTH=1` liest die Client-IP als **letzten** Eintrag (von einem Proxy gesetzt) – Voraussetzung ist, dass genau ein vertrauenswürdiger Proxy davorsteht (Nginx-Konfiguration setzt `X-Forwarded-For $remote_addr`, ersetzt also clientseitige Werte). `PROTOCOL_HEADER`/`HOST_HEADER` sorgen für korrektes `https` und Host. Bei mehreren Proxys `XFF_DEPTH` anpassen. Die IP geht in Rate Limits und Audit-Logs ein.

## Erster Start

Beim Start laufen Migrationen und Synchronisation automatisch. Existiert noch kein Administrator und sind `INITIAL_ADMIN_*` gesetzt, wird er angelegt. Danach die Variablen aus der `.env` entfernen und das Passwort ändern.

Anschließend in der Oberfläche konfigurieren: Einstellungen (Systemname, SMTP), Storage (S3), KI (OpenAI-Key), PDF.

## S3 / MinIO

- Einstellungen `core.storage.*`: Endpoint (leer = AWS), Region (`auto` für R2), Bucket, Access Key, Secret, *Path-Style* (für MinIO aktivieren).
- Bucket privat lassen; Zugriff erfolgt per Server oder signierten URLs. Für Browser-Uploads über signierte URLs muss CORS am Bucket den eigenen `ORIGIN` für `PUT` erlauben.
- Verbindungstest auf der Storage-Seite.

## Chromium

Der PDF-Service startet Chromium mit `--no-sandbox` (im Container ohne User-Namespaces üblich). Seiten werden ohne JavaScript gerendert, externe Requests blockiert. Das Image enthält Chromium (~400 MB). Für lokale Läufe: `npx playwright install chromium`.

## Healthchecks

- App: `GET /api/v1/health` (Docker-Healthcheck).
- DB: `pg_isready`; `app` startet erst nach „healthy“.

## Backups

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
