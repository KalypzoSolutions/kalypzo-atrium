import { invalidateAll } from '$app/navigation';
import type { SubmitFunction } from '@sveltejs/kit';
import { toast } from 'svelte-sonner';

export interface SubmitOptions {
	/** Wird mit true/false aufgerufen, solange die Anfrage läuft */
	busy?: (busy: boolean) => void;
	/** Fehlertext der Aktion (leer bei Start/Erfolg) */
	error?: (message: string) => void;
	/** Nach Erfolg, z. B. Dialog schließen */
	success?: (data: Record<string, unknown>) => void;
	/** Daten nach Erfolg neu laden (Standard: true) */
	reload?: boolean;
}

/** Gemeinsame use:enhance-Logik: Ladezustand, Toasts, Fehleranzeige. */
export function submitHandler(opts: SubmitOptions = {}): SubmitFunction {
	return () => {
		opts.busy?.(true);
		opts.error?.('');
		return async ({ result, update }) => {
			opts.busy?.(false);
			if (result.type === 'success') {
				const data = (result.data ?? {}) as Record<string, unknown>;
				toast.success((data.message as string) ?? 'Gespeichert');
				opts.success?.(data);
				if (opts.reload !== false) await invalidateAll();
			} else if (result.type === 'failure') {
				const msg =
					((result.data ?? {}) as { message?: string }).message ?? 'Aktion fehlgeschlagen';
				opts.error?.(msg);
				toast.error(msg);
			} else if (result.type === 'error') {
				toast.error('Unerwarteter Fehler');
			} else {
				await update();
			}
		};
	};
}
