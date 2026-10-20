import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import { sendMail } from '../mail';
import { requirePermission } from '../permissions/service';
import { hit, peek, reset } from '../rate-limit';
import { getSetting } from '../settings/service';
import * as storage from '../storage';
import { requireUser, systemContext } from './context';
import { getAuth } from './index';
import { maskEmail } from './mask-email';

export { maskEmail };

const PW_WINDOW_SEC = 10 * 60;
const PW_MAX_FAILURES = 5;
const EMAIL_CHANGE_MAX = 3;
const EMAIL_CHANGE_WINDOW_SEC = 60 * 60;

/**
 * Prüft das Passwort des eigenen Kontos (Better Auth prüft es bei `changeEmail` nicht). Fehlversuche
 * werden je Benutzer begrenzt (5 je 10 Minuten).
 */
export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
	const key = `pwcheck:${userId}`;
	if (peek(key, PW_WINDOW_SEC) >= PW_MAX_FAILURES) {
		throw errors.badRequest('Zu viele Versuche. Bitte später erneut versuchen.');
	}
	const [acc] = await getDb()
		.select({ password: schema.account.password })
		.from(schema.account)
		.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')));
	const authCtx = await getAuth().$context;
	const ok =
		!!acc?.password &&
		password.length > 0 &&
		password.length <= 128 &&
		(await authCtx.password.verify({ hash: acc.password, password }));
	if (ok) reset(key);
	else hit(key, 1000, PW_WINDOW_SEC);
	return ok;
}

const emailSchema = z.string().trim().toLowerCase().max(255).pipe(z.email());

/**
 * E-Mail-Wechsel des eigenen Kontos: Passwort prüfen, Hinweis an die alte Adresse, Bestätigungslink an
 * die NEUE Adresse (Better Auth `changeEmail`). Die Adresse ändert sich erst nach Klick auf den Link.
 * Die Antwort ist unabhängig davon, ob die neue Adresse bereits vergeben ist (kein Konto-Orakel).
 */
export async function requestEmailChange(
	ctx: RequestContext,
	headers: Headers,
	input: { newEmail: string; password: string }
): Promise<void> {
	const userId = requireUser(ctx);
	const parsed = emailSchema.safeParse(input.newEmail);
	if (!parsed.success) {
		throw errors.validation(parsed.error.issues, 'Ungültige E-Mail-Adresse');
	}
	const newEmail = parsed.data;
	const [u] = await getDb().select().from(schema.user).where(eq(schema.user.id, userId));
	if (!u) throw errors.notFound('Benutzer nicht gefunden');
	if (!(await verifyUserPassword(userId, input.password))) {
		throw errors.badRequest('Das Passwort ist nicht korrekt.');
	}
	if (newEmail === u.email) {
		throw errors.badRequest('Die neue Adresse entspricht der aktuellen.');
	}
	// Eigenes Limit (Better Auth begrenzt nur den HTTP-Weg): 3 je Stunde und Benutzer
	if (!hit(`emailchange:${userId}`, EMAIL_CHANGE_MAX, EMAIL_CHANGE_WINDOW_SEC).allowed) {
		throw errors.rateLimited(
			'Zu viele Änderungsanfragen für die E-Mail-Adresse. Bitte später erneut versuchen.'
		);
	}
	const name = await getSetting<string>('core.system.name');
	await getAuth().api.changeEmail({
		body: { newEmail, callbackURL: '/profile?emailChanged=1' },
		headers
	});
	// Hinweis an die alte Adresse erst nach erfolgreichem Aufruf (Fire-and-forget, Fehler bleiben intern)
	void sendMail({
		to: u.email,
		subject: `${name}: Änderung deiner E-Mail-Adresse angefragt`,
		text: `Hallo ${u.name},\n\nfür dein Konto wurde die Änderung der E-Mail-Adresse auf ${maskEmail(newEmail)} angefragt. Die Änderung wird erst wirksam, wenn der Link in der Bestätigungsmail an die neue Adresse geöffnet wird.\n\nWenn du das nicht warst, ändere bitte sofort dein Passwort und melde dich bei der Administration.`
	}).catch((err) =>
		console.error('[mail] Hinweis zum E-Mail-Wechsel fehlgeschlagen:', err?.message)
	);
	await auditFromContext(ctx, 'core.auth.email_change_requested', {
		target: userId,
		metadata: { from: maskEmail(u.email), to: maskEmail(newEmail) }
	});
}

/** Eigenen Anzeigenamen ändern. */
export async function updateOwnName(ctx: RequestContext, name: string): Promise<void> {
	const userId = requireUser(ctx);
	const parsed = z.string().trim().min(1, 'Name ist erforderlich').max(100).safeParse(name);
	if (!parsed.success) throw errors.validation(parsed.error.issues, 'Ungültiger Name');
	await getDb()
		.update(schema.user)
		.set({ name: parsed.data, updatedAt: new Date() })
		.where(eq(schema.user.id, userId));
	await auditFromContext(ctx, 'core.user.name_changed', { target: userId });
}

export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const avatarPath = (userId: string) => `avatars/${userId}`;

/** Magic-Bytes-Prüfung (PNG, JPEG, WebP) – `file.type` kommt vom Client und ist nicht vertrauenswürdig. */
export function matchesImageSignature(data: Uint8Array, type: string): boolean {
	const at = (off: number, bytes: number[]) => bytes.every((b, i) => data[off + i] === b);
	if (type === 'image/png') return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	if (type === 'image/jpeg') return at(0, [0xff, 0xd8, 0xff]);
	if (type === 'image/webp') {
		return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
	}
	return false;
}

