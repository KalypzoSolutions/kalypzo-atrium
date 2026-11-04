/**
 * Web Push: VAPID-Schlüssel, Geräte (`push_subscription`) und Versand über `web-push`.
 *
 * Der Server schickt Nachrichten an die vom Browser gelieferte Endpoint-URL. Damit daraus kein Weg wird,
 * beliebige Adressen aufzurufen (SSRF), sind nur `https`-Endpunkte der bekannten Push-Dienste erlaubt.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import webpush from 'web-push';
import type { RequestContext } from '$lib/sdk/types';
import { PUSH_DEVICES_MAX, type PushDevice } from '$lib/sdk/types/notifications';
import { auditFromContext } from '../audit/service';
import { systemContext } from '../auth/context';
import { getDb, schema } from '../database/client';
import { logError } from '../db-errors';
import { env } from '../env';
import { errors } from '../errors';
import { getSettings, setSettings } from '../settings/service';
import { newId } from '../util';
import { t } from '$lib/i18n';
import { assertNotImpersonating } from '../auth/admin/impersonation';

/** Hosts der Push-Dienste (Chrome/Android: FCM, Firefox: Mozilla, Safari/iOS: Apple, Edge: Windows) */
const PUSH_HOSTS = [
	/^fcm\.googleapis\.com$/,
	/^android\.googleapis\.com$/,
	/^updates\.push\.services\.mozilla\.com$/,
	/^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
	/^web\.push\.apple\.com$/,
	/^[a-z0-9-]+\.push\.apple\.com$/,
	/^[a-z0-9-]+\.notify\.windows\.com$/
];

export function isAllowedPushEndpoint(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
	return PUSH_HOSTS.some((re) => re.test(url.hostname.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Schlüssel
// ---------------------------------------------------------------------------

export interface VapidKeys {
	publicKey: string;
	privateKey: string;
}

let creating: Promise<VapidKeys> | null = null;

/** Gespeicherte Schlüssel; fehlen sie, werden sie einmalig erzeugt */
export async function vapidKeys(): Promise<VapidKeys> {
	const s = await getSettings(['core.push.vapidPublicKey', 'core.push.vapidPrivateKey']);
	const publicKey = String(s['core.push.vapidPublicKey'] ?? '');
	const privateKey = String(s['core.push.vapidPrivateKey'] ?? '');
	if (publicKey && privateKey) return { publicKey, privateKey };
	creating ??= (async () => {
		const keys = webpush.generateVAPIDKeys();
		await setSettings(systemContext('core'), {
			'core.push.vapidPublicKey': keys.publicKey,
			'core.push.vapidPrivateKey': keys.privateKey
		});
		return keys;
	})().finally(() => (creating = null));
	return creating;
}

/** Push systemweit eingeschaltet? */
export async function pushEnabled(): Promise<boolean> {
	const s = await getSettings(['core.push.enabled']);
	return s['core.push.enabled'] !== false;
}

/**
 * Neue Schlüssel erzeugen: alle Geräte verlieren ihr Abo (sie sind an den alten Schlüssel gebunden) und
 * müssen Push neu aktivieren. Recht `core.settings.manage`.
 */
export async function rotateVapidKeys(ctx: RequestContext): Promise<{ removedDevices: number }> {
	const keys = webpush.generateVAPIDKeys();
	await setSettings(ctx, {
		'core.push.vapidPublicKey': keys.publicKey,
		'core.push.vapidPrivateKey': keys.privateKey
	});
	const removed = await getDb()
		.delete(schema.pushSubscription)
		.returning({ id: schema.pushSubscription.id });
	await auditFromContext(ctx, 'core.notifications.vapid-rotated', {
		metadata: { removedDevices: removed.length }
	});
	return { removedDevices: removed.length };
}

async function vapidSubject(): Promise<string> {
	const s = await getSettings(['core.organization.email', 'core.smtp.from']);
	for (const k of ['core.organization.email', 'core.smtp.from']) {
		const v = String(s[k] ?? '').trim();
		const m = /<([^>]+)>/.exec(v)?.[1] ?? v;
		if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) return `mailto:${m}`;
	}
	return env().ORIGIN.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Geräte
// ---------------------------------------------------------------------------

export interface SubscriptionInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	label?: string;
}

function cleanLabel(label: string | undefined): string {
	return (
		(label ?? '')
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001f\u007f]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 100) || t('notifications.unknownDevice')
	);
}

