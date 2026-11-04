/**
 * Passwort-Hilfe durch die Verwaltung: Zurücksetzen-Mail, Einmal-Link zum Weitergeben, Passwort direkt setzen
 * (optional mit Pflicht zur Änderung) und Einladungen für Konten ohne Passwort.
 *
 * Tokens entstehen wie bei Better Auth (`verification`-Zeile `reset-password:<token>`, Wert = Benutzer-ID), damit
 * die bestehende Seite `/reset-password?token=…` (`api.resetPassword`) sie einlöst. Der Link wird nie protokolliert.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { t } from '$lib/i18n';
import { auditFromContext } from '../../audit/service';
import { getDb, schema } from '../../database/client';
import { env } from '../../env';
import { errors } from '../../errors';
import { withLocale } from '../../i18n/locale';
import { sendMail } from '../../mail';
import { requirePermission } from '../../permissions/service';
import { getSetting } from '../../settings/service';
import { newId } from '../../util';
import { getAuth } from '../index';
import { accountMailLocale } from '../account-mail';
import { assertCanManageUser } from '../manage-guard';

/** Gültigkeit eines Links aus der Verwaltung (wie „Passwort vergessen“) */
export const RESET_LINK_TTL_SEC = 60 * 60;
/** Gültigkeit einer Einladung */
export const INVITE_TTL_SEC = 7 * 24 * 60 * 60;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

interface TargetUser {
	id: string;
	name: string;
	email: string;
	active: boolean;
}

/** Gemeinsame Prüfung: Recht, Zielkonto vorhanden, nicht das eigene Konto, höchstens eigene Rechte. */
export async function loadManageableTarget(
	ctx: RequestContext,
	userId: string,
	permission = 'core.users.edit'
): Promise<TargetUser> {
	await requirePermission(ctx, permission);
	const [u] = await getDb()
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			active: schema.user.active
		})
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!u) throw errors.notFound(t('auth.userNotFound'));
	// Für das eigene Konto gibt es das Profil (Passwort, Sitzungen, 2FA mit eigener Bestätigung)
	if (u.id === ctx.userId) throw errors.badRequest(t('admin-users.server.notOnSelf'));
	await assertCanManageUser(ctx, u.id);
	return u;
}

function origin(): string {
	return env().ORIGIN.replace(/\/+$/, '');
}

/** Legt einen Token an, den `api.resetPassword` einlöst; ältere offene Links des Kontos verfallen. */
async function issueResetToken(userId: string, ttlSec: number): Promise<string> {
	const db = getDb();
	// Nur ein gültiger Verwaltungs-Link je Konto: alte Zeilen dieses Kontos entfernen
	await db
		.delete(schema.verification)
		.where(
			and(
				like(schema.verification.identifier, 'reset-password:%'),
				eq(schema.verification.value, userId)
			)
		);
	const token = randomBytes(24).toString('base64url');
	const authCtx = await getAuth().$context;
	await authCtx.internalAdapter.createVerificationValue({
		value: userId,
		identifier: `reset-password:${token}`,
		expiresAt: new Date(Date.now() + ttlSec * 1000)
	});
	return token;
}

function resetUrl(token: string, invite = false): string {
	return `${origin()}/reset-password?token=${encodeURIComponent(token)}${invite ? '&invite=1' : ''}`;
}

async function systemName(): Promise<string> {
	return (await getSetting<string>('core.system.name')) || 'Kalypzo Atrium';
}

/**
 * Schickt der Person eine Zurücksetzen-Mail (Link 1 h). Anders als „Passwort vergessen“ wartet der Aufruf auf den
 * Versand: Ohne SMTP kommt 503, damit die Verwaltung den Fehler sieht (und z. B. den Link kopiert).
 */
export async function sendPasswordReset(ctx: RequestContext, userId: string): Promise<void> {
	const u = await loadManageableTarget(ctx, userId);
	if (!u.active) throw errors.conflict(t('admin-users.server.inactiveAccount'));
	const token = await issueResetToken(u.id, RESET_LINK_TTL_SEC);
	const [system, locale] = await Promise.all([systemName(), accountMailLocale(u.id, 'system')]);
	await withLocale(locale, () =>
		sendMail({
			to: u.email,
			subject: t('account-mail.resetPassword.subject', { system }),
			text: t('account-mail.resetPassword.text', { name: u.name, url: resetUrl(token) })
		})
	);
	await auditFromContext(ctx, 'core.user.password_reset_sent', { target: u.id });
}

/** Einmal-Link (1 h) zum Weitergeben, z. B. ohne SMTP. Nur einmal sichtbar; im Audit steht nur, dass es ihn gibt. */
export async function createPasswordResetLink(
	ctx: RequestContext,
	userId: string
): Promise<{ url: string; expiresAt: Date }> {
	const u = await loadManageableTarget(ctx, userId);
	if (!u.active) throw errors.conflict(t('admin-users.server.inactiveAccount'));
	const token = await issueResetToken(u.id, RESET_LINK_TTL_SEC);
	await auditFromContext(ctx, 'core.user.password_reset_link_created', { target: u.id });
	return { url: resetUrl(token), expiresAt: new Date(Date.now() + RESET_LINK_TTL_SEC * 1000) };
}

