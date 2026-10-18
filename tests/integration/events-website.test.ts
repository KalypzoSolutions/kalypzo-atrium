import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { registerModule } from '$lib/server/core/modules/registry';
import { disableModule, enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { core } from '$lib/server/core';
import eventsModule from '$lib/modules/events/module';
import membersModule from '$lib/modules/members/module';
import { todayBerlin } from '$lib/modules/events/website.endpoints';
import { DEFAULT_STAMM_NAME } from '$lib/modules/events/schemas';
import type { RequestContext } from '$lib/sdk/types';

const BASE = 'http://localhost:5173/api/v1/modules/events';
const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;

let admin: RequestContext;
let adminKey: string;
let websiteKey: string;
let noScopeKey: string;

async function get(path: string, key: string) {
	resetAllForTests();
	const url = new URL(`${BASE}${path}`);
	const res = await handleApiRequest({
		request: new Request(url, { headers: { authorization: `Bearer ${key}` } }),
		url,
		ip: '127.0.0.1'
	});
	return { status: res.status, body: await res.json() };
}

function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

interface Seed {
	title: string;
	startsOn: string;
	startsAt?: string | null;
	endsOn?: string | null;
	onWebsite: boolean;
	tags?: string[];
	groups?: string[];
}

async function insertEvent(e: Seed): Promise<string> {
	const id = crypto.randomUUID();
	await core.database.forModule('events').transaction(async (tx) => {
		await tx.execute(sql`
			INSERT INTO events (id, title, description, location, color, starts_on, starts_at, ends_on,
				ends_at, on_website, owner_id, created_by)
			VALUES (${id}, ${e.title}, 'Beschreibung', 'Heim', '#2563eb', ${e.startsOn}::date,
				${e.startsAt ?? null}, ${e.endsOn ?? null}::date, null, ${e.onWebsite}, 'owner-1', 'owner-1')
		`);
		for (const [i, tag] of (e.tags ?? []).entries()) {
			await tx.execute(
				sql`INSERT INTO event_tags (event_id, tag, position) VALUES (${id}, ${tag}, ${i})`
			);
		}
		for (const g of e.groups ?? []) {
			await tx.execute(sql`INSERT INTO event_groups (event_id, group_id) VALUES (${id}, ${g})`);
		}
		await tx.execute(
			sql`INSERT INTO event_shares (event_id, principal_type, principal_id, level)
				VALUES (${id}, 'everyone', '*', 'read')`
		);
	});
	return id;
}

const today = todayBerlin();
let groupId: string;

beforeAll(async () => {
	await useTestDatabase();
	registerCoreApi();
	registerModule(membersModule);
	registerModule(eventsModule);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = await ctxOf(u!.id);
	await enableModule(admin, 'members');
	await enableModule(admin, 'events');
	admin = await ctxOf(u!.id);
	adminKey = (await createApiKey(admin, { name: 'admin', scopes: ['events.event.view'] })).key;

	const roleId = await createRole(admin, {
		name: 'Website',
		permissions: ['events.website.read', 'core.api.manage']
	});
	const webUserId = await createUser(admin, {
		name: 'Website',
		email: 'website@example.test',
		password: 'correct-horse-battery-2',
		roleIds: [roleId]
	});
	const web = await ctxOf(webUserId);
	websiteKey = (await createApiKey(web, { name: 'web', scopes: ['events.website.read'] })).key;
	noScopeKey = (await createApiKey(web, { name: 'kein', scopes: ['core.api.manage'] })).key;

	groupId = crypto.randomUUID();
	await core.database.forModule('members').transaction(async (tx) => {
		await tx.execute(
			sql`INSERT INTO groups (id, name, type) VALUES (${groupId}, 'Sippe Falke', 'sippe')`
		);
	});
});

describe('GET /website/events', () => {
	let future: string;
	let running: string;
	let later: string;

	beforeAll(async () => {
		later = await insertEvent({
			title: 'Sommerlager',
			startsOn: addDays(today, 30),
			endsOn: addDays(today, 37),
			onWebsite: true,
			tags: ['Lager', 'Sommer'],
			groups: ['stamm', groupId]
		});
		future = await insertEvent({
			title: 'Gruppenstunde',
			startsOn: addDays(today, 3),
			startsAt: '17:00',
			onWebsite: true,
			tags: ['Gruppenstunde'],
			groups: [groupId]
		});
		running = await insertEvent({
			title: 'Laufende Fahrt',
			startsOn: addDays(today, -2),
			endsOn: addDays(today, 1),
			onWebsite: true
		});
		await insertEvent({ title: 'Vorbei', startsOn: addDays(today, -10), onWebsite: true });
		await insertEvent({ title: 'Intern', startsOn: addDays(today, 5), onWebsite: false });
	});

	it('liefert nur Website-Termine ab heute, sortiert, nur öffentliche Felder', async () => {
		const { status, body } = await get('/website/events', websiteKey);
		expect(status, JSON.stringify(body)).toBe(200);
		const items = body.data as Record<string, unknown>[];
		expect(items.map((e) => e.id)).toEqual([running, future, later]);
		for (const item of items) {
			expect(Object.keys(item).sort()).toEqual(
				[
					'color',
					'description',
					'endsOn',
					'endsTime',
					'groups',
					'id',
					'location',
					'occurrenceDate',
					'recurring',
					'startsOn',
					'startsTime',
					'tags',
					'title'
				].sort()
			);
		}
		const summer = items[2]!;
		expect(summer.tags).toEqual(['Lager', 'Sommer']);
		expect(summer.groups).toEqual([DEFAULT_STAMM_NAME, 'Sippe Falke']);
		expect(summer.endsOn).toBe(addDays(today, 37));
		expect(items[1]!.startsTime).toBe('17:00');
		expect(items[1]!.endsOn).toBeNull();
	});

	it('filtert nach Tag (ohne Groß-/Kleinschreibung), Zeitraum und Limit', async () => {
		const byTag = await get('/website/events?tag=lager', websiteKey);
		expect(byTag.body.data.map((e: { id: string }) => e.id)).toEqual([later]);

		const range = await get(
			`/website/events?from=${addDays(today, -20)}&to=${addDays(today, 4)}`,
			websiteKey
		);
		expect(range.body.data.map((e: { title: string }) => e.title)).toEqual([
			'Vorbei',
			'Laufende Fahrt',
			'Gruppenstunde'
		]);

		const limited = await get('/website/events?limit=1', websiteKey);
		expect(limited.body.data).toHaveLength(1);

		const bad = await get(`/website/events?from=${today}&to=${addDays(today, -1)}`, websiteKey);
		expect(bad.status).toBe(422);
	});

	it('Key ohne Scope events.website.read → 403', async () => {
		const { status, body } = await get('/website/events', noScopeKey);
		expect(status).toBe(403);
		expect(body.error.code).toBe('forbidden');
	});

	it('Website-Key darf keine internen Endpoints nutzen', async () => {
		const { status } = await get('/groups', websiteKey);
		expect(status).toBe(403);
	});
});

describe('Meta-Endpoints', () => {
	it('GET /tags: häufigste zuerst, case-insensitiv zusammengefasst, Teilsuche', async () => {
		await insertEvent({ title: 'A', startsOn: today, onWebsite: false, tags: ['lager'] });
		await insertEvent({ title: 'B', startsOn: today, onWebsite: false, tags: ['LAGER', 'Ab_c'] });
		const all = await get('/tags', adminKey);
		expect(all.status).toBe(200);
		const tags = all.body.data as string[];
		expect(tags[0]!.toLowerCase()).toBe('lager');
		expect(tags.filter((t) => t.toLowerCase() === 'lager')).toHaveLength(1);
		expect(tags).toEqual(expect.arrayContaining(['Sommer', 'Gruppenstunde', 'Ab_c']));

		const search = await get('/tags?search=OMM', adminKey);
		expect(search.body.data).toEqual(['Sommer']);
		// `_` ist kein Platzhalter
		const literal = await get('/tags?search=b_', adminKey);
		expect(literal.body.data).toEqual(['Ab_c']);
	});

	it('GET /settings/stamm liefert den Stammesnamen', async () => {
		const { status, body } = await get('/settings/stamm', adminKey);
		expect(status).toBe(200);
		expect(body.data).toEqual({ name: DEFAULT_STAMM_NAME });
	});

	it('GET /principals sucht Stamm und Gruppen', async () => {
		const { status, body } = await get('/principals?search=Falke', adminKey);
		expect(status, JSON.stringify(body)).toBe(200);
		expect(body.data).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'group', id: groupId })])
		);
		const short = await get('/principals?search=a', adminKey);
		expect(short.status).toBe(422);
	});

	it('GET /groups: Stamm zuerst, mit members-Gruppen; ohne members nur Stamm', async () => {
		const on = await get('/groups', adminKey);
		expect(on.status).toBe(200);
		expect(on.body.data).toEqual([
			{
				id: 'stamm',
				name: DEFAULT_STAMM_NAME,
				color: null,
				meetingWeekday: null,
				meetingTime: null,
				meetingPlace: null
			},
			{
				id: groupId,
				name: 'Sippe Falke',
				color: null,
				meetingWeekday: null,
				meetingTime: null,
				meetingPlace: null
			}
		]);

		await disableModule(admin, 'members');
		const off = await get('/groups', adminKey);
		expect(off.body.data).toEqual([
			{
				id: 'stamm',
				name: DEFAULT_STAMM_NAME,
				color: null,
				meetingWeekday: null,
				meetingTime: null,
				meetingPlace: null
			}
		]);
		// Website ohne members: Gruppennamen nur noch Stamm
		const web = await get('/website/events?tag=lager', websiteKey);
		expect(web.body.data[0].groups).toEqual([DEFAULT_STAMM_NAME]);
		await enableModule(admin, 'members');
	});
});
