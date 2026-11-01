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
	GEOMETRY_LANDSCAPE,
	createLetterTemplate,
	foldMarks,
	letterFooter,
	neutralFooterLines,
	neutralLetterheadTop
} from '$lib/server/core/pdf/parts/letter';
import { describeTemplate, getTemplate, type PdfLayoutData } from '$lib/server/core/pdf/templates';

const data: PdfLayoutData = {
	title: 'Einladung <Sommerlager>',
	organization: { name: 'Verein <A&B>', address: '', email: '', phone: '' },
	logoDataUrl: null,
	headerText: '',
	footerText: '',
	accentColor: '#2563eb',
	createdAt: new Date('2026-01-01'),
	locale: 'de-DE'
};
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

const describe1 = (id: string) => describeTemplate(getTemplate(id)!);

beforeAll(() => loadTemplates());

describe('Brief-Bausteine (neutral)', () => {
	it('Briefkopf: Name der Organisation escaped, Logo an der Emblem-Position', () => {
		const ohne = neutralLetterheadTop(undefined, data);
		expect(ohne).toContain('data-part="briefkopf"');
		expect(ohne).toContain('Verein &lt;A&amp;B&gt;');
		expect(ohne).not.toContain('<img');
		const mit = neutralLetterheadTop(undefined, { ...data, logoDataUrl: LOGO });
		expect(mit).toContain(`src="${LOGO}"`);
		expect(mit).toContain(`left:${GEOMETRY.emblem.x}mm`);
		expect(mit).toContain(`width:${GEOMETRY.emblem.width}mm`);
		expect(mit).not.toMatch(/Pfadfind|Lilie|Wappen/);
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
		expect(addressField([])).toContain('width:84mm;height:40mm');
	});

	it('Fußzeile: Text aus den Einstellungen, sonst Kontaktdaten der Organisation', () => {
		expect(neutralFooterLines({ ...data, footerText: 'Zeile A\nZeile B' })).toEqual([
			'Zeile A',
			'Zeile B'
		]);
		expect(
			neutralFooterLines({
				...data,
				organization: {
					name: 'X',
					address: 'Weg 1\n28207 Bremen',
					email: 'info@example.org',
					phone: ''
				}
			})
		).toEqual(['Weg 1, 28207 Bremen · info@example.org']);
		expect(neutralFooterLines(data)).toEqual([]);
		const html = letterFooter(undefined, ['A <1>', 'B']);
		expect(html).toContain('data-part="fusszeile"');
		expect(html).toContain('A &lt;1&gt;<br/>B');
		expect(html).toContain('font-size:7pt');
		expect(html).toContain('width:160mm');
	});
});

describe('Core-Briefvorlagen', () => {
	it('sind registriert (idempotent), Texte übersetzt', () => {
		loadTemplates();
		const kopf = describe1('briefkopf');
		const brief = describe1('brief');
		expect(kopf.label).toBe('Briefkopf (ohne Adressfeld)');
		expect(kopf.parts.map((p) => p.id)).toEqual(['briefkopf', 'fusszeile']);
		expect(kopf.parts[0]!.label).toBe('Briefkopf');
		expect(brief.label).toBe('Brief (mit Adressfeld)');
		expect(brief.parts.map((p) => p.id)).toEqual([
			'briefkopf',
			'falzmarken',
			'adressfeld',
			'fusszeile'
		]);
		expect(brief.source).toBe('templates/brief.ts');
		expect(brief.letterhead).toBe(true);
	});

	it('alte IDs (stamm-*) zeigen auf die neuen Vorlagen', () => {
		expect(getTemplate('stamm-brief')).toBe(getTemplate('brief'));
		expect(getTemplate('stamm-briefkopf')).toBe(getTemplate('briefkopf'));
		expect(getTemplate('briefkopf-quer')).toBe(getTemplate('briefkopf-quer'));
	});

	it('briefkopf enthält weder Adressfeld noch Falzmarken', () => {
		const html = getTemplate('briefkopf')!.overlay!(data, { recipient: ['Zzyzx Adresse'] });
		expect(html).toContain('data-part="briefkopf"');
		expect(html).toContain('data-part="fusszeile"');
		expect(html).not.toContain('data-part="adressfeld"');
		expect(html).not.toContain('data-part="falzmarken"');
		expect(html).not.toContain('Zzyzx Adresse');
	});

	it('brief enthält Adressfeld, Falzmarken und den neutralen Kopf', () => {
		const t = getTemplate('brief')!;
		const html = t.overlay!(
			{ ...data, footerText: 'Fußzeile des Vereins' },
			{ recipient: ['Erika Muster'] }
		);
		expect(html).toContain('data-part="adressfeld"');
		expect(html).toContain('data-part="falzmarken"');
		expect(html).toContain('Erika Muster');
		expect(html).toContain('Verein &lt;A&amp;B&gt;');
		expect(html).toContain('Fußzeile des Vereins');
		expect(html).not.toMatch(/Pfadfind|Vereinsregister/);
		expect(t.page?.format).toBe('A4');
	});

	it('only zeigt nur den gewählten Baustein', () => {
		const html = getTemplate('brief')!.overlay!(data, {
			recipient: ['Erika Muster'],
			only: 'adressfeld'
		});
		expect(html).toContain('data-part="adressfeld"');
		expect(html).not.toContain('data-part="briefkopf"');
		expect(html).not.toContain('data-part="fusszeile"');
		expect(html).not.toContain('data-part="falzmarken"');
	});

	it('Titelblock: Abstandshalter nur im Brief, Titel escaped', () => {
		const brief = getTemplate('brief')!.titleBlock!(data);
		const kopf = getTemplate('briefkopf')!.titleBlock!(data);
		expect(brief).toContain('height:63mm');
		expect(kopf).not.toContain('height:63mm');
		expect(brief).toContain('Einladung &lt;Sommerlager&gt;');
	});

	it('Header/Footer von Chromium bleiben leer', () => {
		const t = getTemplate('brief')!;
		expect(t.header(data)).toBe('<span></span>');
		expect(t.footer(data)).toBe('<span></span>');
	});

	it('CSS bindet Carlito ein', () => {
		const css = getTemplate('brief')!.css(data);
		expect(css).toContain("font-family: 'Carlito'");
		expect(css).toContain('data:');
		expect(carlitoFontFaceCss().match(/@font-face/g)).toHaveLength(2);
	});

	it('eigener Kopf und eigene Fußzeile über letterhead', () => {
		const t = createLetterTemplate({
			id: 'x-eigen',
			label: 'X',
			description: 'X',
			source: 'x.ts',
			withAddress: false,
			letterhead: {
				top: (geo) => `<i data-x="${geo.emblem.x}">KOPF</i>`,
				footerLines: () => ['FUSS'],
				headDescription: 'Eigener Kopf'
			}
		});
		const html = t.overlay!(data);
		expect(html).toContain('data-part="briefkopf"');
		expect(html).toContain(`<i data-x="${GEOMETRY.emblem.x}">KOPF</i>`);
		expect(html).toContain('FUSS');
		expect(html).not.toContain('Verein &lt;A&amp;B&gt;');
		expect(describeTemplate(t).parts[0]!.description).toBe('Eigener Kopf');
	});
});

