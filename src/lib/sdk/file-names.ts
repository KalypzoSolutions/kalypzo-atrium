/**
 * Einheitliche Dateinamen-Bereinigung (#33). Rein, für Server und Browser.
 * Für `content-disposition` mit UTF-8-Namen `contentDisposition` aus `$lib/sdk/server` nutzen.
 */

export interface SafeFileNameOptions {
	/** Ersatz für unerlaubte Zeichen (Standard `_`) */
	replacement?: '_' | '-';
	/** Höchstlänge inkl. Endung (Standard 100) */
	maxLength?: number;
	/** Ergebnis bei leerem Namen (Standard `datei`) */
	fallback?: string;
	/** Deutsche Umlaute ausschreiben (ä → ae, ß → ss) statt nur Akzente zu entfernen (ä → a) */
	german?: boolean;
}

const GERMAN: Record<string, string> = {
	ä: 'ae',
	ö: 'oe',
	ü: 'ue',
	Ä: 'Ae',
	Ö: 'Oe',
	Ü: 'Ue',
	ß: 'ss'
};

/**
 * Dateiname für Storage-Pfade und ASCII-`filename`: Akzente entfernen (bzw. Umlaute ausschreiben), alles außer
 * `A–Z a–z 0–9 . _ -` → `_` (bzw. `-`), keine führenden/abschließenden `._-`, gekürzt unter Erhalt der Endung.
 * Pfadteile (`../`) bleiben nie erhalten.
 */
export function safeFileName(name: string, opts: SafeFileNameOptions = {}): string {
	const rep = opts.replacement ?? '_';
	const max = Math.max(8, opts.maxLength ?? 100);
	let s = String(name ?? '').normalize('NFC');
	if (opts.german) s = s.replace(/[äöüÄÖÜß]/g, (c) => GERMAN[c] ?? c);
	let cleaned = s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, rep)
		.replace(/^[._-]+/, '')
		.replace(/[._-]+$/, '');
	if (cleaned.length > max) {
		const ext = /\.[A-Za-z0-9]{1,10}$/.exec(cleaned)?.[0] ?? '';
		cleaned = cleaned.slice(0, max - ext.length).replace(/[._-]+$/, '') + ext;
	}
	return cleaned || opts.fallback || 'datei';
}
