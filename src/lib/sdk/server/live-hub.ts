/**
 * Generischer Live-Hub (Server-Sent Events) für Module: je Objekt die offenen Verbindungen (eine je Browser-Tab =
 * `client`), Heartbeat, Wiederverbinden mit derselben Kennung, Grenze je Konto und regelmäßige Zugriffsprüfung.
 * Verteilung bewusst im Prozess – der Betrieb läuft mit EINER App-Instanz (mehrere bräuchten LISTEN/NOTIFY).
 * Erste Nutzerin: `notes` (Yjs-Dokumente); `whiteboard` hat noch eine eigene, gleich aufgebaute Kopie.
 *
 *   const hub = createLiveHub<Level, Peer>({ name: 'notes', resolveLevel, maxStreamsPerUser: 30 });
 *   return hub.open({ ctx, request, objectId, client, level, peer, onOpen: async (push) => push({ type: 'hello' }) });
 *
 * `resolveLevel` läuft in eigener Transaktion (nie aus einer offenen heraus aufrufen); ohne Zugriff → `revoked`
 * und die Verbindung schließt, geänderte Stufe → `access` (+ `onLevelChange`).
 */
import type { RequestContext } from '$lib/sdk/types';
import { core } from '$lib/server/core';
import { errors } from '$lib/server/core/errors';

/** Nur die Anmeldedaten einer Anfrage (für die spätere Neuprüfung der Sitzung) */
export function authHeadersOf(request: Request): Headers {
	const headers = new Headers();
	for (const name of ['authorization', 'cookie']) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	return headers;
}

/**
 * Kontext einer offenen Verbindung neu auflösen: Sitzung bzw. API-Key noch gültig, Konto aktiv, aktuelle Rechte.
 * `null` = nicht mehr angemeldet (Verbindung schließen). System-Kontexte bleiben unverändert.
 */
export async function refreshLiveContext(
	ctx: RequestContext,
	headers: Headers
): Promise<RequestContext | null> {
	if (ctx.actor.type === 'system') return ctx;
	const meta = { ip: ctx.ip, requestId: ctx.requestId };
	const authz = headers.get('authorization');
	const fresh = authz
		? await core.auth.resolveApiKey(/^Bearer\s+(\S+)$/i.exec(authz)?.[1] ?? '', meta)
		: await core.auth.resolveSession(headers, meta);
	if (!fresh || fresh.ctx.userId !== ctx.userId) return null;
	return fresh.ctx;
}

export interface LiveSubscriber<L extends string, P> {
	client: string;
	objectId: string;
	/** Konto bzw. `subject` der Verbindung (Gäste ohne Konto) */
	userId: string;
	/** Kontext der letzten Prüfung (wird bei jeder Neuprüfung neu aufgelöst) */
	ctx: RequestContext;
	level: L;
	peer: P;
	push(event: unknown): void;
	close(): void;
}

export interface LiveHubOptions<L extends string, P> {
	/** Kurzname für Logmeldungen */
	name: string;
	/** Zugriffsstufe neu ermitteln (`null` = kein Zugriff mehr) */
	resolveLevel(ctx: RequestContext, objectId: string): Promise<L | null>;
	/** Nach einer geänderten Stufe (z. B. Anwesenheit neu verteilen) */
	onLevelChange?(sub: LiveSubscriber<L, P>, level: L): void;
	/** Wenn eine Verbindung endet (z. B. `leave` verteilen) */
	onLeave?(sub: LiveSubscriber<L, P>, remaining: number): void;
	maxStreamsPerUser: number;
	heartbeatMs?: number;
	recheckMs?: number;
}

export interface LiveOpenInput<L extends string, P> {
	ctx: RequestContext;
	request: Request;
	objectId: string;
	client: string;
	level: L;
	peer: P;
	/**
	 * Identität statt `ctx.userId` (Gäste über öffentliche Links, z. B. `guest:<hash>`): gilt für die Kennungsprüfung
	 * und `streamCount`. Ohne Angabe = Konto.
	 */
	subject?: string;
	/**
	 * Eigene Neuprüfung statt Sitzung + `resolveLevel` (Gäste: Link noch gültig?). `null` = Zugriff weg.
	 */
	recheck?: () => Promise<L | null>;
	/** Nach dem Anmelden: Startereignisse schicken (Fehler schließen die Verbindung) */
	onOpen(push: (event: unknown) => void, sub: LiveSubscriber<L, P>): Promise<void>;
}

export interface LiveHub<L extends string, P> {
	open(input: LiveOpenInput<L, P>): Response;
	broadcast(objectId: string, event: unknown, exceptClient?: string): void;
	subscribers(objectId: string): LiveSubscriber<L, P>[];
	get(objectId: string, client: string): LiveSubscriber<L, P> | undefined;
	streamCount(userId: string): number;
	/** Verbindungen, auf die `match` zutrifft (z. B. Gäste je IP) */
	countWhere(match: (sub: LiveSubscriber<L, P>) => boolean): number;
	/** Objekte mit offenen Verbindungen */
	openObjects(): string[];
	/** Alle Verbindungen eines Objekts sofort neu prüfen */
	recheck(objectId: string): Promise<void>;
	/** Alle Verbindungen eines Objekts mit einem letzten Ereignis schließen */
	closeObject(objectId: string, event?: unknown): void;
	closeAll(event?: unknown): void;
}

const encoder = new TextEncoder();

