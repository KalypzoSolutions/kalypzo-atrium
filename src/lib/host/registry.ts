/**
 * Host-Registry (Client und Server): gibt separat kompilierten Modul-Bundles die **Instanzen des Core** – Svelte-Laufzeit,
 * `$app/*`, SDK, UI-Bausteine – statt eigener Kopien (sonst getrennte Kontexte, Stores, Texte, Toasts).
 *
 * Die Loader-Liste kommt selbst erst bei Bedarf (`virtual:atrium-host-map/<seite>`), damit der Einstieg jeder Seite
 * klein bleibt. Ein Bundle meldet die benötigten Schlüssel; der Lader ruft vorher `preload(keys)` auf, danach liefert
 * `get(key)` synchron den Modul-Namespace (umgeschriebene Importe im Bundle:
 * `const $ = __atriumHost.get('svelte/internal/client')`).
 */

export type HostLoader = () => Promise<Record<string, unknown>>;
export type HostLoaders = Record<string, HostLoader>;

export interface AtriumHost {
	/** Kennung der ABI (Core-/Svelte-Version + Schlüssel); Bundles mit anderer Kennung passen nicht */
	readonly abi: string;
	/** Alle bekannten Schlüssel (lädt die Loader-Liste) */
	keys(): Promise<string[]>;
	/** Lädt die Einträge (parallel); unbekannte Schlüssel → Fehler mit Liste */
	preload(keys: readonly string[]): Promise<void>;
	/**
	 * Vorgeladener Namespace; nicht vorgeladen oder unbekannt → Fehler. `names`: Exporte, die das Bundle braucht –
	 * fehlt einer (Core-Update hat ihn entfernt), gibt es sofort einen klaren Fehler statt später `undefined`.
	 */
	get(key: string, names?: readonly string[]): Record<string, unknown>;
}

declare global {
	var __atriumHost: AtriumHost | undefined;
}

/** `loaders`: Liste direkt oder Funktion, die sie nachlädt (einmal) */
export function createHost(
	loaders: HostLoaders | (() => Promise<HostLoaders>),
	abi: string
): AtriumHost {
	let map: HostLoaders | undefined = typeof loaders === 'function' ? undefined : loaders;
	let mapPromise: Promise<HostLoaders> | undefined;
	const getMap = async (): Promise<HostLoaders> => {
		if (map) return map;
		mapPromise ??= (loaders as () => Promise<HostLoaders>)().then(
			(m) => (map = m),
			(e: unknown) => {
				mapPromise = undefined;
				throw e;
			}
		);
		return mapPromise;
	};
	const loaded = new Map<string, Record<string, unknown>>();
	const pending = new Map<string, Promise<void>>();
	const load = (m: HostLoaders, key: string): Promise<void> => {
		if (loaded.has(key)) return Promise.resolve();
		let p = pending.get(key);
		if (!p) {
			p = m[key]!().then((ns) => {
				loaded.set(key, ns);
			});
			p.finally(() => pending.delete(key)).catch(() => {});
			pending.set(key, p);
		}
		return p;
	};
	return {
		abi,
		keys: async () => Object.keys(await getMap()).sort(),
		async preload(keys) {
			const m = await getMap();
			const unknown = keys.filter((k) => !Object.hasOwn(m, k));
			if (unknown.length) throw new Error(`Nicht Teil der Host-ABI: ${unknown.join(', ')}`);
			await Promise.all(keys.map((k) => load(m, k)));
		},
		get(key, names) {
			const ns = loaded.get(key);
			if (ns) {
				const missing = (names ?? []).filter((n) => !(n in ns));
				if (missing.length)
					throw new Error(`Host-Modul „${key}“ hat keinen Export ${missing.join(', ')}`);
				return ns;
			}
			throw new Error(
				!map || Object.hasOwn(map, key)
					? `Host-Modul „${key}“ wurde nicht vorgeladen`
					: `Nicht Teil der Host-ABI: ${key}`
			);
		}
	};
}

/** Registry global setzen (einmal je Prozess bzw. Seite; spätere Aufrufe behalten die erste) */
export function installHost(
	loaders: HostLoaders | (() => Promise<HostLoaders>),
	abi: string
): AtriumHost {
	globalThis.__atriumHost ??= createHost(loaders, abi);
	return globalThis.__atriumHost;
}

/** Die installierte Registry (Fehler, wenn der Core sie noch nicht gesetzt hat) */
export function host(): AtriumHost {
	const h = globalThis.__atriumHost;
	if (!h) throw new Error('Host-Registry ist noch nicht installiert');
	return h;
}
