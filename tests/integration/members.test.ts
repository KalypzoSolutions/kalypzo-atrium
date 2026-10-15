import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { registerModule } from '$lib/server/core/modules/registry';
import { disableModule, enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { listAudit } from '$lib/server/core/audit/service';
import membersModule from '$lib/modules/members/module';
import type { RequestContext } from '$lib/sdk/types';

const ADMIN_EMAIL = 'admin@example.test';
const ADMIN_PW = 'correct-horse-battery';
const BASE = '/modules/members';

let admin: RequestContext;
let adminId: string;
let fullKey: string;
let viewKey: string;

function api(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
	const { token, json, ...rest } = init;
	const headers = new Headers(rest.headers);
	if (token) headers.set('authorization', `Bearer ${token}`);
	if (json !== undefined) {
		rest.body = JSON.stringify(json);
		headers.set('content-type', 'application/json');
	}
	const url = new URL(`http://localhost:5173/api/v1${path}`);
	return handleApiRequest({
		request: new Request(url, { ...rest, headers }),
		url,
		ip: '127.0.0.1'
	});
}

const call = (path: string, init: Parameters<typeof api>[1] = {}) =>
	api(`${BASE}${path}`, { token: fullKey, ...init });

async function data<T>(res: Response, status = 200): Promise<T> {
	const body = await res.json();
	expect(res.status, JSON.stringify(body)).toBe(status);
	return body.data as T;
}

const memberBody = (over: Record<string, unknown> = {}) => ({
	firstName: 'Max',
	lastName: 'Muster',
	scoutName: 'Fuchs',
	birthDate: '2012-05-17',
	address: 'Musterweg 1, 12345 Musterstadt',
	phones: [
		{ name: 'Mutter', value: '0123 456' },
		{ name: null, value: '0987 654' }
	],
	emails: [
		{ name: null, value: 'max@example.test' },
		{ name: 'Eltern', value: 'eltern@example.test' }
	],
	stage: 'pfadfinder',
	groupIds: [],
	consentSocialMedia: true,
	consentWebsite: false,
	consentPrint: true,
	...over
});

interface MemberDto {
	id: string;
	phones: { name: string | null; value: string }[];
	emails: { name: string | null; value: string }[];
	groups: { id: string; color: string | null }[];
}
interface GroupDto {
	id: string;
	name: string;
	meetingWeekday: number | null;
	meetingTime: string | null;
	color: string | null;
	hasImage: boolean;
	imageVersion: string | null;
	leaders: { id: string }[];
	memberCount: number;
}

// Gemeinsamer Zustand ueber die Tests hinweg (Bootstrap-Fluss)
let leader: MemberDto;
let group: GroupDto;

beforeAll(async () => {
	await useTestDatabase();
	registerCoreApi();
	registerModule(membersModule);
	await syncModules();
	await bootstrapAdmin(ADMIN_EMAIL, ADMIN_PW);
	const [u] = await getDb().select().from(schema.user).where(eq(schema.user.email, ADMIN_EMAIL));
	adminId = u!.id;
	const ctxOf = async () => {
		const r = await contextForUser(adminId);
		if (!r) throw new Error('Kontext nicht aufloesbar');
		return r.ctx;
	};
	admin = await ctxOf();
	await enableModule(admin, 'members');
	admin = await ctxOf(); // neue Modulrechte wirksam
	const perms = membersModule.manifest.permissions;
	fullKey = (await createApiKey(admin, { name: 'full', scopes: [...perms] })).key;
	viewKey = (
		await createApiKey(admin, {
			name: 'view',
			scopes: ['members.member.view', 'members.group.view']
		})
	).key;
});

describe('Bootstrap: Mitglieder und Gruppen', () => {
	it('legt das erste Mitglied ohne Gruppe an (Mehrfach-Telefon/E-Mail)', async () => {
		leader = await data<MemberDto>(
			await call('/members', { method: 'POST', json: memberBody() }),
			201
		);
		expect(leader.phones).toEqual([
			{ name: 'Mutter', value: '0123 456' },
			{ name: null, value: '0987 654' }
		]);
		expect(leader.emails).toEqual([
			{ name: null, value: 'max@example.test' },
			{ name: 'Eltern', value: 'eltern@example.test' }
		]);
		expect(leader.groups).toEqual([]);
	});

	it('legt eine Gruppe mit diesem Mitglied als Leiter an', async () => {
		group = await data<GroupDto>(
			await call('/groups', {
				method: 'POST',
				json: {
					name: 'Wolfsrudel',
					type: 'meute',
					leaderIds: [leader.id],
					meetingPlace: 'Heim',
					meetingTime: '16:30'
				}
			}),
			201
		);
		expect(group.leaders.map((l) => l.id)).toEqual([leader.id]);
		const list = await data<GroupDto[]>(await call('/groups'));
		expect(list.some((g) => g.id === group.id)).toBe(true);
	});

	it('verlangt danach mindestens eine Gruppe pro Mitglied (422)', async () => {
		const res = await call('/members', {
			method: 'POST',
			json: memberBody({ firstName: 'Ohne', groupIds: [] })
		});
		expect(res.status).toBe(422);
	});
});

describe('Mitglieder-CRUD', () => {
	let memberId: string;

	it('legt ein Mitglied mit Gruppe an und liefert es in Liste und Detail', async () => {
		const m = await data<MemberDto>(
			await call('/members', {
				method: 'POST',
				json: memberBody({ firstName: 'Lena', groupIds: [group.id] })
			}),
			201
		);
		memberId = m.id;
		expect(m.groups.map((g) => g.id)).toEqual([group.id]);
		const list = await data<{ items: MemberDto[]; total: number }>(
			await call('/members?limit=200&offset=0')
		);
		expect(list.total).toBeGreaterThanOrEqual(2);
		const detail = await data<MemberDto>(await call(`/members/${memberId}`));
		expect(detail.id).toBe(memberId);
		const g = (await data<GroupDto[]>(await call('/groups'))).find((x) => x.id === group.id);
		expect(g!.memberCount).toBeGreaterThanOrEqual(1);
	});

	it('aktualisiert Telefon- und E-Mail-Listen', async () => {
		const m = await data<MemberDto>(
			await call(`/members/${memberId}`, {
				method: 'PUT',
				json: memberBody({
					firstName: 'Lena',
					groupIds: [group.id],
					phones: [{ name: 'Oma', value: '+49 111 22233' }],
					emails: [
						{ value: 'a@example.test' },
						{ value: 'B@Example.test', name: 'Papa' },
						{ value: 'c@example.test' }
					]
				})
			})
		);
		expect(m.phones).toEqual([{ name: 'Oma', value: '+49 111 22233' }]);
		expect(m.emails).toHaveLength(3);
		expect(m.emails[1]).toEqual({ name: 'Papa', value: 'b@example.test' });
	});

	const post = (over: Record<string, unknown>) =>
		call('/members', {
			method: 'POST',
			json: memberBody({ groupIds: [group.id], ...over })
		});

	it('lehnt ungueltige Telefonnummern ab (422)', async () => {
		expect((await post({ phones: [{ name: null, value: 'abc' }] })).status).toBe(422);
		expect((await post({ phones: [{ name: null, value: '12' }] })).status).toBe(422);
	});

	it('lehnt doppelte E-Mail-Adressen ab (422)', async () => {
		const res = await post({
			emails: [{ value: 'x@example.test' }, { value: 'X@example.test', name: 'Zweit' }]
		});
		expect(res.status).toBe(422);
	});

	it('lehnt ein Geburtsdatum in der Zukunft ab (422)', async () => {
		const future = `${new Date().getFullYear() + 1}-01-01`;
		expect((await post({ birthDate: future })).status).toBe(422);
		expect((await post({ birthDate: '2012-02-30' })).status).toBe(422);
	});

	it('validiert Eingaben (ungueltige E-Mail, Stufe) mit 422', async () => {
		const bad = await call('/members', {
			method: 'POST',
			json: memberBody({ emails: [{ name: null, value: 'kaputt' }], groupIds: [group.id] })
		});
		expect(bad.status).toBe(422);
		const stage = await call('/members', {
			method: 'POST',
			json: memberBody({ stage: 'xyz', groupIds: [group.id] })
		});
		expect(stage.status).toBe(422);
	});

	it('loescht ein Mitglied', async () => {
		const res = await call(`/members/${memberId}`, { method: 'DELETE' });
		expect([200, 204]).toContain(res.status);
		expect((await call(`/members/${memberId}`)).status).toBe(404);
	});
});

describe('Gruppen-Regeln', () => {
	it('verlangt mindestens einen Leiter (422)', async () => {
		const res = await call('/groups', {
			method: 'POST',
			json: { name: 'Leer', type: 'sippe', leaderIds: [] }
		});
		expect(res.status).toBe(422);
	});

	it('aktualisiert eine Gruppe', async () => {
		const g = await data<GroupDto>(
			await call(`/groups/${group.id}`, {
				method: 'PUT',
				json: { name: 'Wolfsrudel Nord', type: 'meute', leaderIds: [leader.id] }
			})
		);
		expect(g.name).toBe('Wolfsrudel Nord');
	});

	it('sperrt das Loeschen des einzigen Leiters (409)', async () => {
		const res = await call(`/members/${leader.id}`, { method: 'DELETE' });
		expect(res.status).toBe(409);
	});

	it('sperrt das Loeschen einer Gruppe mit Mitgliedern (409)', async () => {
		const m = await data<MemberDto>(
			await call('/members', {
				method: 'POST',
				json: memberBody({ firstName: 'Kai', groupIds: [group.id] })
			}),
			201
		);
		expect((await call(`/groups/${group.id}`, { method: 'DELETE' })).status).toBe(409);
		// Mitglied entfernen, dann ist die Gruppe loeschbar sofern keine Mitglieder uebrig sind
		await call(`/members/${m.id}`, { method: 'DELETE' });
	});

	it('loescht eine leere Gruppe', async () => {
		const g = await data<GroupDto>(
			await call('/groups', {
				method: 'POST',
				json: { name: 'Temp', type: 'sippe', leaderIds: [leader.id] }
			}),
			201
		);
		const res = await call(`/groups/${g.id}`, { method: 'DELETE' });
		expect([200, 204]).toContain(res.status);
	});
});

describe('Gruppen: Wochentag, Farbe, Bild', () => {
	let g: GroupDto;

	it('speichert Wochentag und normalisiert die Farbe', async () => {
		g = await data<GroupDto>(
			await call('/groups', {
				method: 'POST',
				json: {
					name: 'Adler',
					type: 'sippe',
					leaderIds: [leader.id],
					meetingWeekday: 3,
					meetingTime: '17:30',
					color: '#ABC'
				}
			}),
			201
		);
		expect(g.meetingWeekday).toBe(3);
		expect(g.meetingTime).toBe('17:30');
		expect(g.color).toBe('#aabbcc');
		expect(g.hasImage).toBe(false);
		expect(g.imageVersion).toBeNull();
		const listed = (await data<GroupDto[]>(await call('/groups'))).find((x) => x.id === g.id);
		expect(listed!.meetingWeekday).toBe(3);
		expect(listed!.color).toBe('#aabbcc');
	});

	it('lehnt ungueltige Farbe und Wochentag ab (422)', async () => {
		const base = { name: 'Farbe', type: 'sippe', leaderIds: [leader.id] };
		expect(
			(await call('/groups', { method: 'POST', json: { ...base, color: 'rot' } })).status
		).toBe(422);
		expect(
			(await call('/groups', { method: 'POST', json: { ...base, meetingWeekday: 8 } })).status
		).toBe(422);
	});

	it('liefert die Gruppenfarbe in den Gruppen eines Mitglieds', async () => {
		const m = await data<MemberDto>(
			await call('/members', {
				method: 'POST',
				json: memberBody({ firstName: 'Farbig', groupIds: [g.id] })
			}),
			201
		);
		expect(m.groups[0]!.color).toBe('#aabbcc');
		await call(`/members/${m.id}`, { method: 'DELETE' });
	});

	it('Bild-Upload ohne verfuegbaren Storage schlaegt kontrolliert fehl', async () => {
		const form = new FormData();
		form.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
		const res = await call(`/groups/${g.id}/image`, { method: 'POST', body: form });
		expect(res.ok).toBe(false);
		expect([502, 503]).toContain(res.status);
	});

	it('lehnt falschen Content-Type ab', async () => {
		const form = new FormData();
		form.set('file', new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }));
		const res = await call(`/groups/${g.id}/image`, { method: 'POST', body: form });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(JSON.stringify(body)).toContain('bad_request');
	});

	it('liefert ohne Bild 404', async () => {
		expect((await call(`/groups/${g.id}/image`)).status).toBe(404);
		expect((await call(`/groups/${g.id}/image`, { method: 'DELETE' })).status).toBe(404);
	});
});

