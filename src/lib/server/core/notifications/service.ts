/**
 * `core.notifications` – Benachrichtigungen an Benutzerkonten per E-Mail und/oder Web Push.
 *
 * Module deklarieren ihre Typen (`ModuleDefinition.notifications`) und rufen nach der Transaktion
 * `core.notifications.send(ctx, MODULE_ID, items)` auf. Der Core wählt je Person den Kanal (Einstellung im
 * Profil, sonst Standard des Typs), bündelt alle Einträge eines Aufrufs zu einer Mail und fällt auf
 * E-Mail zurück, wenn Push gewählt, aber nicht möglich ist (ausgeschaltet oder kein Gerät).
 */
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import {
	NOTIFICATION_BODY_MAX,
	NOTIFICATION_SCOPE_MAX,
	NOTIFICATION_TITLE_MAX,
	allowedChannels,
	type NotificationChannel,
	type NotificationDelivery,
	type NotificationPrefsResponse
} from '$lib/sdk/types/notifications';
import { auditFromContext } from '../audit/service';
import { getDb, schema } from '../database/client';
import { logError } from '../db-errors';
import { env } from '../env';
import { errors } from '../errors';
import { localesForUsers, withLocale } from '../i18n/locale';
import { sendMail } from '../mail';
import { isModuleEnabled } from '../modules/service';
import { isSafeHref } from '../search/service';
import { newId } from '../util';
import {
	defaultChannelOf,
	effectiveChoice,
	findEditableRow,
	findType,
	preferenceGroups
} from './catalog';
import { composeMail, composePush, oneLine, type ComposeItem } from './compose';
import { insertPrefsIfMissing, loadPrefs, prefKey, storePref } from './prefs';
import {
	deliverPush,
	deviceCounts,
	listDevices,
	pushEnabled,
	vapidKeys,
	type PushPayload
} from './push';
import { t, type Locale } from '$lib/i18n';

export interface NotificationItem {
	/** Schlüssel des Typs ohne Modul (deklariert in `ModuleDefinition.notifications`) */
	type: string;
	/** Pflicht bei `scoped`-Typen (z. B. Postfach-Schlüssel) */
	scope?: string;
	/** Empfänger*innen (Benutzerkonten); unbekannte/deaktivierte werden übersprungen */
	userIds: string[];
	/** Eine Zeile, ≤ 150 Zeichen (Mail-Betreff bzw. Push-Titel) */
	title: string;
	/** Klartext ≤ 4000 Zeichen (im Push gekürzt) */
	body?: string;
	/** Relativer App-Pfad, z. B. `/modules/messages/inbox/…` */
	link?: string | null;
	/** Überschrift in Sammelmails (z. B. Name des Amts) */
	group?: string | null;
	/** Kurzer Text nur für Push (z. B. Anfang der Nachricht); ohne Angabe der Anfang von `body` */
	pushBody?: string | null;
	/**
	 * Push mit gleichem Schlüssel ersetzen sich auf dem Gerät (z. B. Zählerstand). Ohne Angabe bleibt
	 * jede Nachricht einzeln stehen. `[a-z0-9:-]`, ≤ 64 Zeichen.
	 */
	tag?: string;
}

export interface NotificationSendResult {
	/** verschickte Mails (eine je Person) */
	email: number;
	/** Personen mit mindestens einer zugestellten Push-Nachricht */
	push: number;
	/** Einträge für die Tageszusammenfassung */
	queued: number;
	/** übersprungene Einträge × Personen (Aus, unbekannt, ungültig) */
	skipped: number;
}

type CleanItem = ComposeItem & {
	fullKey: string;
	scope: string;
	userIds: string[];
	type: NonNullable<ReturnType<typeof findType>>;
};

const MAX_ITEMS = 200;
const MAX_RECIPIENTS = 2000;

const AUTO_HEADERS = { 'Auto-Submitted': 'auto-generated', 'X-Atrium': 'notification' };

function origin(): string {
	return env().ORIGIN.replace(/\/+$/, '');
}

interface Recipient {
	id: string;
	name: string;
	email: string;
}

async function activeRecipients(ids: string[]): Promise<Map<string, Recipient>> {
	const map = new Map<string, Recipient>();
	for (let i = 0; i < ids.length; i += 500) {
		const rows = await getDb()
			.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
			.from(schema.user)
			.where(and(inArray(schema.user.id, ids.slice(i, i + 500)), eq(schema.user.active, true)));
		for (const r of rows) map.set(r.id, r);
	}
	return map;
}

interface PushState {
	enabled: boolean;
	devices: Map<string, number>;
}

