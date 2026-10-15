# EP Intern – modulare Verwaltungsplattform (Core)

Selbst gehostete, webbasierte Verwaltungsplattform als **modularer Monolith**. Dieses Repository enthält ausschließlich den **Core**: Authentifizierung, RBAC, Modulverwaltung, Einstellungen, REST-API mit API-Keys, Datenverwaltung, PDF-, KI- und S3-Storage-Service sowie Audit-Log. Fachmodule werden später unter `src/lib/modules/` ergänzt.

## Techstack

| Bereich | Technologie |
|---|---|
| Framework | SvelteKit 2 mit Svelte 5 (Runes), `adapter-node` |
| Sprache | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Styling / UI | Tailwind CSS 4, shadcn-svelte (bits-ui), Lucide |
| Datenbank | PostgreSQL, Drizzle ORM, Drizzle Kit |
| Auth | Better Auth (E-Mail/Passwort, 2FA/TOTP) |
| API | REST unter `/api/v1`, OpenAPI 3.1 (zod-to-openapi) |
| Validierung | Zod 4 |
| KI | Offizielles `openai`-SDK |
| Storage | S3-kompatibel (`@aws-sdk/client-s3`) |
| PDF | Playwright/Chromium (HTML → PDF) |
| Tests | Vitest (Unit/Integration, PGlite), Playwright (E2E) |
| Deployment | Docker Compose, Nginx |

## Schnellstart (lokal)

Voraussetzungen: Node.js ≥ 24, Docker.

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL (5432) + MinIO (9000/9001)

# .env anlegen (siehe .env.example)
cat > .env <<'EOF'
DATABASE_URL=postgres://ep_intern:dev-password@localhost:5432/ep_intern
APP_SECRET=<mindestens 32 zufällige Zeichen>
ORIGIN=http://localhost:5173
INITIAL_ADMIN_EMAIL=admin@example.org
INITIAL_ADMIN_PASSWORD=ein-langes-passwort-123
EOF

npm run dev
```

Beim Start werden Migrationen angewendet, Module registriert/synchronisiert und – falls noch kein Administrator existiert – der Administrator aus `INITIAL_ADMIN_*` angelegt. Anmeldung unter <http://localhost:5173/login>.

Chromium für den PDF-Service lokal installieren: `npx playwright install chromium`.

### Umgebungsvariablen

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `DATABASE_URL` | ja | PostgreSQL-Verbindung |
| `APP_SECRET` | ja | ≥ 32 Zeichen; Auth-Signaturen und Verschlüsselung von Secrets |
| `ORIGIN` | ja | Öffentliche URL der App (CSRF-/Cookie-Konfiguration) |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | nein | Bootstrap des ersten Administrators (Passwort ≥ 12 Zeichen) |

SMTP, S3, OpenAI und PDF-Layout werden **in der Oberfläche** konfiguriert (Einstellungen, verschlüsselt in der DB).

## Skripte

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm run build` / `npm start` | Produktions-Build / Start (`node build`) |
| `npm run check` | `svelte-kit sync` + `svelte-check` |
| `npm run lint` / `npm run format` | ESLint + Prettier prüfen / schreiben |
| `npm test` | Vitest (Unit + Integration) |
| `npm run test:unit` / `test:integration` | Teilmengen |
| `npm run test:e2e` | Playwright (startet eine PGlite-Instanz per TCP-Socket, kein Docker nötig; mit `E2E_DATABASE_URL` echte PostgreSQL, siehe `scripts/e2e-server.mjs`) |
| `npm run db:generate` | Drizzle-Migration aus dem Schema erzeugen |
| `npm run db:migrate` | Migrationen manuell anwenden |
| `npm run openapi` | `docs/openapi.json` erzeugen |

## Projektstruktur

```text
src/
├── hooks.server.ts              Session, Guard, Security-Header, Auth-Handler
├── lib/
│   ├── server/core/             Core-Implementierung (nur Server)
│   │   ├── auth/ permissions/ modules/ settings/ api/
│   │   ├── database/ pdf/ ai/ storage/ audit/
│   │   └── index.ts             `core`-Objekt
│   ├── sdk/{server,client,types}  Öffentliche Modul-SDK-Schnittstelle
│   ├── components/{ui,layout}   shadcn-svelte + Layout
│   └── modules/                 Fachmodule (<id>/module.ts, ui.ts, migrations)
└── routes/
    ├── login/ forgot-password/ reset-password/
    ├── api/v1/[...path]/        Zentraler REST-Router
    └── (internal)/              Dashboard, Benutzer, Rollen, Module, …
drizzle/                         SQL-Migrationen
deploy/nginx/                    Reverse-Proxy-Konfiguration
tests/{unit,integration,e2e,helpers}
docs/                            Dokumentation
```

## Dokumentation

- [Architektur](docs/architecture.md)
- [Core-Services](docs/core-services.md)
- [Modulentwicklung](docs/module-development.md)
- [Rollen und Berechtigungen](docs/permissions.md)
- [REST API](docs/api.md)
- [Datenbank](docs/database.md)
- [Deployment](docs/deployment.md)
- [Sicherheit](docs/security.md)