describe('Dokumente (ohne Storage)', () => {
	it('lehnt unbekannte Dokumentarten ab (422)', async () => {
		const res = await call(`/members/${leader.id}/documents/unknown`);
		expect(res.status).toBe(422);
	});

	it('liefert ohne Dokument keinen Erfolg', async () => {
		const res = await call(`/members/${leader.id}/documents/privacy`);
		expect(res.ok).toBe(false);
	});

	it('Upload ohne verfuegbaren Storage schlaegt kontrolliert fehl', async () => {
		const form = new FormData();
		form.set('file', new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' }));
		const res = await call(`/members/${leader.id}/documents/privacy`, {
			method: 'POST',
			body: form
		});
		expect(res.ok).toBe(false);
		expect(res.status).toBeLessThan(600);
	});
});

describe('Berechtigungen und Modulstatus', () => {
	it('verweigert Schreibzugriff ohne Recht (403)', async () => {
		const res = await api(`${BASE}/groups`, {
			method: 'POST',
			token: viewKey,
			json: { name: 'X', type: 'sippe', leaderIds: [leader.id] }
		});
		expect(res.status).toBe(403);
		expect((await api(`${BASE}/groups`, { token: viewKey })).status).toBe(200);
	});

	it('verweigert Anfragen ohne Anmeldung (401)', async () => {
		expect((await api(`${BASE}/groups`)).status).toBe(401);
	});

	it('schreibt Audit-Eintraege', async () => {
		for (const action of [
			'members.member.created',
			'members.member.updated',
			'members.member.deleted',
			'members.group.created',
			'members.group.updated',
			'members.group.deleted'
		]) {
			const { rows } = await listAudit({ action });
			expect(rows.length, action).toBeGreaterThan(0);
		}
	});

	it('deaktiviertes Modul ist nicht erreichbar (404)', async () => {
		await disableModule(admin, 'members');
		const res = await call('/groups');
		expect(res.status).toBe(404);
	});
});
