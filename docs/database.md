# Datenbank

PostgreSQL mit Drizzle ORM. Schema: `src/lib/server/core/database/schema.ts`; Verbindung: `database/client.ts` (`pg`-Pool, Singleton, max. 10 Verbindungen).

## Tabellen (Core)

| Gruppe | Tabellen |
|---|---|
| Better Auth | `user` (inkl. `active`, `two_factor_enabled`), `session`, `account`, `verification`, `two_factor` |
| RBAC | `permission`, `role`, `role_permission`, `user_role` |
| Module | `module_state` (aktiv/Version), `module_migration` (angewendete Modulmigrationen + Prüfsumme), `role_grant_applied` (Marker für einmalig vergebene `defaultRoleGrants`; PK `module_id`+`role_name`+`permission_key`, Migration `0004_role_grant_applied.sql`) |
| Einstellungen | `setting` (`key`, `scope_id`, `value` jsonb; Secrets als `enc:v1:…`; Benutzereinstellungen `core.user.*` mit `scope_id` = Benutzer-ID) |
| API | `api_key` (Hash, Scopes, Ablauf, Widerruf), `api_log` |
| Audit | `audit_log` (append-only) |
| Storage | `file` (Metadaten, Objektschlüssel, Status `pending`/`ready`) |
| KI | `ai_usage` (Tokens, Kosten je Modul/Modell) |

## Migrationen

- Quelle: `drizzle/*.sql` (erzeugt mit Drizzle Kit, versioniert im Repository).
- Workflow bei Schemaänderung:
  1. `schema.ts` anpassen
  2. `npm run db:generate` (optional `-- --name=…`; handgeschriebenes SQL: `npx drizzle-kit generate --custom --name=…`)
  3. SQL prüfen und committen
