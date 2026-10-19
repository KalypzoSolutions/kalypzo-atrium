# REST API

Basisroute: `/api/v1`. OpenAPI 3.1: `GET /api/v1/openapi.json` (angemeldet) bzw. statisch `docs/openapi.json` (`npm run openapi`).

## Authentifizierung

1. **API-Key**: `Authorization: Bearer epk_…`
2. **Session-Cookie** (Anmeldung über die Oberfläche). Schreibende Anfragen mit Session erfordern passende `Origin`.

Ungültige, widerrufene oder abgelaufene Keys → `401 unauthenticated`. Bei Bearer-Header wird die Session ignoriert.

```bash
curl -H "Authorization: Bearer $API_KEY" https://intern.example.org/api/v1/users?limit=10
```

## Antworten

Erfolg: `{ "data": … }` (`201` bei POST, sonst `200`). Fehler siehe unten. Jede Antwort enthält `X-Request-Id`, geschützte Endpunkte `X-RateLimit-Remaining`. `Cache-Control: no-store`.

### Fehlerformat

```json
{ "error": { "code": "forbidden", "message": "Berechtigung fehlt: core.users.view",
             "details": null, "requestId": "…" } }
```

Codes: `bad_request` 400, `unauthenticated` 401, `forbidden` 403, `not_found`/`module_disabled` 404, `method_not_allowed` 405, `conflict` 409, `payload_too_large` 413, `validation_failed` 422 (`details` = Zod-Issues), `rate_limited` 429 (mit `Retry-After`), `unavailable` 503, `internal_error` 500.

## Rate Limiting

Je Endpunkt und Identität (Key → Benutzer → IP): Standard **120 Anfragen/60 s**, anonym **30/60 s**; teurere Endpunkte (`/pdf`, `/ai/generate`) 20/60 s. In-Memory, pro Prozess.

## Protokollierung

Jede Anfrage erzeugt einen Eintrag in `api_log` (Methode, Pfad, Status, Dauer, Akteur, Key-ID, IP) – ohne Query-Strings, Bodies oder Header.

## Endpunkte (Core)

Nur ausdrücklich freigegebene Core-Funktionen sind erreichbar (`registerCoreApi`).

| Methode | Pfad | Berechtigung | Hinweis |
|---|---|---|---|
| GET | `/health` | – | öffentlich |
| GET | `/openapi.json` | angemeldet | |
| GET | `/me` | angemeldet | Identität und wirksame Rechte |
| GET | `/users` | `core.users.view` | `search`, `limit`, `offset` |
| GET | `/users/:id` | `core.users.view` | |
| POST | `/users` | `core.users.create` | `name`, `email`, `password` (≥ 12), `roleIds?` |
| PATCH | `/users/:id` | `core.users.edit` | `name?`, `email?`, `active?`, `roleIds?` (Rollen: zusätzlich `core.roles.assign`) |
| DELETE | `/users/:id` | `core.users.delete` | |
| GET | `/roles` | `core.roles.view` | |
| POST | `/roles` | `core.roles.create` | |
| PATCH | `/roles/:id` | `core.roles.edit` | |
| DELETE | `/roles/:id` | `core.roles.delete` | |
| GET | `/permissions` | `core.roles.view` | |
| GET | `/modules` | `core.modules.view` | |
| POST | `/modules/:id/enable` | `core.modules.manage` | |
| POST | `/modules/:id/disable` | `core.modules.manage` | |
| GET | `/settings` | `core.settings.view` | Secrets ohne Wert (`isSet`) |
| PUT | `/settings` | `core.settings.manage` | `{ values: { key: value } }` |
| GET/POST/DELETE | `/api-keys`, `/api-keys/:id` | `core.api.view` / `core.api.manage` | nur Session |
| POST | `/pdf` | `core.pdf.generate` | liefert `application/pdf` |
| POST | `/ai/generate` | `core.ai.use` | |
| GET | `/ai/usage` | `core.ai.view` | |
| GET | `/storage/files` | `<modul>.storage.read` | Query `module`, `prefix` |
| POST | `/storage/upload-url` | `<modul>.storage.write` | |
| POST | `/storage/files/:id/confirm` | `<modul>.storage.write` | |
| GET | `/storage/download-url` | `<modul>.storage.read` | |
| DELETE | `/storage/files` | `<modul>.storage.delete` | Query `module`, `path` |
| GET | `/audit-logs` | `core.audit.view` | `action`, `search`, Paging |

Eigenes Profil (Name, E-Mail-Wechsel, Profilbild, Darstellung) läuft **nicht** über die REST-API, sondern über Server-Actions bzw. SvelteKit-Routen
(`/profile`, `POST /profile/theme`, `GET /avatar/<userId>`, jeweils mit Session); der Better-Auth-HTTP-Weg `/api/auth/change-email` und
`/update-user` ist gesperrt (403). Siehe [Sicherheit](security.md). Endpunkte der verknüpften Konten (`/my/members`, `/my/fields`,
`/my/members/:id/contacts|fields|mail-prefs`, Rechte `members.own.view|edit`) sind Modul-Endpunkte des Moduls `members`.

