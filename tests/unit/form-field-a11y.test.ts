/**
 * #51: `FormField` verknüpft Hinweis und Fehler selbst mit dem Steuerelement
 * (`aria-describedby`, `aria-invalid`, `aria-required`) – ohne Code im Aufrufer.
 * Geprüft per SSR-Render (`svelte/server`), ohne DOM.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Fixture from '../fixtures/FormFieldFixture.svelte';
import { fieldAria, mergeIds } from '../../src/lib/components/ui/field/context';

type Props = Parameters<typeof Fixture>[1];

function html(props: Props): string {
	return render(Fixture, { props }).body;
}

/** Attribute des ersten Elements mit `id="<id>"` */
function attrsOf(markup: string, id: string): Record<string, string> {
	const tag = new RegExp(`<(?:input|textarea|button)\\b[^>]*\\bid="${id}"[^>]*>`).exec(markup)?.[0];
	if (!tag) throw new Error(`Element #${id} fehlt in ${markup}`);
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/([a-z-]+)="([^"]*)"/g)) out[m[1]!] = m[2]!;
	return out;
}

describe('FormField: ARIA-Weitergabe', () => {
	it.each(['input', 'textarea', 'select', 'money', 'stepper'] as const)(
		'%s: Fehler + Hinweis werden verknüpft',
		(control) => {
			const out = html({ control, error: 'Pflichtfeld', hint: 'In Euro' });
			const a = attrsOf(out, 'f-amount');
			expect(a['aria-invalid']).toBe('true');
			expect(a['aria-describedby']?.split(' ').sort()).toEqual(['f-amount-error', 'f-amount-hint']);
			// Hinweis bleibt bei Fehler sichtbar
			expect(out).toContain('id="f-amount-hint"');
			expect(out).toContain('id="f-amount-error"');
		}
	);

	it('ohne Fehler: nur Hinweis, kein aria-invalid', () => {
		const a = attrsOf(html({ control: 'input', hint: 'In Euro' }), 'f-amount');
		expect(a['aria-describedby']).toBe('f-amount-hint');
		expect(a['aria-invalid']).toBeUndefined();
	});

	it('ohne Hinweis und Fehler: keine Attribute', () => {
		const a = attrsOf(html({ control: 'input' }), 'f-amount');
		expect(a['aria-describedby']).toBeUndefined();
		expect(a['aria-invalid']).toBeUndefined();
	});

	it('required: Sternchen und aria-required', () => {
		const out = html({ control: 'input', required: true });
		expect(attrsOf(out, 'f-amount')['aria-required']).toBe('true');
		expect(out).toMatch(/<span[^>]*aria-hidden="true"[^>]*>\*<\/span>/);
	});

	it('Angaben des Aufrufers: describedby wird ohne Dopplung zusammengeführt, invalid gewinnt', () => {
		const a = attrsOf(
			html({
				control: 'input',
				error: 'x',
				ownDescribedby: 'f-amount-error extra',
				ownInvalid: false
			}),
			'f-amount'
		);
		expect(a['aria-describedby']).toBe('f-amount-error extra');
		expect(a['aria-invalid']).toBe('false');
	});

	it('nur das Steuerelement des Felds, nicht weitere Eingaben oder Felder außerhalb', () => {
		const out = html({ control: 'two-inputs', error: 'Fehler' });
		expect(attrsOf(out, 'f-amount')['aria-invalid']).toBe('true');
		expect(attrsOf(out, 'f-other')['aria-invalid']).toBeUndefined();
		expect(attrsOf(out, 'outside')['aria-describedby']).toBeUndefined();
		expect(out.match(/id="f-amount"/g)).toHaveLength(1);
	});
});

describe('field/context: Hilfsfunktionen', () => {
	it('mergeIds entfernt Dopplungen und Leerwerte', () => {
		expect(mergeIds('a b', undefined, 'b c', false, '')).toBe('a b c');
		expect(mergeIds(undefined, null)).toBeUndefined();
	});

	it('fieldAria ohne Kontext ändert nichts', () => {
		expect(fieldAria(null, 'x', { describedby: 'h' })).toEqual({
			'aria-describedby': 'h',
			'aria-invalid': undefined,
			'aria-required': undefined
		});
	});

	it('natives required ersetzt aria-required', () => {
		const field = { id: 'x', describedby: undefined, invalid: false, required: true };
		expect(fieldAria(field, 'x', { required: true })['aria-required']).toBeUndefined();
		expect(fieldAria(field, 'x')['aria-required']).toBe('true');
		expect(fieldAria(field, 'y')['aria-required']).toBeUndefined();
	});
});
