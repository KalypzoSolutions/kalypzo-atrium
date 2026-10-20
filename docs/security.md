# Sicherheitskonzept

## Authentifizierung und Sessions

- Better Auth, E-Mail/Passwort; Registrierung ist deaktiviert (`disableSignUp`), Benutzer werden nur administrativ angelegt.
- Passwörter: 12–128 Zeichen, Hashing durch Better Auth (Standard-Hashing von Better Auth, derzeit scrypt; nicht im Projektcode konfiguriert).
- Sessions: 7 Tage, Erneuerung nach 1 Tag, Cookies `HttpOnly`, `SameSite=Lax`, `Secure` bei HTTPS-`ORIGIN`. Session-Übersicht und -Widerruf im Profil.
- Optionale 2FA (TOTP, Backup-Codes).
- Passwort-Reset per E-Mail (Link 1 Stunde gültig, danach werden alle Sessions widerrufen); die Antwort verrät nicht, ob ein Konto existiert.
- Deaktivierte Benutzer: Anmeldung wird in `databaseHooks.session.create` abgelehnt, bestehende Sessions werden gelöscht, `resolveSession` liefert `null`.

## Brute-Force-Schutz

- Better-Auth-Rate-Limits: `/sign-in/email` 10/min, Passwort-Reset 5/5 min, TOTP 10/min, sonst 100/min.
- Zusätzliche Kontosperre: ab 5 Fehlversuchen je E-Mail in 15 min wird die Anmeldung blockiert (Audit `core.auth.login_blocked`); Erfolg setzt den Zähler zurück.

## CSRF

- SvelteKit-Origin-Prüfung für Formulare.
- API: Session-authentifizierte schreibende Requests müssen `Origin == ORIGIN` (oder `Sec-Fetch-Site: same-origin/none`) haben; API-Key-Requests sind nicht cookie-basiert.

## Header und CSP

`svelte.config.js` (`kit.csp`, Modus `auto` mit Nonces/Hashes): `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`. Zusätzlich `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS bei HTTPS. Keine Inline-Skripte (Theme per Cookie serverseitig).

## Autorisierung

Zentral und serverseitig: `core.permissions.require`, API-Router, Services. Schutz vor Rechteausweitung, Last-Admin-Schutz, API-Key-Rechte = Scopes ∩ Besitzer (siehe [Permissions](permissions.md)). Deaktivierte Module sind per UI und API nicht erreichbar.

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
Die E-Mail-Adresse neuer Konten wird nicht verifiziert (`emailVerified: true` wie bei Admin-Anlage).

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

Beim Tippen einer Adresse sendet **unser Server** (nicht der Browser) den Suchtext an den in `members.address.photonUrl` konfigurierten
Photon-Dienst (Standard: `photon.komoot.io`, OpenStreetMap). Es werden nur Straße/Ort-Fragmente übertragen, keine Namen oder Kontodaten.
Timeout 3 s, Fehler brechen das Formular nicht. Zum Abschalten oder für eine eigene Instanz die Einstellung leeren bzw. ändern.

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

## Uploads und Storage

Größenlimit (`core.storage.maxFileSizeMb`), Content-Type-Allowlist (HTML/SVG nur explizit), validierte Pfade (keine `..`, absolute oder Steuerzeichen), zufällige Objektschlüssel, Zugriff je Modul (`<modul>.storage.*`). S3-Zugangsdaten bleiben serverseitig; signierte URLs sind kurzlebig. Downloads sollten mit `Content-Disposition: attachment` ausgeliefert werden, um aktive Inhalte zu vermeiden.

## KI-Datenminimierung

Prompts und Antworten werden nicht gespeichert oder geloggt; `ai_usage` enthält nur Zähler (Tokens, Kosten, Modul, Modell). Modul-Allowlist, Modell-Allowlist, Rate Limit und Monatslimits begrenzen Verbrauch. Der API-Key verlässt den Server nie. Dateien werden nur mit den Rechten des aufrufenden Kontexts gelesen.

## PDF

Inhalte werden HTML-escaped, JavaScript im Renderer deaktiviert, externe Netzwerkzugriffe blockiert, CSP-Meta im Dokument. Chromium läuft mit `--no-sandbox`; die Isolation übernimmt der Container (nicht-root, `cap_drop: ALL`).

## Bekannte Einschränkungen

- Rate Limiter und Login-Sperre sind prozesslokal und gehen bei Neustart verloren; Mehr-Instanz-Betrieb benötigt einen gemeinsamen Store.
- Keine automatische Secret-Rotation.
- Audit-Log ist nicht manipulationssicher gegenüber Datenbank-Superusern (Trigger ließe sich entfernen); kein Hash-Chaining.
- Modul-Schemaisolation ist eine Konvention auf Basis von `search_path`, kein Datenbank-Rollenmodell; Module sind vertrauenswürdiger Code.
- Chromium im Container mit `--no-sandbox`.
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
