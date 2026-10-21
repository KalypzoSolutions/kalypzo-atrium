/**
 * Endpunkt-Abgleich der Kasse (#61): Jeder Endpunkt aus der Registry muss in mindestens einem
 * Integrationstest aufgerufen werden (Pfad mit Methode bzw. Pfad als String/Template) – oder
 * bewusst in `UNTESTED` stehen (mit Grund). Neue Endpunkte ohne Test lassen diesen Test scheitern.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import treasuryModule from '$lib/modules/treasury/module';

/** Bewusst nicht per Integrationstest abgedeckt: `METHODE pfad` → Grund */
const UNTESTED: Record<string, string> = {};

const dir = join(process.cwd(), 'tests', 'integration');
const sources = readdirSync(dir)
	.filter((f) => f.endsWith('.test.ts'))
	.map((f) => readFileSync(join(dir, f), 'utf8'))
	.join('\n');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Pfad → Regex: `:param` passt auf `${…}` oder einen Literalwert; danach Ende des Strings oder `?` */
function pathPattern(path: string): RegExp {
	const body = path
		.split('/')
		.map((seg) => (seg.startsWith(':') ? '(?:\\$\\{[^}]+\\}|[A-Za-z0-9_.-]+)' : escape(seg)))
		.join('/');
	return new RegExp(`['\`](?:/modules/treasury)?${body}(?:[?'\`])`);
}

describe('Endpunkt-Abgleich Kasse', () => {
	const endpoints = treasuryModule.endpoints ?? [];

	it('jeder Endpunkt erscheint in einem Integrationstest oder steht begründet in UNTESTED', () => {
		const missing = endpoints
			.map((e) => `${e.method} ${e.path}`)
			.filter((key) => !UNTESTED[key])
			.filter((key) => !pathPattern(key.split(' ')[1]!).test(sources));
		expect(missing).toEqual([]);
	});

	it('UNTESTED enthält nur existierende Endpunkte', () => {
		const keys = new Set(endpoints.map((e) => `${e.method} ${e.path}`));
		expect(Object.keys(UNTESTED).filter((k) => !keys.has(k))).toEqual([]);
	});
});