const toDevice = (r: typeof schema.pushSubscription.$inferSelect): PushDevice => ({
	id: r.id,
	label: r.label,
	createdAt: r.createdAt.toISOString(),
	lastSuccessAt: r.lastSuccessAt ? r.lastSuccessAt.toISOString() : null
});

export async function listDevices(userId: string): Promise<PushDevice[]> {
	const rows = await getDb()
		.select()
		.from(schema.pushSubscription)
		.where(eq(schema.pushSubscription.userId, userId))
		.orderBy(desc(schema.pushSubscription.createdAt));
	return rows.map(toDevice);
}

/** Gerät registrieren bzw. aktualisieren (gleicher Endpoint = gleiches Gerät, auch nach Kontowechsel) */
export async function addDevice(
	ctx: RequestContext,
	input: SubscriptionInput
): Promise<PushDevice> {
	const userId = ctx.userId;
	if (!userId) throw errors.unauthenticated();
	// Das Gerät gehört der Admin-Person, nicht der Zielperson
	assertNotImpersonating(ctx);
	if (!(await pushEnabled())) throw errors.unavailable(t('notifications.pushDisabled'));
	if (!isAllowedPushEndpoint(input.endpoint)) {
		throw errors.validation([
			{ path: ['endpoint'], message: t('notifications.unknownPushService') }
		]);
	}
	const db = getDb();
	const label = cleanLabel(input.label);
	const device = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(schema.pushSubscription)
			.where(eq(schema.pushSubscription.endpoint, input.endpoint));
		if (existing) {
			const [row] = await tx
				.update(schema.pushSubscription)
				.set({ userId, p256dh: input.keys.p256dh, auth: input.keys.auth, label, failures: 0 })
				.where(eq(schema.pushSubscription.id, existing.id))
				.returning();
			return { row: row!, created: existing.userId !== userId };
		}
		const [count] = await tx
			.select({ n: sql<number>`count(*)` })
			.from(schema.pushSubscription)
			.where(eq(schema.pushSubscription.userId, userId));
		if (Number(count?.n ?? 0) >= PUSH_DEVICES_MAX) {
			throw errors.conflict(t('notifications.tooManyDevices', { max: PUSH_DEVICES_MAX }));
		}
		const [row] = await tx
			.insert(schema.pushSubscription)
			.values({
				id: newId(),
				userId,
				endpoint: input.endpoint,
				p256dh: input.keys.p256dh,
				auth: input.keys.auth,
				label
			})
			.returning();
		return { row: row!, created: true };
	});
	if (device.created) {
		await auditFromContext(ctx, 'core.notifications.device-added', { target: device.row.id });
	}
	return toDevice(device.row);
}

/** Eigenes Gerät entfernen (fremde/unbekannte → 404); `endpoint` statt ID beim Abmelden im Browser */
export async function removeDevice(
	ctx: RequestContext,
	ref: { id?: string; endpoint?: string }
): Promise<{ removed: true }> {
	const userId = ctx.userId;
	if (!userId) throw errors.unauthenticated();
	const match = ref.id
		? eq(schema.pushSubscription.id, ref.id)
		: eq(schema.pushSubscription.endpoint, ref.endpoint ?? '');
	const rows = await getDb()
		.delete(schema.pushSubscription)
		.where(and(match, eq(schema.pushSubscription.userId, userId)))
		.returning({ id: schema.pushSubscription.id });
	if (!rows.length) throw errors.notFound(t('notifications.deviceNotFound'));
	await auditFromContext(ctx, 'core.notifications.device-removed', { target: rows[0]!.id });
	return { removed: true };
}

/** Zahl der Geräte je Person */
export async function deviceCounts(userIds: string[]): Promise<Map<string, number>> {
	const map = new Map<string, number>();
	if (!userIds.length) return map;
	const rows = await getDb()
		.select({ userId: schema.pushSubscription.userId, n: sql<number>`count(*)` })
		.from(schema.pushSubscription)
		.where(inArray(schema.pushSubscription.userId, userIds))
		.groupBy(schema.pushSubscription.userId);
	for (const r of rows) map.set(r.userId, Number(r.n));
	return map;
}

