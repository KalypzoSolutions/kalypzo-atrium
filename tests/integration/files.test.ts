/**
 * Modul `files` (Dateien) über die REST-API (`handleApiRequest`): Meta, Ordner, Upload (Fake-Storage),
 * Inhalt/Thumbnail, Liste, Umbenennen, Verschieben, Suche, Papierkorb inkl. Job, Zugriff, Audit,
 * Modul deaktiviert. Testbilder werden mit sharp erzeugt.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, like, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { useTestDatabase } from '../helpers/db';
import {
	fakeFileRows,
	fakeObjects,
	installFakeStorage,
	uninstallFakeStorage
} from '../helpers/fake-storage';
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
import { setSetting } from '$lib/server/core/settings/service';
import { runJobNow } from '$lib/server/core/jobs';
import { core } from '$lib/server/core';
import filesModule from '$lib/modules/files/module';
import {
	MAX_DEPTH,
	type FileNode,
	type FolderListing,
	type TrashItem
} from '$lib/modules/files/schemas';
import type { RequestContext } from '$lib/sdk/types';

const ROOT = 'http://localhost:5173/api/v1/modules/files';
const PW = 'a-long-enough-pw';
const keys: Record<string, string> = {};
const ids: Record<string, string> = {};
let close: () => Promise<void>;
let admin: RequestContext;
let adminId: string;

const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;

interface Res {
	status: number;
	headers: Headers;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	body: any;
}

async function send(who: string | null, method: string, path: string, init: RequestInit = {}) {
	resetAllForTests();
	const url = new URL(ROOT + path);
	const headers = new Headers(init.headers);
	if (who) headers.set('authorization', `Bearer ${keys[who]}`);
	const res = await handleApiRequest({
		request: new Request(url, { ...init, method, headers }),
		url,
		ip: '127.0.0.1'
	});
	const text = await res.text();
	let body: unknown = text;
	try {
		body = JSON.parse(text);
	} catch {
		/* roher Inhalt */
	}
	return { status: res.status, headers: res.headers, body } as Res;
}

const api = (who: string | null, method: string, path: string, data?: unknown) =>
	send(who, method, path, {
		headers: data === undefined ? {} : { 'content-type': 'application/json' },
		body: data === undefined ? undefined : JSON.stringify(data)
	});

interface UploadOpts {
	space?: 'personal' | 'shared';
	relativePath?: string;
	conflict?: 'rename' | 'replace';
	type?: string;
	bytes?: Uint8Array;
	size?: number;
	withLength?: boolean;
}

async function upload(who: string, parent: string, name: string, o: UploadOpts = {}) {
	const form = new FormData();
	form.set('space', o.space ?? 'personal');
	if (o.relativePath !== undefined) form.set('relativePath', o.relativePath);
	if (o.conflict) form.set('conflict', o.conflict);
	const bytes = o.bytes ?? new Uint8Array(o.size ?? 10).fill(65);
	form.set('file', new File([bytes as BlobPart], name, { type: o.type ?? 'text/plain' }));
	const r = new Response(form);
	const buf = new Uint8Array(await r.arrayBuffer());
	const headers: Record<string, string> = { 'content-type': r.headers.get('content-type')! };
	if (o.withLength !== false) headers['content-length'] = String(buf.byteLength);
	return send(who, 'POST', `/nodes/${parent}/upload`, { headers, body: buf });
}

const folder = async (who: string, space: string, parentId: string | null, name: string) =>
	api(who, 'POST', '/folders', { space, parentId, name });

const list = async (who: string, space: string, parent?: string) =>
	api(who, 'GET', `/nodes?space=${space}${parent ? `&parent=${parent}` : ''}`);

const names = (l: FolderListing) => l.items.map((i) => i.name);

/** Storage-Pfade (Modul `files`) eines Knotens, deren Objekt im Fake-S3 noch existiert */
const objectsOf = (nodeId: string) =>
	[...fakeFileRows.values()]
		.filter((r) => r.moduleId === 'files' && r.path.startsWith(`${nodeId}/`))
		.filter((r) => fakeObjects.has(r.objectKey))
		.map((r) => r.path);

