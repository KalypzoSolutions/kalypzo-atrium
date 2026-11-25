/**
 * Sammelaktionen der Modulverwaltung (`/admin/modules`): mehrere Module auf einmal aktivieren bzw. deaktivieren.
 * Jede ID läuft einzeln über `enableModule`/`disableModule` (eigene Transaktion, Audit, `onEnable`/`onDisable`),
 * Fehler werden je ID gesammelt und brechen den Rest nicht ab. Reihenfolge nach `manifest.dependencies`:
 * Aktivieren mit den Abhängigkeiten zuerst, Deaktivieren umgekehrt (abhängige Module zuerst).
 */
import { t } from '$lib/i18n';
import type { RequestContext } from '$lib/sdk/types';
import { errors, isCoreError } from '../errors';
import { requirePermission } from '../permissions/service';
import { getDefinition } from './registry';
import { disableModule, enableModule } from './service';
import { enabledModuleIds } from './state';

/** Höchstzahl an IDs je Sammelaktion */
export const BULK_MODULE_MAX_IDS = 100;

export type BulkModuleActionKind = 'enable' | 'disable';

export interface BulkModuleResult {
	id: string;
	ok: boolean;
	message?: string;
	/** Bereits im Zielzustand, nichts geändert */
	skipped?: boolean;
	/** Nicht ausgewählt, aber als harte Abhängigkeit mitaktiviert (`withDependencies`) */
	addedAsDependency?: boolean;
}

export interface BulkModuleOutcome {
	/** In Ausführungsreihenfolge; unbekannte IDs am Anfang */
	results: BulkModuleResult[];
	/** Mitaktivierte Abhängigkeiten (nur `enable` mit `withDependencies`) */
	addedDependencies: string[];
}

/**
 * Reihenfolge zum Aktivieren: jede Abhängigkeit vor dem Modul, das sie braucht (Tiefensuche über den ganzen
 * Graphen, damit auch Ketten über nicht ausgewählte Module gelten). Ausgegeben werden nur `ids`; bei Zyklen bricht
 * die Suche am bereits besuchten Knoten ab. Gleichrangige behalten die Reihenfolge der Eingabe.
 */
export function orderForEnable(ids: readonly string[], deps: (id: string) => readonly string[]) {
	const wanted = new Set(ids);
	const visited = new Set<string>();
	const out: string[] = [];
	const visit = (id: string) => {
		if (visited.has(id)) return;
		visited.add(id);
		for (const d of deps(id)) visit(d);
		if (wanted.has(id)) out.push(id);
	};
	for (const id of ids) visit(id);
	return out;
}

/** Reihenfolge zum Deaktivieren: abhängige Module zuerst (Umkehrung von `orderForEnable`) */
export function orderForDisable(ids: readonly string[], deps: (id: string) => readonly string[]) {
	return orderForEnable(ids, deps).reverse();
}

/** Fehlende, aber registrierte und inaktive harte Abhängigkeiten (transitiv), ohne die Auswahl selbst */
export function missingDependencies(
	ids: readonly string[],
	deps: (id: string) => readonly string[],
	isAvailable: (id: string) => boolean
): string[] {
	const selected = new Set(ids);
	const added: string[] = [];
	const seen = new Set<string>(ids);
	const queue = [...ids];
	while (queue.length) {
		const id = queue.shift()!;
		for (const d of deps(id)) {
			if (seen.has(d)) continue;
			seen.add(d);
			if (!isAvailable(d)) continue;
			if (!selected.has(d)) added.push(d);
			queue.push(d);
		}
	}
	return added;
}

const depsOf = (id: string): readonly string[] => getDefinition(id)?.manifest.dependencies ?? [];

function errorMessage(e: unknown, id: string): string {
	if (isCoreError(e)) return e.message;
	console.error(`[modules] Sammelaktion für ${id} fehlgeschlagen`, e);
	return e instanceof Error && e.message ? e.message : t('modules.bulk.failed');
}

export async function bulkModuleAction(
	ctx: RequestContext,
	input: { action: BulkModuleActionKind; ids: string[]; withDependencies?: boolean }
): Promise<BulkModuleOutcome> {
	await requirePermission(ctx, 'core.modules.manage');
	if (input.action !== 'enable' && input.action !== 'disable') {
		throw errors.validation([{ path: ['action'], message: t('modules.bulk.invalidAction') }]);
	}
	const ids = [...new Set((input.ids ?? []).map((id) => String(id)))];
	if (!ids.length) {
		throw errors.validation([{ path: ['ids'], message: t('modules.bulk.noIds') }]);
	}
	if (ids.length > BULK_MODULE_MAX_IDS) {
		throw errors.validation([
			{ path: ['ids'], message: t('modules.bulk.tooMany', { max: BULK_MODULE_MAX_IDS }) }
		]);
	}

	const results: BulkModuleResult[] = [];
	const known: string[] = [];
	for (const id of ids) {
		if (getDefinition(id)) known.push(id);
		else results.push({ id, ok: false, message: t('modules.notInstalled', { id }) });
	}

	const enabled = await enabledModuleIds();
	let addedDependencies: string[] = [];
	let order: string[];
	if (input.action === 'enable') {
		if (input.withDependencies) {
			addedDependencies = missingDependencies(
				known,
				depsOf,
				(id) => !!getDefinition(id) && !enabled.has(id)
			);
		}
		order = orderForEnable([...known, ...addedDependencies], depsOf);
	} else {
		order = orderForDisable(known, depsOf);
	}
	const added = new Set(addedDependencies);

	for (const id of order) {
		const extra = added.has(id) ? { addedAsDependency: true } : {};
		const target = input.action === 'enable';
		if (enabled.has(id) === target) {
			results.push({ id, ok: true, skipped: true, ...extra });
			continue;
		}
		try {
			if (target) await enableModule(ctx, id);
			else await disableModule(ctx, id);
			results.push({ id, ok: true, ...extra });
		} catch (e) {
			results.push({ id, ok: false, message: errorMessage(e, id), ...extra });
		}
	}
	return { results, addedDependencies };
}
