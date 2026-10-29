/** SSE-Antwort für `POST /ai/assist`: `delta`-Ereignisse während der Erzeugung, dann `done` oder `error`. */
import type { AssistEvent, AssistResult } from '$lib/sdk/types';
import { logError } from '../../db-errors';
import { isCoreError } from '../../errors';

export function assistStreamResponse(
	run: (onDelta: (text: string) => void, signal: AbortSignal) => Promise<AssistResult>,
	info: { requestId: string; signal?: AbortSignal }
): Response {
	const encoder = new TextEncoder();
	let closed = false;
	// Browser weg (Abbrechen, Dialog zu): Erzeugung beim Anbieter abbrechen statt bis zum Ende laufen lassen
	const abort = new AbortController();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (event: AssistEvent) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					closed = true;
				}
			};
			const close = () => {
				if (closed) return;
				closed = true;
				try {
					controller.close();
				} catch {
					// bereits geschlossen
				}
			};
			info.signal?.addEventListener(
				'abort',
				() => {
					abort.abort();
					close();
				},
				{ once: true }
			);
			run((text) => send({ type: 'delta', text }), abort.signal)
				.then((result) => send({ type: 'done', ...result }))
				.catch((e: unknown) => {
					if (isCoreError(e)) {
						send({ type: 'error', message: e.message, code: e.code });
					} else {
						logError('[ai.assist] Erzeugung fehlgeschlagen', e, { requestId: info.requestId });
						send({ type: 'error', message: 'Die Schreibhilfe ist gerade nicht erreichbar' });
					}
				})
				.finally(close);
		},
		cancel() {
			closed = true;
			abort.abort();
		}
	});
	return new Response(stream, {
		status: 200,
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-store, no-transform',
			'x-accel-buffering': 'no'
		}
	});
}