async function pngBytes(): Promise<Uint8Array> {
	const buf = await sharp({
		create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 50, b: 50 } }
	})
		.png()
		.toBuffer();
	return new Uint8Array(buf);
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	registerModule(filesModule);
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	adminId = u!.id;
	admin = await ctxOf(adminId);
	await enableModule(admin, 'files');
	admin = await ctxOf(adminId);
	await installFakeStorage(admin);

	const roles = {
		// Stamm bearbeiten
		editor: await createRole(admin, {
			name: 'Dateien Stamm',
			permissions: ['files.file.view', 'files.shared.edit', 'core.api.manage']
		}),
		// Stamm nur lesen
		reader: await createRole(admin, {
			name: 'Dateien Lesen',
			permissions: ['files.file.view', 'files.shared.view', 'core.api.manage']
		}),
		// nur eigene Ablage
		plain: await createRole(admin, {
			name: 'Dateien Basis',
			permissions: ['files.file.view', 'core.api.manage']
		}),
		// gar kein Modulrecht
		none: await createRole(admin, { name: 'Ohne Dateien', permissions: ['core.api.manage'] })
	};
	const users: [string, string][] = [
		['u1', roles.editor],
		['u2', roles.reader],
		['u3', roles.plain],
		['u4', roles.none]
	];
	for (const [n, role] of users) {
		ids[n] = await createUser(admin, {
			name: n.toUpperCase(),
			email: `${n}@example.test`,
			password: PW,
			roleIds: [role]
		});
		const c = await ctxOf(ids[n]!);
		keys[n] = (await createApiKey(c, { name: 'k', scopes: [...c.permissions] })).key;
	}
});

afterAll(async () => {
	uninstallFakeStorage();
	await close?.();
});

describe('Meta', () => {
	it('liefert Kontingent, Grenzen und Rechte-Flags je Person', async () => {
		const r1 = await api('u1', 'GET', '/meta');
		expect(r1.status).toBe(200);
		expect(r1.body.data.quota).toEqual({ usedBytes: 0, limitBytes: 1024 * 1024 * 1024 });
		expect(r1.body.data.trashDays).toBe(30);
		expect(r1.body.data.maxFileBytes).toBeGreaterThan(0);
		expect(r1.body.data.allowedContentTypes).toContain('text/plain');
		expect(r1.body.data.can).toEqual({
			sharedView: true,
			sharedEdit: true,
			linkCreate: false,
			manageAll: false
		});
		const r2 = await api('u2', 'GET', '/meta');
		expect(r2.body.data.can).toMatchObject({ sharedView: true, sharedEdit: false });
		const r3 = await api('u3', 'GET', '/meta');
		expect(r3.body.data.can).toMatchObject({ sharedView: false, sharedEdit: false });
	});

	it('ohne files.file.view → 403 forbidden', async () => {
		const r = await api('u4', 'GET', '/meta');
		expect(r.status).toBe(403);
		expect(r.body.error.code).toBe('forbidden');
		const l = await list('u4', 'personal');
		expect(l.status).toBe(403);
	});
});

describe('Ordner', () => {
	it('legt Ordner in persönlicher Wurzel, Stamm und verschachtelt an', async () => {
		const p = await folder('u1', 'personal', null, 'Projekte');
		expect(p.status).toBe(201);
		expect(p.body.data).toMatchObject({
			kind: 'folder',
			space: 'personal',
			parentId: null,
			name: 'Projekte',
			ownerId: ids.u1,
			access: 'edit',
			childCount: 0
		});
		const sub = await folder('u1', 'personal', p.body.data.id, 'Sommer');
		expect(sub.status).toBe(201);
		expect(sub.body.data.parentId).toBe(p.body.data.id);
		const s = await folder('u1', 'shared', null, 'Stammesordner');
		expect(s.status).toBe(201);
		expect(s.body.data.space).toBe('shared');
		// gleicher Name bei anderer Person erlaubt
		expect((await folder('u3', 'personal', null, 'Projekte')).status).toBe(201);
	});

	it('Namenskonflikt (ohne Groß/Klein) → 409 conflict mit Vorschlag', async () => {
		const r = await folder('u1', 'personal', null, 'projekte');
		expect(r.status).toBe(409);
		expect(r.body.error.code).toBe('conflict');
		expect(r.body.error.message).toBe('Es gibt hier schon „projekte“. Vorschlag: „projekte (2)“');
	});

	it('ungültige Namen → 422', async () => {
		for (const name of ['a/b', 'a\\b', '..', '.', '', '   ', 'x\u0001', 'A‮b', 'x'.repeat(201)]) {
			const r = await folder('u1', 'personal', null, name);
			expect(r.status, JSON.stringify(name)).toBe(422);
			expect(r.body.error.code).toBe('validation_failed');
		}
	});

	it(`mehr als MAX_DEPTH (${MAX_DEPTH}) Ebenen → 422`, async () => {
		let parent: string | null = null;
		for (let i = 1; i <= MAX_DEPTH; i++) {
			const r = await folder('u3', 'personal', parent, `Ebene ${i}`);
			expect(r.status, `Ebene ${i}`).toBe(201);
			parent = r.body.data.id;
		}
		const tooDeep = await folder('u3', 'personal', parent, 'zu tief');
		expect(tooDeep.status).toBe(422);
		expect(tooDeep.body.error.code).toBe('validation_failed');
		expect(JSON.stringify(tooDeep.body.error)).toContain('Ordnerebenen');
	});
});

