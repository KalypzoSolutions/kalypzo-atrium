import { entries } from 'virtual:atrium-modules/server';
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
	if (!def?.manifest) return 'module.ts exportiert keine Moduldefinition';
	if (def.manifest.id !== folder) return `Ordner „${folder}“ ≠ Modul-ID „${def.manifest.id}“`;
	if (def.package === undefined) return 'atrium-module.json fehlt (`package` in defineModule)';
	const names = (def.migrations ?? []).map((m) => m.name);
	if (names.join('\n') !== migrationFiles.join('\n')) {
		return `Migrationen in module.ts (${names.join(', ') || '–'}) ≠ Dateien in migrations/ (${migrationFiles.join(', ') || '–'})`;
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
		const problem = conventionProblem(folder, definition, migrationFiles);
		try {
			if (problem) throw new Error(problem);
			registerModule(definition);
		} catch (e) {
			markModuleBroken({
				id: definition?.manifest?.id ?? folder,
				name: definition?.manifest?.name ?? folder,
				version: definition?.manifest?.version ?? null,
				reason: e instanceof Error ? e.message : String(e)
			});
		}
	}
}
