/**
 * Globale Suche (Core): Eingabe-Normalisierung, sichere Links, Benutzer*innen/Rollen nur mit Recht,
 * Modul-Suchquellen nur aktiv + mit Recht, fehlerhafte Quelle wird übersprungen, Route `/search`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
import { enableModule, syncModules } from '$lib/server/core/modules/service';
import {
	isSafeHref,
	likePattern,
	normalizeQuery,
	searchEverything
} from '$lib/server/core/search/service';
import { GET as getSearch } from '../../src/routes/(internal)/search/+server';
import type { ModuleDefinition } from '$lib/server/core/modules/types';
import type { RequestContext } from '$lib/sdk/types';

let close: () => Promise<void>;
let admin: RequestContext;
let user: RequestContext;
let userId: string;
const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;

const probe: ModuleDefinition = {
	manifest: {
		id: 'search-probe',
		name: 'Suchprobe',
		version: '1.0.0',
		permissions: ['search-probe.item.view'],
		permissionDescriptions: { 'search-probe.item.view': 'Probe' },
		navigation: [],
		dependencies: []
	},
	search: {
		permission: 'search-probe.item.view',
		run: async (_ctx, q) => [
			{ id: '1', title: `Treffer ${q}`, href: '/modules/search-probe', type: 'Probe' },
			{ id: '2', title: 'Böser Link', href: '//evil.example', type: 'Probe' },
			{ id: '3', title: 'JS', href: 'javascript:alert(1)', type: 'Probe' }
		]
	}
};
const broken: ModuleDefinition = {
	manifest: {
		id: 'search-broken',
		name: 'Kaputt',
		version: '1.0.0',
		permissions: ['search-broken.item.view'],
		permissionDescriptions: { 'search-broken.item.view': 'Probe' },
		navigation: [],
		dependencies: []
	},
	search: {
		run: async () => {
			throw new Error('kaputt');
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
	admin = await ctxOf(a!.id);
	await enableModule(admin, 'search-broken');
	admin = await ctxOf(a!.id);
	const role = await createRole(admin, { name: 'Leer', permissions: [] });
	userId = await createUser(admin, {
		name: 'Nora Nutzer_in',
		email: 'nora@example.test',
		password: 'correct-horse-battery',
		roleIds: [role]
	});
	user = await ctxOf(userId);
});

afterAll(async () => {
	unregisterModule('search-probe');
	unregisterModule('search-broken');
	await close();
});

describe('Hilfen', () => {
	it('normalisiert den Suchbegriff', () => {
		expect(normalizeQuery(' a ')).toBeNull();
		expect(normalizeQuery('  Nora   Nutzer ')).toBe('Nora Nutzer');
		expect(normalizeQuery('x'.repeat(150))).toHaveLength(100);
	});
	it('escaped LIKE-Sonderzeichen', () => {
		expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
	});
	it('erlaubt nur relative App-Pfade', () => {
		expect(isSafeHref('/modules/x?y=1')).toBe(true);
		expect(isSafeHref('//evil.example')).toBe(false);
		expect(isSafeHref('javascript:alert(1)')).toBe(false);
		expect(isSafeHref('https://x')).toBe(false);
	});
});

describe('searchEverything', () => {
	it('Admin findet Benutzer*innen und Rollen', async () => {
		const r = await searchEverything(admin, 'nora');
		const core = r.groups.find((g) => g.source === 'core');
		expect(core?.hits.map((h) => h.title)).toContain('Nora Nutzer_in');
		expect(core?.hits[0]!.href).toMatch(/^\/admin\/users\/[0-9a-f-]{36}$/);
		const roles = await searchEverything(admin, 'leer');
		expect(roles.groups.find((g) => g.source === 'core')?.hits[0]).toMatchObject({
			title: 'Leer',
			type: 'Rolle'
		});
	});

	it('ohne Rechte keine Benutzer*innen', async () => {
		const r = await searchEverything(user, 'nora');
		expect(r.groups).toEqual([]);
	});

	it('% und _ wirken wörtlich', async () => {
		const r = await searchEverything(admin, '_in');
		expect(r.groups.find((g) => g.source === 'core')?.hits.map((h) => h.title)).toEqual([
			'Nora Nutzer_in'
		]);
		const none = await searchEverything(admin, '%%');
		expect(none.groups.find((g) => g.source === 'core')).toBeUndefined();
	});

	it('Modulquelle nur aktiv und mit Recht; unsichere Links entfallen; Fehler überspringt Quelle', async () => {
		let r = await searchEverything(admin, 'abc');
		expect(r.groups.find((g) => g.source === 'search-probe')).toBeUndefined();
		await enableModule(admin, 'search-probe');
		admin = await ctxOf(admin.userId!);
		r = await searchEverything(admin, 'abc');
		const g = r.groups.find((x) => x.source === 'search-probe');
		expect(g?.label).toBe('Suchprobe');
		expect(g?.hits.map((h) => h.id)).toEqual(['1']);
		expect(r.groups.find((x) => x.source === 'search-broken')).toBeUndefined();
		// Ohne Recht: nichts aus dem Modul
		const u = await searchEverything(await ctxOf(userId), 'abc');
		expect(u.groups.find((x) => x.source === 'search-probe')).toBeUndefined();
	});
});

describe('GET /search', () => {
	const call = (locals: Record<string, unknown>, q: string) =>
		getSearch({
			locals,
			url: new URL(`http://localhost/search?q=${encodeURIComponent(q)}`)
		} as never);

	it('401 ohne Login', async () => {
		const res = await call({ user: null, ctx: user }, 'nora');
		expect(res.status).toBe(401);
	});

	it('liefert Treffer mit no-store', async () => {
		const res = await call({ user: { id: admin.userId }, ctx: admin }, 'nora');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = (await res.json()) as { data: { groups: { source: string }[] } };
		expect(body.data.groups.some((g) => g.source === 'core')).toBe(true);
	});

	it('zu kurzer Begriff → leer', async () => {
		const res = await call({ user: { id: admin.userId }, ctx: admin }, 'n');
		expect(((await res.json()) as { data: { groups: unknown[] } }).data.groups).toEqual([]);
	});
});
