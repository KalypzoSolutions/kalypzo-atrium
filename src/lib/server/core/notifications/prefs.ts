/**
 * Gespeicherte Kanalwahl (`notification_pref`) – nur Abweichungen vom Standard des Typs.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { NotificationChannel, NotificationDelivery } from '$lib/sdk/types/notifications';
import { getDb, schema } from '../database/client';

export interface StoredPref {
	channel: string;
	delivery: string;
}

export const prefKey = (userId: string, typeKey: string, scope: string) =>
	`${userId}|${typeKey}|${scope}`;

const CHUNK = 500;

/** Einstellungen zu Personen × Typen als Map `prefKey` → Wahl */
export async function loadPrefs(
	userIds: string[],
	typeKeys: string[]
): Promise<Map<string, StoredPref>> {
	const map = new Map<string, StoredPref>();
	const users = [...new Set(userIds)];
	const types = [...new Set(typeKeys)];
	if (!users.length || !types.length) return map;
	for (let i = 0; i < users.length; i += CHUNK) {
		const rows = await getDb()
			.select()
			.from(schema.notificationPref)
			.where(
				and(
					inArray(schema.notificationPref.userId, users.slice(i, i + CHUNK)),
					inArray(schema.notificationPref.typeKey, types)
				)
			);
		for (const r of rows) {
			map.set(prefKey(r.userId, r.typeKey, r.scope), { channel: r.channel, delivery: r.delivery });
		}
	}
	return map;
}

/** Speichert die Wahl; entspricht sie dem Standard, wird die Zeile gelöscht */
export async function storePref(
	userId: string,
	typeKey: string,
	scope: string,
	choice: { channel: NotificationChannel; delivery: NotificationDelivery },
	isDefault: boolean
): Promise<void> {
	const db = getDb();
	const where = and(
		eq(schema.notificationPref.userId, userId),
		eq(schema.notificationPref.typeKey, typeKey),
		eq(schema.notificationPref.scope, scope)
	);
	if (isDefault) {
		await db.delete(schema.notificationPref).where(where);
		return;
	}
	await db
		.insert(schema.notificationPref)
		.values({ userId, typeKey, scope, ...choice, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: [
				schema.notificationPref.userId,
				schema.notificationPref.typeKey,
				schema.notificationPref.scope
			],
			set: { ...choice, updatedAt: new Date() }
		});
}

/** Für die Übernahme alter Modul-Einstellungen: vorhandene Zeilen bleiben (idempotent) */
export async function insertPrefsIfMissing(
	rows: {
		userId: string;
		typeKey: string;
		scope: string;
		channel: NotificationChannel;
		delivery: NotificationDelivery;
	}[]
): Promise<number> {
	if (!rows.length) return 0;
	const db = getDb();
	const known = new Set<string>();
	const ids = [...new Set(rows.map((r) => r.userId))];
	for (let i = 0; i < ids.length; i += CHUNK) {
		const found = await db
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(inArray(schema.user.id, ids.slice(i, i + CHUNK)));
		for (const u of found) known.add(u.id);
	}
	const valid = rows.filter((r) => known.has(r.userId));
	let inserted = 0;
	for (let i = 0; i < valid.length; i += CHUNK) {
		const res = await db
			.insert(schema.notificationPref)
			.values(valid.slice(i, i + CHUNK))
			.onConflictDoNothing()
			.returning({ userId: schema.notificationPref.userId });
		inserted += res.length;
	}
	return inserted;
}
