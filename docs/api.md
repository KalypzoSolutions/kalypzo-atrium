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

- `X-Request-Id` des Clients wird nur übernommen, wenn sie `[A-Za-z0-9-]{8,64}` entspricht, sonst vergibt der Server eine UUID (#72, 06-15).
- `405` enthält einen `Allow`-Header mit den erlaubten Methoden. `HEAD` wird von jedem GET-Endpunkt bedient (gleiche Header, kein Body).
- Routen: Bei mehreren passenden Mustern gewinnt das spezifischere (statisches Segment vor `:param`, von links nach rechts) – unabhängig von der Registrierungsreihenfolge.
- JSON-Bodies werden gestreamt gelesen und bei mehr als 1 MB mit `413` abgebrochen (auch ohne `Content-Length`); öffentliches Multipart ebenso bis `multipart.maxBytes`.
- Validierungsmeldungen (`details` bei 422) sind deutsch: eigene Meldungen der Schemas, sonst das deutsche Zod-Locale (`src/lib/zod-locale.ts`, Server und Client).

### Konventionen für neue Endpunkte (Soll, #72 06-13)

Bestehende Endpunkte erfüllen das noch nicht überall; neue sollen es:

- Immer `defineEndpoint` (Typinferenz für `params`/`query`/`body`), kein Cast `as ApiEndpoint[]` einzelner Einträge.
- GET-Endpunkte bekommen ein `response`-Schema (API-Übersicht, Beispiele).
- `POST` = Anlegen (`201`); Kommandos (`…/send`, `…/close`, Vorschauen) liefern derzeit ebenfalls `201` – UI nie auf einen bestimmten 2xx-Code prüfen. Eine Option `status` am Endpunkt ist geplant.
- `PATCH` = Teil-Update (nur übergebene Felder), `PUT` = vollständiges Ersetzen (Listen, Reihenfolge).
- `DELETE` liefert `{ "deleted": true }` (bzw. `{ id, deleted: true }`), nicht `null` oder das Objekt.
- Listen mit `limit`/`offset` (Standard 50, max. 200) und `total`.
- Ein Fehlerformat: `{ error: { code, message, details, requestId } }` – auch interne JSON-Routen außerhalb von `/api/v1` sollen es nutzen.
- Datumsfelder als echtes Kalenderdatum prüfen (`refine(isRealDate)`), nicht nur per Regex.
- Mehrschritt-Änderungen: alle Rechte-/Eingabeprüfungen **vor** der ersten Schreiboperation, Schreiben in **einer** Transaktion (Muster `updateUserFull`).
- Nebenarbeiten (Mail, Audit, Rückschreiben) mit `bestEffort(label, fn, { ctx, target })` bzw. `logBestEffort` aus `$lib/sdk/server` – nie `catch {}` ohne Log.

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
| POST | `/roles/:id/adopt-default` | `core.roles.edit` | gleichnamige Rolle als Standardrolle (`defaultRoleGrants`) übernehmen |
| GET | `/permissions` | `core.roles.view` | |
| GET | `/modules` | `core.modules.view` | |
| POST | `/modules/:id/enable` | `core.modules.manage` | |
| POST | `/modules/:id/disable` | `core.modules.manage` | |
| GET | `/jobs` | `core.jobs.manage` | Hintergrundjobs mit letztem Lauf |
| POST | `/jobs/:key/run` | `core.jobs.manage` | `key` = `<modul>.<job>`, läuft synchron |
| GET | `/settings` | `core.settings.view` | Secrets ohne Wert (`isSet`) |
| PUT | `/settings` | `core.settings.manage` | `{ values: { key: value } }` |
| GET/POST/DELETE | `/api-keys`, `/api-keys/:id` | `core.api.view` / `core.api.manage` | nur Session |
| POST | `/pdf` | `core.pdf.generate` | liefert `application/pdf` |
| POST | `/ai/generate` | `core.ai.use` | |
| GET | `/ai/usage` | `core.ai.view` | |
| GET | `/storage/files` | `core.storage.manage` | Query `module`, `prefix` |
| POST | `/storage/upload-url` | `core.storage.manage` | |
| POST | `/storage/files/:id/confirm` | `core.storage.manage` | |
| GET | `/storage/download-url` | `core.storage.manage` | |
| DELETE | `/storage/files` | `core.storage.manage` | Query `module`, `path` |
| GET | `/audit-logs` | `core.audit.view` | `action`, `search`, Paging |

Eigenes Profil (Name, E-Mail-Wechsel, Profilbild, Darstellung) läuft **nicht** über die REST-API, sondern über Server-Actions bzw. SvelteKit-Routen
(`/profile`, `POST /profile/theme`, `GET /avatar/<userId>`, jeweils mit Session); der Better-Auth-HTTP-Weg `/api/auth/change-email` und
`/update-user` ist gesperrt (403). Siehe [Sicherheit](security.md). Endpunkte der verknüpften Konten (`/my/members`, `/my/fields`,
`/my/members/:id/contacts|fields|mail-prefs`, Rechte `members.own.view|edit`) sind Modul-Endpunkte des Moduls `members`.

Modul-Endpunkte: `/api/v1/modules/<id>/…`. Deaktivierte Module liefern `404 module_disabled`.

Website-Endpunkte von `events`, `galleries`, `members` und `offices` (API-Key mit `*.website.read`): siehe
[Stammeswebsite](#stammeswebsite).

Abrechnung im Modul `actions`: `POST …/actions/:id/accounting/entries` akzeptiert bei Auslagen (Ausgabe, bezahlt von Person) `reimbursed: true`
(„bereits erstattet“, nur beim Anlegen; `422` mit Pfad `reimbursed` bei Einnahmen/Stamm-Ausgaben). `PUT …/entries/:entryId` mit
`reimbursed: true` liefert `422` („Die Erstattung kann nur beim Anlegen gesetzt werden“); `false`/fehlend ist wirkungslos.
Erstattete Auslagen sind für `PUT`/`DELETE` gesperrt (`409`); die Erstattung einer Person nimmt `DELETE …/payees/:payeeId/reimburse` zurück.

## Stammeswebsite

Die öffentliche Stammeswebsite (eigene App `website/`, siehe `docs/deployment.md`) liest ihre Inhalte **serverseitig** aus vier
Modulen (`events`, `galleries`, `members`, `offices` für „Unser Team“; `website/src/lib/server/backend.ts`). Alle Website-Endpunkte sind normale Modul-Endpunkte (`/api/v1/modules/<id>/website/…`), brauchen einen **API-Key** mit dem
passenden Scope und liefern nur öffentliche Felder. Ein Key **nur** mit diesen Scopes bekommt auf alle internen Endpunkte `403`.

| Modul | Scope | Inhalt |
|---|---|---|
| `events` | `events.website.read` | Termine mit „Auf der Stammeswebsite anzeigen“ |
| `galleries` | `galleries.website.read` | Galerien mit Sichtbarkeit „öffentlich“ und deren Bilder (`thumb`/`web`) |
| `website` | `website.content.read` | Laufende Banner/Hinweise, aktive häufige Fragen (bereinigtes HTML), veröffentlichte Blog-Beiträge mit Themen, Titelbild und Bildern (`thumb`/`web`), Autor*in nur Vorname – Banner-Leiste, `/faq`, `/blog`, RSS |
| `offices` | `offices.website.read` | Ämter mit Beschreibung, Amts-E-Mails, Inhaber*innen mit Zustimmung im Profil (**nur Vorname** `firstName`, Bio, „seit“, Profilbild) – Seite „Unser Team“ |
| `members` | `members.website.read` | Gruppen mit „Auf der Website zeigen“ (Steckbrief, Bild) |
| `messages` | `messages.website.contact` | **Schreibend:** `GET /website/contact/challenge` (Proof-of-Work-Aufgabe, signiert, 2 h gültig) und `POST /website/contact` (Name, E-Mail, Telefon, Nachricht + Lösung) → Posteingang „Stamm“; 422 Spam-Schutz (ungültig, < 3 s, abgelaufen), 409 Aufgabe schon eingelöst |

**Einrichtung:** Ein*e Benutzer*in, die diese Rechte hat (z. B. Administrator), legt unter Administration → API-Keys
(`POST /api/v1/api-keys`, nur Session) **einen** Key mit genau den benötigten Scopes an:
`events.website.read galleries.website.read members.website.read offices.website.read website.content.read messages.website.contact` (Least Privilege). Rechte des Keys = Scopes ∩ Rechte der
Besitzer*in – verliert die Besitzer*in ein Recht, antwortet der Endpunkt mit `403`. Der Key steht nur einmal in der Antwort und
gehört in die Umgebung der Website (`WEBSITE_API_KEY`), **nie** in den Browser. Es gibt **kein CORS**; die Website ruft alles
serverseitig ab und liefert Bilder über eigene Proxy-Routen aus. Deaktiviertes Modul → `404 module_disabled`.

### Endpunkte

| Methode + Pfad (`/api/v1/modules/…`) | Query | Antwort (`{ data }`) | Rate-Limit |
|---|---|---|---|
| GET `events/website/events` | `from` (Standard heute, Europe/Berlin), `to` (≥ `from`, sonst 422), `tag`, `group` (Gruppen-ID oder `stamm`), `limit` 1–200 (50), `offset` (0), `paged` (`1`/`true`) | `WebsiteEvent[]`, sortiert nach Beginn; mit `paged=1` `{ items, total, offset, limit, hasMore }` | 600/60 s |
| GET `events/website/events/:id` | `occurrence` (`YYYY-MM-DD`, nur Serien) | `WebsiteEvent` | 600/60 s |
| GET `galleries/website/galleries` | `eventId` (nur Galerien zu diesem Website-Termin), `limit` 1–200 (50), `offset` | `{ items: WebsiteGallery[], total }` | 600/60 s |
| GET `galleries/website/galleries/:id` | – | `WebsiteGalleryDetail` (mit `images`) | 600/60 s |
| GET `galleries/website/galleries/:id/images/:imageId/:variant` | `variant` = `thumb` \| `web` (`full` → 422) | Bild roh, `public, max-age=86400` | 1200/60 s |
| GET `offices/website/offices` | – | `WebsiteOffice[]` nach Reihenfolge der Ämter | 600/60 s |
| GET `offices/website/offices/holders/:userId/avatar` | – | Profilbild roh, `private, max-age=300` | 1200/60 s |
| GET `members/website/groups` | – | `WebsiteGroup[]` (Meuten vor Sippen, dann nach Name) | 600/60 s |
| GET `members/website/groups/:slug` | – | `WebsiteGroup` | 600/60 s |
| GET `members/website/groups/:slug/image` | – | Gruppenbild roh, `public, max-age=86400` | 1200/60 s |

Rate-Limits gelten **je Key und Endpunktmuster** (getrennte Kontingente; #20: JSON 600/60 s, Bilder `IMAGE_RATE_LIMIT` 1200/60 s). Die
Stammeswebsite schützt das gemeinsame Kontingent zusätzlich durch Cache (auch negativ), In-Flight-Deduplizierung, ID-Vorprüfung und ein Rate-Limit je Besucher-IP. Bild-Endpunkte antworten mit `x-content-type-options: nosniff` und `404`, wenn es kein Bild gibt,
das Objekt nicht (mehr) auf der Website steht oder kein Speicher eingerichtet ist.

### Felder

- **`WebsiteEvent`**: `id`, `title`, `description`, `location`, `color`, `startsOn`, `startsTime`, `endsOn`, `endsTime`, `tags`,
  `groups` (Namen, „ganzer Stamm“ = Stammesname), `groupIds` (gleiche Reihenfolge wie `groups`, `stamm` für den ganzen Stamm),
  `recurring`, `occurrenceDate`. Keine Freigaben, Eigentümer*innen, Zeitstempel, Gruppenstunden-Daten.
  - **Serien** erscheinen in der Liste als einzelne Vorkommen mit gleicher `id`, `recurring: true` und `occurrenceDate`
    (ursprüngliches Datum; stabiler Schlüssel `id` + `occurrenceDate`); Änderungen einzelner Vorkommen sind eingerechnet,
    abgesagte fehlen. Ohne `to` höchstens 366 Tage voraus.
  - **Paging** (#48): `limit`/`offset` zählen **Vorkommen** (nach dem Expandieren der Serien). Ohne `paged` bleibt die Antwort ein Array
    (abwärtskompatibel) – eine volle Seite heißt dann „evtl. gekürzt“. Mit `paged=1` kommt `WebsiteEventPage`
    `{ items, total, offset, limit, hasMore }`; nachladen, solange `hasMore`. Die Stammeswebsite tut das je Halbjahr (`website/src/lib/server/event-pages.ts`).
  - **Vertrag**: Zod-Schemas der Website-DTOs in `src/lib/modules/<modul>/website.schemas.ts` (`websiteEventSchema`, `websiteEventPageSchema`,
    `websiteGallerySchema`, `websiteGalleryDetailSchema`, `websiteGalleryListSchema`, `websiteOfficeSchema`, `websiteGroupSchema`, alle strikt);
    die `*-website`-Integrationstests parsen die Antworten dagegen, `tests/unit/website-contract.test.ts` prüft die `Backend*`-Typen der Website.
  - **`group`**: nur Termine, die dieser Gruppe bzw. (`stamm`) dem ganzen Stamm zugeordnet sind. Keine UUID und nicht `stamm` → 422;
    unbekannte Gruppe → leere Liste.
  - **Detail `/:id`**: `404`, wenn unbekannt oder nicht auf der Website. Serie **mit** `occurrence`: genau dieses Vorkommen
    (kein Vorkommen der Serie oder abgesagt → 404). Serie **ohne** `occurrence`: das nächste nicht abgesagte Vorkommen, das heute
    (Europe/Berlin) noch nicht vorbei ist, sonst das letzte. Einmaliger Termin mit `occurrence` → 404.
- **`WebsiteGallery`**: `id`, `title`, `description`, `imageCount`, `cover` (`imageId`, `width`, `height` oder `null`), `events`
  (nur Termine, die selbst auf der Website stehen: `id`, `title`, `startsOn`, `endsOn`), `updatedAt`. Detail zusätzlich `images`
  (`id`, `galleryId`, `description`, `width`, `height`, `position`). Keine Dateinamen, Uploader, Freigaben; `full` gibt es nie.
- **`WebsiteOffice`**: `id`, `name`, `description`, `position`, `emails` (`label`, `email` – Adressen des **Amts**), `holders`
  (`id`, `name`, `bio`, `since`, `avatarPath` = relativer API-Pfad oder `null`). Keine Konto-Mails, Rollen; deaktivierte Konten fehlen.
- **`WebsiteGroup`**: `id`, `slug`, `name`, `type` (`meute` | `sippe`), `description` (Website-Text, sonst interne Beschreibung),
  `ageRange`, `meetingPlace`, `meetingWeekday` (1 = Mo … 7 = So), `meetingTime`, `color`, `contactEmail` (Adresse der **Gruppe**),
  `leaders` (nur `firstName`), `imagePath` (relativer API-Pfad mit `?v=…` oder `null`). Keine Nachnamen, Mitglieder-Mails,
  Geburtsdaten, Mitgliederzahlen.

### Bilder und Caching

- `avatarPath` und `imagePath` sind **relative API-Pfade**; die Website ruft sie mit demselben Key ab. Galerie-Bilder baut sie aus
  `id` + `imageId` + Variante. Im Browser landen nur die eigenen Proxy-URLs der Website (`/bilder/…`), nie der Key.
- **Empfehlung:** JSON-Antworten auf dem Website-Server einige Minuten zwischenspeichern (z. B. 60 s mit „stale on error“, damit ein
  kurzer Ausfall des Intern-Servers die Seite nicht leert), Bilder länger (Galerie/Gruppe bis 24 h, Profilbilder ≤ 5 min wie vom
  Endpunkt vorgegeben). So bleibt die Website auch bei vielen Besucher*innen weit unter den Rate-Limits.
- Termine sind öffentlich gemeint: Beschreibungen, Orte und Galerie-Texte ohne personenbezogene Daten pflegen.

```bash
KEY=epk_…   # Scopes: events.website.read galleries.website.read members.website.read (+ offices.website.read für die Ämter-Zeile)
BASE=https://intern.example.org/api/v1/modules

curl -H "Authorization: Bearer $KEY" "$BASE/events/website/events?from=2026-10-01&to=2026-12-31&limit=20"
curl -H "Authorization: Bearer $KEY" "$BASE/events/website/events?group=stamm&limit=3"
curl -H "Authorization: Bearer $KEY" "$BASE/events/website/events/<id>?occurrence=2026-11-06"
curl -H "Authorization: Bearer $KEY" "$BASE/galleries/website/galleries?eventId=<terminId>"
curl -H "Authorization: Bearer $KEY" -o bild.webp "$BASE/galleries/website/galleries/<id>/images/<imageId>/web"
curl -H "Authorization: Bearer $KEY" "$BASE/offices/website/offices"
curl -H "Authorization: Bearer $KEY" "$BASE/members/website/groups/sportliche-panther"
```

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
