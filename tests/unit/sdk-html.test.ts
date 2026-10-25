/** `$lib/sdk/server/html` (Bereinigung von Rich-Text) und `$lib/sdk/slug` */
import { describe, expect, it } from 'vitest';
import { richTextImageIds, sanitizeRichText } from '$lib/sdk/server/html';
import { slugify } from '$lib/sdk/slug';
import { bannerState, firstNameOf } from '$lib/modules/website/schemas';

const IMG = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('sanitizeRichText', () => {
	it('entfernt Skripte, Event-Handler und javascript:-Links', () => {
		const out = sanitizeRichText(
			'<p onclick="x()">Hi <a href="javascript:alert(1)">a</a><script>bad()</script><iframe src="x"></iframe></p>'
		);
		expect(out).not.toMatch(/onclick|javascript|script|iframe/);
		expect(out).toContain('<p>Hi <a');
	});

	it('setzt sichere Linkattribute', () => {
		expect(sanitizeRichText('<a href="https://example.org" class="x">L</a>')).toBe(
			'<a href="https://example.org" target="_blank" rel="noopener noreferrer">L</a>'
		);
	});

	it('verwirft Bilder ohne Erlaubnis', () => {
		expect(sanitizeRichText(`<img data-image-id="${IMG}" alt="a">`)).toBe('');
	});

	it('lässt nur erlaubte Bild-IDs zu, ohne src und Handler', () => {
		const out = sanitizeRichText(
			`<img data-image-id="${IMG}" alt="Zelt" src="https://evil.example/x.png" onerror="x()">` +
				`<img data-image-id="${OTHER}" alt="fremd"><img src="https://evil.example/y.png"><img data-image-id="kaputt">`,
			{ images: (id) => id === IMG }
		);
		expect(out).toBe(`<img data-image-id="${IMG}" alt="Zelt" />`);
		expect(richTextImageIds(out)).toEqual([IMG]);
	});

	it('kürzt Alt-Texte', () => {
		const out = sanitizeRichText(`<img data-image-id="${IMG}" alt="${'x'.repeat(400)}">`, {
			images: () => true
		});
		expect(out).toContain(`alt="${'x'.repeat(300)}"`);
	});
});

describe('slugify', () => {
	it('wandelt Umlaute und Sonderzeichen', () => {
		expect(slugify('Größe & Übermut – Sommerlager 2026!')).toBe(
			'groesse-uebermut-sommerlager-2026'
		);
		expect(slugify('Café Crème')).toBe('cafe-creme');
		expect(slugify('---')).toBe('');
	});

	it('kürzt ohne Bindestrich am Ende', () => {
		expect(slugify('abc def ghi', 4)).toBe('abc');
	});
});

describe('website: reine Helfer', () => {
	const now = Date.parse('2026-10-25T12:00:00Z');
	it('bannerState', () => {
		expect(bannerState({ active: false, startsAt: null, endsAt: null }, now)).toBe('inactive');
		expect(bannerState({ active: true, startsAt: null, endsAt: null }, now)).toBe('live');
		expect(bannerState({ active: true, startsAt: '2026-10-26T00:00:00Z', endsAt: null }, now)).toBe(
			'scheduled'
		);
		expect(bannerState({ active: true, startsAt: null, endsAt: '2026-10-25T12:00:00Z' }, now)).toBe(
			'expired'
		);
	});

	it('firstNameOf', () => {
		expect(firstNameOf('  Anna-Lena  Muster ')).toBe('Anna-Lena');
		expect(firstNameOf('')).toBe('');
	});
});
