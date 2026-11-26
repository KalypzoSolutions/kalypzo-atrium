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

declare module 'virtual:atrium-core/messages' {
	/** Deutsche Core-Texte, sofort geladen: `./messages/de/<bereich>.json` → Inhalt */
	export const eager: Record<string, unknown>;
	/** Alle Core-Texte als Lazy-Loader: `./messages/<sprache>/<bereich>.json` → Inhalt */
	export const lazy: Record<string, () => Promise<unknown>>;
}

declare module 'virtual:atrium-core/pdf-templates' {
	import type { PdfTemplate } from '$lib/server/core/pdf/templates';
	/** Default-Exporte aller `src/lib/server/core/pdf/templates/*.ts` */
	export const templates: PdfTemplate[];
}

declare module 'virtual:atrium-core/fonts' {
	/** Carlito Regular als Data-URL (`data:font/ttf;base64,…`) */
	export const regular: string;
	/** Carlito Bold als Data-URL */
	export const bold: string;
}
