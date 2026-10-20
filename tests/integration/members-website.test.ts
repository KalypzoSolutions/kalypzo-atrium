/**
 * Modul `members` – Website-API (`/website/groups…`, Key nur mit Scope `members.website.read`)
 * und Website-Felder an `/groups` (Lesen/Schreiben, Slug-Validierung, Duplikat, Weglassen).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { installFakeStorage, uninstallFakeStorage } from '../helpers/fake-storage';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { registerModule } from '$lib/server/core/modules/registry';
import { disableModule, enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { listAudit } from '$lib/server/core/audit/service';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { core } from '$lib/server/core';
import membersModule from '$lib/modules/members/module';
import { slugFromName } from '$lib/modules/members/slug';
import type { Group, Member, WebsiteGroup } from '$lib/modules/members/schemas';
import type { RequestContext } from '$lib/sdk/types';

const ROOT = 'http://localhost:5173/api/v1/modules/members';
const keys: Record<string, string> = {};
let admin: RequestContext;

interface Res<T = unknown> {
	status: number;
	headers: Headers;
	body: { data?: T; error?: { code: string; message: string; details?: unknown } };
}

const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;

async function raw(who: string, method: string, path: string, body?: BodyInit, json = false) {
	resetAllForTests();
	const headers = new Headers({ authorization: `Bearer ${keys[who]}` });
	if (json) headers.set('content-type', 'application/json');
	const url = new URL(`${ROOT}${path}`);
	return handleApiRequest({
		request: new Request(url, { method, headers, body }),
		url,
		ip: '127.0.0.1'
	});
}

async function call<T = unknown>(
	who: string,
	method: string,
	path: string,
	json?: unknown
): Promise<Res<T>> {
	const res = await raw(
		who,
		method,
		path,
		json === undefined ? undefined : JSON.stringify(json),
		json !== undefined
	);
	return { status: res.status, headers: res.headers, body: await res.json() };
}

function ok<T>(res: Res<T>, status = 200): T {
	expect(res.status, JSON.stringify(res.body)).toBe(status);
	return res.body.data as T;
}

function fail(res: Res, status: number, code: string) {
	expect(res.status, JSON.stringify(res.body)).toBe(status);
	expect(res.body.error?.code).toBe(code);
}

const memberBody = (firstName: string, lastName: string, over: Record<string, unknown> = {}) => ({
	firstName,
	lastName,
	scoutName: null,
	birthDate: '2012-05-17',
	street: 'Musterweg 1',
	postalCode: '12345',
	city: 'Musterstadt',
	country: 'DE',
	phones: [{ name: 'Mutter', value: '0123 456' }],
	emails: [{ name: null, value: `${firstName.toLowerCase()}@example.test` }],
	stage: 'pfadfinder',
	groupIds: [],
	consentSocialMedia: false,
	consentWebsite: false,
	consentPrint: false,
	...over
});

const groupBody = (name: string, type: 'sippe' | 'meute', leaderIds: string[], over = {}) => ({
	name,
	type,
	leaderIds,
	description: `Interne Beschreibung ${name}`,
	meetingPlace: 'Gemeindehaus',
	meetingWeekday: 3,
	meetingTime: '17:00',
	color: '#2f855a',
	...over
});

const ROLES: Record<string, string[]> = {
	editor: [
		'members.member.view',
		'members.member.edit',
		'members.group.view',
		'members.group.edit',
		'members.storage.read',
		'members.storage.write',
		'core.api.manage'
	],
	website: ['members.website.read', 'core.api.manage']
};

let anna: Member;
let bert: Member;
let carla: Member;
let left: Member;
let woelflinge: Group;
let falken: Group;
let adler: Group;
let intern: Group;

beforeAll(async () => {
	await useTestDatabase();
	registerCoreApi();
	registerModule(membersModule);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = await ctxOf(u!.id);
	await enableModule(admin, 'members');
	admin = await ctxOf(u!.id);

	for (const [name, perms] of Object.entries(ROLES)) {
		const roleId = await createRole(admin, { name: `role-${name}`, permissions: perms });
		const userId = await createUser(admin, {
			name: `Benutzer ${name}`,
			email: `${name}@example.test`,
			password: 'a-long-enough-pw',
			roleIds: [roleId]
		});
		const ctx = await ctxOf(userId);
		const scopes = name === 'website' ? ['members.website.read'] : perms;
		keys[name] = (await createApiKey(ctx, { name: `key-${name}`, scopes })).key;
	}

	const mk = async (first: string, last: string, over: Record<string, unknown> = {}) =>
		ok<Member>(await call('editor', 'POST', '/members', memberBody(first, last, over)), 201);
	anna = await mk('Anna', 'Zander');
	bert = await mk('Bert', 'Yilmaz');
	carla = await mk('Carla', 'Xaver');
	left = await mk('Dora', 'Weg', { entryDate: '2015-01-01', exitDate: '2020-01-01' });

	woelflinge = ok<Group>(
		await call(
			'editor',
			'POST',
			'/groups',
			groupBody('Wölflinge', 'meute', [carla.id, anna.id, left.id], {
				website: {
					onWebsite: true,
					slug: 'woelflinge',
					description: 'Spiel und Spaß für Kinder',
					ageRange: '7 bis 10 Jahre',
					contactEmail: 'Woelflinge@Stamm.Example'
				}
			})
		),
		201
	);
	falken = ok<Group>(
		await call(
			'editor',
			'POST',
			'/groups',
			groupBody('Falken', 'sippe', [bert.id], {
				meetingEndTime: '18:30',
				website: { onWebsite: true, slug: 'falken' }
			})
		),
		201
	);
	adler = ok<Group>(
		await call(
			'editor',
			'POST',
			'/groups',
			groupBody('Adler', 'sippe', [anna.id], {
				description: null,
				website: { onWebsite: true, slug: 'adler', description: null }
			})
		),
		201
	);
	intern = ok<Group>(
		await call(
			'editor',
			'POST',
			'/groups',
			groupBody('Interne Runde', 'sippe', [bert.id], {
				website: { onWebsite: false, slug: 'interne-runde' }
			})
		),
		201
	);
});

afterAll(() => uninstallFakeStorage());

describe('Gruppen: Website-Felder', () => {
	it('liefert `website` im Gruppen-DTO (E-Mail klein geschrieben)', async () => {
		expect(woelflinge.website).toEqual({
			onWebsite: true,
			slug: 'woelflinge',
			description: 'Spiel und Spaß für Kinder',
			ageRange: '7 bis 10 Jahre',
			contactEmail: 'woelflinge@stamm.example'
		});
		const list = ok<Group[]>(await call('editor', 'GET', '/groups'));
		expect(list.every((g) => typeof g.website?.onWebsite === 'boolean')).toBe(true);
	});

	it('Gruppe ohne `website` beim Anlegen → Standardwerte', async () => {
		const g = ok<Group>(
			await call('editor', 'POST', '/groups', groupBody('Ohne Website', 'sippe', [anna.id])),
			201
		);
		expect(g.website).toEqual({
			onWebsite: false,
			slug: null,
			description: null,
			ageRange: null,
			contactEmail: null
		});
	});

	it('`website` weglassen beim Ändern lässt die gespeicherten Werte unverändert', async () => {
		const updated = ok<Group>(
			await call(
				'editor',
				'PUT',
				`/groups/${woelflinge.id}`,
				groupBody('Wölflinge', 'meute', [carla.id, anna.id, left.id], { meetingPlace: 'Wiese' })
			)
		);
		expect(updated.meetingPlace).toBe('Wiese');
		expect(updated.website).toEqual(woelflinge.website);
	});

	it('Slug-Validierung → 422 mit Pfad website.slug', async () => {
		for (const slug of [
			'Mit Leerzeichen',
			'ä-umlaut',
			'-vorne',
			'hinten-',
			'a--b',
			'x'.repeat(61)
		]) {
			const res = await call(
				'editor',
				'PUT',
				`/groups/${falken.id}`,
				groupBody('Falken', 'sippe', [bert.id], { website: { onWebsite: true, slug } })
			);
			fail(res, 422, 'validation_failed');
			expect(JSON.stringify(res.body.error?.details)).toContain('slug');
		}
		// Auf der Website ohne Adresse
		fail(
			await call(
				'editor',
				'PUT',
				`/groups/${falken.id}`,
				groupBody('Falken', 'sippe', [bert.id], { website: { onWebsite: true, slug: null } })
			),
			422,
			'validation_failed'
		);
		// Ungültige Kontakt-E-Mail
		fail(
			await call(
				'editor',
				'PUT',
				`/groups/${falken.id}`,
				groupBody('Falken', 'sippe', [bert.id], {
					website: { onWebsite: true, slug: 'falken', contactEmail: 'keine-mail' }
				})
			),
			422,
			'validation_failed'
		);
		// Großbuchstaben werden normalisiert
		const g = ok<Group>(
			await call(
				'editor',
				'PUT',
				`/groups/${falken.id}`,
				groupBody('Falken', 'sippe', [bert.id], { website: { onWebsite: true, slug: 'Falken' } })
			)
		);
		expect(g.website.slug).toBe('falken');
	});

	it('doppelte Adresse → 409 (Anlegen und Ändern), eigene Adresse bleibt erlaubt', async () => {
		const dup = await call(
			'editor',
			'PUT',
			`/groups/${falken.id}`,
			groupBody('Falken', 'sippe', [bert.id], { website: { onWebsite: true, slug: 'woelflinge' } })
		);
		fail(dup, 409, 'conflict');
		expect(dup.body.error?.message).toContain('Website-Adresse');
		// private Gruppe belegt ihre Adresse ebenfalls
		fail(
			await call(
				'editor',
				'POST',
				'/groups',
				groupBody('Neu', 'sippe', [anna.id], {
					website: { onWebsite: false, slug: 'interne-runde' }
				})
			),
			409,
			'conflict'
		);
		ok<Group>(
			await call(
				'editor',
				'PUT',
				`/groups/${woelflinge.id}`,
				groupBody('Wölflinge', 'meute', [carla.id, anna.id, left.id], {
					website: woelflinge.website
				})
			)
		);
	});

	it('Audit ohne personenbezogene Details (keine Kontakt-Mail, kein Text)', async () => {
		const { rows } = await listAudit({ action: 'members.group', limit: 100 });
		const mine = rows.filter(
			(e) => e.target === woelflinge.id && e.action === 'members.group.created'
		);
		expect(mine.length).toBe(1);
		expect(mine[0]!.metadata).toMatchObject({ onWebsite: true });
		const text = JSON.stringify(rows.map((e) => e.metadata));
		expect(text).not.toContain('stamm.example');
		expect(text).not.toContain('Spiel und Spaß');
	});
});

describe('Gruppenstunde: Ende', () => {
	it('speichert und liefert `meetingEndTime` (Anlegen, Ändern, Leeren)', async () => {
		// beim Anlegen gespeichert (spätere Tests ändern Falken ohne Ende)
		expect(falken.meetingEndTime).toBe('18:30');
		const changed = ok<Group>(
			await call(
				'editor',
				'PUT',
				`/groups/${falken.id}`,
				groupBody('Falken', 'sippe', [bert.id], { meetingTime: '16:30', meetingEndTime: '18:00' })
			)
		);
		expect(changed).toMatchObject({ meetingTime: '16:30', meetingEndTime: '18:00' });
		const cleared = ok<Group>(
			await call(
				'editor',
				'PUT',
				`/groups/${falken.id}`,
				groupBody('Falken', 'sippe', [bert.id], { meetingEndTime: null })
			)
		);
		expect(cleared.meetingEndTime).toBeNull();
		// für die folgenden Website-Tests wiederherstellen
		const restored = ok<Group>(
			await call(
				'editor',
				'PUT',
				`/groups/${falken.id}`,
				groupBody('Falken', 'sippe', [bert.id], { meetingEndTime: '18:30' })
			)
		);
		expect(restored.meetingEndTime).toBe('18:30');
		const got = ok<Group>(await call('editor', 'GET', `/groups/${falken.id}`));
		expect(got.meetingEndTime).toBe('18:30');
	});

	it('Ende ohne Beginn, Ende ≤ Beginn oder falsches Format → 422 (Pfad meetingEndTime)', async () => {
		const cases: Record<string, unknown>[] = [
			{ meetingTime: null, meetingEndTime: '18:00' },
			{ meetingTime: '17:00', meetingEndTime: '17:00' },
			{ meetingTime: '17:00', meetingEndTime: '16:59' },
			{ meetingTime: '17:00', meetingEndTime: '25:00' }
		];
		for (const over of cases) {
			const res = await call(
				'editor',
				'POST',
				'/groups',
				groupBody('Ungültige Zeit', 'sippe', [anna.id], over)
			);
			fail(res, 422, 'validation_failed');
			expect(JSON.stringify(res.body), JSON.stringify(over)).toContain('meetingEndTime');
		}
		const noStart = await call(
			'editor',
			'POST',
			'/groups',
			groupBody('Ungültige Zeit', 'sippe', [anna.id], {
				meetingTime: null,
				meetingEndTime: '18:00'
			})
		);
		expect(JSON.stringify(noStart.body)).toContain('Beginn');
	});
});

describe('Website-API', () => {
	it('Key nur mit Scope members.website.read: interne Endpunkte → 403', async () => {
		fail(await call('website', 'GET', '/groups'), 403, 'forbidden');
		fail(await call('website', 'GET', '/members'), 403, 'forbidden');
		fail(await call('website', 'GET', `/groups/${woelflinge.id}/image`), 403, 'forbidden');
	});

	it('Website-Endpunkte ohne Scope → 403', async () => {
		fail(await call('editor', 'GET', '/website/groups'), 403, 'forbidden');
	});

	it('Liste: nur Gruppen auf der Website, Meute vor Sippe, dann Name', async () => {
		const list = ok<WebsiteGroup[]>(await call('website', 'GET', '/website/groups'));
		expect(list.map((g) => g.slug)).toEqual(['woelflinge', 'adler', 'falken']);
		expect(list.find((g) => g.id === intern.id)).toBeUndefined();
	});

	it('Felder: nur öffentliche Schlüssel, Leitende nur mit Vornamen, ohne Ausgetretene', async () => {
		const list = ok<WebsiteGroup[]>(await call('website', 'GET', '/website/groups'));
		const w = list.find((g) => g.slug === 'woelflinge')!;
		expect(Object.keys(w).sort()).toEqual(
			[
				'id',
				'slug',
				'name',
				'type',
				'description',
				'ageRange',
				'meetingPlace',
				'meetingWeekday',
				'meetingTime',
				'meetingEndTime',
				'color',
				'contactEmail',
				'leaders',
				'imagePath'
			].sort()
		);
		expect(w).toMatchObject({
			id: woelflinge.id,
			name: 'Wölflinge',
			type: 'meute',
			description: 'Spiel und Spaß für Kinder',
			ageRange: '7 bis 10 Jahre',
			contactEmail: 'woelflinge@stamm.example',
			meetingWeekday: 3,
			meetingTime: '17:00',
			meetingEndTime: null,
			color: '#2f855a',
			imagePath: null
		});
		expect(list.find((g) => g.slug === 'falken')).toMatchObject({
			meetingTime: '17:00',
			meetingEndTime: '18:30'
		});
		// Vornamen sortiert, Dora (ausgetreten) fehlt
		expect(w.leaders).toEqual([{ firstName: 'Anna' }, { firstName: 'Carla' }]);
		for (const l of w.leaders) expect(Object.keys(l)).toEqual(['firstName']);
		const text = JSON.stringify(list);
		for (const secret of ['Zander', 'Xaver', 'Weg', 'anna@example.test', '2012-05-17', 'Dora']) {
			expect(text).not.toContain(secret);
		}
		// interne Beschreibung als Fallback, wenn kein Website-Text gesetzt ist
		expect(list.find((g) => g.slug === 'falken')!.description).toBe('Interne Beschreibung Falken');
		expect(list.find((g) => g.id === adler.id)!.description).toBeNull();
	});

	it('Detail per Slug; privat/unbekannt → 404, ungültiger Slug → 422', async () => {
		const d = ok<WebsiteGroup>(await call('website', 'GET', '/website/groups/falken'));
		expect(d.name).toBe('Falken');
		expect(d.leaders).toEqual([{ firstName: 'Bert' }]);
		fail(await call('website', 'GET', '/website/groups/interne-runde'), 404, 'not_found');
		fail(await call('website', 'GET', '/website/groups/gibt-es-nicht'), 404, 'not_found');
		fail(await call('website', 'GET', '/website/groups/Kein_Slug'), 422, 'validation_failed');
	});

	it('Bild ohne Storage bzw. ohne Bild / privat / unbekannt → 404', async () => {
		fail(await call('website', 'GET', '/website/groups/woelflinge/image'), 404, 'not_found');
		fail(await call('website', 'GET', '/website/groups/interne-runde/image'), 404, 'not_found');
		fail(await call('website', 'GET', '/website/groups/gibt-es-nicht/image'), 404, 'not_found');
		// Bildpfad gesetzt, aber kein Storage eingerichtet → 404 statt 503
		await core.database
			.forModule('members')
			.transaction((tx) =>
				tx.execute(
					sql`UPDATE groups SET image_path = 'groups/x/fehlt.png', image_name = 'fehlt.png' WHERE id = ${falken.id}`
				)
			);
		fail(await call('website', 'GET', '/website/groups/falken/image'), 404, 'not_found');
		await core.database
			.forModule('members')
			.transaction((tx) =>
				tx.execute(
					sql`UPDATE groups SET image_path = NULL, image_name = NULL WHERE id = ${falken.id}`
				)
			);
	});

	it('Bild mit Storage: roh, Content-Type, public-Cache, nosniff; imagePath gesetzt', async () => {
		await installFakeStorage(admin);
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
		const fd = new FormData();
		fd.set('file', new File([png as BlobPart], 'gruppe.png', { type: 'image/png' }));
		const up = await raw('editor', 'POST', `/groups/${woelflinge.id}/image`, fd);
		expect(up.status, await up.clone().text()).toBe(201);

		const list = ok<WebsiteGroup[]>(await call('website', 'GET', '/website/groups'));
		const w = list.find((g) => g.slug === 'woelflinge')!;
		expect(w.imagePath).toMatch(
			/^\/api\/v1\/modules\/members\/website\/groups\/woelflinge\/image\?v=\d+$/
		);
		const res = await raw('website', 'GET', '/website/groups/woelflinge/image');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);

		// Gruppe nicht mehr auf der Website → Bild 404
		ok<Group>(
			await call(
				'editor',
				'PUT',
				`/groups/${woelflinge.id}`,
				groupBody('Wölflinge', 'meute', [carla.id, anna.id], {
					website: { ...woelflinge.website, onWebsite: false }
				})
			)
		);
		fail(await call('website', 'GET', '/website/groups/woelflinge/image'), 404, 'not_found');
		fail(await call('website', 'GET', '/website/groups/woelflinge'), 404, 'not_found');
	});
});

describe('Adress-Vorschlag', () => {
	it('slugFromName: Umlaute, ß, Sonderzeichen', () => {
		expect(slugFromName('Wölflinge')).toBe('woelflinge');
		expect(slugFromName('Sippe Große Bären')).toBe('sippe-grosse-baeren');
		expect(slugFromName('  Über & Café! ')).toBe('ueber-cafe');
		expect(slugFromName('***')).toBe('');
		expect(slugFromName('a'.repeat(70)).length).toBe(60);
	});
});

describe('Modul deaktiviert', () => {
	it('Website-API → 404 module_disabled', async () => {
		await disableModule(admin, 'members');
		try {
			const r = await call('website', 'GET', '/website/groups');
			expect(r.status).toBe(404);
			expect(r.body.error?.code).toBe('module_disabled');
		} finally {
			await enableModule(admin, 'members');
		}
	});
});
