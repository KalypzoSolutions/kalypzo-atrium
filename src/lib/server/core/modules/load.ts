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
	const p = conventionMessage(folder, def, migrationFiles);
	return p ? t(p.key, p.params) : null;
}

/** Wie `conventionProblem`, aber als i18n-Schlüssel (Anzeige später in der Sprache des Requests) */
function conventionMessage(
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

/**
 * Build-Zeit-Entdeckung: jedes `modules/<id>/module.ts` (Verzeichnis aus `tools/modules-dir.js`, eingebunden über
 * `virtual:atrium-modules/server`) exportiert per Default eine `defineModule(...)`-Definition. Hier wird nichts
 * aktiviert – nur registriert. Ungültige Module brechen den Start nicht ab, sondern werden als defekt gemerkt.
 */
export function loadBuiltInModules(): void {
	for (const { folder, definition, migrationFiles } of entries) {
		if (definition?.manifest && getDefinition(definition.manifest.id)) continue;
		const entry = {
			id: definition?.manifest?.id ?? folder,
			name: definition?.manifest?.name ?? folder,
			version: definition?.manifest?.version ?? null
		};
		const problem = conventionMessage(folder, definition, migrationFiles);
		if (problem) {
			markModuleBroken({ ...entry, reason: problem });
			continue;
		}
		try {
			registerModule(definition);
		} catch (e) {
			markModuleBroken({ ...entry, reason: e instanceof Error ? e.message : String(e) });
		}
	}
}
