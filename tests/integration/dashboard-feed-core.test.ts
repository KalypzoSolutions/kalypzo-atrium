/**
 * Übersicht (Core): `collectDashboardFeed` sammelt „Zu erledigen“ und „Diese Woche“ nur aus aktiven
 * Modulen mit Recht, bereinigt Einträge (unsichere Links, ungültige Daten, außerhalb der Woche),
 * sortiert, überspringt fehlerhafte Quellen; Route `GET /dashboard/feed` nur mit Anmeldung.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
import { disableModule, enableModule, syncModules } from '$lib/server/core/modules/service';
import { collectDashboardFeed } from '$lib/server/core/dashboard/feed';
import { GET as getFeed } from '../../src/routes/(internal)/dashboard/feed/+server';
import type { ModuleDefinition } from '$lib/server/core/modules/types';
import type { RequestContext } from '$lib/sdk/types';

let close: () => Promise<void>;
let admin: RequestContext;
let user: RequestContext;
let adminId: string;
let userId: string;
const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;
const TODAY = '2026-10-29';
const seenOpts: unknown[] = [];

const probe: ModuleDefinition = {
	manifest: {
		id: 'dash-probe',
		name: 'Probe',
		version: '1.0.0',
		permissions: ['dash-probe.item.view'],
		permissionDescriptions: { 'dash-probe.item.view': 'Probe' },
		navigation: [],
		dependencies: []
	},
	dashboard: {
		todos: {
			permission: 'dash-probe.item.view',
			run: async (ctx, opts) => {
				seenOpts.push(opts);
				return [
					{
						id: 'later',
						title: 'Später',
						severity: 'due',
						due: '2026-11-09',
						action: { label: 'Öffnen', href: '/modules/dash-probe/1' }
					},
					{
						id: 'pay',
						title: 'Rechnung bezahlen',
						detail: `für ${ctx.actor.name}`,
						severity: 'overdue',
						due: '2026-10-20',
						amountCents: 17000,
						action: { label: 'Bezahlen', href: '/modules/dash-probe/2' },
						payment: {
							holder: 'Stamm',
							iban: 'DE12290501010001234567',
							amountCents: 17000,
							reference: 'R-1'
						}
					},
					{
						id: 'evil',
						title: 'Böser Link',
						severity: 'due',
						action: { label: 'Los', href: '//evil.example' }
					},
					{
						id: 'bad',
						title: 'Ungültig',
						severity: 'kaputt' as never,
						action: { label: 'Los', href: '/x' }
					},
					{
						id: 'later',
						title: 'Doppelt',
						severity: 'info',
						action: { label: 'Los', href: '/x' }
					}
				];
			}
		},
		agenda: {
			permission: 'dash-probe.item.view',
			run: async (_ctx, opts) => {
				seenOpts.push(opts);
				return [
					{
						id: 'a',
						kind: 'event',
						title: 'Leiterrunde',
						date: '2026-10-29',
						startTime: '19:30',
						href: '/a'
					},
					{
						id: 'b',
						kind: 'action',
						title: 'Hajk',
						date: '2026-10-31',
						endDate: '2026-11-02',
						href: '/b'
					},
					{ id: 'c', kind: 'event', title: 'Vorwoche', date: '2026-10-20', href: '/c' },
					{
						id: 'd',
						kind: 'event',
						title: 'Lange davor',
						date: '2026-10-01',
						endDate: '2026-10-26',
						href: '/d'
					},
					{
						id: 'e',
						kind: 'event',
						title: 'Kaputte Zeit',
						date: '2026-10-30',
						startTime: '25:00',
						href: '/e'
					},
					{ id: 'f', kind: 'event', title: 'Kein Datum', date: '30.10.2026', href: '/f' },
					{ id: 'g', kind: 'party' as never, title: 'Falsche Art', date: '2026-10-30', href: '/g' }
				];
			}
		}
	}
};

const broken: ModuleDefinition = {
	manifest: {
		id: 'dash-broken',
		name: 'Kaputt',
		version: '1.0.0',
		permissions: [],
		permissionDescriptions: {},
		navigation: [],
		dependencies: []
	},
	dashboard: {
		todos: {
			run: async () => {
				throw new Error('kaputt');
			}
		}
	}
};

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerModule(probe);
	registerModule(broken);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [a] = await getDb()
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	adminId = a!.id;
	admin = await ctxOf(adminId);
	await enableModule(admin, 'dash-probe');
	await enableModule(admin, 'dash-broken');
	admin = await ctxOf(adminId);
	const role = await createRole(admin, { name: 'Leer', permissions: [] });
	userId = await createUser(admin, {
		name: 'Nora Nutzer',
		email: 'nora@example.test',
		password: 'correct-horse-battery',
		roleIds: [role]
	});
	user = await ctxOf(userId);
});

afterAll(async () => {
	unregisterModule('dash-probe');
	unregisterModule('dash-broken');
	await close();
});

describe('collectDashboardFeed', () => {
	it('Woche Montag–Sonntag, Quellen bekommen heute/Zeitraum', async () => {
		seenOpts.length = 0;
		const feed = await collectDashboardFeed(admin, { today: TODAY });
		expect(feed).toMatchObject({ today: TODAY, from: '2026-10-26', to: '2026-11-01' });
		expect(seenOpts).toContainEqual({ today: TODAY, limit: 10 });
		expect(seenOpts).toContainEqual({ today: TODAY, from: '2026-10-26', to: '2026-11-01' });
	});

	it('bereinigt und sortiert „Zu erledigen“; Fehler einer Quelle wird gemeldet, Rest bleibt', async () => {
		const feed = await collectDashboardFeed(admin, { today: TODAY });
		expect(feed.todos.map((t) => t.id)).toEqual(['pay', 'later']);
		expect(feed.todos[0]).toMatchObject({
			moduleId: 'dash-probe',
			moduleName: 'Probe',
			amountCents: 17000,
			payment: { iban: 'DE12290501010001234567', amountCents: 17000 }
		});
		expect(feed.failed).toEqual(['Kaputt']);
	});

	it('Agenda: nur Einträge der Woche, gültige Art/Datum, kaputte Uhrzeit entfällt', async () => {
		const feed = await collectDashboardFeed(admin, { today: TODAY });
		expect(feed.agenda.map((a) => a.id)).toEqual(['d', 'a', 'e', 'b']);
		expect(feed.agenda.find((a) => a.id === 'e')!.startTime).toBeNull();
		expect(feed.agenda.find((a) => a.id === 'b')).toMatchObject({ endDate: '2026-11-02' });
	});

	it('ohne Recht keine Einträge aus der Quelle', async () => {
		const feed = await collectDashboardFeed(user, { today: TODAY });
		expect(feed.todos).toEqual([]);
		expect(feed.agenda).toEqual([]);
		// die Quelle ohne Recht-Vorgabe läuft auch für Nora und schlägt fehl
		expect(feed.failed).toEqual(['Kaputt']);
	});

	it('deaktiviertes Modul liefert nichts', async () => {
		await disableModule(admin, 'dash-probe');
		admin = await ctxOf(adminId);
		const feed = await collectDashboardFeed(admin, { today: TODAY });
		expect(feed.todos).toEqual([]);
		expect(feed.agenda).toEqual([]);
		await enableModule(admin, 'dash-probe');
		admin = await ctxOf(adminId);
	});

	it('ohne Konto (System/API-Key ohne Benutzer) leer', async () => {
		const feed = await collectDashboardFeed({ ...admin, userId: null } as RequestContext, {
			today: TODAY
		});
		expect(feed.todos).toEqual([]);
	});
});

describe('GET /dashboard/feed', () => {
	it('401 ohne Anmeldung, sonst Daten mit no-store', async () => {
		const call = (locals: object) =>
			getFeed({ locals } as unknown as Parameters<typeof getFeed>[0]) as Promise<Response>;
		const anon = await call({ user: null, ctx: user });
		expect(anon.status).toBe(401);
		const res = await call({ user: { id: adminId }, ctx: admin });
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = (await res.json()) as { data: { todos: { id: string }[] } };
		expect(body.data.todos.map((t) => t.id)).toEqual(['pay', 'later']);
	});
});
