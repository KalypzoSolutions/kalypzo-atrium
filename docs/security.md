# Sicherheitskonzept

## Authentifizierung und Sessions

- Better Auth, E-Mail/Passwort; Registrierung ist deaktiviert (`disableSignUp`), Benutzer werden nur administrativ angelegt.
- Passwörter: 12–128 Zeichen, Hashing durch Better Auth (Standard-Hashing von Better Auth, derzeit scrypt; nicht im Projektcode konfiguriert).
- Sessions: 7 Tage, Erneuerung nach 1 Tag, Cookies `HttpOnly`, `SameSite=Lax`, `Secure` bei HTTPS-`ORIGIN`. Session-Übersicht und -Widerruf im Profil.
- Optionale 2FA (TOTP, Backup-Codes).
- Passwort-Reset per E-Mail (Link 1 Stunde gültig, danach werden alle Sessions widerrufen); die Antwort verrät nicht, ob ein Konto existiert.
- Deaktivierte Benutzer: Anmeldung wird in `databaseHooks.session.create` abgelehnt, bestehende Sessions werden gelöscht, `resolveSession` liefert `null`.

## Brute-Force-Schutz

- Gemeinsame Limits `AUTH_RATE_LIMITS` (`core/auth/auth-limits.ts`): `/sign-in/email` 10/min, Passwort-Reset anfordern 5/5 min,
  Passwort zurücksetzen 10/5 min, TOTP 10/min, Passwort ändern / 2FA an / 2FA aus je 5/5 min, Bestätigungsmail 3/5 min, sonst 100/min.
  Better Auth übernimmt sie als `customRules` (HTTP-Weg `/api/auth/*`). Die Form-Actions rufen `getAuth().api.*` direkt auf – dort greift
  dessen Limiter **nicht**; sie zählen deshalb selbst (`limitAuthAction`) **je IP und je Ziel**: Login je IP, 2FA-Code je IP + 2FA-Cookie,
  Passwort vergessen je IP + Adresse (über dem Limit still verworfen, Antwort bleibt neutral, keine Mail), Reset je IP + Token,
  Profil (Passwort/2FA) je IP + Konto. Überschreitung → 429 „Zu viele Versuche“.
- Fehlversuchssperre beim Login je **(E-Mail, IP)**: 5 Fehlversuche in 15 min sperren nur diese IP für dieses Konto – eine fremde IP kann die
  Inhaber*in nicht aussperren. **Globale Kontosperre** erst ab 50 Fehlversuchen je Konto in 15 min (verteilter Angriff), mit einmaliger
  Hinweismail an die Kontoinhaber*in. Audit `core.auth.login_blocked` (`scope: ip|account`). Bei 2FA-Konten wird `core.auth.login` erst nach
  dem Code protokolliert (vorher nur Passwortschritt).
