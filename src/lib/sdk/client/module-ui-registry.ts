import { uiLoaders } from 'virtual:atrium-modules/ui';
import type { ModuleUi } from '$lib/sdk/types/module-ui';

/**
 * Lader der Oberfläche (`modules/<id>/ui.ts`) eines installierten Moduls, sonst `undefined`.
 * Die Liste entsteht beim Build aus dem Modulverzeichnis (`tools/vite-plugin-atrium-modules.ts`);
 * ob das Modul aktiv ist, prüft weiterhin der Server.
 */
export function moduleUiLoader(
	moduleId: string
): (() => Promise<{ default: ModuleUi }>) | undefined {
	return Object.hasOwn(uiLoaders, moduleId) ? uiLoaders[moduleId] : undefined;
}