export function createLiveHub<L extends string, P>(options: LiveHubOptions<L, P>): LiveHub<L, P> {
	const heartbeatMs = options.heartbeatMs ?? 20_000;
	const recheckMs = options.recheckMs ?? 60_000;
	const objects = new Map<string, Map<string, LiveSubscriber<L, P>>>();
	const headersOf = new WeakMap<LiveSubscriber<L, P>, Headers>();
	const customRecheck = new WeakMap<LiveSubscriber<L, P>, () => Promise<L | null>>();

	function subscribersOf(objectId: string): Map<string, LiveSubscriber<L, P>> {
		let map = objects.get(objectId);
		if (!map) {
			map = new Map();
			objects.set(objectId, map);
		}
		return map;
	}

	function remove(sub: LiveSubscriber<L, P>): void {
		const map = objects.get(sub.objectId);
		if (!map || map.get(sub.client) !== sub) return;
		map.delete(sub.client);
		if (!map.size) objects.delete(sub.objectId);
		options.onLeave?.(sub, map.size);
	}

	function broadcast(objectId: string, event: unknown, exceptClient?: string): void {
		const map = objects.get(objectId);
		if (!map) return;
		for (const sub of map.values()) if (sub.client !== exceptClient) sub.push(event);
	}

	async function recheckOne(sub: LiveSubscriber<L, P>): Promise<void> {
		let level: L | null;
		try {
			const own = customRecheck.get(sub);
			if (own) {
				level = await own();
			} else {
				// Sitzung, Konto und Rechte neu auflösen – Rollenentzug, Abmelden oder Deaktivieren wirken sofort
				const fresh = await refreshLiveContext(sub.ctx, headersOf.get(sub) ?? new Headers());
				if (fresh) sub.ctx = fresh;
				level = fresh ? await options.resolveLevel(fresh, sub.objectId) : null;
			}
		} catch (e) {
			// Datenbank kurz nicht erreichbar: offen lassen, nächster Versuch beim nächsten Takt
			console.warn(`[${options.name}] Zugriffsprüfung fehlgeschlagen`, e);
			return;
		}
		if (!level) {
			sub.push({ type: 'revoked' });
			sub.close();
			return;
		}
		if (level !== sub.level) {
			sub.level = level;
			sub.push({ type: 'access', level });
			options.onLevelChange?.(sub, level);
		}
	}

	function open(input: LiveOpenInput<L, P>): Response {
		const { ctx, objectId, client } = input;
		const subject = input.subject ?? ctx.userId ?? '';
		// fremde Kennung übernehmen (Kennungen stehen in `hello`) wäre ein Rauswurf anderer Personen
		const existing = objects.get(objectId)?.get(client);
		if (existing && existing.userId !== subject) {
			throw errors.conflict('Diese Verbindungskennung ist bereits vergeben');
		}
		const authHeaders = authHeadersOf(input.request);
		let sub: LiveSubscriber<L, P> | null = null;
		let closed = false;
		const timers: ReturnType<typeof setInterval>[] = [];

		const cleanup = () => {
			if (closed) return;
			closed = true;
			for (const t of timers) clearInterval(t);
			if (sub) remove(sub);
		};

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const write = (chunk: string) => {
					if (closed) return;
					try {
						controller.enqueue(encoder.encode(chunk));
					} catch {
						cleanup();
					}
				};
				const push = (event: unknown) => write(`data: ${JSON.stringify(event)}\n\n`);
				const current: LiveSubscriber<L, P> = {
					client,
					objectId,
					userId: subject,
					ctx,
					level: input.level,
					peer: input.peer,
					push,
					close: () => {
						cleanup();
						try {
							controller.close();
						} catch {
							// schon geschlossen
						}
					}
				};
				sub = current;
				headersOf.set(current, authHeaders);
				if (input.recheck) customRecheck.set(current, input.recheck);
				const map = subscribersOf(objectId);
				// gleiche Kennung erneut verbunden (Wiederverbinden): alte Verbindung ablösen
				map.get(client)?.close();
				subscribersOf(objectId).set(client, current);
				write('retry: 3000\n\n');
				void input.onOpen(push, current).catch((e) => {
					console.warn(`[${options.name}] Live-Start fehlgeschlagen`, e);
					current.close();
				});
				timers.push(setInterval(() => write(': ping\n\n'), heartbeatMs));
				timers.push(setInterval(() => void recheckOne(current), recheckMs));
			},
			cancel() {
				cleanup();
			}
		});

		input.request.signal?.addEventListener('abort', () => sub?.close(), { once: true });

		return new Response(stream, {
			status: 200,
			headers: {
				'content-type': 'text/event-stream; charset=utf-8',
				'cache-control': 'no-store, no-transform',
				// nginx: nicht puffern (sonst kommen Ereignisse erst gesammelt an)
				'x-accel-buffering': 'no'
			}
		});
	}

	return {
		open,
		broadcast,
		subscribers: (objectId) => [...(objects.get(objectId)?.values() ?? [])],
		get: (objectId, client) => objects.get(objectId)?.get(client),
		streamCount(userId) {
			let n = 0;
			for (const map of objects.values()) {
				for (const s of map.values()) if (s.userId === userId) n++;
			}
			return n;
		},
		countWhere(match) {
			let n = 0;
			for (const map of objects.values()) {
				for (const s of map.values()) if (match(s)) n++;
			}
			return n;
		},
		openObjects: () => [...objects.keys()],
		async recheck(objectId) {
			for (const s of [...(objects.get(objectId)?.values() ?? [])]) await recheckOne(s);
		},
		closeObject(objectId, event) {
			const map = objects.get(objectId);
			if (!map) return;
			for (const s of [...map.values()]) {
				if (event !== undefined) s.push(event);
				s.close();
			}
			objects.delete(objectId);
		},
		closeAll(event) {
			for (const id of [...objects.keys()]) {
				const map = objects.get(id);
				for (const s of [...(map?.values() ?? [])]) {
					if (event !== undefined) s.push(event);
					s.close();
				}
				objects.delete(id);
			}
		}
	};
}
