import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ctxWith, settingsStore } from './_helpers';

vi.mock('$lib/server/core/settings/service', () => ({
	getSettings: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settingsStore[k]])),
	getSetting: async (k: string) => settingsStore[k]
}));
vi.mock('$lib/server/core/storage', () => ({
	upload: async () => {
		throw new Error('nicht erwartet');
	},
	readFileByIdUnchecked: async () => null
}));

import * as pdf from '$lib/server/core/pdf';
import type { RenderOptions } from '$lib/server/core/pdf';
import { carlitoFontFaceCss } from '$lib/server/core/pdf/fonts';
import { loadTemplates } from '$lib/server/core/pdf/load-templates';
import {
	GEOMETRY,
	addressField,
	FOOTER_TEXT_LINES,
	GEOMETRY_LANDSCAPE,
	createStammTemplate,
	foldMarks,
	letterFooter,
	letterheadTop
} from '$lib/server/core/pdf/parts/stamm';
import { describeTemplates, getTemplate, type PdfLayoutData } from '$lib/server/core/pdf/templates';

const data: PdfLayoutData = {
	title: 'Einladung <Sommerlager>',
	organization: { name: 'Stamm', address: '', email: '', phone: '' },
	logoDataUrl: null,
	headerText: '',
	footerText: '',
	accentColor: '#2563eb',
	createdAt: new Date('2026-01-01'),
	locale: 'de-DE'
};

beforeAll(() => loadTemplates());

