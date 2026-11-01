/**
 * Bewusste Ausnahmen des i18n-Wächters (`i18n-guard.test.ts`): Datei + Text (Anfang genügt) + Grund.
 * Jede Ausnahme braucht einen Grund; Eigennamen, Beispielwerte in Feldern und Rechtstexte Dritter sind typische Fälle.
 */
export const I18N_ALLOWLIST: { file: string; text: string; reason: string }[] = [
	{
		file: 'src/lib/backup/contract.ts',
		text: 'ZUSAMMENFÜHREN',
		reason: 'deutsches Bestätigungswort, gilt in jeder Sprache'
	},
	{
		file: 'src/lib/server/core/system/reset.ts',
		text: 'ZURÜCKSETZEN',
		reason: 'deutsches Bestätigungswort, gilt in jeder Sprache'
	},
	{
		file: 'src/lib/components/forms/FieldEditor.svelte',
		text: 'placeholder="https://…"',
		reason: 'Formatbeispiel'
	},
	{
		file: 'src/lib/components/ui/color-picker/color-picker.svelte',
		text: 'placeholder="#rrggbb"',
		reason: 'Formatbeispiel'
	},
	{
		file: 'src/lib/components/layout/CommandPalette.svelte',
		text: 'Esc',
		reason: 'Tastenbeschriftung'
	},
	{
		file: 'src/lib/server/core/auth/mask-email.ts',
		text: '[ungültig]',
		reason: 'gespeicherter Audit-Wert, kein Oberflächentext'
	},
	{
		file: 'src/lib/server/core/modules/validate.ts',
		text: 'Gegenseitige Modulkopplung',
		reason: 'nur console.warn beim Start'
	},
	{
		file: 'src/lib/server/core/pdf/index.ts',
		text: '<!doctype html>',
		reason: 'HTML-Gerüst ohne sichtbaren Text'
	},
	{
		file: 'src/lib/server/core/pdf/templates.ts',
		text: '\n\t\t* { box-sizing',
		reason: 'CSS-Vorlage baseCss (Wächter erkennt „font-size“ fälschlich als Text)'
	},
	{
		file: 'src/lib/server/core/settings/catalog.ts',
		text: 'freundlich und klar',
		reason: 'Standardwert der Einstellung (vom Admin änderbar)'
	},
	{
		file: 'src/lib/server/core/settings/catalog.ts',
		text: 'Viele Grüße',
		reason: 'Standardwert der Einstellung (vom Admin änderbar)'
	},
	{
		file: 'src/routes/(internal)/admin/api/docs/+page.svelte',
		text: 'OpenAPI (JSON)',
		reason: 'Eigenname'
	},
	{
		file: 'src/routes/(internal)/admin/api/docs/+page.svelte',
		text: 'multipart',
		reason: 'technischer Begriff'
	},
	{
		file: 'src/routes/(internal)/admin/api/docs/ApiConsole.svelte',
		text: '$EPK_KEY',
		reason: 'Variablenname im Codebeispiel'
	},
	{
		file: 'src/routes/(internal)/admin/api/docs/ErrorsTable.svelte',
		text: 'details',
		reason: 'JSON-Feldname'
	},
	{
		file: 'src/routes/(internal)/admin/api/docs/ErrorsTable.svelte',
		text: 'path',
		reason: 'JSON-Feldname'
	},
	{
		file: 'src/routes/(internal)/admin/api/docs/ErrorsTable.svelte',
		text: 'message',
		reason: 'JSON-Feldname'
	},
	{
		file: 'src/routes/(internal)/admin/api/docs/ResponsePanel.svelte',
		text: 'x-request-id',
		reason: 'Headername'
	},
	{
		file: 'src/routes/(internal)/admin/api/docs/ResponsePanel.svelte',
		text: 'x-ratelimit-remaining',
		reason: 'Headername'
	},
	{
		file: 'src/routes/(internal)/admin/audit/+page.svelte',
		text: 'placeholder="core.user"',
		reason: 'Formatbeispiel (Aktionspräfix)'
	},
	{
		file: 'src/routes/(internal)/admin/modules/install/+page.svelte',
		text: 'atrium-modules.json',
		reason: 'Dateiname'
	},
	{
		file: 'src/routes/(internal)/admin/modules/install/+page.svelte',
		text: 'placeholder="https://github.com/…"',
		reason: 'URL-Beispiel'
	},
	{
		file: 'src/routes/(internal)/admin/settings/pdf/+page.svelte',
		text: 'src/lib/server/core/pdf/templates/',
		reason: 'Code-Pfad'
	},
	{
		file: 'src/service-worker.ts',
		text: 'Erneuertes Gerät',
		reason: 'Service Worker ohne Textkatalog: wählt per navigator.language zwischen de/en'
	}
];