/** Alle `<prop>:<zahl>mm`-Werte eines HTML-Strings (tolerant gegen Gleitkomma-Rundung). */
function mmValues(html: string, prop: string): number[] {
	return [...html.matchAll(new RegExp(`(?:^|[;"\\s])${prop}:(-?[\\d.]+)mm`, 'g'))].map((m) =>
		Number(m[1])
	);
}
const near = (values: number[], target: number) => values.some((v) => Math.abs(v - target) < 0.05);

describe('Briefkopf quer', () => {
	it('ist als Querformat-Vorlage registriert', () => {
		const t = getTemplate('briefkopf-quer');
		expect(t).toBeDefined();
		expect(t!.page?.format).toBe('A4');
		expect(t!.page?.orientation).toBe('landscape');
		expect(t!.page?.margins).toEqual({ top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' });
		const desc = describe1('briefkopf-quer');
		expect(desc.orientation).toBe('landscape');
		expect(desc.parts.map((p) => p.id)).toEqual(['briefkopf', 'fusszeile']);
	});

	it('Overlay: Logo rechts bei 263,7 mm, Fußzeilenlinie bei 189,8 mm, ohne Adressfeld', () => {
		const html = getTemplate('briefkopf-quer')!.overlay!(
			{ ...data, logoDataUrl: LOGO },
			{ recipient: ['Zzyzx Adresse'] }
		);
		expect(html).toContain('data-part="briefkopf"');
		expect(html).toContain('data-part="fusszeile"');
		expect(html).not.toContain('data-part="adressfeld"');
		expect(html).not.toContain('data-part="falzmarken"');
		expect(html).not.toContain('Zzyzx Adresse');
		const lefts = mmValues(html, 'left');
		// Logo bei 263,7 mm: endet 12,7 mm vor dem rechten Rand (297 mm)
		expect(near(lefts, 263.7)).toBe(true);
		expect(near(mmValues(html, 'top'), 189.8)).toBe(true);
		// Fußzeile 25 mm Rand links/rechts -> 247 mm Breite
		expect(near(mmValues(html, 'width'), 247)).toBe(true);
		// Hochkant-Lage taucht nicht auf
		expect(near(lefts, GEOMETRY.emblem.x)).toBe(false);
		expect(near(mmValues(html, 'top'), GEOMETRY.footer.lineY)).toBe(false);
	});

	it('Bestandteile liegen innerhalb von 297 × 210 mm', () => {
		const parts = getTemplate('briefkopf-quer')!.parts ?? [];
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
		for (const id of ['briefkopf', 'brief']) {
			const t = getTemplate(id)!;
			expect([undefined, 'portrait']).toContain(t.page?.orientation);
			expect(describe1(id).orientation).toBe('portrait');
			const html = t.overlay!({ ...data, logoDataUrl: LOGO }, { recipient: ['Erika Muster'] });
			expect(near(mmValues(html, 'left'), GEOMETRY.emblem.x)).toBe(true);
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
			createLetterTemplate({
				...base,
				id: 'x-quer-brief',
				withAddress: true,
				orientation: 'landscape'
			})
		).toThrow();
		expect(() =>
			createLetterTemplate({
				...base,
				id: 'x-quer-kopf',
				withAddress: false,
				orientation: 'landscape'
			})
		).not.toThrow();
	});
});

const LETTER_IDS = ['brief', 'briefkopf', 'briefkopf-quer'] as const;

/** Einzelne Selektoren aller CSS-Regeln, die `.letter-flow` erwähnen (Kombinatoren `>` normalisiert). */
function letterFlowSelectors(css: string): string[] {
	return [...css.matchAll(/([^{}]+)\{[^}]*\}/g)]
		.flatMap((m) => m[1]!.split(','))
		.map((sel) =>
			sel
				.trim()
				.replace(/\s*>\s*/g, '>')
				.replace(/\s+/g, ' ')
		)
		.filter((sel) => sel.includes('.letter-flow'));
}

/**
 * `true`, wenn der Selektor per Nachfahren-Kombinator (Leerzeichen) auf eine nackte Zelle zielt,
 * z. B. `.letter-flow td` oder `.letter-flow tbody td`: Das trifft auch Zellen verschachtelter
 * Inhaltstabellen. Erlaubt sind Kind-Ketten (`.letter-flow>tbody>tr>td`) oder Zellen mit Klasse.
 */
function hitsNestedCells(sel: string): boolean {
	const rest = sel.slice(sel.indexOf('.letter-flow') + '.letter-flow'.length);
	return /(^|[ >])t[dh]$/.test(rest) && rest.includes(' ');
}

describe('Brief: Fußzeile, Textränder, Layout-CSS', () => {
	it('Fußzeile quer ist ein Absatz, hochkant zwei feste Zeilen', () => {
		const lines = ['Erste Zeile', 'Zweite Zeile'];
		const quer = letterFooter(GEOMETRY_LANDSCAPE, lines);
		expect(quer).toContain('data-part="fusszeile"');
		expect(quer).not.toContain('<br');
		expect(quer).toContain(lines.join(' '));

		const hoch = letterFooter(undefined, lines);
		expect(hoch.match(/<br\/>/g)).toHaveLength(1);
		expect(hoch).toContain(lines.join('<br/>'));

		const withFooter = { ...data, footerText: lines.join('\n') };
		const querOverlay = getTemplate('briefkopf-quer')!.overlay!(withFooter, { only: 'fusszeile' });
		expect(querOverlay).not.toContain('<br');
		const hochOverlay = getTemplate('briefkopf')!.overlay!(withFooter, { only: 'fusszeile' });
		expect(hochOverlay).toContain('<br/>');
	});

	it('Textränder: 25 mm links/rechts, 45 mm oben, 25 mm unten (hochkant und quer)', () => {
		for (const id of LETTER_IDS) {
			const t = getTemplate(id)!;
			expect(t.css(data), id).toMatch(/\.letter-text[^{]*\{[^}]*padding:\s*0\s+25mm\s+0\s+25mm/);
			const html = t.overlay!(data, { recipient: [] });
			expect(html, id).toMatch(/<thead>(?:(?!<\/thead>).)*height:45mm/s);
			expect(html, id).toMatch(/<tfoot>(?:(?!<\/tfoot>).)*height:25mm/s);
		}
	});

	it('Selektor-Prüfung erkennt den alten Fehler', () => {
		expect(hitsNestedCells('.letter-flow td')).toBe(true);
		expect(hitsNestedCells('.letter-flow tbody td')).toBe(true);
		expect(hitsNestedCells('.letter-flow>thead>tr>td')).toBe(false);
		expect(hitsNestedCells('.letter-flow>tbody>tr>td.letter-text')).toBe(false);
		expect(hitsNestedCells('.letter-flow td.letter-text')).toBe(false);
	});

	it('Reset der Layout-Zellen trifft keine verschachtelten Inhaltstabellen', () => {
		for (const id of LETTER_IDS) {
			const css = getTemplate(id)!.css(data);
			const selectors = letterFlowSelectors(css);
			expect(selectors.length, id).toBeGreaterThan(0);
			expect(selectors.filter(hitsNestedCells), id).toEqual([]);
			expect(css, id).not.toMatch(/\.letter-flow\s+td\s*[{,]/);
		}
	});
});

describe('generate: Ausrichtung', () => {
	let options: RenderOptions | undefined;

	beforeEach(() => {
		options = undefined;
		Object.assign(settingsStore, {
			'core.organization.name': 'Verein',
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
			template: 'briefkopf-quer',
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
			template: 'briefkopf',
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
