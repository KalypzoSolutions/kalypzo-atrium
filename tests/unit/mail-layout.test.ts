import { describe, expect, it } from 'vitest';
import {
	mailLayoutOptions,
	renderMailLayout,
	textToHtml,
	type MailLayoutOptions
} from '$lib/server/core/mail-layout';

/** 1×1-PNG (gültige Signatur) als Bildmarke/Emblem */
const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const options: MailLayoutOptions = {
	enabled: true,
	showEmblem: true,
	signature: 'Viele Grüße',
	footerText: 'Vereinsnachweis <Test>',
	accentColor: '#112233',
	branding: {
		title: 'Musterverein\ne.V.',
		mark: { dataUrl: PNG, alt: 'Bildmarke' },
		emblem: { dataUrl: PNG, alt: 'Emblem' }
	}
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
		expect(r.html).toContain('cid:brand-mark@atrium');
		expect(r.html).toContain('cid:brand-emblem@atrium');
		expect(r.html).not.toContain('data:image');
		expect(r.html).toContain('Musterverein<br/>e.V.');
		expect(r.html).toContain('alt="Emblem"');
		expect(r.attachments.map((a) => a.cid)).toEqual(['brand-mark@atrium', 'brand-emblem@atrium']);
		for (const a of r.attachments) expect(a.content.subarray(1, 4).toString()).toBe('PNG');
	});

	it('Vorschau nutzt data-URLs ohne Anhänge', () => {
		const r = renderMailLayout({ text: 'Hallo' }, options, 'data');
		expect(r.html.match(/src="data:image\/png/g)).toHaveLength(2);
		expect(r.attachments).toEqual([]);
	});

	it('ohne Emblem, Signatur und Fußzeile', () => {
		const r = renderMailLayout(
			{ text: 'Hallo' },
			{ ...options, showEmblem: false, signature: '', footerText: '' }
		);
		expect(r.html).not.toContain('brand-emblem');
		expect(r.attachments).toHaveLength(1);
		expect(r.html).not.toContain('Viele Grüße');
		expect(r.text).toBe('Hallo');
	});

	it('neutraler Kopf: nur Name, keine Bilder', () => {
		const r = renderMailLayout(
			{ text: 'Hallo' },
			{ ...options, branding: { title: 'Kalypzo Atrium' } }
		);
		expect(r.html).toContain('Kalypzo Atrium');
		expect(r.html).not.toContain('<img');
		expect(r.attachments).toEqual([]);
		expect(r.html).not.toMatch(/Pfadfind|Wappen|Lilie/);
	});

	it('Textfassung enthält Signatur und Fußzeile, HTML escaped sie', () => {
		const r = renderMailLayout({ text: 'Hallo' }, options);
		expect(r.text).toBe('Hallo\n\nViele Grüße\n\n--\nMusterverein e.V.\nVereinsnachweis <Test>');
		expect(r.html).toContain('Vereinsnachweis &lt;Test&gt;');
		expect(r.html).toContain('border-top:4px solid #112233');
	});

	it('übernimmt Modul-HTML unverändert als Inhalt', () => {
		const r = renderMailLayout({ text: 'x', html: '<p id="mod">Modul</p>' }, options);
		expect(r.html).toContain('<p id="mod">Modul</p>');
	});

	it('Optionen: Standardwerte, Name aus Organisation bzw. System', () => {
		const o = mailLayoutOptions({
			'core.design.accentColor': 'rot',
			'core.mail.showEmblem': false,
			'core.system.name': 'Atrium'
		});
		expect(o.enabled).toBe(true);
		expect(o.showEmblem).toBe(false);
		expect(o.accentColor).toBe('#2563eb');
		expect(o.footerText).toBe('');
		expect(o.branding).toEqual({ title: 'Atrium' });
		expect(
			mailLayoutOptions({ 'core.system.name': 'Atrium', 'core.organization.name': 'Verein' })
				.branding
		).toEqual({ title: 'Verein' });
	});
});
