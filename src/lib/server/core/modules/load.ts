import { entries } from 'virtual:atrium-modules/server';
import { t, type MessageParams } from '$lib/i18n';
import { getDefinition, markModuleBroken, registerModule } from './registry';
import type { ModuleDefinition } from './types';

/**
 * Prüft die Konventionen eines Moduls aus dem Modulverzeichnis; liefert den Grund, warum es nicht geladen
 * wird, sonst `null`. Ordnername = Modul-ID, `atrium-module.json` vorhanden, `def.migrations` = alle Dateien
 * `migrations/*.sql` in Namensreihenfolge (nur so kann die Installationsvorschau Migrationen ohne
 * Modulcode erkennen).
 */
export function conventionProblem(
	folder: string,
	def: ModuleDefinition | undefined,
	migrationFiles: string[]
): string | null {
	const p = conventionMessageFor(folder, def, migrationFiles);
	return p ? t(p.key, p.params) : null;
}

/**
 * Wie `conventionProblem`, aber als i18n-Schlüssel (Anzeige später in der Sprache des Requests); auch für
 * vorkompilierte Bundles (`migrationFiles` = Migrationsnamen aus `meta.json`)
 */
export function conventionMessageFor(
	folder: string,
	def: ModuleDefinition | undefined,
	migrationFiles: string[]
): { key: string; params?: MessageParams } | null {
	if (!def?.manifest) return { key: 'modules.convention.noDefinition' };
	if (def.manifest.id !== folder)
		return { key: 'modules.convention.folderMismatch', params: { folder, id: def.manifest.id } };
	if (def.package === undefined) return { key: 'modules.convention.noPackage' };
	const names = (def.migrations ?? []).map((m) => m.name);
	if (names.join('\n') !== migrationFiles.join('\n')) {
		return {
			key: 'modules.convention.migrationsMismatch',
			params: { declared: names.join(', ') || '–', files: migrationFiles.join(', ') || '–' }
		};
	}
	return null;
}

export type ModuleEntry = (typeof entries)[number];

/**
 * Name des fehlenden npm-Pakets aus einer Importfehlermeldung (Bun: „Cannot find package 'x' from …“,
 * Node: „Cannot find package 'x' imported from …“, auch „Cannot find module 'x'“). Unterpfade werden auf den
 * Paketnamen gekürzt (`@scope/name/sub` → `@scope/name`); relative oder absolute Pfade sind kein Paket → `null`.
 */
export function missingPackageName(error: unknown): string | null {
	const message = error instanceof Error ? error.message : String(error);
	const m = /Cannot find (?:package|module) ['"]([^'"]+)['"]/.exec(message);
	const spec = m?.[1];
	if (!spec || /^(\.|\/|[a-zA-Z]:[\\/]|file:|node:)/.test(spec)) return null;
	const parts = spec.split('/');
	return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** Grund für ein Modul, dessen `module.ts` (bzw. Bundle) sich nicht importieren ließ */
export function importProblem(error: unknown): { key: string; params: MessageParams } {
	const name = missingPackageName(error);
	if (name) return { key: 'modules.broken.missingPackage', params: { name } };
	const message = error instanceof Error ? error.message : String(error);
	return { key: 'modules.broken.importFailed', params: { error: message.slice(0, 300) } };
}

/**
 * Build-Zeit-Entdeckung: jedes `modules/<id>/module.ts` (Verzeichnis aus `tools/modules-dir.js`, eingebunden über
 * `virtual:atrium-modules/server`) exportiert per Default eine `defineModule(...)`-Definition. Hier wird nichts
 * aktiviert – nur registriert. Ungültige Module brechen den Start nicht ab, sondern werden als defekt gemerkt –
 * auch, wenn schon der Import scheitert (z. B. fehlendes npm-Paket nach einem Core-Update).
 */
export async function loadBuiltInModules(list: readonly ModuleEntry[] = entries): Promise<void> {
	for (const { folder, load, migrationFiles } of list) {
		let definition: ModuleDefinition | undefined;
		try {
			definition = (await load()).default;
		} catch (e) {
			if (getDefinition(folder)) continue;
			markModuleBroken({ id: folder, name: folder, version: null, reason: importProblem(e) });
			continue;
		}
		if (definition?.manifest && getDefinition(definition.manifest.id)) continue;
		const entry = {
			id: definition?.manifest?.id ?? folder,
			name: definition?.manifest?.name ?? folder,
			version: definition?.manifest?.version ?? null
		};
		const problem = conventionMessageFor(folder, definition, migrationFiles);
		if (problem || !definition) {
			markModuleBroken({ ...entry, reason: problem ?? { key: 'modules.convention.noDefinition' } });
			continue;
		}
		try {
			registerModule(definition);
		} catch (e) {
			markModuleBroken({ ...entry, reason: e instanceof Error ? e.message : String(e) });
		}
	}
}