export async function totalDevices(): Promise<number> {
	const [row] = await getDb()
		.select({ n: sql<number>`count(*)` })
		.from(schema.pushSubscription);
	return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Versand
// ---------------------------------------------------------------------------

export interface PushPayload {
	title: string;
	body: string;
	/** relativer App-Pfad */
	url: string;
	/** gleiche Tags ersetzen sich auf dem Gerät */
	tag: string;
}

export type PushTransport = (
	subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
	payload: string,
	options: { vapid: VapidKeys; subject: string; ttl: number }
) => Promise<{ statusCode: number }>;

const defaultTransport: PushTransport = async (subscription, payload, { vapid, subject, ttl }) => {
	try {
		const res = await webpush.sendNotification(subscription, payload, {
			vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
			TTL: ttl,
			urgency: 'normal',
			timeout: 10_000
		});
		return { statusCode: res.statusCode };
	} catch (e) {
		const status = (e as { statusCode?: number }).statusCode;
		if (typeof status === 'number') return { statusCode: status };
		throw e;
	}
};

let transport: PushTransport = defaultTransport;

/** Nur für Tests: Versand ersetzen (`null` = zurück zu `web-push`) */
export function setPushTransportForTests(t: PushTransport | null): void {
	transport = t ?? defaultTransport;
}

/** Ab so vielen Fehlversuchen in Folge wird ein Gerät entfernt */
const MAX_FAILURES = 5;
const TTL_SECONDS = 24 * 60 * 60;
const PARALLEL = 5;

/**
 * Nachrichten an alle Geräte der Personen. 404/410 (Abo abgelaufen) entfernt das Gerät sofort,
 * andere Fehler zählen hoch. Rückgabe: Zahl der Personen mit mindestens einer zugestellten Nachricht.
 */
export async function deliverPush(byUser: Map<string, PushPayload[]>): Promise<Set<string>> {
	const delivered = new Set<string>();
	const userIds = [...byUser.keys()].filter((u) => byUser.get(u)!.length > 0);
	if (!userIds.length) return delivered;
	const db = getDb();
	const subs = await db
		.select()
		.from(schema.pushSubscription)
		.where(inArray(schema.pushSubscription.userId, userIds));
	if (!subs.length) return delivered;
	const vapid = await vapidKeys();
	const subject = await vapidSubject();

	const jobs: { sub: (typeof subs)[number]; payload: PushPayload }[] = [];
	for (const sub of subs) {
		for (const payload of byUser.get(sub.userId) ?? []) jobs.push({ sub, payload });
	}
	const gone = new Set<string>();
	const failed = new Set<string>();
	const ok = new Set<string>();
	for (let i = 0; i < jobs.length; i += PARALLEL) {
		await Promise.all(
			jobs.slice(i, i + PARALLEL).map(async ({ sub, payload }) => {
				if (gone.has(sub.id)) return;
				try {
					const { statusCode } = await transport(
						{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
						JSON.stringify(payload),
						{ vapid, subject, ttl: TTL_SECONDS }
					);
					if (statusCode >= 200 && statusCode < 300) {
						ok.add(sub.id);
						delivered.add(sub.userId);
					} else if (statusCode === 404 || statusCode === 410) {
						gone.add(sub.id);
					} else {
						failed.add(sub.id);
					}
				} catch (e) {
					failed.add(sub.id);
					logError('[notifications] Push-Versand fehlgeschlagen', e, { target: sub.id });
				}
			})
		);
	}
	if (gone.size) {
		await db.delete(schema.pushSubscription).where(inArray(schema.pushSubscription.id, [...gone]));
	}
	const okIds = [...ok].filter((id) => !gone.has(id));
	if (okIds.length) {
		await db
			.update(schema.pushSubscription)
			.set({ failures: 0, lastSuccessAt: new Date() })
			.where(inArray(schema.pushSubscription.id, okIds));
	}
	const failedIds = [...failed].filter((id) => !ok.has(id) && !gone.has(id));
	if (failedIds.length) {
		await db
			.update(schema.pushSubscription)
			.set({ failures: sql`${schema.pushSubscription.failures} + 1` })
			.where(inArray(schema.pushSubscription.id, failedIds));
		await db
			.delete(schema.pushSubscription)
			.where(
				and(
					inArray(schema.pushSubscription.id, failedIds),
					sql`${schema.pushSubscription.failures} >= ${MAX_FAILURES}`
				)
			);
	}
	return delivered;
}
