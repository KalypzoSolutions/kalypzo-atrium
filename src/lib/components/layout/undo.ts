import { t } from '$lib/i18n';
/** Erfolgs-Toast mit „Rückgängig“ – der Rückweg läuft über einen vorhandenen API-Aufruf (kein lokaler Zustand). */
import { toast } from 'svelte-sonner';
import { ApiClientError } from '$lib/sdk/client';

export interface UndoOptions {
	/** Meldung nach der Aktion, z. B. „Rechnung storniert“ */
	message: string;
	/** Macht die Aktion rückgängig (wirft bei Fehler) */
	undo: () => Promise<unknown>;
	/** Meldung nach erfolgreichem Rückgängig (Standard: „Rückgängig gemacht“) */
	undone?: string;
	/** Danach z. B. neu laden */
	onundone?: () => void | Promise<void>;
}

export function toastWithUndo({ message, undo, undone, onundone }: UndoOptions): void {
	toast.success(message, {
		duration: 10_000,
		action: {
			label: t('layout.undo.action'),
			onClick: async () => {
				try {
					await undo();
					toast.success(undone ?? t('layout.undo.done'));
					await onundone?.();
				} catch (e) {
					toast.error(e instanceof ApiClientError ? e.message : t('layout.undo.failed'));
				}
			}
		}
	});
}