async function pushState(userIds: string[]): Promise<PushState> {
	if (!(await pushEnabled())) return { enabled: false, devices: new Map() };
	return { enabled: true, devices: await deviceCounts(userIds) };
}

const canPush = (state: PushState, userId: string) =>
	state.enabled && (state.devices.get(userId) ?? 0) > 0;

/** Kanäle für eine Person: Push nur mit Gerät, sonst Rückfall auf E-Mail (außer `pushOnly`) */
function routes(
	channel: NotificationChannel,
	pushOnly: boolean,
	pushPossible: boolean
): { email: boolean; push: boolean } {
	const wantsPush = channel === 'push' || channel === 'both';
	let email = channel === 'email' || channel === 'both';
	const push = wantsPush && pushPossible;
	if (wantsPush && !pushPossible && !pushOnly) email = true;
	if (pushOnly) email = false;
	return { email, push };
}

/** Sendet in der Sprache der Person (auch das Mail-Layout) */
async function sendMailTo(
	r: Recipient,
	mail: { subject: string; text: string },
	locale: Locale
): Promise<boolean> {
	try {
		await withLocale(locale, () => sendMail({ to: r.email, ...mail, headers: AUTO_HEADERS }));
		return true;
	} catch (e) {
		logError('[notifications] Mailversand fehlgeschlagen', e, { target: r.id });
		return false;
	}
}

/** Siehe Dateikopf. Wirft nie (Fehler werden protokolliert). Nie in einer offenen Transaktion aufrufen. */
export async function sendNotifications(
	ctx: RequestContext,
	moduleId: string,
	items: NotificationItem[]
): Promise<NotificationSendResult> {
	const result: NotificationSendResult = { email: 0, push: 0, queued: 0, skipped: 0 };
	try {
		const list = Array.isArray(items) ? items.slice(0, MAX_ITEMS) : [];
		if (!list.length || !(await isModuleEnabled(moduleId))) {
			result.skipped += list.length;
			return result;
		}

		// 1) Einträge prüfen
		const clean: CleanItem[] = [];
		for (const raw of list) {
			const type = raw && typeof raw.type === 'string' ? findType(`${moduleId}.${raw.type}`) : null;
			const scope = typeof raw?.scope === 'string' ? raw.scope : '';
			const title =
				typeof raw?.title === 'string' ? oneLine(raw.title, NOTIFICATION_TITLE_MAX) : '';
			const link = raw?.link ?? null;
			if (
				!type ||
				!title ||
				(type.scoped ? !scope || scope.length > NOTIFICATION_SCOPE_MAX : scope !== '') ||
				(link !== null && !isSafeHref(link)) ||
				!Array.isArray(raw.userIds)
			) {
				logError('[notifications] ungültiger Eintrag übersprungen', new Error('invalid item'), {
					label: `${moduleId}.${String(raw?.type)}`
				});
				result.skipped++;
				continue;
			}
			const userIds = [...new Set(raw.userIds.filter((u) => typeof u === 'string' && u))].slice(
				0,
				MAX_RECIPIENTS
			);
			clean.push({
				type,
				fullKey: type.fullKey,
				scope,
				userIds,
				title,
				body: String(raw.body ?? '').slice(0, NOTIFICATION_BODY_MAX),
				link,
				group: raw.group ? oneLine(raw.group, 100) : null,
				pushBody: raw.pushBody ? String(raw.pushBody).slice(0, 1000) : null,
				tag:
					typeof raw.tag === 'string' && /^[a-z0-9:-]{1,64}$/.test(raw.tag)
						? `${moduleId}:${raw.tag}`
						: `${type.fullKey}:${newId()}`
			});
		}
		if (!clean.length) return result;

		// 2) Empfänger, Einstellungen, Geräte
		const allIds = [...new Set(clean.flatMap((c) => c.userIds))];
		const recipients = await activeRecipients(allIds);
		const ids = [...recipients.keys()];
		const prefs = await loadPrefs(ids, [...new Set(clean.map((c) => c.fullKey))]);
		const push = await pushState(ids);
		const locales = await localesForUsers(ids);

		// 3) Verteilen
		const mailItems = new Map<string, CleanItem[]>();
		const pushItems = new Map<string, CleanItem[]>();
		const queue: (typeof schema.notificationQueue.$inferInsert)[] = [];
		for (const c of clean) {
			for (const userId of c.userIds) {
				if (!recipients.has(userId)) {
					result.skipped++;
					continue;
				}
				const choice = effectiveChoice(c.type, prefs.get(prefKey(userId, c.fullKey, c.scope)));
				if (choice.channel === 'off') {
					result.skipped++;
					continue;
				}
				if (choice.delivery === 'daily') {
					queue.push({
						id: newId(),
						userId,
						typeKey: c.fullKey,
						scope: c.scope,
						channel: choice.channel,
						title: c.title,
						body: c.body,
						link: c.link,
						groupLabel: c.group
					});
					continue;
				}
				const r = routes(choice.channel, !!c.type.pushOnly, canPush(push, userId));
				if (!r.email && !r.push) {
					result.skipped++;
					continue;
				}
				if (r.email) mailItems.set(userId, [...(mailItems.get(userId) ?? []), c]);
				if (r.push) pushItems.set(userId, [...(pushItems.get(userId) ?? []), c]);
			}
		}

		if (queue.length) {
			for (let i = 0; i < queue.length; i += 500) {
				await getDb()
					.insert(schema.notificationQueue)
					.values(queue.slice(i, i + 500));
			}
			result.queued = queue.length;
		}

		// 4) Push zuerst (schnell); Personen ohne zugestellten Push bekommen die Mail (Rückfall)
		if (pushItems.size) {
			const payloads = new Map<string, PushPayload[]>();
			for (const [u, list] of pushItems)
				payloads.set(u, composePush(list, 'immediate', locales.get(u)));
			const delivered = await deliverPush(payloads);
			result.push = delivered.size;
			for (const [u, list] of pushItems) {
				if (delivered.has(u)) continue;
				const merged = [...(mailItems.get(u) ?? [])];
				for (const i of list) if (!i.type.pushOnly && !merged.includes(i)) merged.push(i);
				if (merged.length) mailItems.set(u, merged);
			}
		}
		for (const [u, list] of mailItems) {
			const r = recipients.get(u)!;
			const locale = locales.get(u)!;
			const mail = composeMail(r.name, list, 'immediate', origin(), locale);
			if (await sendMailTo(r, mail, locale)) result.email++;
		}
	} catch (e) {
		logError('[notifications] send fehlgeschlagen', e, {
			label: moduleId,
			requestId: ctx.requestId
		});
	}
	return result;
}

