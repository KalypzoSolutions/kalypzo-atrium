/**
 * Gemeinsamer Ladezustand der Icon-Bibliothek im Browser: einmal laden, alle `DynamicIcon`s/`IconPicker`
 * zeigen danach sofort an. Daten selbst: `$lib/sdk/icons` (eigener Chunk).
 */
import { loadIconSet, type IconSet } from '$lib/sdk/icons';

let current = $state<IconSet | null>(null);
let failed = $state(false);
let loading = false;

export const iconStore = {
	/** Geladene Icons (`null` = noch nicht geladen) */
	get set(): IconSet | null {
		return current;
	},
	/** Letzter Ladeversuch fehlgeschlagen */
	get failed(): boolean {
		return failed;
	},
	/** Laden anstoßen (mehrfach aufrufbar, lädt nur einmal) */
	ensure(): void {
		if (current || loading) return;
		loading = true;
		failed = false;
		loadIconSet()
			.then((s) => (current = s))
			.catch(() => (failed = true))
			.finally(() => (loading = false));
	}
};
