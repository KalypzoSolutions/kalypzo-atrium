/**
 * Zähler der Seitenleiste (Navigationspfad → Zahl, z. B. ungelesene Mails). Startwert aus dem Layout
 * (`page.data.navBadges`), Aktualisierung über `GET /api/v1/nav/badges`. Seiten, die einen Zähler
 * verändern (Mail gelesen), rufen `refreshNavBadges()` auf.
 */
import { apiFetch } from './index';

let counts = $state<Record<string, number>>({});
/** Erst nach dem ersten Befüllen im Browser gilt der Store (vorher, z. B. beim SSR, `page.data.navBadges`) */
let seeded = $state(false);
let pending: Promise<void> | null = null;

export const navBadges = {
	get counts(): Record<string, number> {
		return counts;
	},
	get seeded(): boolean {
		return seeded;
	}
};

/** Startwert aus dem Layout übernehmen (nur im Browser aufrufen) */
export function seedNavBadges(initial: Record<string, number> | undefined): void {
	counts = { ...(initial ?? {}) };
	seeded = true;
}

/** Neu laden (gleichzeitige Aufrufe teilen sich eine Anfrage; Fehler lassen den alten Stand stehen) */
export function refreshNavBadges(): Promise<void> {
	pending ??= apiFetch<Record<string, number>>('/nav/badges')
		.then((res) => {
			counts = res ?? {};
			seeded = true;
		})
		.catch(() => undefined)
		.finally(() => {
			pending = null;
		});
	return pending;
}
