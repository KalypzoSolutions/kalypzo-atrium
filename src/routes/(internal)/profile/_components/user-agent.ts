const MAX_RAW = 60;

/** Rohtext kürzen, damit ungewöhnliche User-Agents (curl, Bots) die Zeile nicht sprengen. */
function shorten(ua: string): string {
	return ua.length > MAX_RAW ? `${ua.slice(0, MAX_RAW - 1)}…` : ua;
}

/**
 * Lesbare Beschreibung eines User-Agents („Chrome auf Windows“). Unbekanntes wird gekürzt
 * als Rohtext gezeigt; ohne Angabe „Unbekanntes Gerät“. Reine Funktion, keine Browser-APIs.
 */
export function describeUserAgent(ua: string | null | undefined): string {
	const s = (ua ?? '').trim();
	if (!s) return 'Unbekanntes Gerät';

	// Reihenfolge ist wichtig: Edge/Opera/Samsung enthalten auch „Chrome“, Chrome enthält „Safari“
	let browser: string | null = null;
	if (/\bEdg(e|A|iOS)?\//.test(s)) browser = 'Edge';
	else if (/\bOPR\/|\bOpera\b/.test(s)) browser = 'Opera';
	else if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet';
	else if (/\bFirefox\/|\bFxiOS\//.test(s)) browser = 'Firefox';
	else if (/\bChrome\/|\bCriOS\//.test(s)) browser = 'Chrome';
	else if (/\bSafari\//.test(s) && /\bVersion\//.test(s)) browser = 'Safari';

	let os: string | null = null;
	if (/\bWindows\b/.test(s)) os = 'Windows';
	else if (/\bAndroid\b/.test(s)) os = 'Android';
	else if (/\biPhone\b|\biPad\b|\biPod\b/.test(s)) os = 'iOS';
	else if (/\bMac OS X\b|\bMacintosh\b/.test(s)) os = 'macOS';
	else if (/\bCrOS\b/.test(s)) os = 'ChromeOS';
	else if (/\bLinux\b|\bX11\b/.test(s)) os = 'Linux';

	if (browser && os) return `${browser} auf ${os}`;
	if (browser) return browser;
	return shorten(s);
}
