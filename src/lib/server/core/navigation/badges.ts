/**
 * Zähler an Navigationseinträgen der Seitenleiste (`ModuleDefinition.navBadge`, z. B. ungelesene Mails).
 * Nur aktive Module und nur Einträge, die die Person sieht (gleiche Filter wie `navigationFor`). Fehler oder
 * Zeitüberschreitung eines Moduls werden geloggt und übersprungen – die Seitenleiste lädt immer.
 */
import type { RequestContext } from '$lib/sdk/types';
import { logError } from '../db-errors';
import { allDefinitions } from '../modules/registry';
import { navigationFor } from '../modules/service';

/** Zeitbudget je Modul */
const BUDGET_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`Zeitbudget ${ms} ms überschritten`)), ms);
	});
	return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Navigationspfad → Zahl (nur Werte > 0) */
export async function navBadgeCounts(ctx: RequestContext): Promise<Record<string, number>> {
	if (!ctx.userId) return {};
	const withBadge = allDefinitions().filter((d) => d.navBadge);
	if (!withBadge.length) return {};
	const nav = await navigationFor(ctx);
	const out: Record<string, number> = {};
	for (const d of withBadge) {
		const badge = d.navBadge!;
		const entry = nav.find(
			(n) => n.moduleId === d.manifest.id && !n.admin && (!badge.path || n.path === badge.path)
		);
		if (!entry) continue;
		try {
			const n = await withTimeout(badge.count(ctx), BUDGET_MS);
			if (Number.isFinite(n) && n > 0) out[entry.path] = Math.floor(n);
		} catch (e) {
			logError(`[nav] Zähler für ${d.manifest.id} übersprungen:`, e);
		}
	}
	return out;
}
