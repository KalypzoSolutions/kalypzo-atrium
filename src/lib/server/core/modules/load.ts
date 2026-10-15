import { getDefinition, registerModule } from './registry';
import type { ModuleDefinition } from './types';

/**
 * Build-Zeit-Entdeckung: jedes `src/lib/modules/<id>/module.ts` exportiert per Default
 * eine `defineModule(...)`-Definition. Hier wird nichts aktiviert – nur registriert.
 */
const found = import.meta.glob<{ default: ModuleDefinition }>('/src/lib/modules/*/module.ts', {
	eager: true
});

export function loadBuiltInModules(): void {
	for (const [path, mod] of Object.entries(found)) {
		const def = mod.default;
		if (!def?.manifest) throw new Error(`${path} exportiert keine Moduldefinition`);
		if (!getDefinition(def.manifest.id)) registerModule(def);
	}
}