- **Automatisch beim Start**: `initCore()` ruft `runCoreMigrations` auf. Manuell: `npm run db:migrate` (`scripts/migrate.ts`).
- **Migrationssperre** (#73): Mit `pg` hält `runCoreMigrations` währenddessen eine Advisory-Sperre (`pg_advisory_lock(MIGRATION_LOCK_KEY)` auf eigener Verbindung, `database/migrate.ts`); Modul-Migrationen nehmen dieselbe Sperre als `pg_advisory_xact_lock` je Transaktion. Überlappende Starts (Rolling-Update, zwei Replikas) warten aufeinander, jede Migration läuft genau einmal. PGlite (Tests/Demo) braucht keine Sitzungssperre. Nebenläufigkeit ist nur mit echtem PostgreSQL prüfbar (PGlite hat eine Sitzung, #60).
- Tests: `tests/helpers/db.ts` wendet dieselben Migrationen auf PGlite an – oder mit `TEST_DATABASE_URL` auf echtes PostgreSQL (siehe unten).

## Tests gegen echtes PostgreSQL (#60)

Standard ist PGlite (eine Sitzung, kein Docker): Transaktionen laufen dort nacheinander, Advisory-Sperren und Wettläufe
werden nicht wirklich geprüft, und `int8` kommt als `number` statt als String. Für den Produktionspfad:

```bash
docker run -d --rm --name ep-pg-test -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:17.11-alpine3.24
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npx vitest run tests/integration
docker stop ep-pg-test
```

- `useTestDatabase()` legt je Testdatei eine eigene Datenbank `ept_<pid>_<zufall>` an (Benutzer braucht `CREATEDB`), wendet die
  Core-Migrationen über `runCoreMigrations` (inkl. Migrationssperre) mit dem `pg`-Treiber an und löscht sie in `close()`
  (`DROP DATABASE … WITH (FORCE)`). Abgebrochene Läufe hinterlassen `ept_*`-Datenbanken – bei Wegwerf-Containern egal.
- `TEST_DATABASE_POOL_MAX` (Standard 4): Verbindungen je Testdatei – > 1, damit parallele Requests wirklich gleichzeitig laufen.
- `TEST_DATABASE_ISOLATION=reset`: statt neuer Datenbank die angegebene leeren (Schemas `public`, `drizzle`, `mod_*`), z. B. ohne
  `CREATEDB`-Recht; dann nur **eine** Testdatei gleichzeitig (`--no-file-parallelism`). Damit lässt sich auch der `pg`-Treiberpfad
  gegen einen PGlite-Socket-Server prüfen (`TEST_DATABASE_POOL_MAX=1`; ohne echte Nebenläufigkeit).
- Nebenläufigkeitstests: `tests/integration/pg-concurrency.test.ts` (nur mit `TEST_DATABASE_URL`, sonst übersprungen):
  20 parallele `POST /invoices` (Rechnungsnummern), parallele `orders.nextNumber` (Bestell-/Einkaufsnummern), parallele Uploads gegen
  das Kontingent (`files.assertQuota`), parallele Mahnläufe (Reservierung), parallele Modul-Migrationen, Wartesperre von
  `withMigrationLock` (über `pg_locks`, nur echter Server), Job-Claim (`runDueJobs`), Treiberwerte (`int8` als String).
- **Gegenprobe** (einmalig von Hand, Akzeptanzkriterium #60): die jeweilige `pg_advisory_xact_lock`-Zeile entfernen → der zugehörige
  Test wird rot. Ausnahme Mahnlauf: dort schützt zusätzlich der Unique-Index `reminders_auto_level_uq`.
- CI: Job `postgres` in `.github/workflows/ci.yml` (Service `postgres:17.11-alpine3.24` wie `docker-compose.yml`).

## Unveränderliches Audit-Log

Migration `0001_audit_immutable.sql`: Trigger `audit_log_no_update_delete` (BEFORE UPDATE/DELETE) und `audit_log_no_truncate` lösen eine Exception aus. Kontrollierte Ausnahmen (Funktion `audit_log_immutable`, jeweils nur mit `SET LOCAL` in der Transaktion):

- `app.audit_reset = 'on'` (Migration 0005): `DELETE` für den Admin-Reset bzw. die Wiederherstellung.
- `app.audit_retention = 'on'` (Migration 0007): `DELETE` und ein `UPDATE`, das nur `ip` auf `NULL` setzt (geprüft per
  `to_jsonb(NEW) - 'ip' = to_jsonb(OLD) - 'ip'`) – genutzt vom Core-Job `core.housekeeping`.

UPDATE/DELETE ohne Flag und TRUNCATE bleiben verboten.

## Aufbewahrung von Protokollen

Core-Job `core.housekeeping` (täglich, `core/jobs/housekeeping.ts`): `api_log` älter als `core.retention.apiLogDays` (30) löschen,
IP in `audit_log` nach `core.retention.auditIpDays` (90) leeren, `audit_log` nach `core.retention.auditDays` (730, 0 = nie) löschen –
jeweils in Stapeln zu 5000 Zeilen mit eigener kurzer Transaktion (Index `api_log_created_idx` bzw. `audit_log_created_idx`).
Fristen und Hintergrund: `docs/security.md` → „Aufbewahrungsfristen“.

## Indizes auf `audit_log`

`created_at`, `action`, `actor_id` (0000) sowie seit Migration 0007 `audit_log_target_idx (target, created_at DESC)` für den Verlauf je
Objekt (`listAudit({ target | targets })`, z. B. Kassen-Verlauf) und `audit_log_action_pattern_idx (action text_pattern_ops)` für den
Präfixfilter (`listAudit({ action })` nutzt `LIKE 'prefix%'` mit maskierten `%`/`_`; Aktionen sind ASCII-klein).
Die Freitextsuche (`ILIKE '%…%'`) bleibt ein Scan.

Hinweis: Die Drizzle-Snapshots in `drizzle/meta/` reichen nur bis 0002; neue Core-Migrationen werden von Hand geschrieben und im
`_journal.json` ergänzt (`idx`, `tag`, `when` aufsteigend).

## Transaktionen

```ts
await core.database.forModule('members').transaction(async (tx) => { /* … */ });
```
Core-intern: `getDb().transaction(…)` aus `src/lib/server/core/database/client.ts` (`core.database` bietet Modulen nur `forModule`). Services reichen `tx` an `auditFromContext`/Hilfsfunktionen durch, damit Fachänderung und Audit-Eintrag atomar sind (z. B. Rollen, Module, Benutzer deaktivieren).

## Modul-Schema und -Migrationen

- Strategie: **ein PostgreSQL-Schema je Modul** (`mod_<id>`).
- `ModuleDefinition.migrations` = geordnete Liste `{ name, sql }`; Quelle meist `migrations/*.sql?raw`.
- Ausführung beim **Aktivieren** und beim **Start** aktiver Module (`syncModules`), jeweils in einer Transaktion: Migrationssperre → Schema anlegen → `SET LOCAL search_path TO "mod_<id>"` (**ohne** `public`, #73) → SQL → `SET LOCAL search_path TO DEFAULT` → Eintrag in `module_migration`. Unqualifizierte Namen in Modul-Migrationen treffen daher **nie** Core-Tabellen (Zugriff darauf schlägt fehl; schemaqualifizierte Namen wie `public."user"` funktionieren dagegen – die Trennung ist Konvention, kein Sicherheitsmechanismus), und eine Modultabelle mit Core-Namen überschattet die folgenden Core-Statements nicht. Funktionen aus `pg_catalog` (`now()`, `gen_random_uuid()`, `hashtext()` …) bleiben erreichbar; Erweiterungen in `public` müssten qualifiziert werden.
- Der Splitter (`modules/split-sql.ts`) zerlegt an `;` außerhalb von Strings (`'…'`, `E'…'` mit Backslash-Escapes), Bezeichnern, Kommentaren (auch verschachtelte `/* /* */ */`) und Dollar-Quoting (`$$`, `$tag$`, `$tag_1$`).
- **Konventionen für neue Spalten**: Geld als `bigint` (Integer-Cent; ältere `integer`-Spalten in `actions`, `orders`, `treasury.annual_fee_items` bleiben, Grenze ≈ 21,4 Mio. €). Beziehungen im selben Modulschema immer mit FK (passendes `ON DELETE`) und Index auf der FK-Spalte; Formate (`HH:MM`, Datumsreihenfolge, Längen) zusätzlich als `CHECK`. Nachträglich: `ADD CONSTRAINT … NOT VALID` → Altbestand bereinigen → `VALIDATE CONSTRAINT` (Muster `events/migrations/0003_checks.sql`). Positionsvergabe `MAX(position)+1` unter `pg_advisory_xact_lock(hashtext('<modul>:<container>'))` (Muster `orders`).
- Bereits angewendete Migrationen werden per SHA-256 geprüft; Änderung führt zu einem Fehler. Korrekturen immer als neue Migration.
- Deaktivieren löscht **keine** Daten; Rückbau erfolgt manuell.
- Zugriff nur über `forModule(id)` (siehe [Modulentwicklung](module-development.md)).
- Beispiel `members`: Migration `0008_member_mail_prefs.sql` legt `member_mail_prefs` an (`member_id` → `members` ON DELETE CASCADE, `category` ∈ `payment-confirmation|action-info`, `enabled`, `updated_at`, `updated_by`; PK `member_id`+`category`). Gespeichert werden nur Abwahlen. `0007` ist in `members` unbenutzt.

## Zeilenenden und Migrations-Prüfsummen

- `.gitattributes` legt `* text=auto eol=lf` fest (Binärdateien ausgenommen). Unabhängig davon sind alle Prüfsummen
  **zeilenendenunabhängig** (`src/lib/server/core/modules/migration-checksum.ts`): SHA-256 über den Text mit `\r\n` → `\n`.
- **Modul-Migrationen**: `module_migration.checksum` = kanonischer Hash. Übergang: Ein gespeicherter Hash der Roh- oder
  CRLF-Variante gilt als unverändert und wird beim nächsten Lauf (`syncModules`, Aktivieren) auf den kanonischen Wert
  umgeschrieben. Eine inhaltliche Änderung bricht weiterhin ab („wurde nach Anwendung verändert“).
- **Core-Migrationen (Drizzle)**: Drizzle speichert in `drizzle.__drizzle_migrations.hash` den SHA-256 des **Rohtexts** und
  entscheidet beim Migrieren **nur** über `created_at` (= Journal `when`); ein abweichender Hash bricht nicht ab, eine
  nachträglich geänderte Core-Migration fällt dem Migrator also nicht auf. Der Hash dient nur der Datensicherung:
  Export schreibt den kanonischen Hash der lokalen Datei mit gleichem `created_at`, der Import akzeptiert gespeicherte
  Hashes sowie kanonische, CRLF- und Roh-Variante der lokalen Dateien (`coreMigrationIdentifiers`).
- Sicherungen zwischen Windows- (CRLF) und Linux-Builds (LF) sind damit übertragbar; ältere Server ohne diese Logik
  akzeptieren neue Sicherungen nur, wenn ihre eigenen Hashes zufällig der LF-Variante entsprechen.
- Drizzle-Metadaten: `drizzle/meta/NNNN_snapshot.json` muss für **jede** Core-Migration gepflegt werden (auch für
  handgeschriebene). Der letzte Snapshot beschreibt die echte Datenbank (Constraint-/Indexnamen aus dem SQL), `schema.ts`
  muss dieselben Namen tragen; `npx drizzle-kit generate` meldet dann „No schema changes“. Handgeschriebene Migration:
  SQL schreiben, Journal-Eintrag ergänzen, `schema.ts` anpassen und den Snapshot in einer Kopie des Repos per
  `drizzle-kit generate` erzeugen (erzeugte SQL verwerfen, Snapshot als `NNNN_snapshot.json` mit `prevId` = Vorgänger übernehmen).
