/**
 * Wächter (Phase N): Der Core enthält keine fest eingetragenen Oberflächentexte mehr – alles läuft über
 * `t()` aus `$lib/i18n` mit Texten in `src/lib/i18n/messages/{de,en}/*.json`. Einzelne Bereiche prüfen:
 * `I18N_GUARD_PATHS=src/routes/login npx vitest run tests/unit/i18n-guard.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { I18N_ALLOWLIST } from './i18n-allowlist';
import { isVisibleText, looksGerman, scanCore, scanSvelte, scanTs } from './i18n-scan';

describe('i18n-Wächter: Erkennung', () => {
	it('erkennt deutsche Texte und lässt Bezeichner in Ruhe', () => {
		expect(looksGerman('Speichern')).toBe(true);
		expect(looksGerman('Datei nicht gefunden')).toBe(true);
		expect(looksGerman('Größe')).toBe(true);
		expect(looksGerman('core.users.view')).toBe(false);
		expect(looksGerman('flex items-center gap-2')).toBe(false);
		expect(looksGerman('application/json')).toBe(false);
		expect(isVisibleText('PDF')).toBe(false);
		expect(isVisibleText(' · ')).toBe(false);
		expect(isVisibleText('Abbrechen')).toBe(true);
	});

	it('findet Texte in Svelte-Markup, Attributen und Ausdrücken, nicht in t()', () => {
		const src = `<script lang="ts">
	import { t } from '$lib/i18n';
	const a = 'Bitte warten';
	const b = t('x.y');
</script>
<button title="Schließen">Abbrechen</button>
<p>{busy ? 'Speichert …' : t('x.save')}</p>
<p class="text-xs">{t('x.ok')}</p>`;
		const texts = scanSvelte(src, 'x.svelte').map((f) => f.text);
		expect(texts).toEqual(['Bitte warten', 'title="Schließen"', 'Abbrechen', 'Speichert …']);
	});

	it('ignoriert Importe, Schlüssel, Error, console und Vergleiche', () => {
		const src = `import x from './Größe';
const o = { 'Größe': 1 };
console.log('nicht gefunden');
throw new Error('Programmierfehler: kein Modul');
if (v === 'gelöscht') {}
const m = 'Mitglied nicht gefunden';`;
		expect(scanTs(src, 'x.ts').map((f) => f.text)).toEqual(['Mitglied nicht gefunden']);
	});
});

describe('i18n-Wächter: Core', () => {
	it('keine fest eingetragenen Texte (außer Ausnahmen)', () => {
		const allowed = (f: { file: string; text: string }) =>
			I18N_ALLOWLIST.some((a) => a.file === f.file && f.text.startsWith(a.text));
		const open = scanCore().filter((f) => !allowed(f));
		expect(open.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
	}, 120_000);
});