describe('Stamm-Bausteine', () => {
	it('Briefkopf: Lilie, dreizeiliger Name, Wappen', () => {
		const html = letterheadTop();
		expect(html).toContain('data-part="briefkopf"');
		expect(html).toContain('Christliche<br/>Pfadfinderschaft<br/>Deutschlands e.V.');
		expect(html).toContain(`width:${GEOMETRY.wappen.width}mm`);
		expect(html).toContain(`width:${GEOMETRY.lilie.width}mm`);
		expect(html.match(/src="data:image\/png/g)).toHaveLength(2);
	});

	it('Falzmarken bei 105 mm und 210 mm', () => {
		const html = foldMarks();
		expect(html).toContain('data-part="falzmarken"');
		expect(html).toContain('top:104.8mm');
		expect(html).toContain('top:209.8mm');
		expect(html).toContain('width:3mm');
	});

	it('Adressfeld: Maße 84 x 40 mm bei x 25 / y 50,8', () => {
		const html = addressField(['Max Mustermann', 'Musterstraße 7', '28207 Bremen']);
		expect(html).toContain('data-part="adressfeld"');
		expect(html).toContain('left:25mm;top:50.8mm;width:84mm;height:40mm');
		expect(html).toContain('font-size:14pt');
		expect(html).toContain('Max Mustermann');
		expect(html).toContain('28207 Bremen');
	});

	it('Adressfeld escaped HTML und kappt nicht', () => {
		const lines = [
			'<b>"X" & Y</b>',
			'Zeile 2',
			'Zeile 3',
			'Zeile 4',
			'Zeile 5',
			'Zeile 6',
			'Zeile 7'
		];
		const html = addressField(lines);
		expect(html).not.toContain('<b>');
		expect(html).toContain('&lt;b&gt;&quot;X&quot; &amp; Y&lt;/b&gt;');
		expect(html).toContain('Zeile 7');
	});

	it('leeres Adressfeld behält die Fenster-Maße', () => {
		const html = addressField([]);
		expect(html).toContain('width:84mm;height:40mm');
	});

	it('Fußzeile: 160 mm Linie und Vereinsnachweis', () => {
		const html = letterFooter();
		expect(html).toContain('data-part="fusszeile"');
		expect(html).toContain('Vereinsregister Heilbad Heiligenstadt unter Nr. 400532');
		expect(html).toContain('font-size:7pt');
		expect(html).toContain('width:160mm');
	});
});

describe('Stamm-Vorlagen', () => {
	it('sind registriert (idempotent)', () => {
		loadTemplates();
		const all = describeTemplates();
		const kopf = all.find((t) => t.id === 'stamm-briefkopf');
		const brief = all.find((t) => t.id === 'stamm-brief');
		expect(kopf?.label).toBe('Stamm-Briefkopf (ohne Adressfeld)');
		expect(kopf?.parts.map((p) => p.id)).toEqual(['briefkopf', 'fusszeile']);
		expect(brief?.label).toBe('Stamm-Brief (mit Adressfeld)');
		expect(brief?.parts.map((p) => p.id)).toEqual([
			'briefkopf',
			'falzmarken',
			'adressfeld',
			'fusszeile'
		]);
		expect(brief?.source).toBe('templates/stamm-brief.ts');
		expect(brief?.letterhead).toBe(true);
		expect(all.filter((t) => t.id === 'stamm-brief')).toHaveLength(1);
	});

	it('stamm-briefkopf enthält weder Adressfeld noch Falzmarken', () => {
		const t = getTemplate('stamm-briefkopf')!;
		const html = t.overlay!(data, { recipient: ['Zzyzx Adresse'] });
		expect(html).toContain('data-part="briefkopf"');
		expect(html).toContain('data-part="fusszeile"');
		expect(html).not.toContain('data-part="adressfeld"');
		expect(html).not.toContain('data-part="falzmarken"');
		expect(html).not.toContain('Zzyzx Adresse');
	});

	it('stamm-brief enthält Adressfeld und Falzmarken', () => {
		const t = getTemplate('stamm-brief')!;
		const html = t.overlay!(data, { recipient: ['Erika Muster'] });
		expect(html).toContain('data-part="adressfeld"');
		expect(html).toContain('data-part="falzmarken"');
		expect(html).toContain('Erika Muster');
		expect(t.page?.format).toBe('A4');
	});

	it('only zeigt nur den gewählten Baustein', () => {
		const t = getTemplate('stamm-brief')!;
		const html = t.overlay!(data, { recipient: ['Erika Muster'], only: 'adressfeld' });
		expect(html).toContain('data-part="adressfeld"');
		expect(html).not.toContain('data-part="briefkopf"');
		expect(html).not.toContain('data-part="fusszeile"');
		expect(html).not.toContain('data-part="falzmarken"');
	});

	it('Titelblock: Abstandshalter nur im Brief, Titel escaped', () => {
		const brief = getTemplate('stamm-brief')!.titleBlock!(data);
		const kopf = getTemplate('stamm-briefkopf')!.titleBlock!(data);
		expect(brief).toContain('height:63mm');
		expect(kopf).not.toContain('height:63mm');
		expect(brief).toContain('Einladung &lt;Sommerlager&gt;');
	});

	it('Header/Footer von Chromium bleiben leer', () => {
		const t = getTemplate('stamm-brief')!;
		expect(t.header(data)).toBe('<span></span>');
		expect(t.footer(data)).toBe('<span></span>');
	});

	it('CSS bindet Carlito ein', () => {
		const css = getTemplate('stamm-brief')!.css(data);
		expect(css).toContain("font-family: 'Carlito'");
		expect(css).toContain('data:');
		expect(carlitoFontFaceCss().match(/@font-face/g)).toHaveLength(2);
	});
});

/** Alle `<prop>:<zahl>mm`-Werte eines HTML-Strings (tolerant gegen Gleitkomma-Rundung). */
function mmValues(html: string, prop: string): number[] {
	return [...html.matchAll(new RegExp(`(?:^|[;"\\s])${prop}:(-?[\\d.]+)mm`, 'g'))].map((m) =>
		Number(m[1])
	);
}
const near = (values: number[], target: number) => values.some((v) => Math.abs(v - target) < 0.05);

describe('Stamm-Briefkopf quer', () => {
	it('ist als Querformat-Vorlage registriert', () => {
		const t = getTemplate('stamm-briefkopf-quer');
		expect(t).toBeDefined();
		expect(t!.page?.format).toBe('A4');
		expect(t!.page?.orientation).toBe('landscape');
		expect(t!.page?.margins).toEqual({ top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' });
		const desc = describeTemplates().find((x) => x.id === 'stamm-briefkopf-quer');
		expect(desc?.orientation).toBe('landscape');
		expect(desc?.parts.map((p) => p.id)).toEqual(['briefkopf', 'fusszeile']);
	});

	it('Overlay: Wappen rechts bei 263,7 mm, Fußzeilenlinie bei 189,8 mm, ohne Adressfeld', () => {
		const html = getTemplate('stamm-briefkopf-quer')!.overlay!(data, {
			recipient: ['Zzyzx Adresse']
		});
		expect(html).toContain('data-part="briefkopf"');
		expect(html).toContain('data-part="fusszeile"');
		expect(html).not.toContain('data-part="adressfeld"');
		expect(html).not.toContain('data-part="falzmarken"');
		expect(html).not.toContain('Zzyzx Adresse');
		const lefts = mmValues(html, 'left');
		// Wappen bei 263,7 mm: endet 12,7 mm vor dem rechten Rand (297 mm)
		expect(near(lefts, 263.7)).toBe(true);
		expect(near(mmValues(html, 'top'), 189.8)).toBe(true);
		// Fußzeile 25 mm Rand links/rechts -> 247 mm Breite
		expect(near(mmValues(html, 'width'), 247)).toBe(true);
		// Hochkant-Lage taucht nicht auf
		expect(near(lefts, GEOMETRY.wappen.x)).toBe(false);
		expect(near(mmValues(html, 'top'), GEOMETRY.footer.lineY)).toBe(false);
	});

	it('Bestandteile liegen innerhalb von 297 × 210 mm', () => {
		const parts = getTemplate('stamm-briefkopf-quer')!.parts ?? [];
		expect(parts).toHaveLength(2);
		for (const p of parts) {
			expect(p.x).toBeGreaterThanOrEqual(0);
			expect(p.y).toBeGreaterThanOrEqual(0);
			expect(p.x + (p.width ?? 0)).toBeLessThanOrEqual(297);
			expect(p.y + (p.height ?? 0)).toBeLessThanOrEqual(210);
		}
		const kopf = parts.find((p) => p.id === 'briefkopf')!;
		const fuss = parts.find((p) => p.id === 'fusszeile')!;
		expect(kopf.x + kopf.width!).toBeCloseTo(297 - 12.7, 1);
		expect(fuss.x).toBeCloseTo(25, 1);
		expect(fuss.y).toBeCloseTo(189.8, 1);
		expect(fuss.width).toBeCloseTo(247, 1);
	});

	it('Hochkant-Vorlagen bleiben hochkant', () => {
		for (const id of ['stamm-briefkopf', 'stamm-brief']) {
			const t = getTemplate(id)!;
			expect([undefined, 'portrait']).toContain(t.page?.orientation);
			expect(describeTemplates().find((x) => x.id === id)?.orientation).toBe('portrait');
			const html = t.overlay!(data, { recipient: ['Erika Muster'] });
			expect(near(mmValues(html, 'left'), GEOMETRY.wappen.x)).toBe(true);
			expect(html).toContain(`top:${GEOMETRY.footer.lineY}mm`);
			expect(html).toContain('width:160mm');
			for (const p of t.parts ?? []) {
				expect(p.x + (p.width ?? 0)).toBeLessThanOrEqual(210);
				expect(p.y + (p.height ?? 0)).toBeLessThanOrEqual(297);
			}
		}
	});

	it('Querformat mit Adressfeld ist nicht erlaubt', () => {
		const base = { label: 'X', description: 'X', source: 'templates/x.ts' };
		expect(() =>
			createStammTemplate({
				...base,
				id: 'x-quer-brief',
				withAddress: true,
				orientation: 'landscape'
			})
		).toThrow();
		expect(() =>
			createStammTemplate({
				...base,
				id: 'x-quer-kopf',
				withAddress: false,
				orientation: 'landscape'
			})
		).not.toThrow();
	});
});

const STAMM_IDS = ['stamm-brief', 'stamm-briefkopf', 'stamm-briefkopf-quer'] as const;

/** Einzelne Selektoren aller CSS-Regeln, die `.stamm-flow` erwähnen (Kombinatoren `>` normalisiert). */
function stammFlowSelectors(css: string): string[] {
	return [...css.matchAll(/([^{}]+)\{[^}]*\}/g)]
		.flatMap((m) => m[1]!.split(','))
		.map((sel) =>
			sel
				.trim()
				.replace(/\s*>\s*/g, '>')
				.replace(/\s+/g, ' ')
		)
		.filter((sel) => sel.includes('.stamm-flow'));
}

/**
 * `true`, wenn der Selektor per Nachfahren-Kombinator (Leerzeichen) auf eine nackte Zelle zielt,
 * z. B. `.stamm-flow td` oder `.stamm-flow tbody td`: Das trifft auch Zellen verschachtelter
 * Inhaltstabellen. Erlaubt sind Kind-Ketten (`.stamm-flow>tbody>tr>td`) oder Zellen mit Klasse.
 */
function hitsNestedCells(sel: string): boolean {
	const rest = sel.slice(sel.indexOf('.stamm-flow') + '.stamm-flow'.length);
	return /(^|[ >])t[dh]$/.test(rest) && rest.includes(' ');
}

describe('Stamm: Fußzeile, Textränder, Layout-CSS', () => {
	it('Fußzeile quer ist ein Absatz, hochkant zwei feste Zeilen', () => {
		const quer = letterFooter(GEOMETRY_LANDSCAPE);
		expect(quer).toContain('data-part="fusszeile"');
		expect(quer).not.toContain('<br');
		expect(quer).toContain(FOOTER_TEXT_LINES.join(' '));

		const hoch = letterFooter();
		expect(hoch.match(/<br\/>/g)).toHaveLength(1);
		expect(hoch).toContain(FOOTER_TEXT_LINES.join('<br/>'));

		const querOverlay = getTemplate('stamm-briefkopf-quer')!.overlay!(data, { only: 'fusszeile' });
		expect(querOverlay).not.toContain('<br');
		const hochOverlay = getTemplate('stamm-briefkopf')!.overlay!(data, { only: 'fusszeile' });
		expect(hochOverlay).toContain('<br/>');
	});

	it('Textränder: 25 mm links/rechts, 45 mm oben, 25 mm unten (hochkant und quer)', () => {
		for (const id of STAMM_IDS) {
			const t = getTemplate(id)!;
			expect(t.css(data), id).toMatch(/\.stamm-text[^{]*\{[^}]*padding:\s*0\s+25mm\s+0\s+25mm/);
			const html = t.overlay!(data, { recipient: [] });
			expect(html, id).toMatch(/<thead>(?:(?!<\/thead>).)*height:45mm/s);
			expect(html, id).toMatch(/<tfoot>(?:(?!<\/tfoot>).)*height:25mm/s);
		}
	});

	it('Selektor-Prüfung erkennt den alten Fehler', () => {
		expect(hitsNestedCells('.stamm-flow td')).toBe(true);
		expect(hitsNestedCells('.stamm-flow tbody td')).toBe(true);
		expect(hitsNestedCells('.stamm-flow>thead>tr>td')).toBe(false);
		expect(hitsNestedCells('.stamm-flow>tbody>tr>td.stamm-text')).toBe(false);
		expect(hitsNestedCells('.stamm-flow td.stamm-text')).toBe(false);
	});

	it('Reset der Layout-Zellen trifft keine verschachtelten Inhaltstabellen', () => {
		for (const id of STAMM_IDS) {
			const css = getTemplate(id)!.css(data);
			const selectors = stammFlowSelectors(css);
			expect(selectors.length, id).toBeGreaterThan(0);
			expect(selectors.filter(hitsNestedCells), id).toEqual([]);
			expect(css, id).not.toMatch(/\.stamm-flow\s+td\s*[{,]/);
		}
	});
});

describe('generate: Ausrichtung', () => {
	let options: RenderOptions | undefined;

	beforeEach(() => {
		options = undefined;
		Object.assign(settingsStore, {
			'core.organization.name': 'Stamm',
			'core.organization.address': '',
			'core.organization.email': '',
			'core.organization.phone': '',
			'core.design.logoFileId': '',
			'core.design.accentColor': '#112233',
			'core.pdf.defaultFormat': 'A4',
			'core.pdf.defaultOrientation': 'portrait',
			'core.pdf.marginTop': '25mm',
			'core.pdf.marginRight': '18mm',
			'core.pdf.marginBottom': '22mm',
			'core.pdf.marginLeft': '18mm',
			'core.pdf.headerText': '',
			'core.pdf.footerText': '',
			'core.pdf.showLogo': false
		});
		pdf.setPdfRendererForTests(async (_html, o) => {
			options = o;
			return new Uint8Array([0x25, 0x50, 0x44]);
		});
	});
	afterEach(() => pdf.setPdfRendererForTests(undefined));

	it('Quer-Vorlage rendert quer, auch wenn portrait angefragt wird', async () => {
		await pdf.generate(ctxWith(), {
			title: 'Quer',
			content: [],
			template: 'stamm-briefkopf-quer',
			orientation: 'portrait'
		});
		expect(options?.landscape).toBe(true);
		expect(options?.format).toBe('A4');
		expect(options?.displayHeaderFooter).toBe(false);
	});

	it('Hochkant-Vorlage ignoriert input.orientation landscape', async () => {
		await pdf.generate(ctxWith(), {
			title: 'Hoch',
			content: [],
			template: 'stamm-briefkopf',
			orientation: 'landscape'
		});
		expect(options?.landscape).toBe(false);
	});

	it('Vorlage ohne festes Seitenlayout folgt input.orientation', async () => {
		await pdf.generate(ctxWith(), {
			title: 'Frei',
			content: [],
			template: 'default',
			orientation: 'landscape'
		});
		expect(options?.landscape).toBe(true);
	});
});
