/**
 * Texte des Core (Phase N): beide Sprachen haben dieselben Dateien, Schlüssel und Platzhalter, keine leeren
 * Texte; jeder im Code verwendete Schlüssel (`t('bereich.schlüssel')`) existiert.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMessage, messageArguments } from '$lib/i18n/format';
import { ensureLocale, negotiateLocale, tl } from '$lib/i18n';
import { coreFiles } from './i18n-scan';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'src', 'lib', 'i18n', 'messages');

function flatten(prefix: string, v: unknown, out: Map<string, string>) {
	if (typeof v === 'string') out.set(prefix, v);
	else if (v && typeof v === 'object')
		for (const [k, x] of Object.entries(v)) flatten(prefix ? `${prefix}.${k}` : k, x, out);
	else out.set(prefix, `<<${typeof v}>>`);
}

function load(locale: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const f of readdirSync(join(DIR, locale))
		.filter((f) => f.endsWith('.json'))
		.sort()) {
		flatten(f.slice(0, -5), JSON.parse(readFileSync(join(DIR, locale, f), 'utf8')), out);
	}
	return out;
}

describe('Nachrichtenformat', () => {
	it('Platzhalter, Mehrzahl, Auswahl', () => {
		expect(formatMessage('Hallo {name}', { name: 'Ada' }, 'de-DE')).toBe('Hallo Ada');
		const p = '{count, plural, =0 {keine} one {# Datei} other {# Dateien}}';
		expect(formatMessage(p, { count: 0 }, 'de-DE')).toBe('keine');
		expect(formatMessage(p, { count: 1 }, 'de-DE')).toBe('1 Datei');
		expect(formatMessage(p, { count: 1200 }, 'de-DE')).toBe('1.200 Dateien');
		expect(formatMessage('{k, select, a {A} other {X}}', { k: 'b' }, 'de-DE')).toBe('X');
		expect(formatMessage('Fehlt: {x}', {}, 'de-DE')).toBe('Fehlt: {x}');
		expect(messageArguments(p + ' {name}')).toEqual(['count', 'name']);
	});

	it('Rückfall auf Deutsch und Sprachwahl aus Accept-Language', async () => {
		await ensureLocale('en');
		expect(tl('en', 'zod.required')).toBe('Required');
		expect(tl('en', 'gibt.es.nicht')).toBe('gibt.es.nicht');
		expect(negotiateLocale('en-US,en;q=0.9,de;q=0.8')).toBe('en');
		expect(negotiateLocale('fr-FR, de;q=0.5')).toBe('de');
		expect(negotiateLocale('fr')).toBe(null);
	});
});

describe('Texte des Core', () => {
	const de = load('de');
	const en = load('en');

	it('gleiche Dateien in de und en', () => {
		const files = (l: string) => readdirSync(join(DIR, l)).sort();
		expect(files('en')).toEqual(files('de'));
	});

	it('gleiche Schlüssel, gleiche Platzhalter, nichts leer', () => {
		expect([...en.keys()].filter((k) => !de.has(k))).toEqual([]);
		expect([...de.keys()].filter((k) => !en.has(k))).toEqual([]);
		const bad: string[] = [];
		for (const [k, v] of de) {
			const e = en.get(k);
			if (!v.trim() || !e?.trim()) bad.push(`${k}: leer`);
			else if (v.startsWith('<<') || e.startsWith('<<')) bad.push(`${k}: kein Text`);
			else if (messageArguments(v).join() !== messageArguments(e).join())
				bad.push(`${k}: Platzhalter ${messageArguments(v)} ≠ ${messageArguments(e)}`);
		}
		expect(bad).toEqual([]);
	});

	it('jeder verwendete Schlüssel existiert', () => {
		const used = new Map<string, string>();
		const re = /\b(?:t|tl\([^,()]+,)\s*\(?\s*'([a-z0-9-]+\.[A-Za-z0-9_.-]+)'/g;
		for (const file of coreFiles('')) {
			const src = readFileSync(join(ROOT, file), 'utf8');
			for (const m of src.matchAll(re)) used.set(m[1]!, file);
		}
		const missing = [...used].filter(([k]) => !de.has(k)).map(([k, f]) => `${k} (${f})`);
		expect(missing).toEqual([]);
	});
});
