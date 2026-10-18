# Rollen und Berechtigungen

## Modell (RBAC)

- **Berechtigung**: Schlüssel `modul.ressource.aktion` (Regex `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`), registriert durch Core oder Module in Tabelle `permission`.
- **Rolle**: benannte Menge von Berechtigungen (`role`, `role_permission`).
- **Benutzer**: beliebig viele Rollen (`user_role`); wirksame Rechte = Vereinigung.
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
| `core.modules.manage` | Module aktivieren/deaktivieren |
| `core.settings.view` | Systemeinstellungen ansehen |
| `core.settings.manage` | Systemeinstellungen verwalten |
| `core.api.view` | API-Keys ansehen |
| `core.api.manage` | API-Keys verwalten |
| `core.storage.read` / `write` / `delete` | Dateien im Core-Speicherbereich |
| `core.storage.manage` | Storage konfigurieren; alle Speicherbereiche verwalten |
| `core.pdf.generate` | PDF per API erzeugen |
| `core.pdf.manage` | PDF-Vorlagen konfigurieren |
| `core.ai.use` | KI im Core-Kontext nutzen |
| `core.ai.manage` | KI konfigurieren |
| `core.ai.view` | KI-Nutzung ansehen |
| `core.audit.view` | Audit-Logs ansehen |

### Rolle „Mitglied“ und Standard-Rollenrechte

Konten, die über den Verknüpfungslink des Moduls `members` entstehen (`core.users.registerWithRole`), bekommen die Rolle **„Mitglied“**. Sie wird
über `defaultRoleGrants` des Moduls angelegt (kein System) und erhält `members.own.view` (eigene verknüpfte Mitglieder sehen) und `members.own.edit`
(Kontakte, Zusatzfelder und Mail-Einstellungen dieser Mitglieder ändern; setzt `.view` voraus). Die Vergabe geschieht **einmalig** je
(Modul, Rolle, Recht) (Tabelle `role_grant_applied`): ein bewusst entzogenes Recht kommt nicht zurück. Administrator*innen können die Rolle danach
wie jede andere bearbeiten.

Modulberechtigungen kommen aus den Manifesten (`<modul>.…`), siehe [Modulentwicklung](module-development.md).

## Systemrolle Administrator

Die Rolle `Administrator` (ID `role_administrator`, `isSystem`) wird beim Start angelegt; neue Berechtigungen werden ihr automatisch zugeordnet. Es gibt **kein Wildcard-Recht**: Der Administrator besitzt konkret alle registrierten Berechtigungen. Systemrollen können weder umbenannt, noch in ihren Rechten geändert, noch gelöscht werden. Der erste Administrator entsteht über `INITIAL_ADMIN_EMAIL/PASSWORD`.

## Schutz vor Rechteausweitung

- **Vergabe**: Nur Berechtigungen, die der Handelnde selbst besitzt, dürfen einer Rolle oder einem API-Key zugewiesen werden (`assertCanGrant`).
- **Rollenänderung/-löschung**: Wer eine Rolle bearbeitet oder löscht, muss alle ihre Berechtigungen selbst besitzen.
- **Zuweisung an Benutzer**: `core.roles.assign` plus Besitz aller Rechte der zugewiesenen/entzogenen Rolle.
- Eigene Rollen können nicht entzogen werden; der **letzte aktive Administrator** kann weder deaktiviert, gelöscht noch seiner Rolle beraubt werden; Selbstdeaktivierung/-löschung ist gesperrt.
- API-Keys können keine API-Keys erzeugen; Key-Verwaltung ist `sessionOnly`.

## API-Key-Scopes

Scopes sind Berechtigungsschlüssel. Wirksame Rechte eines Keys = **Scopes ∩ aktuelle Rechte des Besitzers**. Verliert der Besitzer eine Berechtigung (Rolle entzogen, Benutzer deaktiviert, Modul deaktiviert), verliert der Key sie sofort. Scopes müssen existieren und vom Ersteller selbst gehalten werden.