const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** Gut lesbares Zufallspasswort (ohne 0/O/1/l/I), 4er-Gruppen mit Bindestrich, ≥ 16 Zeichen. */
export function generatePassword(groups = 4): string {
	const all = LOWER + UPPER + DIGITS;
	const parts: string[] = [];
	for (let g = 0; g < groups; g++) {
		let p = '';
		for (let i = 0; i < 4; i++) p += all[randomInt(all.length)];
		parts.push(p);
	}
	// Mindestens je ein Zeichen jeder Art garantieren
	const pick = (s: string) => s[randomInt(s.length)];
	parts[0] = pick(UPPER)! + parts[0]!.slice(1);
	parts[1] = pick(DIGITS)! + parts[1]!.slice(1);
	parts[2] = pick(LOWER)! + parts[2]!.slice(1);
	return parts.join('-');
}

/**
 * Setzt das Passwort direkt. Alle Sitzungen der Person enden (sonst blieben Geräte mit dem alten Passwort
 * angemeldet), offene Zurücksetzen-Links verfallen. `generate` liefert ein Zufallspasswort, das einmal angezeigt wird.
 */
export async function setUserPassword(
	ctx: RequestContext,
	userId: string,
	input: { password?: string; generate?: boolean; mustChange?: boolean }
): Promise<{ password?: string }> {
	const u = await loadManageableTarget(ctx, userId);
	const generated = input.generate ? generatePassword() : undefined;
	const password = generated ?? input.password ?? '';
	if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
		throw errors.validation(
			[
				{
					path: ['password'],
					message: t('auth.passwordLength', { min: PASSWORD_MIN, max: PASSWORD_MAX })
				}
			],
			t('auth.passwordLength', { min: PASSWORD_MIN, max: PASSWORD_MAX })
		);
	}
	const hash = await (await getAuth().$context).password.hash(password);
	const mustChange = input.mustChange ?? false;
	let revoked = 0;
	await getDb().transaction(async (tx) => {
		const updated = await tx
			.update(schema.account)
			.set({ password: hash, updatedAt: new Date() })
			.where(and(eq(schema.account.userId, u.id), eq(schema.account.providerId, 'credential')))
			.returning({ id: schema.account.id });
		if (!updated.length) {
			await tx.insert(schema.account).values({
				id: newId(),
				accountId: u.id,
				providerId: 'credential',
				userId: u.id,
				password: hash
			});
		}
		await tx
			.update(schema.user)
			.set({ mustChangePassword: mustChange, updatedAt: new Date() })
			.where(eq(schema.user.id, u.id));
		const gone = await tx
			.delete(schema.session)
			.where(eq(schema.session.userId, u.id))
			.returning({ id: schema.session.id });
		revoked = gone.length;
		await tx
			.delete(schema.verification)
			.where(
				and(
					like(schema.verification.identifier, 'reset-password:%'),
					eq(schema.verification.value, u.id)
				)
			);
		await auditFromContext(
			ctx,
			'core.user.password_set',
			{ target: u.id, metadata: { generated: !!generated, mustChange, sessionsRevoked: revoked } },
			tx
		);
	});
	return generated ? { password: generated } : {};
}

/** Einladung an ein neu angelegtes Konto ohne Passwort (Link 7 Tage). Wirft 503 ohne SMTP. */
export async function sendInvitation(ctx: RequestContext, userId: string): Promise<void> {
	await requirePermission(ctx, 'core.users.create');
	const [u] = await getDb()
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			active: schema.user.active
		})
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!u) throw errors.notFound(t('auth.userNotFound'));
	if (u.id === ctx.userId) throw errors.badRequest(t('admin-users.server.notOnSelf'));
	await assertCanManageUser(ctx, u.id);
	if (!u.active) throw errors.conflict(t('admin-users.server.inactiveAccount'));
	const token = await issueResetToken(u.id, INVITE_TTL_SEC);
	const [system, locale] = await Promise.all([systemName(), accountMailLocale(u.id, 'system')]);
	await withLocale(locale, () =>
		sendMail({
			to: u.email,
			subject: t('account-mail.invite.subject', { system }),
			text: t('account-mail.invite.text', {
				name: u.name,
				system,
				url: resetUrl(token, true),
				days: INVITE_TTL_SEC / 86400
			})
		})
	);
	await auditFromContext(ctx, 'core.user.invited', { target: u.id });
}

/** Unbenutzbares Passwort für Einladungen (die Person setzt ihr eigenes über den Link). */
export function unusablePassword(): string {
	return randomBytes(48).toString('base64url');
}

/** Löscht die Pflicht zur Passwortänderung (nach erfolgreicher eigener Änderung). */
export async function clearMustChangePassword(userId: string): Promise<void> {
	await getDb()
		.update(schema.user)
		.set({ mustChangePassword: false })
		.where(eq(schema.user.id, userId));
}

/** Muss die Person ihr Passwort ändern? (für den Guard in `hooks.server.ts`) */
export async function mustChangePassword(userId: string): Promise<boolean> {
	const [u] = await getDb()
		.select({ v: schema.user.mustChangePassword })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	return !!u?.v;
}