describe('Upload und Inhalt', () => {
	let fileId: string;

	it('ohne Content-Length → 400 bad_request', async () => {
		const r = await upload('u1', 'root', 'ohne.txt', { withLength: false });
		expect(r.status).toBe(400);
		expect(r.body.error.code).toBe('bad_request');
	});

	it('lädt eine Datei hoch und liefert den Inhalt mit sicheren Headern', async () => {
		const bytes = new TextEncoder().encode('Hallo Welt');
		const r = await upload('u1', 'root', 'Notiz Ä.txt', { bytes });
		expect(r.status).toBe(201);
		expect(r.body.data).toMatchObject({
			kind: 'file',
			name: 'Notiz Ä.txt',
			contentType: 'text/plain',
			sizeBytes: bytes.byteLength,
			hasThumb: false,
			parentId: null
		});
		fileId = r.body.data.id;
		expect(objectsOf(fileId).length).toBe(1);

		const c = await send('u1', 'GET', `/nodes/${fileId}/content`);
		expect(c.status).toBe(200);
		expect(c.body).toBe('Hallo Welt');
		expect(c.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(c.headers.get('content-disposition')).toMatch(/^inline; filename="Notiz A.txt"/);
		expect(c.headers.get('content-disposition')).toContain("filename*=UTF-8''Notiz%20%C3%84.txt");
		expect(c.headers.get('x-content-type-options')).toBe('nosniff');
		expect(c.headers.get('content-security-policy')).toContain('sandbox');

		const d = await send('u1', 'GET', `/nodes/${fileId}/content?download=1`);
		expect(d.headers.get('content-disposition')).toMatch(/^attachment;/);
	});

	it('Namenskonflikt: rename → „Name (2)“, replace → gleiche ID mit neuem Inhalt', async () => {
		const ren = await upload('u1', 'root', 'Notiz Ä.txt', { size: 3 });
		expect(ren.status).toBe(201);
		expect(ren.body.data.name).toBe('Notiz Ä (2).txt');
		expect(ren.body.data.id).not.toBe(fileId);

		const oldObjects = objectsOf(fileId);
		const rep = await upload('u1', 'root', 'notiz ä.txt', { size: 7, conflict: 'replace' });
		expect(rep.status).toBe(201);
		expect(rep.body.data.id).toBe(fileId);
		expect(rep.body.data.sizeBytes).toBe(7);
		// altes Objekt entfernt, neues vorhanden
		const now = objectsOf(fileId);
		expect(now.length).toBe(1);
		expect(now[0]).not.toBe(oldObjects[0]);
	});

	it('Ordner-Upload per relativePath legt Ordner an und verwendet sie wieder', async () => {
		const a = await upload('u1', 'root', 'egal.txt', { relativePath: 'Fotos/2026/a.txt' });
		expect(a.status).toBe(201);
		expect(a.body.data.name).toBe('a.txt');
		const b = await upload('u1', 'root', 'egal.txt', { relativePath: 'fotos/2026/b.txt' });
		expect(b.status).toBe(201);
		expect(b.body.data.parentId).toBe(a.body.data.parentId);
		const root = (await list('u1', 'personal')).body.data as FolderListing;
		expect(names(root).filter((n) => n.toLowerCase() === 'fotos')).toEqual(['Fotos']);
		const inner = (await list('u1', 'personal', a.body.data.parentId)).body.data as FolderListing;
		expect(names(inner)).toEqual(['a.txt', 'b.txt']);
		expect(inner.breadcrumbs.map((b) => b.name)).toEqual(['Meine Dateien', 'Fotos', '2026']);

		const bad = await upload('u1', 'root', 'x.txt', { relativePath: '//' });
		expect(bad.status).toBe(422);
		expect(bad.body.error.code).toBe('validation_failed');
	});

	it('nicht erlaubter Typ → 422, nichts gespeichert', async () => {
		const before = fakeObjects.size;
		const r = await upload('u1', 'root', 'bild.svg', { type: 'image/svg+xml' });
		expect(r.status).toBe(422);
		expect(r.body.error.code).toBe('validation_failed');
		expect(r.body.error.message).toContain('Dateityp nicht erlaubt');
		const exe = await upload('u1', 'root', 'tool.exe', { type: 'application/x-msdownload' });
		expect(exe.status).toBe(422);
		expect(fakeObjects.size).toBe(before);
	});

	it('SVG/HTML werden nie inline ausgeliefert (auch wenn erlaubt)', async () => {
		const meta = (await api('u1', 'GET', '/meta')).body.data;
		await setSetting(admin, 'core.storage.allowedContentTypes', [
			...meta.allowedContentTypes,
			'image/svg+xml',
			'text/html'
		]);
		try {
			const svg = await upload('u1', 'root', 'logo.svg', {
				type: 'image/svg+xml',
				bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
			});
			expect(svg.status).toBe(201);
			const html = await upload('u1', 'root', 'seite.html', {
				type: 'text/html',
				bytes: new TextEncoder().encode('<script>alert(1)</script>')
			});
			expect(html.status).toBe(201);
			for (const id of [svg.body.data.id, html.body.data.id]) {
				const c = await send('u1', 'GET', `/nodes/${id}/content`);
				expect(c.status).toBe(200);
				expect(c.headers.get('content-disposition')).toMatch(/^attachment;/);
				expect(c.headers.get('content-type')).toBe('application/octet-stream');
				expect(c.headers.get('x-content-type-options')).toBe('nosniff');
				expect(c.headers.get('content-security-policy')).toContain('sandbox');
			}
		} finally {
			await setSetting(admin, 'core.storage.allowedContentTypes', []);
		}
	});

	it('Bild bekommt ein Thumbnail (hasThumb, /thumb als WebP)', async () => {
		const r = await upload('u1', 'root', 'foto.png', {
			type: 'image/png',
			bytes: await pngBytes()
		});
		expect(r.status).toBe(201);
		expect(r.body.data.contentType).toBe('image/png');
		expect(r.body.data.hasThumb).toBe(true);
		expect(objectsOf(r.body.data.id).length).toBe(2);
		const t = await send('u1', 'GET', `/nodes/${r.body.data.id}/thumb`);
		expect(t.status).toBe(200);
		expect(t.headers.get('content-type')).toBe('image/webp');
		const c = await send('u1', 'GET', `/nodes/${r.body.data.id}/content`);
		expect(c.headers.get('content-disposition')).toMatch(/^inline;/);
		// Textdatei hat kein Thumbnail
		expect((await send('u1', 'GET', `/nodes/${fileId}/thumb`)).status).toBe(404);
	});

	it('Kontingent überschritten → 413, nichts gespeichert; /meta zeigt Belegung', async () => {
		await setSetting(admin, 'files.quota.mb', 1);
		try {
			const meta = (await api('u3', 'GET', '/meta')).body.data;
			expect(meta.quota.limitBytes).toBe(1024 * 1024);
			const before = fakeObjects.size;
			const r = await upload('u3', 'root', 'gross.txt', { size: 1024 * 1024 + 1 });
			expect(r.status).toBe(413);
			expect(r.body.error.code).toBe('payload_too_large');
			expect(r.body.error.message).toContain('Speicherplatz ist voll');
			expect(fakeObjects.size).toBe(before);
			// Stamm zählt nicht zum persönlichen Kontingent
			const s = await upload('u1', 'root', 'stamm.txt', { space: 'shared', size: 1024 * 1024 + 1 });
			expect(s.status).toBe(201);
		} finally {
			await setSetting(admin, 'files.quota.mb', 0);
		}
		const meta = (await api('u3', 'GET', '/meta')).body.data;
		expect(meta.quota.limitBytes).toBeNull();
		const used = (await api('u1', 'GET', '/meta')).body.data.quota.usedBytes;
		expect(used).toBeGreaterThan(0);
	});
});

describe('Liste, Umbenennen, Verschieben', () => {
	let projekte: FileNode;
	let ziel: string;

	it('Liste: Ordner zuerst, dann Dateien, je nach Name; Breadcrumbs', async () => {
		const root = (await list('u1', 'personal')).body.data as FolderListing;
		const kinds = root.items.map((i) => i.kind);
		const firstFile = kinds.indexOf('file');
		expect(firstFile).toBeGreaterThan(0);
		expect(kinds.slice(firstFile).every((k) => k === 'file')).toBe(true);
		const folders = root.items.filter((i) => i.kind === 'folder').map((i) => i.name);
		expect(folders).toEqual([...folders].sort((a, b) => a.localeCompare(b, 'de')));
		expect(root.breadcrumbs).toEqual([{ id: null, name: 'Meine Dateien' }]);
		expect(root.access).toBe('edit');
		projekte = root.items.find((i) => i.name === 'Projekte')!;
		expect(projekte.childCount).toBe(1);
		const inner = (await list('u1', 'personal', projekte.id)).body.data as FolderListing;
		expect(inner.breadcrumbs).toEqual([
			{ id: null, name: 'Meine Dateien' },
			{ id: projekte.id, name: 'Projekte' }
		]);
		expect(inner.folder?.id).toBe(projekte.id);
	});

	it('Umbenennen: ok, nur Groß/Klein ok, Konflikt 409, ungültig 422', async () => {
		const a = await folder('u1', 'personal', projekte.id, 'Alt');
		const b = await folder('u1', 'personal', projekte.id, 'Belegt');
		const r = await api('u1', 'PATCH', `/nodes/${a.body.data.id}`, { name: 'Neu' });
		expect(r.status).toBe(200);
		expect(r.body.data.name).toBe('Neu');
		const cs = await api('u1', 'PATCH', `/nodes/${a.body.data.id}`, { name: 'NEU' });
		expect(cs.status).toBe(200);
		expect(cs.body.data.name).toBe('NEU');
		const c = await api('u1', 'PATCH', `/nodes/${a.body.data.id}`, { name: 'belegt' });
		expect(c.status).toBe(409);
		expect(c.body.error.code).toBe('conflict');
		expect(c.body.error.message).toContain('Vorschlag: „belegt (2)“');
		const bad = await api('u1', 'PATCH', `/nodes/${b.body.data.id}`, { name: 'x/y' });
		expect(bad.status).toBe(422);
		expect(bad.body.error.code).toBe('validation_failed');
	});

	it('Verschieben: mehrere, in sich selbst 422, Namenskonflikt → automatisch umbenannt', async () => {
		ziel = (await folder('u1', 'personal', null, 'Ziel')).body.data.id;
		await folder('u1', 'personal', ziel, 'Doppelt');
		const d = await folder('u1', 'personal', null, 'Doppelt');
		const f = await upload('u1', 'root', 'mitnehmen.txt');
		const mv = await api('u1', 'POST', '/nodes/move', {
			ids: [d.body.data.id, f.body.data.id],
			targetId: ziel,
			space: 'personal'
		});
		expect(mv.status).toBe(201);
		expect(mv.body.data.affected).toBe(2);
		const inner = (await list('u1', 'personal', ziel)).body.data as FolderListing;
		expect(names(inner)).toEqual(['Doppelt', 'Doppelt (2)', 'mitnehmen.txt']);

		const self = await api('u1', 'POST', '/nodes/move', {
			ids: [ziel],
			targetId: ziel,
			space: 'personal'
		});
		expect(self.status).toBe(422);
		expect(self.body.error.code).toBe('validation_failed');
		const child = inner.items[0]!.id;
		const intoChild = await api('u1', 'POST', '/nodes/move', {
			ids: [ziel],
			targetId: child,
			space: 'personal'
		});
		expect(intoChild.status).toBe(422);
		expect(intoChild.body.error.code).toBe('validation_failed');
	});

	it('personal → Stamm mit files.shared.edit: ganzer Teilbaum wechselt den Bereich', async () => {
		const mv = await api('u1', 'POST', '/nodes/move', {
			ids: [ziel],
			targetId: null,
			space: 'shared'
		});
		expect(mv.status).toBe(201);
		expect(mv.body.data.affected).toBe(1);
		const node = (await api('u1', 'GET', `/nodes/${ziel}`)).body.data as FileNode;
		expect(node.space).toBe('shared');
		const inner = (await list('u1', 'shared', ziel)).body.data as FolderListing;
		expect(inner.items.every((i) => i.space === 'shared')).toBe(true);
		expect(inner.breadcrumbs[0]).toEqual({ id: null, name: 'Stamm' });
		// Stamm-Leser darf nicht hinein verschieben
		const own = await folder('u2', 'personal', null, 'Eigenes');
		const no = await api('u2', 'POST', '/nodes/move', {
			ids: [own.body.data.id],
			targetId: null,
			space: 'shared'
		});
		expect(no.status).toBe(403);
		expect(no.body.error.code).toBe('forbidden');
	});
});

describe('Suche', () => {
	it('findet Treffer, behandelt % und _ wörtlich, ignoriert Gelöschte', async () => {
		const p = 'personal';
		for (const n of ['100% Spaß', '1000 Spaß', 'a_b Liste', 'axb Liste', 'Weg Liste']) {
			expect((await folder('u3', p, null, n)).status).toBe(201);
		}
		const s = await api('u3', 'GET', '/search?q=liste');
		expect(s.status).toBe(200);
		expect(
			s.body.data.items
				.map((i: FileNode) => i.name)
				.sort((a: string, b: string) => a.localeCompare(b, 'de'))
		).toEqual(['a_b Liste', 'axb Liste', 'Weg Liste']);
		expect(s.body.data.items[0].path).toBe('Meine Dateien');
		const pct = await api('u3', 'GET', `/search?q=${encodeURIComponent('0%')}`);
		expect(pct.body.data.items.map((i: FileNode) => i.name)).toEqual(['100% Spaß']);
		const und = await api('u3', 'GET', '/search?q=a_b');
		expect(und.body.data.items.map((i: FileNode) => i.name)).toEqual(['a_b Liste']);

		const weg = s.body.data.items.find((i: FileNode) => i.name === 'Weg Liste');
		expect((await api('u3', 'POST', '/nodes/trash', { ids: [weg.id] })).status).toBe(201);
		const after = await api('u3', 'GET', '/search?q=liste');
		expect(after.body.data.items.map((i: FileNode) => i.name)).not.toContain('Weg Liste');

		// fremde Ablage taucht nicht auf
		const other = await api('u1', 'GET', '/search?q=liste');
		expect(other.body.data.items).toEqual([]);
		const short = await api('u3', 'GET', '/search?q=a');
		expect(short.status).toBe(422);
	});
});

describe('Papierkorb', () => {
	it('in den Papierkorb, Liste mit purgeOn, Wiederherstellen am Ort', async () => {
		const f = await upload('u3', 'root', 'papier.txt');
		const id = f.body.data.id;
		const t = await api('u3', 'POST', '/nodes/trash', { ids: [id] });
		expect(t.status).toBe(201);
		expect(t.body.data.affected).toBe(1);
		expect((await api('u3', 'GET', `/nodes/${id}`)).status).toBe(404);
		const root = (await list('u3', 'personal')).body.data as FolderListing;
		expect(names(root)).not.toContain('papier.txt');

		const tr = await api('u3', 'GET', '/trash');
		expect(tr.status).toBe(200);
		const item = (tr.body.data as TrashItem[]).find((i) => i.id === id)!;
		expect(item).toMatchObject({ kind: 'file', name: 'papier.txt', originalPath: 'Meine Dateien' });
		const expected = new Date(new Date(item.deletedAt).getTime() + 30 * 86_400_000)
			.toISOString()
			.slice(0, 10);
		expect(item.purgeOn).toBe(expected);
		// fremde sehen den Eintrag nicht
		const foreign = (await api('u1', 'GET', '/trash')).body.data as TrashItem[];
		expect(foreign.some((i) => i.id === id)).toBe(false);
		expect((await api('u1', 'POST', '/trash/restore', { ids: [id] })).status).toBe(404);

		const r = await api('u3', 'POST', '/trash/restore', { ids: [id] });
		expect(r.status).toBe(201);
		expect(r.body.data.affected).toBe(1);
		const back = (await api('u3', 'GET', `/nodes/${id}`)).body.data as FileNode;
		expect(back.parentId).toBeNull();
		expect(back.name).toBe('papier.txt');
	});

	it('Wiederherstellen: Elternordner weg → Wurzel, Namenskonflikt → umbenannt', async () => {
		const box = (await folder('u3', 'personal', null, 'Kiste')).body.data.id;
		const f = await upload('u3', box, 'inhalt.txt');
		const id = f.body.data.id;
		await api('u3', 'POST', '/nodes/trash', { ids: [id] });
		await api('u3', 'POST', '/nodes/trash', { ids: [box] });
		// gleicher Name inzwischen an der Wurzel
		expect((await upload('u3', 'root', 'inhalt.txt')).status).toBe(201);
		const r = await api('u3', 'POST', '/trash/restore', { ids: [id] });
		expect(r.status).toBe(201);
		const back = (await api('u3', 'GET', `/nodes/${id}`)).body.data as FileNode;
		expect(back.parentId).toBeNull();
		expect(back.name).toBe('inhalt (2).txt');
		// Kiste bleibt im Papierkorb
		const tr = (await api('u3', 'GET', '/trash')).body.data as TrashItem[];
		expect(tr.some((i) => i.id === box)).toBe(true);
	});

	it('nur Papierkorb-Wurzeln wiederherstellbar/löschbar (sonst 404)', async () => {
		const f = await upload('u3', 'root', 'aktiv.txt');
		const r = await api('u3', 'POST', '/trash/purge', { ids: [f.body.data.id] });
		expect(r.status).toBe(404);
		expect(r.body.error.code).toBe('not_found');
		expect((await api('u3', 'GET', `/nodes/${f.body.data.id}`)).status).toBe(200);
	});

	it('endgültig löschen entfernt Knoten und Storage-Objekte (inkl. Teilbaum)', async () => {
		const box = (await folder('u3', 'personal', null, 'Endgültig')).body.data.id;
		const a = await upload('u3', box, 'a.png', { type: 'image/png', bytes: await pngBytes() });
		const b = await upload('u3', box, 'b.txt');
		expect(objectsOf(a.body.data.id).length).toBe(2);
		expect(objectsOf(b.body.data.id).length).toBe(1);
		await api('u3', 'POST', '/nodes/trash', { ids: [box] });
		const before = (await api('u3', 'GET', '/meta')).body.data.quota.usedBytes;
		const p = await api('u3', 'POST', '/trash/purge', { ids: [box] });
		expect(p.status).toBe(201);
		expect(p.body.data.affected).toBe(1);
		expect(objectsOf(a.body.data.id)).toEqual([]);
		expect(objectsOf(b.body.data.id)).toEqual([]);
		const tr = (await api('u3', 'GET', '/trash')).body.data as TrashItem[];
		expect(tr.some((i) => i.id === box)).toBe(false);
		const after = (await api('u3', 'GET', '/meta')).body.data.quota.usedBytes;
		expect(after).toBeLessThan(before);
		expect((await api('u3', 'POST', '/trash/restore', { ids: [box] })).status).toBe(404);
	});

	it('Job files.purge-trash löscht nur abgelaufene Einträge', async () => {
		const old = await upload('u3', 'root', 'alt.txt');
		const fresh = await upload('u3', 'root', 'frisch.txt');
		await api('u3', 'POST', '/nodes/trash', { ids: [old.body.data.id, fresh.body.data.id] });
		const oldId = old.body.data.id as string;
		await core.database.forModule('files').transaction(async (tx) => {
			await tx.execute(
				sql`UPDATE nodes SET deleted_at = now() - interval '31 days' WHERE id = ${oldId}`
			);
		});
		await runJobNow(admin, 'files.purge-trash');
		const tr = (await api('u3', 'GET', '/trash')).body.data as TrashItem[];
		expect(tr.some((i) => i.id === oldId)).toBe(false);
		expect(tr.some((i) => i.id === fresh.body.data.id)).toBe(true);
		expect(objectsOf(oldId)).toEqual([]);
		expect(objectsOf(fresh.body.data.id).length).toBe(1);
		const rows = await core.database
			.forModule('files')
			.transaction(
				async (tx) => (await tx.execute(sql`SELECT id FROM nodes WHERE id = ${oldId}`)).rows
			);
		expect(rows).toEqual([]);
	});
});

describe('Zugriff', () => {
	let privateFolder: string;
	let sharedFolder: string;

	beforeAll(async () => {
		privateFolder = (await folder('u1', 'personal', null, 'Privat')).body.data.id;
		sharedFolder = (await folder('u1', 'shared', null, 'Stamm Ordner')).body.data.id;
		await upload('u1', sharedFolder, 'liesmich.txt', { space: 'shared' });
	});

	it('fremde persönliche Ablage → 404 (auch Liste, Inhalt, Umbenennen, Upload)', async () => {
		for (const who of ['u2', 'u3']) {
			expect((await api(who, 'GET', `/nodes/${privateFolder}`)).status).toBe(404);
			const l = await list(who, 'personal', privateFolder);
			expect(l.status).toBe(404);
			expect(l.body.error.code).toBe('not_found');
			const r = await api(who, 'PATCH', `/nodes/${privateFolder}`, { name: 'x' });
			expect(r.status).toBe(404);
			const up = await upload(who, privateFolder, 'x.txt');
			expect(up.status).toBe(404);
		}
		// ?owner= ohne manage-all → 404
		const o = await api('u3', 'GET', `/nodes?space=personal&owner=${ids.u1}`);
		expect(o.status).toBe(404);
	});

	it('Stamm ohne files.shared.view → 404 (Liste/Knoten), 403 beim Anlegen', async () => {
		const l = await list('u3', 'shared');
		expect(l.status).toBe(404);
		expect(l.body.error.code).toBe('not_found');
		expect((await api('u3', 'GET', `/nodes/${sharedFolder}`)).status).toBe(404);
		const c = await folder('u3', 'shared', null, 'Neu');
		expect(c.status).toBe(403);
		expect(c.body.error.code).toBe('forbidden');
	});

	it('files.shared.view: nur lesen (Liste/Inhalt ok, Upload/Anlegen/Umbenennen/Löschen 403)', async () => {
		const l = await list('u2', 'shared', sharedFolder);
		expect(l.status).toBe(200);
		expect(l.body.data.access).toBe('read');
		const file = (l.body.data as FolderListing).items.find((i) => i.name === 'liesmich.txt')!;
		expect(file.access).toBe('read');
		expect((await send('u2', 'GET', `/nodes/${file.id}/content`)).status).toBe(200);

		const up = await upload('u2', sharedFolder, 'neu.txt', { space: 'shared' });
		expect(up.status).toBe(403);
		expect(up.body.error.code).toBe('forbidden');
		const upRoot = await upload('u2', 'root', 'neu.txt', { space: 'shared' });
		expect(upRoot.status).toBe(403);
		expect((await folder('u2', 'shared', sharedFolder, 'Neu')).status).toBe(403);
		expect((await api('u2', 'PATCH', `/nodes/${file.id}`, { name: 'x.txt' })).status).toBe(403);
		const t = await api('u2', 'POST', '/nodes/trash', { ids: [file.id] });
		expect(t.status).toBe(403);
		expect(t.body.error.code).toBe('forbidden');
	});
});

describe('Audit', () => {
	it('Einträge vorhanden, ohne Dateinamen und E-Mail-Adressen', async () => {
		const rows = await getDb()
			.select({ action: schema.auditLog.action, metadata: schema.auditLog.metadata })
			.from(schema.auditLog)
			.where(like(schema.auditLog.action, 'files.%'));
		const actions = new Set(rows.map((r) => r.action));
		for (const a of [
			'files.node.created',
			'files.node.uploaded',
			'files.node.renamed',
			'files.node.moved',
			'files.node.trashed',
			'files.node.restored',
			'files.node.purged'
		]) {
			expect(actions, a).toContain(a);
		}
		const meta = JSON.stringify(rows.map((r) => r.metadata));
		for (const secret of [
			'Notiz',
			'papier.txt',
			'inhalt',
			'Projekte',
			'Privat',
			'liesmich',
			'Spaß',
			'@example.test'
		]) {
			expect(meta, secret).not.toContain(secret);
		}
		// Job-Lauf protokolliert
		expect(rows.some((r) => JSON.stringify(r.metadata).includes('"expired":true'))).toBe(true);
	});
});

describe('Modul deaktiviert', () => {
	it('→ 404 module_disabled', async () => {
		await disableModule(admin, 'files');
		const r = await api('u1', 'GET', '/meta');
		expect(r.status).toBe(404);
		expect(r.body.error.code).toBe('module_disabled');
		const up = await upload('u1', 'root', 'spaet.txt');
		expect(up.status).toBe(404);
		expect(up.body.error.code).toBe('module_disabled');
	});
});
