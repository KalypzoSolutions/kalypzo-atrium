# Rollen und Berechtigungen

## Modell (RBAC)

- **Berechtigung**: Schlüssel `modul.ressource.aktion` (Regex `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`), registriert durch Core oder Module in Tabelle `permission`.
- **Rolle**: benannte Menge von Berechtigungen (`role`, `role_permission`).
- **Benutzer**: beliebig viele Rollen (`user_role`) und zusätzlich **Einzelrechte direkt am Benutzer** (`user_permission`);
  wirksame Rechte = Vereinigung aus Rollen, Modul-Verleihungen und Einzelrechten.
- Nur Berechtigungen **aktiver** Module (und des Core) sind wirksam.
- Durchsetzung ausschließlich serverseitig (`core.permissions.require`, API-Router, Load/Actions). Die UI blendet nur aus.

## Core-Berechtigungen

| Schlüssel | Bedeutung |
|---|---|
| `core.users.view` | Benutzer ansehen |
| `core.users.create` | Benutzer anlegen |
| `core.users.edit` | Benutzer bearbeiten und deaktivieren |
| `core.users.delete` | Benutzer löschen |
| `core.roles.view` | Rollen und Berechtigungen ansehen |
| `core.roles.create` | Rollen anlegen |
| `core.roles.edit` | Rollen bearbeiten |
| `core.roles.delete` | Rollen löschen |
| `core.roles.assign` | Rollen an Benutzer zuweisen |
| `core.modules.view` | Module ansehen |
| `core.modules.manage` | Module aktivieren und deaktivieren |
| `core.jobs.manage` | Hintergrundjobs ansehen und manuell auslösen (`GET /api/v1/jobs`, `POST /api/v1/jobs/:key/run`) |
| `core.settings.view` | Systemeinstellungen ansehen |
| `core.settings.manage` | Systemeinstellungen verwalten |
| `core.api.view` | API-Keys ansehen |
| `core.api.manage` | API-Keys verwalten |
| `core.storage.read` | Dateien im Core-Speicherbereich lesen |
| `core.storage.write` | Dateien im Core-Speicherbereich schreiben |
| `core.storage.delete` | Dateien im Core-Speicherbereich löschen |
| `core.storage.manage` | Storage konfigurieren und alle Speicherbereiche verwalten |
| `core.pdf.generate` | PDF-Dokumente erzeugen (per API) |
| `core.pdf.manage` | PDF-Vorlagen konfigurieren |
| `core.ai.use` | KI-Dienst im Core-Kontext nutzen |
| `core.ai.manage` | KI-Dienst konfigurieren |
| `core.ai.view` | KI-Nutzung ansehen |
| `core.audit.view` | Audit-Logs ansehen |
| `core.system.reset` | Datenbereiche zurücksetzen (`/admin/reset`: Vorschau, Passwort, Pflicht-Export, Bestätigungswort) – **admin-gleich** |
| `core.system.backup` | Datensicherung: Gesamt-Export (verschlüsselt, inkl. Zugangsdaten) und Import (`/admin/backup`) – **admin-gleich** |
| `core.privacy.export` | Datenauskunft (Art. 15/20 DSGVO, `/admin/privacy`): alle Daten einer Person aus allen Modulen exportieren (inkl. Gesundheitsdaten) – **admin-gleich** |

Quelle: `CORE_PERMISSIONS` in `src/lib/server/core/permissions/catalog.ts`; die Tabelle muss jeden Schlüssel enthalten.

### Rolle „Mitglied“ und Standard-Rollenrechte

Konten, die über den Verknüpfungslink des Moduls `members` entstehen (`core.users.registerWithRole`), bekommen die Rolle **„Mitglied“**. Sie wird
über `defaultRoleGrants` der Module angelegt (Standardrolle mit Kennung `default:Mitglied`, kein System). Bei aktiven Modulen erhält sie:

| Modul | Recht | Wirkung |
|---|---|---|
| `members` | `members.own.view` | eigene verknüpfte Mitglieder sehen (Profil „Meine Mitglieder“) |
| `members` | `members.own.edit` | Kontakte, Zusatzfelder und Mail-Einstellungen dieser Mitglieder ändern (setzt `.view` voraus) |
| `actions` | `actions.own.view` | eigene Anmeldungen (Dashboard „Meine Anmeldungen“, `GET /my/registrations`) |
| `treasury` | `treasury.own.view` | eigene offene Rechnungen (Dashboard „Meine offenen Rechnungen“, `GET /my/invoices`) |
| `events` | `events.event.view` | Termine ansehen (eigene und freigegebene) |
| `galleries` | `galleries.gallery.view` | Galerien ansehen (eigene, freigegebene, öffentliche) |
| `files` | `files.file.view` | eigene Dateien ablegen und Freigegebenes sehen |
| `orders` | `orders.order.view`, `orders.order.create` | eigene Bestellungen sehen und für verknüpfte Mitglieder bestellen |

