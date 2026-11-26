import { uiLoaders } from 'virtual:atrium-modules/ui';
import type { ModuleUi } from '$lib/sdk/types/module-ui';

type UiLoader = () => Promise<{ default: ModuleUi }>;

/** Browser-Angaben eines vorkompilierten Modul-Bundles (aus den Layout-Daten, `core/modules/bundles`) */
export interface ClientBundleRef {
	id: string;
	/** URL-Präfix der Browser-Dateien, endet auf `/` */
	base: string;
	entry: string;
	css: string[];
	/** vor dem Import vorzuladende Host-Schlüssel (`globalThis.__atriumHost`) */
	host: string[];
}

let serverResolver: ((id: string) => UiLoader | undefined) | undefined;
const clientBundles = new Map<string, ClientBundleRef>();
const clientLoaders = new Map<string, UiLoader>();

/** Server: Lader der SSR-Oberflächen vorkompilierter Bundles (setzt `core/modules/bundles`) */
export function setServerUiResolver(resolver: (id: string) => UiLoader | undefined): void {
	serverResolver = resolver;
}

/** Browser: Liste der vorkompilierten Bundles aus den Layout-Daten (Root-`+layout.ts`) */
export function setClientBundles(list: readonly ClientBundleRef[] | undefined): void {
	if (typeof window === 'undefined') return;
	for (const b of list ?? []) {
		if (clientBundles.get(b.id)?.base === b.base) continue;
		clientBundles.set(b.id, b);
		clientLoaders.delete(b.id);
	}
}

function clientLoader(b: ClientBundleRef): UiLoader {
	let cached = clientLoaders.get(b.id);
	if (!cached) {
		const url = new URL(b.base + b.entry, window.location.origin).href;
		cached = async () => {
			const h = globalThis.__atriumHost;
			if (!h) throw new Error('Host-Registry ist nicht installiert');
			await h.preload(b.host);
			return (await import(/* @vite-ignore */ url)) as { default: ModuleUi };
		};
		clientLoaders.set(b.id, cached);
	}
	return cached;
}

/**
 * Lader der Oberfläche (`modules/<id>/ui.ts`) eines installierten Moduls, sonst `undefined`.
 * Eingebaute Module kommen aus dem Build (`tools/vite-plugin-atrium-modules.ts`), vorkompilierte Bundles im Browser
 * über ihre URL und beim Server-Rendering über `setServerUiResolver`. Ob das Modul aktiv ist, prüft weiterhin der
 * Server.
 */
export function moduleUiLoader(moduleId: string): UiLoader | undefined {
	if (Object.hasOwn(uiLoaders, moduleId)) return uiLoaders[moduleId];
	if (typeof window === 'undefined') return serverResolver?.(moduleId);
	const b = clientBundles.get(moduleId);
	return b ? clientLoader(b) : undefined;
}