/**
 * Setzt das Profilbild (`user.image` = `/avatar/<id>?v=…`). Speicherung im Storage-Bereich `core`
 * (braucht konfiguriertes S3, sonst `unavailable`/503).
 */
export async function setOwnAvatar(
	ctx: RequestContext,
	file: { data: Uint8Array; contentType: string }
): Promise<string> {
	return writeAvatar(ctx, requireUser(ctx), file);
}

export async function removeOwnAvatar(ctx: RequestContext): Promise<void> {
	await deleteAvatar(ctx, requireUser(ctx));
}

/** Profilbild eines anderen Benutzers setzen (Verwaltung, Recht `core.users.edit`). */
export async function setUserAvatar(
	ctx: RequestContext,
	userId: string,
	file: { data: Uint8Array; contentType: string }
): Promise<string> {
	await requireEditableUser(ctx, userId);
	return writeAvatar(ctx, userId, file);
}

/** Profilbild eines anderen Benutzers entfernen (Verwaltung, Recht `core.users.edit`). */
export async function removeUserAvatar(ctx: RequestContext, userId: string): Promise<void> {
	await requireEditableUser(ctx, userId);
	await deleteAvatar(ctx, userId);
}

async function requireEditableUser(ctx: RequestContext, userId: string): Promise<void> {
	await requirePermission(ctx, 'core.users.edit');
	const [u] = await getDb()
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!u) throw errors.notFound('Benutzer nicht gefunden');
}

/** Audit-Zusatz, wenn jemand das Bild eines anderen Kontos ändert */
const byAdmin = (ctx: RequestContext, userId: string) =>
	ctx.userId === userId ? undefined : { byAdmin: true };

async function writeAvatar(
	ctx: RequestContext,
	userId: string,
	file: { data: Uint8Array; contentType: string }
): Promise<string> {
	const type = file.contentType.split(';')[0]!.trim().toLowerCase();
	if (!(AVATAR_TYPES as readonly string[]).includes(type)) {
		throw errors.badRequest('Nur PNG-, JPEG- oder WebP-Bilder sind erlaubt');
	}
	if (file.data.byteLength === 0 || file.data.byteLength > AVATAR_MAX_BYTES) {
		throw errors.tooLarge('Das Bild darf höchstens 2 MB groß sein');
	}
	if (!matchesImageSignature(file.data, type)) {
		throw errors.badRequest('Die Datei ist kein gültiges PNG-, JPEG- oder WebP-Bild');
	}
	await storage.upload(systemContext('avatar'), {
		module: 'core',
		path: avatarPath(userId),
		file: file.data,
		contentType: type,
		name: 'avatar'
	});
	const image = `/avatar/${userId}?v=${Date.now()}`;
	await getDb()
		.update(schema.user)
		.set({ image, updatedAt: new Date() })
		.where(eq(schema.user.id, userId));
	await auditFromContext(ctx, 'core.user.avatar_changed', {
		target: userId,
		metadata: byAdmin(ctx, userId)
	});
	return image;
}

async function deleteAvatar(ctx: RequestContext, userId: string): Promise<void> {
	await getDb()
		.update(schema.user)
		.set({ image: null, updatedAt: new Date() })
		.where(eq(schema.user.id, userId));
	// Datei entfernen; ohne S3 oder ohne Datei ist nichts zu tun, andere Fehler werden protokolliert
	await storage
		.remove(systemContext('avatar'), { module: 'core', path: avatarPath(userId) })
		.catch((err) => {
			if (err?.code !== 'not_found' && err?.code !== 'unavailable') {
				console.error('[avatar] Entfernen fehlgeschlagen:', err?.message);
			}
		});
	await auditFromContext(ctx, 'core.user.avatar_removed', {
		target: userId,
		metadata: byAdmin(ctx, userId)
	});
}

/** `true`, wenn `image` auf das eigene Profilbild (`/avatar/<userId>` mit optionaler Query) zeigt. */
export function isOwnAvatarPath(image: string | null | undefined, userId: string): boolean {
	if (!image) return false;
	const base = `/avatar/${userId}`;
	return image === base || image.startsWith(`${base}?`);
}

/**
 * Bild für `GET /avatar/<id>`. Nur wenn der Benutzer aktiv ist und `user.image` auf den EIGENEN Pfad
 * zeigt (verhindert Imitation über einen fremden `/avatar/<id>`-Wert). Die Größe wird vor dem Lesen geprüft.
 * Hinweis: Alle angemeldeten Benutzer dürfen Profilbilder sehen (gewollt, wie in der Benutzerliste).
 */
export async function readAvatar(
	userId: string
): Promise<{ data: Uint8Array; contentType: string } | null> {
	const [u] = await getDb()
		.select({ image: schema.user.image, active: schema.user.active })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!u?.active || !isOwnAvatarPath(u.image, userId)) return null;
	try {
		const ctx = systemContext('avatar');
		const meta = await storage.stat(ctx, { module: 'core', path: avatarPath(userId) });
		if (meta.size > AVATAR_MAX_BYTES) return null;
		const { buffer, file } = await storage.download(ctx, {
			module: 'core',
			path: avatarPath(userId)
		});
		if (buffer.byteLength > AVATAR_MAX_BYTES) return null;
		const ct = (AVATAR_TYPES as readonly string[]).includes(file.contentType)
			? file.contentType
			: 'application/octet-stream';
		return { data: buffer, contentType: ct };
	} catch {
		return null;
	}
}
