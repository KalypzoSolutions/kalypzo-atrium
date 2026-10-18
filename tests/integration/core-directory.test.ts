import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/db';
import { contextForUser, anonymousContext, systemContext } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser, setUserActive } from '$lib/server/core/auth/users';
import { getDb, schema } from '$lib/server/core/database/client';
import { eq } from 'drizzle-orm';
import { core } from '$lib/server/core';
import { syncModules } from '$lib/server/core/modules/service';
import type { RequestContext } from '$lib/sdk/types';

let admin: RequestContext;
const ids: Record<string, string> = {};

async function ctxOf(userId: string) {
	const r = await contextForUser(userId);
	if (!r) throw new Error('kein Kontext');
	return r.ctx;
}

beforeAll(async () => {
	await useTestDatabase();
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = await ctxOf(u!.id);
	for (const [key, name] of [
		['anna', 'Anna Beispiel'],
		['bernd', 'Bernd Muster'],
		['inaktiv', 'Anna Inaktiv']
	] as const) {
		ids[key] = await createUser(admin, {
			name,
			email: `${key}@example.test`,
			password: 'a-long-enough-pw'
		});
	}
	await setUserActive(admin, ids.inaktiv!, false);
});

describe('core.users.directory', () => {
	it('findet aktive Benutzer ohne core.users.view und liefert nur id, name, email, image', async () => {
		const plain = await ctxOf(ids.bernd!);
		expect(plain.permissions.has('core.users.view')).toBe(false);
		const res = await core.users.directory(plain, { search: 'anna' });
		expect(res.map((r) => r.name)).toEqual(['Anna Beispiel']);
		expect(Object.keys(res[0]!).sort()).toEqual(['email', 'id', 'image', 'name']);
		expect(res[0]!.image).toBeNull();
	});

	it('liefert nur eigene Profilbild-Adressen (/avatar/<id>), fremde URLs werden verworfen', async () => {
		const own = `/avatar/${ids.bernd}?v=1`;
		await getDb().update(schema.user).set({ image: own }).where(eq(schema.user.id, ids.bernd!));
		await getDb()
			.update(schema.user)
			.set({ image: 'https://tracker.example/pixel.png' })
			.where(eq(schema.user.id, ids.anna!));
		const res = await core.users.directory(admin, { ids: [ids.anna!, ids.bernd!] });
		const byId = new Map(res.map((r) => [r.id, r.image]));
		expect(byId.get(ids.bernd!)).toBe(own);
		expect(byId.get(ids.anna!)).toBeNull();
		await getDb().update(schema.user).set({ image: null }).where(eq(schema.user.id, ids.bernd!));
		await getDb().update(schema.user).set({ image: null }).where(eq(schema.user.id, ids.anna!));
	});

	it('verlangt mindestens 2 Zeichen und liefert sonst nichts', async () => {
		expect(await core.users.directory(admin, { search: 'a' })).toEqual([]);
		expect(await core.users.directory(admin, {})).toEqual([]);
	});

	it('löst explizite IDs auf, aber nur aktive Benutzer', async () => {
		const res = await core.users.directory(admin, { ids: [ids.anna!, ids.inaktiv!] });
		expect(res.map((r) => r.id)).toEqual([ids.anna]);
	});

	it('maskiert Platzhalter der Suche und begrenzt die Trefferzahl', async () => {
		expect(await core.users.directory(admin, { search: '%%' })).toEqual([]);
		const res = await core.users.directory(admin, { search: 'example', limit: 999 });
		expect(res.length).toBeLessThanOrEqual(30);
	});

	it('verweigert anonyme Kontexte', async () => {
		await expect(
			core.users.directory(anonymousContext(null), { search: 'anna' })
		).rejects.toMatchObject({
			code: 'unauthenticated'
		});
		expect(await core.users.directory(systemContext(), { search: 'anna' })).toHaveLength(1);
	});
});

describe('core.crypto.forModule', () => {
	it('verschlüsselt und entschlüsselt pro Modul', () => {
		const a = core.crypto.forModule('actions');
		const b = core.crypto.forModule('other');
		const enc = a.encrypt('DE75 5206 0410 0506 4394 38');
		expect(a.isEncrypted(enc)).toBe(true);
		expect(enc).not.toContain('DE75');
		expect(a.decrypt(enc)).toBe('DE75 5206 0410 0506 4394 38');
		expect(() => b.decrypt(enc)).toThrow();
	});
});
