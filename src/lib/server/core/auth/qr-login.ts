/**
 * Anmeldung per QR-Code (nur Server). Ablauf:
 * 1. Der Desktop-Browser legt eine Anfrage an (`createQrLogin`) und bekommt ein **Token** (steht im QR-Code) und ein
 *    **Geheimnis** (nur als httpOnly-Cookie dieses Browsers). Beides wird nur als SHA-256 gespeichert.
 * 2. Ein angemeldetes Handy öffnet `/login/qr/<token>`, sieht Gerät, IP und Zeit (`inspectQrLogin`) und bestätigt oder
 *    lehnt ab (`decideQrLogin`).
 * 3. Der Desktop fragt den Stand ab (`qrLoginStatus`) und löst die Anmeldung mit seinem Geheimnis ein
 *    (`consumeQrLogin`, einmalig) – die Sitzung legt das Better-Auth-Plugin `qr-login-plugin.ts` an.
 * Wer nur den QR-Code abfotografiert, kann sich damit nicht anmelden (das Geheimnis fehlt).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { logAudit } from '../audit/service';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import { hit } from '../rate-limit';
import { maskEmail } from './mask-email';
import { t } from '$lib/i18n';
import { assertNotImpersonating } from './admin/impersonation';

/** Gültigkeit eines angezeigten Codes */
export const QR_TTL_SEC = 120;
/** Zeit zum Einlösen nach der Bestätigung */
const CLAIM_GRACE_SEC = 60;
/** Abgelaufene Anfragen bleiben so lange für die Anzeige „abgelaufen“, dann gelöscht */
const KEEP_EXPIRED_SEC = 3600;

export type QrLoginStatus = 'pending' | 'scanned' | 'approved' | 'denied' | 'consumed' | 'expired';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const ID_RE = /^[0-9a-f-]{36}$/;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const random = (bytes: number) => randomBytes(bytes).toString('base64url');

function sameHash(a: string, b: string): boolean {
	const x = Buffer.from(a, 'hex');
	const y = Buffer.from(b, 'hex');
	return x.length === y.length && timingSafeEqual(x, y);
}

/** Neue Anfrage für den anzeigenden Browser (Rate-Limit je IP) */
export async function createQrLogin(meta: { ip: string | null; userAgent: string | null }) {
	if (!hit(`qr-login:create:${meta.ip ?? '-'}`, 30, 600).allowed) {
		throw errors.rateLimited(t('auth.qrTooManyCodes'));
	}
	const db = getDb();
	await db
		.delete(schema.loginQrRequest)
		.where(lt(schema.loginQrRequest.expiresAt, new Date(Date.now() - KEEP_EXPIRED_SEC * 1000)));
	const id = crypto.randomUUID();
	const token = random(24);
	const secret = random(32);
	const expiresAt = new Date(Date.now() + QR_TTL_SEC * 1000);
	await db.insert(schema.loginQrRequest).values({
		id,
		tokenHash: sha256(token),
		secretHash: sha256(secret),
		ip: meta.ip?.slice(0, 64) ?? null,
		userAgent: meta.userAgent?.slice(0, 500) ?? null,
		expiresAt
	});
	return { id, token, secret, expiresAt: expiresAt.toISOString() };
}

type Row = typeof schema.loginQrRequest.$inferSelect;

function statusOf(row: Row, now = Date.now()): QrLoginStatus {
	if (row.status === 'consumed' || row.status === 'denied') return row.status;
	if (row.expiresAt.getTime() <= now) return 'expired';
	if (row.status === 'approved') return 'approved';
	return row.scannedAt ? 'scanned' : 'pending';
}

async function byIdAndSecret(id: string, secret: string): Promise<Row | null> {
	if (!ID_RE.test(id) || !secret || secret.length > 128) return null;
	const [row] = await getDb()
		.select()
		.from(schema.loginQrRequest)
		.where(eq(schema.loginQrRequest.id, id));
	return row && sameHash(row.secretHash, sha256(secret)) ? row : null;
}

/** Stand für den anzeigenden Browser; `null` = unbekannt/falsches Geheimnis */
export async function qrLoginStatus(id: string, secret: string): Promise<QrLoginStatus | null> {
	const row = await byIdAndSecret(id, secret);
	return row ? statusOf(row) : null;
}

