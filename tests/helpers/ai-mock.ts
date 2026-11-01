/**
 * OpenAI-kompatibler KI-Ersatz für E2E-Tests (`POST /v1/chat/completions`, mit und ohne Stream).
 * Antwortet mit `reply` (Text) bzw. bei JSON-Anfragen mit `json`. Port 0 = frei gewählt.
 */
import { createServer, type Server } from 'node:http';

export interface AiMock {
	baseUrl: string;
	requests: { messages: unknown[]; stream: boolean }[];
	reply: string;
	json: string;
	close(): Promise<void>;
}

export async function startAiMock(): Promise<AiMock> {
	const mock: Omit<AiMock, 'baseUrl' | 'close'> = {
		requests: [],
		reply: '<p>Hallo ihr Lieben, die Herbstfahrt startet bald. Viele Grüße!</p>',
		json: JSON.stringify({ variants: ['Herbstfahrt: alle Infos', 'Bald geht es los'] })
	};
	const server: Server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
		req.on('end', () => {
			if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
				res.writeHead(404).end();
				return;
			}
			const body = JSON.parse(raw || '{}') as {
				messages?: unknown[];
				stream?: boolean;
				response_format?: { type?: string };
			};
			mock.requests.push({ messages: body.messages ?? [], stream: !!body.stream });
			const text = body.response_format?.type === 'json_object' ? mock.json : mock.reply;
			const usage = { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 };
			if (!body.stream) {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(
					JSON.stringify({
						id: 'mock',
						object: 'chat.completion',
						created: 0,
						model: 'mock',
						choices: [
							{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }
						],
						usage
					})
				);
				return;
			}
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
				`data: ${JSON.stringify({
					id: 'mock',
					object: 'chat.completion.chunk',
					created: 0,
					model: 'mock',
					choices: [{ index: 0, delta, finish_reason: null }],
					...extra
				})}\n\n`;
			for (const part of text.match(/.{1,12}/gs) ?? []) res.write(chunk({ content: part }));
			res.write(
				`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [], usage })}\n\n`
			);
			res.end('data: [DONE]\n\n');
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	return Object.assign(mock, {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve()))
	}) as AiMock;
}
