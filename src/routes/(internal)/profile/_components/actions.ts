import { invalidateAll } from '$app/navigation';
import { deserialize } from '$app/forms';
import type { SubmitFunction } from '@sveltejs/kit';
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';

export interface FormOutcome {
	ok: boolean;
	data: Record<string, unknown>;
	error: string | null;
}

/** Schlüssel der Rückfallmeldung (beim Gebrauch übersetzt) */
const FALLBACK = 'profile.errors.fallback';

/** Ergebnis einer SvelteKit-Action in ein einheitliches Format bringen. */
function outcomeOf(result: {
	type: string;
	data?: Record<string, unknown>;
	error?: { message?: string };
}): FormOutcome {
	const data = result.data ?? {};
	if (result.type === 'success') return { ok: true, data, error: null };
	const msg = typeof data.error === 'string' ? data.error : null;
	return { ok: false, data, error: msg ?? result.error?.message ?? t(FALLBACK) };
}

/**
 * `use:enhance`-Funktion: Zustand `busy`, Erfolgs-Toast, Daten neu laden. Fehler gibt `ondone` zurück
 * (Anzeige im jeweiligen Dialog/Formular), die Seite wird nicht neu gerendert.
 */
export function submitter(
	ondone: (o: FormOutcome) => void | Promise<void>,
	opts: { setBusy?: (b: boolean) => void; reload?: boolean; reset?: boolean } = {}
): SubmitFunction {
	return () => {
		opts.setBusy?.(true);
		return async ({ result, formElement }) => {
			opts.setBusy?.(false);
			const o = outcomeOf(
				result as { type: string; data?: Record<string, unknown>; error?: { message?: string } }
			);
			if (o.ok) {
				if (typeof o.data.success === 'string') toast.success(o.data.success);
				if (opts.reset) formElement.reset();
				if (opts.reload !== false) await invalidateAll();
			}
			await ondone(o);
		};
	};
}

/** Action ohne sichtbares Formular aufrufen (z. B. „Bild entfernen“). */
export async function callAction(
	name: string,
	fields: Record<string, string> = {}
): Promise<FormOutcome> {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	try {
		const res = await fetch(`?/${name}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const o = outcomeOf(deserialize(await res.text()) as never);
		if (o.ok) {
			if (typeof o.data.success === 'string') toast.success(o.data.success);
			await invalidateAll();
		}
		return o;
	} catch {
		return { ok: false, data: {}, error: t(FALLBACK) };
	}
}
