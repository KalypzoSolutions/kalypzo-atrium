/** Client-Helfer der Seite „Datensicherung“: JSON-Aufrufe der Endpunkte und Formatierung. */

export type CallResult<T> =
	| { ok: true; data: T }
	| { ok: false; status: number; message: string; fields: Record<string, string> };

/** `details` (`[{ path, message }]`, Pfad als String oder Array) auf Felder abbilden. */
function fieldErrors(details: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!Array.isArray(details)) return out;
	for (const d of details) {
		if (!d || typeof d !== 'object') continue;
		const { path, message } = d as { path?: unknown; message?: unknown };
		if (typeof message !== 'string') continue;
		const key = Array.isArray(path)
			? path.map(String).join('.')
			: typeof path === 'string'
				? path
				: '';
		if (key && !out[key]) out[key] = message;
	}
	return out;
}

async function parse<T>(res: Response): Promise<CallResult<T>> {
	const body = (await res.json().catch(() => null)) as {
		data?: T;
		message?: string;
		details?: unknown;
	} | null;
	if (res.ok) return { ok: true, data: body?.data as T };
	return {
		ok: false,
		status: res.status,
		message: body?.message ?? `Anfrage fehlgeschlagen (${res.status})`,
		fields: fieldErrors(body?.details)
	};
}

const BASE = '/admin/backup';

export async function postJson<T>(path: string, body: unknown): Promise<CallResult<T>> {
	try {
		const res = await fetch(BASE + path, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		return await parse<T>(res);
	} catch {
		return { ok: false, status: 0, message: 'Server nicht erreichbar', fields: {} };
	}
}

export async function getJson<T>(path: string): Promise<CallResult<T>> {
	try {
		const res = await fetch(BASE + path, { credentials: 'same-origin' });
		return await parse<T>(res);
	} catch {
		return { ok: false, status: 0, message: 'Server nicht erreichbar', fields: {} };
	}
}

export async function putChunk<T>(path: string, chunk: Blob): Promise<CallResult<T>> {
	try {
		const res = await fetch(BASE + path, {
			method: 'PUT',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/octet-stream' },
			body: chunk
		});
		return await parse<T>(res);
	} catch {
		return { ok: false, status: 0, message: 'Verbindung beim Hochladen unterbrochen', fields: {} };
	}
}

export const fmt = (n: number) => n.toLocaleString('de-DE');

export function fmtBytes(bytes: number): string {
	if (bytes < 1024) return `${fmt(bytes)} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let v = bytes / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${units[i]}`;
}

export function fmtDateTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return (
		d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
		', ' +
		d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) +
		' Uhr'
	);
}

export const percent = (done: number, total: number) =>
	total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0;

/** Grobe Passwortstärke (0–4) für den Hinweis unter dem Sicherungs-Passwort. */
export function passwordStrength(pw: string): { score: number; label: string } {
	if (!pw) return { score: 0, label: '' };
	let score = 0;
	if (pw.length >= 12) score++;
	if (pw.length >= 16) score++;
	const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
	if (classes >= 3) score++;
	if (pw.length >= 20 || (classes === 4 && pw.length >= 14)) score++;
	if (/^(.)\1+$/.test(pw)) score = 0;
	const labels = ['Sehr schwach', 'Schwach', 'Mittel', 'Gut', 'Stark'];
	return { score, label: labels[score] ?? '' };
}

/** Automatisch mitgehende Bereiche (transitiv) mit Auslöser und Begründung. */
export function impliedOf(
	chosen: string[],
	scopes: Map<string, { implies: { scope: string; reason: string }[] }>
): Map<string, { by: string; reason: string }> {
	const explicit = new Set(chosen);
	const out = new Map<string, { by: string; reason: string }>();
	const queue = [...chosen];
	while (queue.length) {
		const key = queue.shift()!;
		for (const imp of scopes.get(key)?.implies ?? []) {
			if (explicit.has(imp.scope) || out.has(imp.scope) || !scopes.has(imp.scope)) continue;
			out.set(imp.scope, { by: key, reason: imp.reason });
			queue.push(imp.scope);
		}
	}
	return out;
}
