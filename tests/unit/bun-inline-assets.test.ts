/**
 * `bun test` liefert für `./datei?inline` wie Vite eine Data-URL (Preload `tests/bun/preload.ts`). Module nutzen das
 * für Bilder und PDF-Vorlagen (z. B. Wappen im Briefkopf); ohne den Preload käme nur der Dateipfad an.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import favicon from '../../static/icons/favicon-32.png?inline';

describe('?inline unter bun test', () => {
	it('liefert eine Data-URL mit Typ und dem Dateiinhalt', () => {
		expect(favicon).toStartWith('data:image/png;base64,');
		const bytes = readFileSync(join(process.cwd(), 'static', 'icons', 'favicon-32.png'));
		expect(favicon.slice('data:image/png;base64,'.length)).toBe(bytes.toString('base64'));
	});
});