- Client-IP für Limits/Audit nur aus `getClientAddress()` (siehe `deployment.md` → „Proxy-Header“).
- **Fenster je Bucket** (`core/rate-limit.ts`, #67 01a-09): Jeder Schlüssel merkt sich sein (größtes) Fenster; das periodische
  Aufräumen nutzt dieses statt des Fensters des gerade laufenden Aufrufs. Früher kürzte jeder Request mit kurzem Fenster z. B. das
  1-h-Limit „E-Mail-Wechsel“ auf 15 min. Test `tests/unit/rate-limit.test.ts`.

## CSRF

- SvelteKit-Origin-Prüfung für Formulare.
- API: Session-authentifizierte schreibende Requests müssen `Origin == ORIGIN` (oder `Sec-Fetch-Site: same-origin/none`) haben; API-Key-Requests sind nicht cookie-basiert.

## Header und CSP

`svelte.config.js` (`kit.csp`, Modus `auto` mit Nonces/Hashes): `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (seit 2026-10-27 für den Barcode-Scanner: zxing-wasm, WASM selbst gehostet, kein `eval` für JavaScript), `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`. Zusätzlich `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (`camera=(self)` für das Scannen im Modul Material, sonst Mikrofon/Standort gesperrt), HSTS bei HTTPS. Keine Inline-Skripte (Theme per Cookie serverseitig).

## Autorisierung

Zentral und serverseitig: `core.permissions.require`, API-Router, Services. Schutz vor Rechteausweitung, Last-Admin-Schutz, API-Key-Rechte = Scopes ∩ Besitzer (siehe [Permissions](permissions.md)). Deaktivierte Module sind per UI und API nicht erreichbar.

### Standardrollen per Kennung statt Name (#67, 01a-07)

- `defaultRoleGrants` und `core.users.registerWithRole` ordnen Rollen über `role.system_key = 'default:<Name>'` zu (Migration
  `drizzle/0008_role_system_key.sql`, Logik `core/permissions/default-roles.ts`). Eine **gleichnamige Rolle ohne Kennung** bekommt keine
  Modulrechte (Warnung im Log), die Selbstregistrierung antwortet dann 503 – so kann niemand mit `core.roles.create` eine leere Rolle
  „vorbelegen“ und sich nach der Modulaktivierung die Rechte erschleichen.
- Die Migration übernimmt bestehende Rollen, für die schon Marker in `role_grant_applied` existieren (Altbestand läuft unverändert weiter).
- **Admin-Bestätigung**: `POST /api/v1/roles/:id/adopt-default` (`core.roles.edit` **und** Administrator*in) übernimmt eine gleichnamige Rolle
  ausdrücklich; die Rechte folgen beim nächsten Abgleich (Neustart bzw. `syncModules`). Alternativ die Rolle umbenennen oder löschen.
- **Reservierte Namen**: Rollen dürfen nicht neu angelegt oder umbenannt werden in einen Namen aus `defaultRoleGrants` (409), außer es ist die
  Standardrolle selbst. Die Standardrolle darf umbenannt werden (Kennung bleibt). Module finden sie mit `core.roles.defaultRoleId(name)`.
- Tests: `tests/integration/core-default-roles.test.ts`, `profile-extra.test.ts` (Randfälle).

### Rechteprüfung in Core-Diensten für Module (#67, 01a-12)

- `core.audit.listForModule(ctx, moduleId, { targets, limit })`: nur Aktionen `<moduleId>.…`, nur angegebene Objekte (≤ 50, leer → nichts),
  nur mit mindestens einem Recht des Moduls (401/403). `core.audit.list` (veraltet) verlangt bereits `targets` – kein Gesamt-Log mehr für Module.
- `core.settings.listPublic(ctx, filter)` verlangt `core.settings.view` (auch nicht geheime Werte wie Bankdaten sind nicht für jedes Modul bestimmt).
- `core.database` enthält nur noch `forModule` (kein `db`/`transaction` ohne `search_path` im SDK; die Schema-Trennung bleibt trotzdem eine Konvention, siehe „Bekannte Einschränkungen“).
- Tests: `tests/integration/core-service-guards.test.ts`.

## Öffentliche Modul-Endpoints

Modul-Endpoints verlangen standardmäßig eine Berechtigung (`permission: null` wird abgelehnt). Ein Modul kann einzelne Endpoints **bewusst** anonym erreichbar machen (Opt-in), z. B. für ein öffentliches Anmeldeformular:

- **Pflichtfelder**: `public: true`, `permission: null`, `rateLimit` (Pflicht), Methode `GET` oder `POST`, bei `POST` ein `body`-Schema. `public: true` zusammen mit einer Berechtigung ist ein Fehler. Verstöße lassen den Start (Registry) fehlschlagen.
- **Limits**: Rate Limit je IP (`rateLimit`) plus ein Gesamt-Bucket je Endpoint (`max(limit × 20, 200)` je Fenster, unabhängig von der IP) gegen verteilte Missbrauchsversuche. Antwort bei Überschreitung: 429 mit `Retry-After`.
- **Content-Type**: mutierende öffentliche Anfragen müssen `application/json` senden, sonst 400. Das verhindert klassische Cross-Site-Formular-Posts.
- **Caching**: Antworten tragen `cache-control: no-store`.
- **Modulstatus**: deaktivierte Module sind auch öffentlich nicht erreichbar (404).
- **Missbrauchsschutz im Modul**: Eingaben streng per Zod begrenzen (Längen, Formate), keine Daten fremder Personen ausliefern, keine Aufzählbarkeit (einheitliche Antworten), Mailversand nur über `core.mail.send` (validiert Adresse und Betreff gegen Header-Injection) und nur an feste oder vom Modul geprüfte Empfänger – nie als offenes Relay.
- **Datenschutz**: Öffentliche Formulare erheben personenbezogene Daten ohne Anmeldung. Nur erforderliche Felder abfragen, Zweck und Aufbewahrung festlegen, Hinweistext anzeigen und Daten nicht in Logs/Audit-Metadaten schreiben.
- **Öffentliche Seiten** (`/p/<moduleId>/<pfad>`) brauchen keine Session, setzen `noindex,nofollow` und zeigen nur Routen aus `ui.publicRoutes`. Alle Sicherheits-Header und die CSP (`frame-ancestors 'none'`) gelten unverändert.

## Konto-Verknüpfung per Code (Modul `members`)

Die Selbstregistrierung ist weiterhin aus. Ausnahme: Wer **Link-Token und 6-stelligen Code** aus dem Brief hat, kann über
`/p/members/verknuepfen/<token>` ein Konto (Rolle „Mitglied“, ohne Rechte) anlegen oder ein vorhandenes verknüpfen.
Schutz: Token (128 Bit) identifiziert das Mitglied, Code (6 Ziffern, verschlüsselt gespeichert, zeitkonstanter Vergleich) belegt den Besitz;
je Mitglied nach 10 Fehlversuchen 60 Minuten Sperre, dazu Rate-Limits je IP/Gesamt; Gültigkeit 90 Tage; „Code neu erzeugen“ macht Link und Code ungültig.
Seit #18: Ein Code verknüpft höchstens `members.link.maxUses` Konten (Standard 2), danach ist der Link ungültig (neuer Brief); jede weitere
Verknüpfung informiert die bereits verknüpften Konten per Mail. Über den Brief registrierte Konten sind **unbestätigt** (`emailVerified=false`):
Bestätigungslink an die Adresse (1 h), Anmeldung erst danach (`databaseHooks.session.create` lehnt mit `EMAIL_NOT_VERIFIED` ab, ein
Anmeldeversuch mit richtigem Passwort schickt höchstens alle 5 min einen neuen Link). Der Bestätigungslink selbst erzeugt keine Session.

## E-Mail-Wechsel, Profilbild und Kontaktänderung

- **E-Mail-Wechsel**: Der Better-Auth-Endpoint `POST /api/auth/change-email` (und `/update-user`) ist für
  HTTP-Aufrufe im `before`-Hook gesperrt (403). Erlaubt ist nur die Profil-Action (`requestEmailChange`, serverseitiger
  `auth.api`-Aufruf ohne `request`): Passwortprüfung (5 Fehlversuche je 10 min), eigenes Rate-Limit (3 Anfragen je Stunde
  und Benutzer), Bestätigungslink an die **neue** Adresse (Session im selben Browser nötig), Hinweismail an die **alte**
  Adresse (erst nach erfolgreichem Aufruf, nur maskierte neue Adresse). Nach der Bestätigung werden alle **anderen**
  Sessions beendet; Audit `core.auth.email_changed` (maskiert).
- **Profilbild**: Upload prüft Typ, Größe und Magic-Bytes (PNG/JPEG/WebP). `GET /avatar/<id>` verlangt Login (alle
  angemeldeten Benutzer dürfen Avatare sehen, gewollt), liefert nichts für deaktivierte Benutzer und nur, wenn
  `user.image` auf den eigenen Pfad `/avatar/<id>` zeigt (keine Imitation per fremder ID). Antwort mit
  `nosniff` und `sandbox`-CSP.
- **Kontaktänderung durch verknüpfte Konten** (`PUT /my/members/:id/contacts`): Ändert sich die E-Mail-Liste, geht eine
  Info-Mail an die **bisherigen** Adressen des Mitglieds (ohne die neuen zu nennen, höchstens eine Mail je Adresse,
  Mailfehler brechen das Speichern nicht ab). Das Audit enthält nur Zähler.
- Startseite (`core.user.startPage`): nur interne Pfade (`^/(?!/)[a-z0-9\-/]*$`, kein `//`).

## Adress-Autovervollständigung (Modul `members`)

Beim Tippen einer Adresse sendet **unser Server** (nicht der Browser) den Straßentext an das Straßenverzeichnis OpenPLZ
(`members.address.openPlzUrl`, Standard `openplzapi.org`) und nur ersatzweise an Photon (`members.address.photonUrl`, Standard `photon.komoot.io`).
Es werden nur Straße/PLZ-Fragmente übertragen, keine Namen oder Kontodaten. Vorschläge aus vorhandenen Mitglieder-Anschriften sieht nur, wer
`members.member.edit` hat (diese Personen sehen die Anschriften ohnehin). Fehler brechen das Formular nicht. Zum Abschalten die Einstellungen leeren.

## Secrets

- Reversibel benötigte Secrets (SMTP-Passwort, S3-Zugangsdaten, OpenAI-Key) werden mit **AES-256-GCM** verschlüsselt (Schlüssel per HKDF-SHA-256 aus `APP_SECRET`, zufälliger 96-Bit-IV, Format `enc:v1:…`).
- Secrets werden nie an Clients oder in Logs ausgegeben (`listPublic` liefert nur `isSet`); Audit-Einträge enthalten nur `{ secret: true }`.
- **Rotation**: Ein neuer `APP_SECRET` macht gespeicherte Secrets unlesbar (auch Better-Auth-Signaturen ändern sich → Sessions ungültig). Vorgehen: Secrets notieren, `APP_SECRET` ändern, Werte in der Oberfläche neu eingeben. Eine automatische Re-Encryption ist nicht implementiert. Alternativ: Datensicherung erstellen und auf dem Server mit neuem
  `APP_SECRET` wiederherstellen – dabei werden alle Secrets, 2FA-Daten und Modul-Felder neu verschlüsselt und schlüsselgebundene Hashes
  (Modul-Hook `backup.rehash`) neu berechnet.
- **Datensicherung** (`.epbackup`): enthält Secrets **im Klartext innerhalb der verschlüsselten Datei** (Passwort-Hashes, 2FA, IBANs,
  SMTP-Zugang); das Quell-`APP_SECRET` ist nicht enthalten. Datei + Sicherungs-Passwort = Zugriff auf alle Daten. Export/Import nur mit
  Konto-Passwort + 2FA, Rate-Limits für Konto- und Sicherungs-Passwort, eigener Origin-Check (JSON/Octet-Stream), Pfad-Whitelist,
  Zip-Bomb-Grenzen, Prüfsummen je Eintrag, Kontoschutz der ausführenden Person, Audit `core.system.backup_exported|backup_restored`.
- API-Keys: 256 Bit Zufall, nur als SHA-256-Hash gespeichert, Klartext einmalig sichtbar, Ablauf und Widerruf.

## Audit

Tabelle `audit_log`, per DB-Trigger unveränderlich. Protokolliert u. a. Logins/Fehlversuche/Sperren, Passwortänderungen, Benutzer-/Rollen-/Rechteänderungen, API-Key-Erzeugung/-Widerruf, Einstellungsänderungen, Modulaktivierung. Metadaten werden um sensible Schlüssel bereinigt und gekürzt. Zugriffsprotokolle der API (`api_log`) enthalten keine Inhalte.

Personenbezogene Daten (#26): Login-Einträge speichern die Adresse nur maskiert (`a***@domain`), Eingaben ohne `@` als `[ungültig]`.
`sanitizeMetadata` hat zusätzlich eine Blockliste (`email`, `birthDate`, `iban`, `phone`, `street`, `address`, `firstName`, `lastName`,
Gesundheitsfelder …): Texte darunter werden entfernt bzw. Adressen maskiert, unmaskierte E-Mail-Adressen unter beliebigen Schlüsseln maskiert –
jeweils mit Warnung `[audit] Personenbezogenes Feld …` im Server-Log. Zähler/Wahrheitswerte bleiben; `name` ist für **Objektnamen** (Aktion, Amt,
Gruppe) erlaubt, Personen stehen nur als ID in `target`. **Bestandsdaten** (ältere Einträge mit Klarnamen/Adressen) werden nicht automatisch
bereinigt; eine einmalige Bereinigung ginge nur über den kontrollierten `app.audit_reset`-Weg (Admin-Reset, Bereich `core:audit`) – Entscheidung
liegt beim Betreiber. Offen: `actor_name` normaler Audit-Einträge eingeloggter Personen ist weiterhin deren Konto-Adresse (`auth/context.ts`).

## Fehler-Logging (keine Parameterwerte)

drizzle-orm verpackt jeden DB-Fehler in `DrizzleQueryError`; dessen `message` und Stack-Kopf lauten
`Failed query: <SQL>\nparams: <Werte>` – also mit allen Parameterwerten (Namen, Geburtsdaten, Gesundheitsangaben, Chiffrate).
Der eigentliche Postgres-Fehler steckt nur in `cause`. Regeln (Helfer in `src/lib/server/core/db-errors.ts`, für Module über `$lib/sdk/server`):

- **Nie** `e.message`, `String(e)` oder das Fehlerobjekt selbst loggen, speichern oder ausliefern. Stattdessen
  `describeError(e)` (`{ name, code, message, constraint, table, sqlPreview, stack }`) bzw. intern `logError(prefix, e, { requestId })`.
  `message` ist die Postgres-Meldung **ohne** `detail`; bei Datenfehlern (SQLSTATE-Klasse 22) werden Werte in Anführungszeichen durch `"…"`
  ersetzt. `sqlPreview` ist der SQL-Text mit Platzhaltern (`$1`), gekürzt, nie `params`. Treiberfelder werden nur über bekannte Namen gelesen.
- Router (`api/router.ts`, mit `requestId`), `handleError` (`hooks.server.ts`) und Job-Runner loggen so; der Stack (ohne Kopfzeilen) geht nur ins
  Server-Log, Clients bekommen ausschließlich `internal_error` + `requestId`.
- `job_run.last_message` (sichtbar über `GET /api/v1/jobs`) enthält bei Fehlern nur `errorSummary(e)` = `Klasse: SQLSTATE Meldung (constraint …)`.
  **Altbestand**: Meldungen im alten Format (`Failed query:` / `\nparams: `) werden beim Lesen (`listJobs`) sofort maskiert und beim ersten
  Job-Tick nach dem Start einmalig per `neutralizeLegacyJobMessages()` in der Tabelle überschrieben („Fehler (Details aus Datenschutzgründen entfernt)“).
- Unique-Verletzungen: `isUniqueViolation(e, constraint?)` läuft die `cause`-Kette ab (SQLSTATE `23505`) – keine eigenen Kopien, nie auf
  `e.code` oder `e.message` der Hülle prüfen. Eine **nicht abgefangene** Unique-Verletzung beantwortet der Router generisch mit 409 `conflict`
  („Ein Eintrag mit diesen Angaben existiert bereits“) statt 500; fachlich passende Texte setzen die Endpunkte selbst.
- Modul-Code mit `console.error(…, e)` auf unbekannte Fehler: `describeError(e)` verwenden (auch für „best effort“-Pfade).

## Aufbewahrungsfristen (Protokolle)

Der tägliche Core-Job `core.housekeeping` (`src/lib/server/core/jobs/housekeeping.ts`, sichtbar unter `GET /api/v1/jobs`,
manuell `POST /api/v1/jobs/core.housekeeping/run`) setzt die Fristen durch. Einstellbar unter Verwaltung → Einstellungen →
Allgemein („Aufbewahrungsfristen“). Die konkreten Fristen legt der Verein fest und trägt sie ins Verarbeitungsverzeichnis ein.

| Daten | Einstellung | Standard | Wirkung |
|---|---|---|---|
| `api_log` (Methode, Pfad-Muster, Status, IP, Akteur, API-Key) | `core.retention.apiLogDays` | 30 Tage (1–3650) | ältere Zeilen werden gelöscht |
| IP-Adressen in `audit_log` | `core.retention.auditIpDays` | 90 Tage (1–3650) | IP wird auf `NULL` gesetzt, Eintrag bleibt |
| `audit_log` | `core.retention.auditDays` | 730 Tage (0 = nie, sonst ≥ 30) | ältere Einträge werden gelöscht |
| Warteschlange der Amts-Tageszusammenfassung (`mod_offices.notification_queue`) | fest | 14 Tage bzw. 5 Fehlversuche | Eintrag wird verworfen und gezählt (Job `offices.notify-digest`) |

- Löschen/IP-Leeren im Audit-Log geht nur in einer Transaktion mit `SET LOCAL app.audit_retention = 'on'` (Migration 0007); der
  Trigger erlaubt dann `DELETE` und ein `UPDATE`, das **ausschließlich** `ip` auf `NULL` setzt. Alle anderen Wege bleiben gesperrt.
- Der Job schreibt einen Audit-Eintrag `core.system.housekeeping` nur mit Zählern und Fristen (keine Inhalte).
- `api_log` speichert das **Endpunkt-Muster** (`/api/v1/modules/files/public/links/:token`) statt des konkreten Pfads; ohne Treffer
  werden token-artige Segmente (≥ 16 Zeichen `[A-Za-z0-9_-]` oder > 64 Zeichen) zu `:param`. Link-Tokens landen so nie im Klartext im
  Protokoll; der Altbestand wurde mit Migration 0007 maskiert. Der Health-Check (`GET /api/v1/health`) wird nicht protokolliert.
- Backups enthalten die Protokolle im Zustand zum Exportzeitpunkt; ältere Sicherungen unterliegen der eigenen Löschfrist der Sicherungen.

## Gesundheitsdaten in Aktionen (Art. 9 DSGVO)

- Ernährung, Allergien/Unverträglichkeiten, „Sonstiges (Medikamente, Mitteilungen)“ und gesundheitsbezogene Formularantworten
  der Teilnehmenden (`mod_actions.action_participants.diet|allergies|notes|health_answers`) sind mit
  `core.crypto.forModule('actions')` verschlüsselt (Altbestand per idempotentem Job `actions.encrypt-health`).
- **Zugriffskreis**: nur mit dem Recht `members.data.export` (dasselbe Recht wie Mitglieder-Datenblätter und Teilnehmenden-PDF,
  standardmäßig nur „Administrator“) **und** Lesezugriff auf die Aktion. Ohne das Recht liefern JSON-Liste (Felder `null`,
  `healthHidden`), CSV (Spalten fehlen), ZIP-Export (`includesHealth: false`) und PDF (403) keine Gesundheitsdaten.
  Zentrale Prüfung: `src/lib/modules/actions/health.ts` (`canSeeHealth`).
- Grenze: Freie Formularfelder gelten nur dann als Gesundheitsdaten, wenn sie an ein Mitgliedsfeld gebunden sind oder ihre
  Beschriftung Gesundheitsbegriffe enthält (kein Kennzeichen im Formular-Builder). Offen: `members.custom` (Zusatzfelder der
  Mitglieder) ist noch unverschlüsselt.

## Löschkonzept und Betroffenenrechte (Fachdaten, #30)

Die Fristen legt der Verein fest (Verarbeitungsverzeichnis); die Standardwerte sind datenschutzfreundliche Vorschläge.
Protokolle siehe „Aufbewahrungsfristen (Protokolle)“.

| Daten | Frist / Einstellung | Standard | Umsetzung |
|---|---|---|---|
| Gesundheitsdaten der Teilnehmenden (`diet`, `allergies`, `notes`, `health_answers`, gesundheitsbezogene `answers`) | `actions.health.retentionDays` (0 = nie) | 90 Tage nach Aktionsende (ohne Ende: Start) | täglicher Job `actions.purge-health` leert die Felder; Name, Geburtsdatum, Rolle bleiben für Abrechnung/Zuschuss |
| Ehemalige Mitglieder | `members.retention.exitYears` (1–30) | 3 Jahre nach Austritt | **Vorschlag**: Seite „Löschfristen“ (`/modules/members/retention`, Recht `members.member.delete`), Sammel-Anonymisieren per `POST /retention/anonymize`; keine automatische Löschung |
| Kopien von Mitgliedsdaten in anderen Modulen | beim Löschen/Anonymisieren des Mitglieds | sofort | Modul-Hook `onMemberDeleted` (`core.modules.memberDeleted`, nur `members` darf auslösen); `actions`: verknüpfte Teilnehmende → „Anonymisiert“, ohne Kontakt, Gesundheitsdaten, Antworten, `member_id`/`user_id` |
| Benutzerkonten | beim Löschen des Kontos | sofort | Modul-Hook `onUserDeleted` (je Modul löschen oder übergeben) |
| Kassendaten (Rechnungen, Buchungen, Zahler) | gesetzliche Aufbewahrung (§ 147 AO, i. d. R. 10 Jahre) | – | **nicht** automatisch gelöscht; Anonymisieren eines Mitglieds lässt Rechnungen unverändert |
| Unbestätigte öffentliche Anmeldungen | fest | Ablauf des Bestätigungslinks | Job `actions.purge-pending` |
| Datei-Papierkorb | `files.trash.days` | 30 Tage | Job `files.purge-trash` |

- **Anonymisieren** (members): Name → „Anonymisiert“, Geburtsdatum → 1. Januar des Geburtsjahrs, Pfadfindername, Anschrift,
  Zusatzfelder (inkl. Gesundheit), Einwilligungen samt Nachweis, Telefone, E-Mails, Gruppen, Leitungen, Konto-Verknüpfungen,
  Codes, Mail-Einstellungen und Dokumente entfernt; `anonymized_at` gesetzt. Einzige Leitung einer Gruppe → übersprungen.
  Audit `members.member.anonymized` nur mit Zählern. Fehlgeschlagene Dokument-Löschungen werden protokolliert (ohne Pfad).
- **Einwilligungen** (Art. 7 Abs. 1): `members.consent_*_at|_by` = Zeitpunkt und erfassende Person (Benutzer-ID bzw.
  `<actor-typ>:<id>`) der letzten Änderung; Altbestand ohne Nachweis (`null`). Die Website-API liefert Leitende nur mit
  `consent_website`; Ämter-Inhaber*innen nur mit eigenem Opt-in (`holder_profiles.show_on_website`); öffentliche Galerien nur
  nach dokumentierter Bestätigung (`galleries.public_confirmed_at|_by`).
- **Datenauskunft** (Art. 15/20): Seite `/admin/privacy` (Recht `core.privacy.export`, admin-gleich – vergeben nur
  Administrator*innen): Person suchen (Konten, auch deaktivierte, und Mitglieder über `subjectExport.findSubjects`), Export als
  JSON per Formular-POST (`/admin/privacy/export`, `no-store`). Inhalt: Konto, Rollen (auch aus Modulen), Sitzungen, API-Keys
  (ohne Schlüssel), persönliche Einstellungen, eigene Uploads (Metadaten), Audit-Einträge der Person (max. 5000, fremde
  Akteur*innen ohne ID) und je aktivem Modul `subjectExport.run` (members, actions, offices, galleries). Ein Konto schließt die
  verknüpften Mitglieder ein (`resolve`). Audit `core.privacy.exported` nur mit IDs/Zählern. Dateiinhalte sind nicht enthalten.
- Offen: `subjectExport` fehlt noch in `treasury` (Zahler, Rechnungen), `events`, `files`, `orders` – deren Daten fehlen im Export
  (`errors` bleibt leer, das Modul erscheint einfach nicht). Export unverschlüsselt (JSON); Herausgabe nur auf sicherem Weg.

## Uploads und Storage

Größenlimit (`core.storage.maxFileSizeMb`), Content-Type-Allowlist (HTML/SVG nur explizit), validierte Pfade (keine `..`, absolute oder Steuerzeichen), zufällige Objektschlüssel, Zugriff je Modul (`<modul>.storage.*`, nur für die Modul-Endpunkte mit Objektprüfung; die generische API `/api/v1/storage/*` verlangt `core.storage.manage`). S3-Zugangsdaten bleiben serverseitig; signierte URLs sind kurzlebig. Downloads sollten mit `Content-Disposition: attachment` ausgeliefert werden, um aktive Inhalte zu vermeiden.

### Gehärtete Datei-Antworten (#67, 01b-11)

- SDK-Helfer `secureFileResponse(body, { contentType, size, name, download, cache })` (`$lib/sdk/server`): `content-security-policy:
  default-src 'none'; sandbox`, `nosniff`, RFC-5987-Dateiname, aktive Typen (HTML, SVG, XHTML, XML, JavaScript) nie inline
  (`application/octet-stream` + `attachment`), inline nur Rasterbilder, PDF und Text. Genutzt von `orders`; `files` hat die gleiche
  Härtung bereits selbst (Vorbild).
- `assertContentMatches(bytes, contentType)` prüft Magic Bytes (Bilder, PDF, ZIP-basierte Office-Formate; HTML/SVG/Skript in Textdateien) → 422.
- Offen (Module waren zum Zeitpunkt der Umsetzung gesperrt): `members` (Dokumente, Gruppenbilder: Header + Magic Bytes), `actions`
  (Belege), `treasury` (Belege, Rechnungs-/Abrechnungs-PDFs), `galleries` (Bilddateien) auf die Helfer umstellen.
- Test: `tests/unit/sdk-file-response.test.ts`.

### Logo in PDFs nur aus dem Branding-Bereich (#67, 01a-08)

`core.design.logoFileId` ist leer oder eine UUID; `loadLogo` (`core/pdf/index.ts`) liest nur Dateien des Core-Bereichs `branding/`
(`readFileByIdUnchecked(id, { module: 'core', pathPrefix: 'branding/' })`). Fremde Datei-IDs (Mitglieds-/Galeriebilder) → kein Logo.
Test `tests/unit/pdf-logo-scope.test.ts`.

### Passwortsperre öffentlicher Datei-Links (#67, 01b-10)

`unlockLink` (`files/links.service.ts`) reserviert jeden Versuch **vor** der scrypt-Prüfung atomar (`UPDATE … SET failed_count = …
WHERE NOT gesperrt RETURNING`). Parallele Anfragen lassen so höchstens `MAX_UNLOCK_FAILURES` (10) Passwörter je Link und Stunde prüfen,
der Rest bekommt 429; Erfolg setzt den Zähler zurück. Test `files-sharing.test.ts` (`Promise.allSettled` mit 30 Versuchen).

## KI-Datenminimierung

Prompts und Antworten werden nicht gespeichert oder geloggt; `ai_usage` enthält nur Zähler (Tokens, Kosten, Modul, Modell). Modul-Allowlist, Modell-Allowlist, Rate Limit und Monatslimits begrenzen Verbrauch. Der API-Key verlässt den Server nie. Dateien werden nur mit den Rechten des aufrufenden Kontexts gelesen.

## Externe Empfänger (Übermittlung an Dritte, #69)

Grundlage für das Verzeichnis der Verarbeitungstätigkeiten (VVT). Alle Verbindungen gehen vom **Server** aus (der Browser der
Nutzer*innen spricht keine Dritten an); die Dienste sehen die Server-Adresse, nicht die der Person.

| Empfänger | Auslöser / Einstellung | Übertragene Daten | Hinweis in der Oberfläche |
|---|---|---|---|
| OpenPLZ API (`openplzapi.org`) | Adress-Autovervollständigung in `members` (`members.address.openPlzUrl`, leer = aus) | Straßenname, ggf. PLZ – keine Namen | Beschreibung der Einstellung (Einstellungen → Module → Mitglieder) |
| Photon (`photon.komoot.io`, OpenStreetMap) | Ersatz, wenn OpenPLZ nichts findet bzw. Land ≠ DE (`members.address.photonUrl`, leer = aus) | eingegebene Anschrift (Straße, Hausnummer, PLZ, Ort) – keine Namen | wie oben |
| KI-Anbieter (OpenAI-kompatibel, `core.ai.baseUrl`) | nur auf Knopfdruck in der **Schreibhilfe** (`POST /api/v1/ai/assist`, Recht `<modul>.ai.use`, Modul freigegeben über `core.ai.allowedModules`); nichts läuft automatisch | Text im Feld, Wunsch der Person, Eckdaten des verknüpften Objekts (z. B. Name/Zeitraum/Ort/Beitrag einer Aktion – **nie** Teilnehmende, Empfängerlisten, Gesundheits- oder Bankdaten); E-Mail-Adressen, Telefonnummern und IBANs vorher maskiert (`[E-Mail 1]` …) und danach lokal zurückgesetzt. Nur mit Einstellung: eingegangene Mail ohne Absender/Zitatverlauf (`core.ai.assist.allowInbox`), Galeriebild ohne Metadaten (`core.ai.assist.allowImages`) – beide Standard aus | Warnhinweis und Karte „Schreibhilfe“ auf `/admin/settings/ai`; Hinweis „Vorschlag der KI“ im Blatt |
| SMTP-Server (`core.smtp.*`) | jede Mail (Bestätigungen, Rechnungen, Erinnerungen, Benachrichtigungen) | Empfängeradresse, Betreff, Text, Anhänge (z. B. Rechnungs-PDF) | – (eigener bzw. beauftragter Mailserver) |
| SMTP-Server (Modul `messages`) | jede Nachricht an Mitglieder/Gruppen, einzeln je Empfänger | Empfängeradresse, Betreff, Text, Anhänge, frei wählbare Absender-/Antwortadresse (vom Server auf erlaubte Absender geprüft) | – (eigener bzw. beauftragter Mailserver) |
| IMAP-Server (Modul `messages`, `messages.imap.*`) | Abruf des Catch-all-Postfachs jede Minute (nur wenn eingeschaltet) | Zugangsdaten (Passwort verschlüsselt gespeichert, an Server/Port/Benutzer gebunden); empfangene Mails werden in der App gespeichert | Einstellungsbeschreibung (Einstellungen → Module → Nachrichten) |
| Web-Push-Dienste (Google FCM, Apple, Mozilla, Microsoft – je nach Browser der Person) | Push-Benachrichtigungen, nur für Personen, die Push im Profil auf einem Gerät aktiviert haben (`core.push.enabled`) | Titel und kurzer Text der Benachrichtigung, Link-Pfad – Ende-zu-Ende verschlüsselt (RFC 8291), der Dienst sieht nur Zeitpunkt, Größe und Geräte-Kennung | Reiter „Benachrichtigungen“ im Profil |
| S3-Speicher (`core.storage.*`) | Uploads (Belege, Bilder, Dateien, Profilbilder) | Dateiinhalte | – (eigener bzw. beauftragter Speicher) |
| Stammeswebsite (`website/`) | Kartenkacheln `tile.openstreetmap.org` erst nach Klick („Zwei-Klick-Karte“, #31) | IP-Adresse des Browsers der Besucher*in | Hinweis an der Karte und in der Datenschutzerklärung der Website |

- **AV-Vertrag**: für KI-Anbieter, Mail- und Speicherdienst (sofern nicht selbst betrieben) vor dem Einschalten abschließen; bei Anbietern
  außerhalb der EU zusätzlich eine Übermittlungsgrundlage (Angemessenheitsbeschluss bzw. Standardvertragsklauseln) prüfen.
- OpenPLZ/Photon erhalten keine personenbezogenen Daten im engeren Sinn (Anschrift ohne Person); zum Abschalten die URLs leeren.
- **Regel für künftige KI-Nutzung in Modulen**: keine Daten nach Art. 9 DSGVO (Gesundheit, Allergien, Medikamente …), keine Daten von Kindern,
  keine Kontaktdaten oder IBAN; Namen vor dem Senden durch Platzhalter ersetzen (Pseudonymisierung) und nach der Antwort lokal zurücksetzen;
  Nutzer*innen vor dem Senden sichtbar darauf hinweisen. Neue externe Empfänger in dieser Tabelle ergänzen.

## PDF

Inhalte werden HTML-escaped, JavaScript im Renderer deaktiviert, externe Netzwerkzugriffe blockiert, CSP-Meta im Dokument.

### PDF-Renderer: Chromium-Sandbox (#67, 01a-13)

- `PDF_CHROMIUM_SANDBOX` = `auto` (Standard) | `on` | `off` (`core/env.ts`, `chromiumLaunchAttempts` in `core/pdf/index.ts`). Playwright startet
  Chromium ohne `chromiumSandbox: true` **immer** mit `--no-sandbox`; jetzt wird die Sandbox ausdrücklich verlangt.
- `auto`: erst mit Sandbox; scheitert der Start (typisch: Docker mit Standard-seccomp, keine User-Namespaces), einmaliger Rückfall auf
  `--no-sandbox` mit Warnung im Log. `on`: nie ohne Sandbox (PDFs schlagen sonst fehl). `off`: ausdrücklich ohne Sandbox.
- **Empfehlung Produktion**: `PDF_CHROMIUM_SANDBOX=on` mit einem seccomp-Profil, das Chromium User-Namespaces erlaubt
  (`security_opt: seccomp=…` im Compose), oder den Renderer in einen eigenen Container auslagern.
- **Abwägung bei Rückfall bzw. `off`**: Der Renderer sieht nur selbst erzeugtes, escaptes HTML, JavaScript ist aus, Netzwerk gesperrt, der
  Prozess läuft als Benutzer `app` (UID 10001) mit `cap_drop: ALL`. Ein Chromium-Parserfehler (z. B. in einem hochgeladenen Bild) führt dann
  aber direkt zu Codeausführung **im App-Container** (Zugriff auf `APP_SECRET`, Datenbank). Restrisiko bewusst getragen, bis Profil oder
  eigener Container umgesetzt sind.
- Test `tests/unit/pdf-sandbox.test.ts`; lokal (Windows) mit Sandbox geprüft.

### Veröffentlichen von Terminen (#67, 01b-06)

`events.event.publish`: Nur damit lässt sich `onWebsite` beim Anlegen setzen oder von „nein“ auf „ja“ ändern (sonst 403), Audit
`events.event.published`/`unpublished`. Zurücknehmen und Bearbeiten bereits veröffentlichter Termine bleibt mit edit möglich. Neue Rechte
erhält nur „Administrator“ – Rollen, die bisher veröffentlicht haben, brauchen das Recht ausdrücklich. Galerien: Team Privacy (#27).
Test `events.test.ts` → „Veröffentlichen auf der Website“.

### Stammeswebsite (#67, 01b-13)

`website/svelte.config.js` `kit.csp` (Modus `auto`): `default-src 'self'`, `script-src 'self'` (+ Nonces), `style-src 'self' 'unsafe-inline'`,
`img-src 'self' data: blob: https://*.tile.openstreetmap.org`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`.
`website/src/lib/server/security-headers.ts` (aus `hooks.server.ts`): `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`nosniff`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS bei HTTPS, Minimal-CSP für Antworten ohne CSP (Bild-Proxy).
Test `tests/unit/website-security-headers.test.ts`.

## Einstellungen: Ziel-gebundene Secrets, Schreibrechte, Atomarität

- **Secrets folgen ihrem Ziel** (`SECRET_BINDINGS` in `core/settings/catalog.ts`): Ändert sich `core.smtp.host|port|user`, wird
  `core.smtp.password` gelöscht; `core.ai.baseUrl` → `core.ai.apiKey`; `core.storage.endpoint` → `core.storage.accessKeyId` und
  `core.storage.secretAccessKey` – außer das Secret wird **im selben Speichervorgang** neu gesetzt. Gleicher Wert (Formular sendet alle Felder)
  zählt nicht als Änderung. Die Oberfläche meldet „… wurde verworfen – bitte neu eingeben“; Audit `core.settings.changed` mit
  `{ secret: true, cleared: true, reason: 'target-changed' }`. So lässt sich ein gespeichertes Passwort/API-Key nicht an einen eigenen Server
  umleiten (SSRF/Abgreifen trotz `core.settings.manage`).
- **SMTP-TLS**: Port 465 ⇒ `secure` (TLS direkt); mit Anmeldung sonst `requireTLS` (STARTTLS Pflicht, sonst Abbruch). Ohne Anmeldung
  (lokales Relay, Demo-Mailserver) bleibt TLS optional. SMTP-Benutzer ohne Passwort ⇒ 503 „SMTP ist nicht konfiguriert“.
- **Testmail-Fehler** werden generisch gemeldet („Details stehen im Server-Protokoll“), der Fehlertext (Host, Port, Serverantwort) nur
  ins Server-Log – kein Dienst-/Portscan über die Oberfläche. Storage-Test meldete schon nur generische Texte.
- **Schreibrecht je Einstellung** (`writePermission`, siehe `permissions.md`): `treasury.*` über `PUT /api/v1/settings` braucht
  `treasury.settings.manage` (sonst 403, nichts geändert).
- **Atomar**: `setSettings(ctx, values)` prüft erst alle Schlüssel (Existenz, Recht, Schema), schreibt dann in **einer** Transaktion,
  Audit danach. Höchstens 100 Schlüssel je Aufruf (422). `null` setzt auf den Standardwert zurück, aber nur, wenn danach ein gültiger
  Wert gilt (Secret, Schema mit `null` oder gültiger Standard) – sonst 422.
- Offen: keine Sperrliste privater/Link-Local-Adressen für `ai.baseUrl`/Storage-Endpoint (selbst gehostete Dienste im Docker-Netz sind
  der Normalfall); wer `core.settings.manage` hat, kann weiterhin interne Ziele *ohne* gespeicherte Secrets ansprechen.

## Pflicht-Export vor dem Zurücksetzen (verschlüsselt)

- `exportResetData` (`core/system/reset.ts`) erzeugt seit 2026-10-20 **kein Klartext-JSON** mehr, sondern eine verschlüsselte Sicherung
  im Format der Datensicherung (`.epbackup`, scrypt + AES-256-GCM, `writeBackupFile` aus `core/backup/export.ts`). Pflichtfeld
  **Sicherungs-Passwort** (≥ 12 Zeichen, auf `/admin/reset` zweimal einzugeben); Passwort + ggf. TOTP wie bisher.
- Umfang: Core-Reset-Bereiche = gleichnamige Sicherungsbereiche (`core:users` …), Modul-Bereiche (`<modul>:<teil>`) ⇒ **ganzes Modul**
  (Obermenge, damit die Datei mit dem normalen Import wiederherstellbar ist). Dateiinhalte sind nicht enthalten (wie zuvor). Secrets der
  gewählten Bereiche stehen – wie in jeder Datensicherung – nur verschlüsselt in der Datei.
- Wiederherstellen über `/admin/backup` → Import (braucht `core.system.backup`). Audit `core.system.reset_exported` mit `encrypted: true`.

## Bekannte Einschränkungen

- Rate Limiter und Login-Sperre sind prozesslokal und gehen bei Neustart verloren; Mehr-Instanz-Betrieb benötigt einen gemeinsamen Store.
- Keine automatische Secret-Rotation.
- Audit-Log ist nicht manipulationssicher gegenüber Datenbank-Superusern (Trigger ließe sich entfernen); kein Hash-Chaining.
- Modul-Schemaisolation ist eine Konvention auf Basis von `search_path`, kein Sicherheitsmechanismus und kein Datenbank-Rollenmodell: Core-Tabellen
  und fremde Modulschemas sind nur **unqualifiziert** unerreichbar, schemaqualifizierte Zugriffe wären möglich. Module sind vertrauenswürdiger Code.
  ESLint meldet in `src/lib/modules/**` direkte Zugriffe auf Core-Interna (`core.database.db`, `core.database.transaction`, `core.system`,
  `core.modules.enable|disable`, `core.auth.instance`, `forModule` mit fremdem String-Literal) – nur statisch erkennbare Fälle, Code-Review bleibt nötig.
- Chromium im Container ohne seccomp-Profil fällt bei `PDF_CHROMIUM_SANDBOX=auto` auf `--no-sandbox` zurück (siehe „PDF-Renderer“).
- Kein Virenscan für Uploads.

## Härtungs-Checkliste

- [ ] HTTPS erzwungen, `ORIGIN` mit `https://`, HSTS aktiv
- [ ] `APP_SECRET` zufällig (≥ 32 Zeichen), sicher gesichert, nicht im Repository
- [ ] `INITIAL_ADMIN_*` nach dem ersten Start entfernt, Admin-Passwort geändert, 2FA für Administratoren aktiviert
- [ ] `ADDRESS_HEADER`/`XFF_DEPTH` passend zum Proxy
- [ ] Datenbank nicht öffentlich erreichbar (kein Port-Publish)
- [ ] S3-Bucket privat, minimale IAM-Rechte, CORS nur für `ORIGIN`
- [ ] Regelmäßige Backups (DB, Objektspeicher) inkl. Restore-Test
- [ ] Least-Privilege-Rollen und API-Key-Scopes, kurze Key-Laufzeiten
- [ ] Audit-Logs regelmäßig prüfen
- [ ] Abhängigkeiten aktualisieren (`npm audit`)