Weitere Standardrollen: **„Amtsinhaber*in“** (`offices`: `offices.office.view`, wird Inhaber*innen über Ämter verliehen) und
**„Kämmerer*in“** (`orders`: `orders.order.view`, `orders.order.create`, `orders.order.manage`, `orders.article.manage`, `orders.stock.manage`).
Quelle: `defaultRoleGrants` in `src/lib/modules/*/module.ts`. Die Vergabe geschieht **einmalig** je
(Modul, Rolle, Recht) (Tabelle `role_grant_applied`): ein bewusst entzogenes Recht kommt nicht zurück. Administrator*innen können die Rolle danach
wie jede andere bearbeiten.

Modulberechtigungen kommen aus den Manifesten (`<modul>.…`), siehe [Modulentwicklung](module-development.md).

### Rollen aus Modulen (z. B. Ämter)

Neben manuell zugewiesenen Rollen (`user_role`) können **Module** Rollen verleihen (Core-Tabelle `user_role_grant`, Spalte `module_id`). Erster Nutzer ist das Modul `offices`: Inhaber*innen eines Amts erhalten die mit dem Amt verknüpften Rollen und zusätzlich die Rolle „Amtsinhaber*in“ (`offices.office.view`).

- Verliehene Rollen zählen zu den Rechten (`getUserPermissions`) und zu `core.users.roleIds` (z. B. Freigaben an Rollen) – aber **nur, solange das verleihende Modul aktiv ist**.
- Manuelle Rollen bleiben unberührt: Wer eine Rolle manuell **und** über ein Amt hat, behält sie beim Entfernen aus dem Amt.
- Benutzer- oder Rollenlöschung entfernt die Verleihungen (Fremdschlüssel mit CASCADE).
- Module ersetzen ihre Verleihungen nur gesammelt über `core.roles.replaceModuleGrants` und prüfen vorher mit `core.roles.assertCanGrant` (siehe unten).

### Einzelrechte am Benutzer

- Verwaltung unter `/admin/users` (Anlegen/Bearbeiten, Abschnitt „Einzelne Berechtigungen“) oder per API
  (`permissionKeys` bei `POST /users` und `PATCH /users/:id`; `undefined` = unverändert, Liste ersetzt die Menge).
- Gleiche Regeln wie bei Rollen: Recht `core.roles.assign`, Zielkonto höchstens mit eigenen Rechten (`assertCanManageUser`),
  nur selbst besessene Rechte vergeben/entziehen, admin-gleiche nur Administrator*innen (`assertCanGrant`), eigene Einzelrechte
  nicht selbst entziehen (409), unbekannte Schlüssel 400. Änderung atomar mit Name/E-Mail/Status/Rollen; Audit `core.user.permissions_changed`.
- Modulrechte wirken nur bei aktivem Modul. Benutzer löschen entfernt die Zeilen (CASCADE). Backup/Reset: Bereich `core:users`
  bzw. Reset-Bereich „Benutzer“; Datenauskunft nennt sie als `directPermissions`.

## Systemrolle Administrator

Die Rolle `Administrator` (ID `role_administrator`, `isSystem`) wird beim Start angelegt; neue Berechtigungen werden ihr automatisch zugeordnet. Es gibt **kein Wildcard-Recht**: Der Administrator besitzt konkret alle registrierten Berechtigungen. Systemrollen können weder umbenannt, noch in ihren Rechten geändert, noch gelöscht werden. Der erste Administrator entsteht über `INITIAL_ADMIN_EMAIL/PASSWORD`.

## Schutz vor Rechteausweitung

- **Vergabe**: Nur Berechtigungen, die der Handelnde selbst besitzt, dürfen einer Rolle oder einem API-Key zugewiesen werden (`assertCanGrant`).
- **Rollenänderung/-löschung**: Wer eine Rolle bearbeitet oder löscht, muss alle ihre Berechtigungen selbst besitzen.
- **Zuweisung an Benutzer**: `core.roles.assign` plus Besitz aller Rechte der zugewiesenen/entzogenen Rolle.
- Eigene Rollen können nicht entzogen werden; der **letzte aktive Administrator** kann weder deaktiviert, gelöscht noch seiner Rolle beraubt werden; Selbstdeaktivierung/-löschung ist gesperrt.
- API-Keys können keine API-Keys erzeugen; Key-Verwaltung ist `sessionOnly`.
- **Rollen über Module** (z. B. Ämter): Wer Personen eines Amts zuordnet/entfernt oder ein besetztes Amt löscht, braucht alle Rechte der Amt-Rollen und der Rolle „Amtsinhaber*in“; wer Rollen eines Amts verknüpft oder löst (auch bei unbesetztem Amt), braucht die Rechte der geänderten Rollen (sonst 403).

