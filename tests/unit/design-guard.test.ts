/**
 * Rückfallschutz Designsystem (#49, #50, #54): In Core-Bausteinen (`src/lib/components`) und Core-Seiten
 * (`src/routes`) keine Status-Palettenklassen (amber/green/emerald/red …), kein `text-white` außerhalb
 * `components/ui` und keine nativen Checkboxen/Textareas in der Verwaltung – stattdessen Tokens
 * (`text-warning`, `bg-success-muted`, `text-destructive` …) und Core-Bausteine (`Alert`, `Badge`, `Checkbox`, `Textarea`).
 *
 * Module werden schrittweise migriert: erfasst sind die in `MIGRATED_MODULES` genannten (#71, Folgeschritt von #49);
 * seit Welle 5 alle Fachmodule. Zusätzlich (#71): Typo-Mindestgröße, Dialoghöhen, Ladetexte, Tabs-Hacks,
 * Kartentitel ohne Größen-Override, du-Ansprache.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function files(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...files(p));
		else if (/\.(svelte|ts)$/.test(name)) out.push(p);
	}
	return out;
}

const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');
/** Bereits auf Tokens umgestellte Module (weitere ergänzen, sobald migriert) */
const MIGRATED_MODULES = [
	'actions',
	'events',
	'files',
	'galleries',
	'members',
	'material',
	'notes',
	'orders',
	'offices',
	'tasks',
	'treasury',
	'website',
	'whiteboard'
];
const SCOPE = [
	...files(join(ROOT, 'src/lib/components')),
	...files(join(ROOT, 'src/routes')),
	...MIGRATED_MODULES.flatMap((m) => files(join(ROOT, 'src/lib/modules', m)))
];

/** Begründete Ausnahmen (Pfad-Präfixe) */
const PALETTE_EXCEPTIONS: string[] = [
	// Datenvisualisierung mit fester Palette
	'src/lib/components/layout/CostBar.svelte'
];

/** Bildbetrachter mit immer dunkler Bühne (unabhängig vom Farbschema): weiße Schrift auf Schwarz gewollt */
const DARK_STAGE: string[] = [
	'src/lib/modules/files/pages/FilePreview.svelte',
	'src/lib/modules/galleries/pages/ImageViewer.svelte'
];

function hits(pattern: RegExp, include: (path: string) => boolean): string[] {
	const found: string[] = [];
	for (const f of SCOPE) {
		const path = rel(f);
		if (!include(path)) continue;
		readFileSync(f, 'utf8')
			.split('\n')
			.forEach((line, i) => {
				if (pattern.test(line)) found.push(`${path}:${i + 1}: ${line.trim()}`);
			});
	}
	return found;
}

describe('Designsystem: Rückfallschutz in Core-Bausteinen und -Seiten', () => {
	it('keine Status-Palettenklassen (Tokens nutzen)', () => {
		const pattern =
			/\b(?:text|bg|border|ring|fill|stroke|divide|outline|from|to)-(?:red|green|amber|emerald|yellow|orange|lime|rose)-\d{2,3}\b/;
		expect(hits(pattern, (p) => !PALETTE_EXCEPTIONS.some((e) => p.startsWith(e)))).toEqual([]);
	});

	it('kein text-white außerhalb components/ui (Vordergrund-Tokens nutzen)', () => {
		expect(
			hits(
				/\btext-white\b/,
				(p) => !p.startsWith('src/lib/components/ui/') && !DARK_STAGE.includes(p)
			)
		).toEqual([]);
	});

	it('keine nativen Checkboxen/Textareas in der Verwaltung (Checkbox/Textarea nutzen)', () => {
		// `/admin/users` wird gerade separat überarbeitet – Ausnahme entfernen, sobald dort umgestellt ist
		const pending = 'src/routes/(internal)/admin/users/';
		const admin = (p: string) =>
			p.startsWith('src/routes/(internal)/admin/') && !p.startsWith(pending);
		expect(hits(/type="checkbox"|<textarea\b/, admin)).toEqual([]);
	});

	it('Textlinks nutzen text-link statt text-primary', () => {
		expect(hits(/\btext-primary(?!-foreground)\b/, () => true)).toEqual([]);
	});

	it('Mindestschrift text-xs (kein text-[10px]/text-[11px])', () => {
		expect(hits(/\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/, () => true)).toEqual([]);
	});

	it('keine eigenen vh-Höhen (Dialoge haben max-h-[calc(100dvh-2rem)], sonst dvh)', () => {
		expect(hits(/\b(?:max-h|h|min-h)-\[\d+vh\]/, () => true)).toEqual([]);
	});

	it('Ladetexte in 3. Person mit echter Ellipse („Speichert …“, „Suchen …“)', () => {
		expect(
			hits(/'(?:Speichere|Lade|Lösche|Sende) …'|[A-Za-zÄÖÜäöüß] ?\.\.\.['"`]/, () => true)
		).toEqual([]);
	});

	it('Tabs.List ohne eigene Umbruch-Hacks (tabs-list.svelte bricht selbst um)', () => {
		expect(hits(/<Tabs\.List[^>]*class="[^"]*\b(?:flex-wrap|h-auto)\b/, () => true)).toEqual([]);
	});

	it('Kartentitel ohne Größen-Override (Typo-Skala text-title/text-section erlaubt)', () => {
		expect(
			hits(
				/<(?:Card\.Title|CardTitle)\b[^>]*class="[^"]*\btext-(?:xs|sm|base|lg|xl|2xl)\b/,
				() => true
			)
		).toEqual([]);
	});

	it('du-Ansprache statt Sie-Form', () => {
		expect(
			hits(/\b(?:Ihnen|Ihrem|Ihrer)\b|\b(?:Melden|Geben|Klicken|Wählen|Bitte) Sie\b/, (p) =>
				p.endsWith('.svelte')
			)
		).toEqual([]);
	});
});
