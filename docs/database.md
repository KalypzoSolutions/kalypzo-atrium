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
- Tests: `tests/helpers/db.ts` wendet dieselben Migrationen auf PGlite an.

## Unveränderliches Audit-Log

Migration `0001_audit_immutable.sql`: Trigger `audit_log_no_update_delete` (BEFORE UPDATE/DELETE) und `audit_log_no_truncate` lösen eine Exception aus. Aufbewahrungsfristen/Archivierung müssen daher bewusst (z. B. durch Tabellenpartitionierung oder DBA-Eingriff) umgesetzt werden.

## Transaktionen

```ts
await core.database.forModule('members').transaction(async (tx) => { /* … */ });
```
Core-intern: `core.database.transaction`. Services reichen `tx` an `auditFromContext`/Hilfsfunktionen durch, damit Fachänderung und Audit-Eintrag atomar sind (z. B. Rollen, Module, Benutzer deaktivieren).

## Modul-Schema und -Migrationen

- Strategie: **ein PostgreSQL-Schema je Modul** (`mod_<id>`).
- `ModuleDefinition.migrations` = geordnete Liste `{ name, sql }`; Quelle meist `migrations/*.sql?raw`.
- Ausführung beim **Aktivieren** und beim **Start** aktiver Module (`syncModules`), jeweils in einer Transaktion: Schema anlegen → `SET LOCAL search_path` → SQL → Eintrag in `module_migration`.
- Bereits angewendete Migrationen werden per SHA-256 geprüft; Änderung führt zu einem Fehler. Korrekturen immer als neue Migration.
- Deaktivieren löscht **keine** Daten; Rückbau erfolgt manuell.
- Zugriff nur über `forModule(id)` (siehe [Modulentwicklung](module-development.md)).
- Beispiel `members`: Migration `0008_member_mail_prefs.sql` legt `member_mail_prefs` an (`member_id` → `members` ON DELETE CASCADE, `category` ∈ `payment-confirmation|action-info`, `enabled`, `updated_at`, `updated_by`; PK `member_id`+`category`). Gespeichert werden nur Abwahlen. `0007` ist in `members` unbenutzt.
