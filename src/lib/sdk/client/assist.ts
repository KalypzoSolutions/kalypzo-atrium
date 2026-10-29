/**
 * Client der KI-Schreibhilfe: Status (einmal je Seitenladung) und Anfrage als Server-Sent Events.
 * Oberfläche: `WritingAssistant` & Co. in `$lib/components/layout`.
 */
import type {
	ApiErrorBody,
	AssistEvent,
	AssistRequest,
	AssistResult,
	AssistStatus
} from '$lib/sdk/types';
import { ApiClientError, apiFetch } from './index';

let statusPromise: Promise<AssistStatus> | null = null;

const OFF: AssistStatus = {
	configured: false,
	modules: [],
	purposes: {},
	allowInbox: false,
	allowImages: false,
	address: 'du'
};

/** Status der Schreibhilfe; Fehler → „nicht verfügbar“ (Knopf bleibt aus) */
export function assistStatus(): Promise<AssistStatus> {
	// Beim Server-Rendering nie abfragen/cachen (der Cache gälte sonst für alle Personen)
	if (typeof window === 'undefined') return Promise.resolve(OFF);
	statusPromise ??= apiFetch<AssistStatus>('/ai/assist/status').catch(() => {
		statusPromise = null;
		return OFF;
	});
	return statusPromise;
}

/** Nur für Tests / nach Einstellungsänderungen */
export function resetAssistStatus(): void {
	statusPromise = null;
}

/** Zerlegt einen SSE-Puffer in Ereignisse; Rückgabe = unvollständiger Rest */
export function parseSseChunk(buffer: string, onEvent: (event: AssistEvent) => void): string {
	const parts = buffer.split('\n\n');
	const rest = parts.pop() ?? '';
	for (const part of parts) {
		const data = part
			.split('\n')
			.filter((l) => l.startsWith('data:'))
			.map((l) => l.slice(5).trimStart())
			.join('\n');
		if (!data) continue;
		try {
			onEvent(JSON.parse(data) as AssistEvent);
		} catch {
			// unvollständige oder fremde Zeile ignorieren
		}
	}
	return rest;
}

/**
 * Fordert einen Vorschlag an. `onDelta` erhält den bisher gestreamten Text (nur Vorschau).
 * Wirft `ApiClientError` bei HTTP-Fehlern und Fehler-Ereignissen.
 */
export async function requestAssist(
	req: AssistRequest,
	opts: { onDelta?: (soFar: string) => void; signal?: AbortSignal } = {}
): Promise<AssistResult> {
	const res = await fetch('/api/v1/ai/assist', {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
		body: JSON.stringify(req),
		credentials: 'same-origin',
		signal: opts.signal
	});
	if (!res.ok || !res.body) {
		const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
		throw new ApiClientError(
			res.status,
			body?.error.code ?? 'unknown',
			body?.error.message ?? 'Die Schreibhilfe ist gerade nicht erreichbar',
			body?.error.details
		);
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let soFar = '';
	let result: AssistResult | null = null;
	let failure: ApiClientError | null = null;
	const onEvent = (event: AssistEvent) => {
		if (event.type === 'delta') {
			soFar += event.text;
			opts.onDelta?.(soFar);
		} else if (event.type === 'done') {
			const { type: _type, ...rest } = event;
			result = rest;
		} else {
			failure = new ApiClientError(422, event.code ?? 'assist_failed', event.message);
		}
	};
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer = parseSseChunk(buffer + decoder.decode(value, { stream: true }), onEvent);
	}
	parseSseChunk(buffer + '\n\n', onEvent);
	if (failure) throw failure;
	if (!result)
		throw new ApiClientError(503, 'assist_incomplete', 'Die Antwort kam nicht vollständig an');
	return result;
}
