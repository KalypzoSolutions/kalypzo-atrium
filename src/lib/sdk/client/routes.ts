/**
 * Routen-Abgleich fuer Modul-Oberflaechen: exakte Pfade und Muster mit `:param`-Segmenten.
 * Reine Funktion ohne Abhaengigkeiten (auch im Server-/Test-Kontext nutzbar).
 */
export interface RouteMatch {
	/** Schluessel in `ui.routes`, der gepasst hat */
	key: string;
	params: Record<string, string>;
}

const trim = (p: string) => p.replace(/^\/+|\/+$/g, '');

export function matchModuleRoute(keys: readonly string[], path: string): RouteMatch | null {
	const target = trim(path);
	if (keys.includes(target)) return { key: target, params: {} };

	const segments = target === '' ? [] : target.split('/');
	for (const key of keys) {
		const pattern = trim(key);
		if (!pattern.includes(':')) continue;
		const parts = pattern === '' ? [] : pattern.split('/');
		if (parts.length !== segments.length) continue;
		const params: Record<string, string> = {};
		let ok = true;
		for (const [i, part] of parts.entries()) {
			const seg = segments[i]!;
			if (part.startsWith(':')) {
				if (seg === '') {
					ok = false;
					break;
				}
				try {
					params[part.slice(1)] = decodeURIComponent(seg);
				} catch {
					ok = false;
					break;
				}
			} else if (part !== seg) {
				ok = false;
				break;
			}
		}
		if (ok) return { key, params };
	}
	return null;
}