// ---------------------------------------------------------------------------
// Tageszusammenfassung (Core-Job `core.notifications-digest`)
// ---------------------------------------------------------------------------

const QUEUE_MAX_AGE_DAYS = 14;
const QUEUE_MAX_ATTEMPTS = 5;

export interface DigestResult {
	users: number;
	email: number;
	push: number;
	expired: number;
}

export async function runNotificationDigest(now = new Date()): Promise<DigestResult> {
	const db = getDb();
	const out: DigestResult = { users: 0, email: 0, push: 0, expired: 0 };
	const cutoff = new Date(now.getTime() - QUEUE_MAX_AGE_DAYS * 86_400_000);
	const expired = await db
		.delete(schema.notificationQueue)
		.where(
			or(
				lt(schema.notificationQueue.createdAt, cutoff),
				sql`${schema.notificationQueue.attempts} >= ${QUEUE_MAX_ATTEMPTS}`
			)
		)
		.returning({ id: schema.notificationQueue.id });
	out.expired = expired.length;

	const rows = await db
		.select()
		.from(schema.notificationQueue)
		.orderBy(schema.notificationQueue.createdAt);
	if (!rows.length) return out;
	const byUser = new Map<string, typeof rows>();
	for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
	const recipients = await activeRecipients([...byUser.keys()]);
	const push = await pushState([...byUser.keys()]);
	const locales = await localesForUsers([...recipients.keys()]);

	for (const [userId, list] of byUser) {
		const ids = list.map((r) => r.id);
		const recipient = recipients.get(userId);
		if (!recipient) {
			await db.delete(schema.notificationQueue).where(inArray(schema.notificationQueue.id, ids));
			continue;
		}
		out.users++;
		const locale = locales.get(userId)!;
		const toItem = (r: (typeof list)[number]): ComposeItem => ({
			title: r.title,
			body: r.body,
			link: r.link,
			group: r.groupLabel,
			tag: `${r.typeKey}:${r.scope}`
		});
		const mailRows = new Set<(typeof list)[number]>();
		const pushRows: typeof list = [];
		for (const r of list) {
			const pushOnly = !!findType(r.typeKey)?.pushOnly;
			const route = routes(r.channel as NotificationChannel, pushOnly, canPush(push, userId));
			if (route.email) mailRows.add(r);
			if (route.push) pushRows.push(r);
		}
		if (pushRows.length) {
			const delivered = await deliverPush(
				new Map([[userId, composePush(pushRows.map(toItem), 'daily', locale)]])
			);
			if (delivered.size) out.push++;
			else for (const r of pushRows) if (!findType(r.typeKey)?.pushOnly) mailRows.add(r);
		}
		let ok = true;
		if (mailRows.size) {
			const mail = list.filter((r) => mailRows.has(r)).map(toItem);
			const composed = composeMail(recipient.name, mail, 'daily', origin(), locale);
			ok = await sendMailTo(recipient, composed, locale);
			if (ok) out.email++;
		}
		if (ok) {
			await db.delete(schema.notificationQueue).where(inArray(schema.notificationQueue.id, ids));
		} else {
			await db
				.update(schema.notificationQueue)
				.set({ attempts: sql`${schema.notificationQueue.attempts} + 1` })
				.where(inArray(schema.notificationQueue.id, ids));
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

export async function getMyPreferences(ctx: RequestContext): Promise<NotificationPrefsResponse> {
	if (!ctx.userId) throw errors.unauthenticated();
	const enabled = await pushEnabled();
	if (enabled) await vapidKeys();
	return {
		pushAvailable: enabled,
		devices: await listDevices(ctx.userId),
		groups: await preferenceGroups(ctx)
	};
}

export async function setMyPreference(
	ctx: RequestContext,
	input: {
		type: string;
		scope: string;
		channel: NotificationChannel;
		delivery?: NotificationDelivery;
	}
): Promise<{ channel: NotificationChannel; delivery: NotificationDelivery }> {
	if (!ctx.userId) throw errors.unauthenticated();
	const type = await findEditableRow(ctx, input.type, input.scope);
	if (!type) throw errors.notFound(t('notifications.typeNotFound'));
	if (!allowedChannels(type).includes(input.channel)) {
		throw errors.validation([
			{
				path: ['channel'],
				message: type.mandatory ? t('notifications.mandatory') : t('notifications.pushOnly')
			}
		]);
	}
	const delivery: NotificationDelivery =
		type.digest && input.delivery === 'daily' && input.channel !== 'off' ? 'daily' : 'immediate';
	const choice = { channel: input.channel, delivery };
	const isDefault = choice.channel === defaultChannelOf(type) && delivery === 'immediate';
	await storePref(ctx.userId, type.fullKey, input.scope, choice, isDefault);
	await auditFromContext(ctx, 'core.notifications.preference-changed', {
		metadata: { type: type.fullKey, channel: choice.channel, delivery }
	});
	return choice;
}

/** Test-Push an alle eigenen Geräte */
export async function sendTestPush(ctx: RequestContext): Promise<{ delivered: boolean }> {
	if (!ctx.userId) throw errors.unauthenticated();
	if (!(await pushEnabled())) throw errors.unavailable(t('notifications.pushDisabled'));
	const delivered = await deliverPush(
		new Map([
			[
				ctx.userId,
				[
					{
						title: t('notifications.testTitle'),
						body: t('notifications.testBody'),
						url: '/profile?tab=notifications',
						tag: 'test'
					}
				]
			]
		])
	);
	return { delivered: delivered.has(ctx.userId) };
}

// ---------------------------------------------------------------------------
// Übernahme alter Modul-Einstellungen
// ---------------------------------------------------------------------------

export interface LegacyPreference {
	userId: string;
	/** Schlüssel ohne Modul */
	type: string;
	scope?: string;
	channel: NotificationChannel;
	delivery?: NotificationDelivery;
}

/**
 * Übernimmt Einstellungen eines Moduls (idempotent, vorhandene Zeilen bleiben). Nur eigene Typen; die
 * Wahl wird auf das Erlaubte begrenzt, Standardwerte werden nicht gespeichert. Rückgabe = neue Zeilen.
 */
export async function migratePreferences(
	moduleId: string,
	rows: LegacyPreference[]
): Promise<number> {
	const out: Parameters<typeof insertPrefsIfMissing>[0] = [];
	for (const r of rows) {
		const type = findType(`${moduleId}.${r.type}`);
		const scope = r.scope ?? '';
		if (!type || (type.scoped ? !scope : scope !== '') || scope.length > NOTIFICATION_SCOPE_MAX) {
			continue;
		}
		const choice = effectiveChoice(type, {
			channel: r.channel,
			delivery: r.delivery ?? 'immediate'
		});
		if (choice.channel === defaultChannelOf(type) && choice.delivery === 'immediate') continue;
		out.push({ userId: r.userId, typeKey: type.fullKey, scope, ...choice });
	}
	return insertPrefsIfMissing(out);
}
