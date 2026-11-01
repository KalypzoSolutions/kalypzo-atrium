// Virtuelle Module aus `tools/vite-plugin-atrium-modules.ts`.

declare module 'virtual:atrium-modules/server' {
	import type { ModuleDefinition } from '$lib/server/core/modules/types';
	/** Alle installierten Module (Ordner `modules/<folder>`), sortiert nach Ordnername */
	export const entries: {
		folder: string;
		/** Default-Export von `module.ts` */
		definition: ModuleDefinition;
		/** Namen der Dateien `migrations/*.sql` ohne Endung, sortiert */
		migrationFiles: string[];
	}[];
}

declare module 'virtual:atrium-modules/ui' {
	import type { ModuleUi } from '$lib/sdk/types/module-ui';
	/** Lazy-Loader der `modules/<id>/ui.ts` je Modul-ID */
	export const uiLoaders: Record<string, () => Promise<{ default: ModuleUi }>>;
	/** IDs der Module mit Oberfläche */
	export const moduleIds: string[];
}

declare module 'virtual:atrium-modules/messages' {
	/** Texte der Module: Modul-ID → Sprache → (verschachtelte) Nachrichten aus `messages/<sprache>.json` */
	const messages: Record<string, Record<string, Record<string, unknown>>>;
	export default messages;
}
