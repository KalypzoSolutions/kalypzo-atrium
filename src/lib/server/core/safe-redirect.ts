/**
 * Open-Redirect-Schutz: nur echte relative Pfade derselben Origin zulassen.
 *
 * Eine reine String-Präfixprüfung reicht nicht – Browser entfernen beim URL-Parsen Tab/CR/LF und
 * behandeln `\` wie `/`, sodass z. B. `/<TAB>/evil.example` oder `/\evil.example` zu einer
 * protokollrelativen URL auf einen fremden Host werden. Deshalb: Vorab-Ablehnung gefährlicher
 * Zeichen (roh und URL-kodiert), danach Auflösung gegen eine Dummy-Basis per WHATWG-URL-Parser
 * und Vergleich der Origin. Zurückgegeben wird nur `pathname + search + hash` des Ergebnisses.
 */

const BASE = new URL('http://safe-redirect.invalid');
const MAX_LENGTH = 2048;

/** Steuerzeichen (`\p{Cc}`), sonstige Leerzeichen (inkl. Unicode) und Backslash. */
const FORBIDDEN_RAW = /[\p{Cc}\s\\]/u;
/** URL-kodierte Steuerzeichen (`%00`–`%1F`, `%7F`) und kodierter Backslash (`%5C`). */
const FORBIDDEN_ENCODED = /%(?:[01][0-9a-f]|7f|5c)/i;

/**
 * Liefert den normalisierten relativen Pfad (`/pfad?query#hash`) oder `null`, wenn `target` kein
 * sicherer Pfad derselben Origin ist (absolut, protokollrelativ, Steuerzeichen, Backslash …).
 */
export function safeRelativePath(target: unknown): string | null {
	if (typeof target !== 'string' || target.length === 0 || target.length > MAX_LENGTH) return null;
	if (!target.startsWith('/') || target.startsWith('//')) return null;
	if (FORBIDDEN_RAW.test(target) || FORBIDDEN_ENCODED.test(target)) return null;
	let url: URL;
	try {
		url = new URL(target, BASE);
	} catch {
		return null;
	}
	if (url.origin !== BASE.origin) return null;
	const out = `${url.pathname}${url.search}${url.hash}`;
	// Normalisierung kann `//` erzeugen (z. B. `/.//evil.example` → `//evil.example`)
	if (!out.startsWith('/') || out.startsWith('//')) return null;
	return out;
}

/** `true`, wenn `href` ein sicherer relativer App-Pfad ist (z. B. für Links aus Suchtreffern). */
export function isSafeRelativeHref(href: unknown): href is string {
	return safeRelativePath(href) !== null;
}

/**
 * Weiterleitungsziel prüfen: sicherer relativer Pfad oder `fallback`. Ziele in `excludePrefixes`
 * (ganze Pfadsegmente, z. B. `/login` sperrt `/login` und `/login/…`, nicht `/login-hilfe`)
 * führen ebenfalls zum Fallback.
 */
export function safeRedirect(
	target: string | null | undefined,
	fallback = '/',
	excludePrefixes: readonly string[] = []
): string {
	const path = safeRelativePath(target);
	if (!path) return fallback;
	const pathname = path.replace(/[?#].*$/s, '');
	for (const p of excludePrefixes) {
		if (pathname === p || pathname.startsWith(`${p}/`)) return fallback;
	}
	return path;
}