## API-Key-Scopes

Scopes sind Berechtigungsschlüssel. Wirksame Rechte eines Keys = **Scopes ∩ aktuelle Rechte des Besitzers**. Verliert der Besitzer eine Berechtigung (Rolle entzogen, Benutzer deaktiviert, Modul deaktiviert), verliert der Key sie sofort. Scopes müssen existieren und vom Ersteller selbst gehalten werden.

## Admin-gleiche (privilegierte) Rechte

Manche Rechte führen faktisch zur Übernahme des ganzen Systems und gelten deshalb als **admin-gleich**
(`PRIVILEGED_PERMISSIONS` in `src/lib/server/core/permissions/catalog.ts`):

| Recht | Warum admin-gleich |
|---|---|
| `core.system.backup` | Gesamt-Export aller Daten inkl. Zugangsdaten; Import einer (mit dem eigenen Passwort entschlüsselbaren, also veränderbaren) Sicherung |
| `core.system.reset` | Löschen beliebiger Datenbereiche inkl. Konten und Rollen; Pflicht-Export enthält alle betroffenen Daten |
| `core.privacy.export` | Liest sämtliche Daten einer Person aus allen Modulen, auch Gesundheitsdaten |

Regeln:

- **Vergabe nur durch Administrator*innen** – beim Anlegen/Bearbeiten/Löschen einer Rolle, beim Zuweisen einer Rolle an Benutzer*innen,
  bei API-Key-Scopes und bei Rollen über Module (Ämter). Umgesetzt zentral in `assertCanGrant` (`permissions/service.ts`), daher gilt es
  für alle Wege ohne eigene Prüfung. Sonst 403 „Admin-gleiche Berechtigungen dürfen nur Administrator*innen vergeben“.
- **Administrator*in** = Systemkontext oder wer **sämtliche Core-Rechte** wirksam besitzt (`isAdministrator`; die Rolle „Administrator“
  hat sie immer). Ein API-Key mit eingeschränkten Scopes zählt nicht. Wer alle Core-Rechte hat, kann ohnehin alles – die Regel
  verhindert, dass ein *delegiertes* Sicherungs- oder Reset-Recht weitergegeben wird.
- Nicht-Admins können Rollen mit einem admin-gleichen Recht nur **ansehen** (nicht bearbeiten/löschen/zuweisen).
- `/admin/roles` kennzeichnet diese Rechte mit dem Badge **„Admin-gleich“** (auch an Rollen-Karten) und zeigt im Dialog einen Warnhinweis.
- **Datensicherung durch Nicht-Admins** (Altbestand, falls das Recht früher delegiert wurde): Die Bereiche `core:users`, `core:roles`,
  `core:api-keys` und `offices` (Rollen-Verleihungen) sind beim Wiederherstellen **und** Zusammenführen gesperrt
  (`ADMIN_ONLY_RESTORE_SCOPES` in `backup/access.ts`). Ein Restore verleiht der ausführenden Person nie zusätzliche Rollen: Im Fall `kept`
  (eigenes Konto nicht in der Sicherung) und wenn das Sicherungsrecht danach fehlt, werden nur ihre **bisherigen** Rollen wieder zugeordnet –
  nicht mehr pauschal die Administrator-Rolle (dann nur Warnung).
- Bewusst **nicht** admin-gleich: `core.roles.*` (Vergabe bleibt auf eigene Rechte beschränkt), `core.settings.manage`
  (Secrets lassen sich nicht mehr an fremde Ziele umleiten, siehe `security.md`), `core.users.*` (Schutz über `assertCanManageUser`).
- Restrisiko: Wer bereits ein delegiertes Sicherungsrecht hat, kann Moduldaten (z. B. Kasse, Mitglieder) aus einer veränderten Sicherung
  einspielen. Das Recht daher nur Administrator*innen geben.

## Schreibrecht für Einstellungen

Jede globale Einstellung hat ein Schreibrecht (`SettingDefinition.writePermission`), geprüft zentral in `setSettings`/`setSetting`
(auch über `PUT /api/v1/settings`):

- Core-Schlüssel: `core.settings.manage`.
- Modul-Schlüssel: `ModuleSettingDefinition.writePermission`, sonst **`<modul>.settings.manage`, wenn das Modul dieses Recht deklariert**
  (heute nur `treasury` → Bankverbindung und Mailtexte der Kasse), sonst `core.settings.manage` (bestehende Formulare unter
  Einstellungen → Module bleiben unverändert).
- Der Systemkontext darf alles (z. B. Kassen-Endpunkt, der `treasury.settings.manage` selbst prüft).