async function byToken(token: string): Promise<Row | null> {
	if (!TOKEN_RE.test(token)) return null;
	const [row] = await getDb()
		.select()
		.from(schema.loginQrRequest)
		.where(eq(schema.loginQrRequest.tokenHash, sha256(token)));
	return row ?? null;
}

export interface QrLoginInfo {
	status: QrLoginStatus;
	ip: string | null;
	userAgent: string | null;
	createdAt: string;
	expiresAt: string;
}

function requireUserCtx(ctx: RequestContext): string {
	if (ctx.actor.type !== 'user' || !ctx.userId) throw errors.unauthenticated();
	return ctx.userId;
}

/** Für das Handy: Angaben zur Anfrage; markiert sie als gescannt. `null` = unbekannt. */
export async function inspectQrLogin(
	ctx: RequestContext,
	token: string
): Promise<QrLoginInfo | null> {
	const userId = requireUserCtx(ctx);
	if (!hit(`qr-login:inspect:${userId}`, 60, 600).allowed) throw errors.rateLimited();
	const row = await byToken(token);
	if (!row) return null;
	if (row.status === 'pending' && !row.scannedAt && statusOf(row) !== 'expired') {
		await getDb()
			.update(schema.loginQrRequest)
			.set({ scannedAt: new Date() })
			.where(eq(schema.loginQrRequest.id, row.id));
		row.scannedAt = new Date();
	}
	return {
		status: statusOf(row),
		ip: row.ip,
		userAgent: row.userAgent,
		createdAt: row.createdAt.toISOString(),
		expiresAt: row.expiresAt.toISOString()
	};
}

/** Handy bestätigt oder lehnt ab (nur angemeldete Personen, nur offene Anfragen) */
export async function decideQrLogin(
	ctx: RequestContext,
	token: string,
	approve: boolean
): Promise<'approved' | 'denied'> {
	const userId = requireUserCtx(ctx);
	assertNotImpersonating(ctx);
	if (!hit(`qr-login:decide:${userId}`, 20, 600).allowed) throw errors.rateLimited();
	const row = await byToken(token);
	if (!row) throw errors.notFound(t('auth.qrInvalid'));
	const now = new Date();
	const updated = await getDb()
		.update(schema.loginQrRequest)
		.set(
			approve
				? {
						status: 'approved',
						userId,
						decidedAt: now,
						expiresAt: new Date(now.getTime() + CLAIM_GRACE_SEC * 1000)
					}
				: { status: 'denied', decidedAt: now }
		)
		.where(
			and(
				eq(schema.loginQrRequest.id, row.id),
				eq(schema.loginQrRequest.status, 'pending'),
				sql`${schema.loginQrRequest.expiresAt} > now()`
			)
		)
		.returning({ id: schema.loginQrRequest.id });
	if (!updated.length) {
		throw errors.conflict(t('auth.qrExpiredOrUsed'));
	}
	await logAudit({
		action: approve ? 'core.auth.qr_login_approved' : 'core.auth.qr_login_denied',
		actor: ctx.actor,
		ip: ctx.ip,
		requestId: ctx.requestId,
		target: row.id
	});
	return approve ? 'approved' : 'denied';
}

/**
 * Einlösen durch den anzeigenden Browser: nur mit passendem Geheimnis, nur bestätigt und nicht abgelaufen, nur einmal.
 * Liefert die Benutzer-ID für die neue Sitzung; sonst `null`.
 */
export async function consumeQrLogin(
	id: string,
	secret: string,
	meta: { ip: string | null }
): Promise<string | null> {
	if (!hit(`qr-login:claim:${meta.ip ?? '-'}`, 60, 600).allowed) return null;
	const row = await byIdAndSecret(id, secret);
	if (!row || statusOf(row) !== 'approved' || !row.userId) return null;
	const done = await getDb()
		.update(schema.loginQrRequest)
		.set({ status: 'consumed' })
		.where(
			and(
				eq(schema.loginQrRequest.id, row.id),
				eq(schema.loginQrRequest.status, 'approved'),
				sql`${schema.loginQrRequest.expiresAt} > now()`
			)
		)
		.returning({ userId: schema.loginQrRequest.userId });
	const userId = done[0]?.userId ?? null;
	if (!userId) return null;
	const [u] = await getDb()
		.select({ email: schema.user.email })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	await logAudit({
		action: 'core.auth.login',
		actor: { type: 'user', id: userId, name: u ? maskEmail(u.email) : '-' },
		ip: meta.ip,
		target: row.id,
		metadata: { method: 'qr' }
	});
	return userId;
}