Modul-Endpunkte: `/api/v1/modules/<id>/…`. Deaktivierte Module liefern `404 module_disabled`.

Termine für die Stammeswebsite (Modul `events`): `GET /api/v1/modules/events/website/events?from=&to=&tag=&limit=` mit einem API-Key,
der nur den Scope `events.website.read` hat (Besitzer*in muss das Recht haben). `from` Standard heute (Europe/Berlin), `limit` 1–200 (50),
Rate-Limit 120/60 s; nur Termine mit „auf der Website“ und nur öffentliche Felder (Titel, Beschreibung, Ort, Farbe, Zeiten, Tags,
Gruppennamen). Serverseitig abrufen – der Key gehört nicht in den Browser (kein CORS).

```bash
curl -H "Authorization: Bearer $WEBSITE_KEY" \
  "https://intern.example.org/api/v1/modules/events/website/events?from=2026-10-01&to=2026-12-31&limit=20"
```

Abrechnung im Modul `actions`: `POST …/actions/:id/accounting/entries` akzeptiert bei Auslagen (Ausgabe, bezahlt von Person) `reimbursed: true`
(„bereits erstattet“, nur beim Anlegen; `422` mit Pfad `reimbursed` bei Einnahmen/Stamm-Ausgaben). `PUT …/entries/:entryId` mit
`reimbursed: true` liefert `422` („Die Erstattung kann nur beim Anlegen gesetzt werden“); `false`/fehlend ist wirkungslos.
Erstattete Auslagen sind für `PUT`/`DELETE` gesperrt (`409`); die Erstattung einer Person nimmt `DELETE …/payees/:payeeId/reimburse` zurück.

## API-Key-Lebenszyklus

1. **Erzeugen** (`POST /api-keys`, Session, `core.api.manage`): `name`, `scopes[]`, optional `expiresAt` (Zukunft). Die Antwort enthält `key` **einmalig** im Klartext (`epk_` + 43 Zeichen).
2. **Speicherung**: nur SHA-256-Hash und Präfix (`epk_` + 8 Zeichen) zur Anzeige.
3. **Nutzung**: Bearer-Header; `lastUsedAt` wird aktualisiert.
4. **Widerruf** (`DELETE /api-keys/:id`): sofort wirksam, nicht umkehrbar.
5. Audit-Events: `core.api_key.created`, `core.api_key.revoked`.

```bash
# Key erzeugen (Session-Cookie + Origin)
curl -X POST https://intern.example.org/api/v1/api-keys \
  -H "Origin: https://intern.example.org" -H "Cookie: <session>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Export","scopes":["core.users.view"],"expiresAt":"2027-01-01T00:00:00Z"}'

# PDF erzeugen
curl -X POST https://intern.example.org/api/v1/pdf -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -o liste.pdf \
  -d '{"title":"Liste","content":[{"type":"paragraph","text":"Hallo"}]}'
```

## API-Übersicht im internen Bereich (`/admin/api/docs`)

Admin-Seite (Recht `core.api.view`, Navigation „Administration → API-Keys“, Reiter „API-Übersicht“; alte URL `/api-docs` leitet um) mit allen Endpunkten von Core und Modulen.
Sie wird **automatisch** aus der Registry erzeugt (`buildApiCatalog` in `src/lib/server/core/api/catalog/`): Schemas aus
`buildOpenApiDocument()` (`$ref` aufgelöst), mögliche Fehler aus den Endpunkt-Eigenschaften (`deriveErrors`), Rate-Limits
(`catalog/limits.ts` spiegelt die Router-Standards 120/60 bzw. anonym 30/60, ein Integrationstest prüft den Abgleich).

- Liste je Core-Tag/Modul mit Suche und Filtern (Modul, Methode, Zugriff, „nur für mich aufrufbar“), Filter und `?endpoint=<id>` in der URL.
- Detail: Übersicht, Anfrage (Parameter/Query/Body als Feldbaum), Antwort (`{ data }` + Beispiel), Fehler, **Ausprobieren**
  (Request mit der eigenen Session, schreibende Methoden nur nach Bestätigung, curl-Snippet mit Platzhalter `$EPK_KEY`;
  Multipart-Endpunkte nicht).
- Gute Doku entsteht im Code: `summary`, `description` und `response`-Schema am Endpunkt pflegen. Der Test
  `tests/integration/api-catalog.test.ts` verlangt für jeden Endpunkt eine `summary` und für `:param`-Pfade ein `params`-Schema.
