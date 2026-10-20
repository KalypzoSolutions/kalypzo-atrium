import { describe, expect, it } from 'vitest';
import {
	mailLayoutOptions,
	renderMailLayout,
	textToHtml,
	type MailLayoutOptions
} from '$lib/server/core/mail-layout';

const options: MailLayoutOptions = {
	enabled: true,
	showEmblem: true,
	signature: 'Gut Pfad!',
	footerText: 'Vereinsnachweis <Test>',
	accentColor: '#112233'
};

describe('E-Mail-Layout', () => {
	it('setzt Text in escapte Absätze mit Links um', () => {
		const html = textToHtml(
			'Hallo <b>Max</b>\nZeile 2\n\nSiehe https://example.org/x?a=1&b=2',
			'#000000'
		);
		expect(html).toContain('Hallo &lt;b&gt;Max&lt;/b&gt;<br/>Zeile 2');
		expect(html.match(/<p /g)).toHaveLength(2);
		expect(html).toContain('<a href="https://example.org/x?a=1&amp;b=2"');
		expect(html).not.toContain('<b>');
	});

	it('bindet Bilder als CID ein und liefert Anhänge', () => {
		const r = renderMailLayout({ text: 'Hallo' }, options);
		expect(r.html).toContain('cid:stamm-lilie@ep-intern');
		expect(r.html).toContain('cid:stamm-wappen@ep-intern');
		expect(r.html).not.toContain('data:image');
		expect(r.attachments.map((a) => a.cid)).toEqual([
			'stamm-lilie@ep-intern',
			'stamm-wappen@ep-intern'
		]);
		// gültige PNG-Dateien
		for (const a of r.attachments) expect(a.content.subarray(1, 4).toString()).toBe('PNG');
	});

	it('Vorschau nutzt data-URLs ohne Anhänge', () => {
		const r = renderMailLayout({ text: 'Hallo' }, options, 'data');
		expect(r.html.match(/src="data:image\/png/g)).toHaveLength(2);
		expect(r.attachments).toEqual([]);
	});

	it('ohne Wappen, Signatur und Fußzeile', () => {
		const r = renderMailLayout(
			{ text: 'Hallo' },
			{ ...options, showEmblem: false, signature: '', footerText: '' }
		);
		expect(r.html).not.toContain('stamm-wappen');
		expect(r.attachments).toHaveLength(1);
		expect(r.html).not.toContain('Gut Pfad');
		expect(r.text).toBe('Hallo');
	});

	it('Textfassung enthält Signatur und Fußzeile, HTML escaped sie', () => {
		const r = renderMailLayout({ text: 'Hallo' }, options);
		expect(r.text).toBe(
			'Hallo\n\nGut Pfad!\n\n--\nChristliche Pfadfinderschaft Deutschlands e.V.\nVereinsnachweis <Test>'
		);
		expect(r.html).toContain('Vereinsnachweis &lt;Test&gt;');
		expect(r.html).toContain('border-top:4px solid #112233');
	});

	it('übernimmt Modul-HTML unverändert als Inhalt', () => {
		const r = renderMailLayout({ text: 'x', html: '<p id="mod">Modul</p>' }, options);
		expect(r.html).toContain('<p id="mod">Modul</p>');
	});

	it('Optionen: Standardwerte und ungültige Akzentfarbe', () => {
		const o = mailLayoutOptions({
			'core.design.accentColor': 'rot',
			'core.mail.showEmblem': false
		});
		expect(o.enabled).toBe(true);
		expect(o.showEmblem).toBe(false);
		expect(o.accentColor).toBe('#2563eb');
		expect(o.footerText).toContain('Vereinsregister');
	});
});
