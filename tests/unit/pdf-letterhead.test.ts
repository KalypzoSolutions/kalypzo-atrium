import { beforeAll, describe, expect, it } from 'vitest';
import { carlitoFontFaceCss } from '$lib/server/core/pdf/fonts';
import { loadTemplates } from '$lib/server/core/pdf/load-templates';
import {
	GEOMETRY,
	addressField,
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
