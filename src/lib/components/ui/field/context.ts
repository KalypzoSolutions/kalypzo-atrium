/**
 * Barrierefreiheit von Formularfeldern: `FormField` (`$lib/components/layout`) legt einen Kontext mit
 * Feld-ID, `aria-describedby` (Hinweis + Fehler), Fehlerstatus und Pflicht an. Eingabe-Bausteine (`Input`,
 * `Textarea`, `SelectField`, `MultiSelect`, `MoneyInput`, `NumberStepper`, `TagInput`, `ColorPicker`) lesen
 * ihn und setzen `aria-describedby`, `aria-invalid` und `aria-required` selbst – Aufrufer müssen nichts tun.
 *
 * Regeln:
 * - Angewendet wird nur auf das Steuerelement des Felds: Element ohne eigene `id` oder mit `id === field.id`
 *   (weitere Eingaben mit anderer ID im selben `FormField` bleiben unberührt; keine doppelten IDs).
 * - Eigene Angaben der Aufrufer gewinnen (`aria-invalid`), `aria-describedby` wird zusammengeführt.
 * - Zusammengesetzte Bausteine lesen den Kontext und leeren ihn für ihre Kinder (`claimFieldContext`), damit
 *   innere Such-/Hilfsfelder ihn nicht erneut anwenden.
 */
import { getContext, hasContext, setContext } from 'svelte';

const KEY = Symbol('form-field');

export interface FieldContext {
	/** ID des Steuerelements (wie `Label for`) */
	readonly id: string;
	/** IDs von Hinweis und Fehler (leer = undefined) */
	readonly describedby: string | undefined;
	readonly invalid: boolean;
	readonly required: boolean;
}

/** Nur von `FormField` aufzurufen (während der Initialisierung). */
export function setFieldContext(field: FieldContext): void {
	setContext(KEY, field);
}

/** Kontext des umgebenden `FormField` oder `null`. */
export function getFieldContext(): FieldContext | null {
	return hasContext(KEY) ? (getContext<FieldContext | null>(KEY) ?? null) : null;
}

/** Für zusammengesetzte Bausteine: Kontext lesen und für Kinder leeren. */
export function claimFieldContext(): FieldContext | null {
	const field = getFieldContext();
	if (field) setContext(KEY, null);
	return field;
}

/** Gehört das Element (eigene `id`) zum Feld? */
export function appliesTo(field: FieldContext | null, id: string | null | undefined): boolean {
	return !!field && (id === undefined || id === null || id === '' || id === field.id);
}

/** Leerzeichen-getrennte ID-Listen zusammenführen (ohne Dopplungen); leer → undefined. */
export function mergeIds(...lists: (string | null | undefined | false)[]): string | undefined {
	const ids = new Set<string>();
	for (const l of lists) if (l) for (const id of l.split(/\s+/)) if (id) ids.add(id);
	return ids.size ? [...ids].join(' ') : undefined;
}

/**
 * ARIA-Attribute für ein Steuerelement mit der ID `id`. `own` sind die Angaben des Aufrufers
 * (`aria-describedby`, `aria-invalid`, `aria-required`, `required`) – sie gewinnen bzw. werden ergänzt.
 */
export function fieldAria(
	field: FieldContext | null,
	id: string | null | undefined,
	own: {
		describedby?: string | null;
		invalid?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | null;
		ariaRequired?: boolean | 'true' | 'false' | null;
		required?: boolean | null;
	} = {}
): {
	'aria-describedby': string | undefined;
	'aria-invalid': boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined;
	'aria-required': boolean | 'true' | 'false' | undefined;
} {
	const use = appliesTo(field, id) ? field : null;
	return {
		'aria-describedby': mergeIds(own.describedby, use?.describedby),
		'aria-invalid': own.invalid ?? (use?.invalid ? 'true' : undefined),
		'aria-required': own.ariaRequired ?? (use?.required && !own.required ? 'true' : undefined)
	};
}
