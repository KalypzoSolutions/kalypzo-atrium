import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { registerModule } from '$lib/server/core/modules/registry';
import { disableModule, enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { getDb, schema } from '$lib/server/core/database/client';
import { listAudit } from '$lib/server/core/audit/service';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { setPdfRendererForTests } from '$lib/server/core/pdf';
import { runJobNow } from '$lib/server/core/jobs';
import { setTodayForTests } from '$lib/sdk/dates';
import materialModule from '$lib/modules/material/module';
import { LABEL_LOGO_DATA } from '$lib/sdk/labels/logos';
import type {
	Article,
	Catalog,
	FindHit,
	CodeTarget,
	LabelTemplate,
	LineAvailability,
	Location,
	MaterialSet,
	Reservation,
	SetTemplate,
	StockEntry,
	UnitDetail,
	UnitSummary
} from '$lib/modules/material/schemas';
import type { RequestContext } from '$lib/sdk/types';

// Modul „Material“: Bestand (Orte, Artikel, Stücke, Kisten, Mengen), Sets, Reservierungen mit
// Verfügbarkeit und Bahnen-Anfrage, Ausgabe/Rückgabe, Codes, Etiketten, Rechte, Modul aus.

const PW = 'material-password-123';
let close: () => Promise<void>;
let admin: RequestContext;
const keys: Record<string, string> = {};
let lastPdfHtml = '';

function api(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
	resetAllForTests();
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
const M = (path: string, who: string, init: Parameters<typeof api>[1] = {}) =>
	api(`/modules/material${path}`, { token: keys[who], ...init });
const post = (path: string, who: string, json: unknown = {}) =>
	M(path, who, { method: 'POST', json });
const patch = (path: string, who: string, json: unknown) => M(path, who, { method: 'PATCH', json });

async function data<T>(res: Response, status = 200): Promise<T> {
	const body = await res.json();
	expect(res.status, JSON.stringify(body)).toBe(status);
	return body.data as T;
}
async function fail(res: Response, status: number) {
	const body = await res.json();
	expect(res.status, JSON.stringify(body)).toBe(status);
	return body.error as { code: string; message: string; details?: unknown };
}
const ctxOf = async (userId: string) => (await contextForUser(userId))!.ctx;

async function mkUser(name: string, permissions: string[]) {
	const role = await createRole(admin, { name: `r-${name}`, permissions });
	const id = await createUser(admin, {
		name,
		email: `${name}@example.test`,
		password: PW,
		roleIds: [role]
	});
	const ctx = await ctxOf(id);
	keys[name] = (await createApiKey(ctx, { name: 'k', scopes: [...ctx.permissions] })).key;
}

let raum: Location;
let regal: Location;
let bahn: Article;
let kreuz: Article;
let tassen: Article;
let kiste: Article;
let bahnen: UnitSummary[] = [];
let kochkiste: UnitSummary;
let kohte: SetTemplate;
let kohte1: MaterialSet;
let kohte2: MaterialSet;

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	registerModule(materialModule);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = await ctxOf(u!.id);
	await enableModule(admin, 'material');
	admin = await ctxOf(u!.id);
	keys.admin = (await createApiKey(admin, { name: 'a', scopes: [...admin.permissions] })).key;
	await mkUser('leitung', [
		'core.api.manage',
		'material.inventory.view',
		'material.reservation.create'
	]);
	await mkUser('andere', [
		'core.api.manage',
		'material.inventory.view',
		'material.reservation.create'
	]);
	await mkUser('nurlesen', ['core.api.manage', 'material.inventory.view']);
	setPdfRendererForTests(async (html) => {
		lastPdfHtml = html;
		return new TextEncoder().encode('%PDF-1.7 test');
	});
	setTodayForTests('2026-06-01');
});

afterAll(async () => {
	setPdfRendererForTests(undefined);
	setTodayForTests(null);
	await close();
});

describe('Bestand', () => {
	it('legt Orte als Baum an und verhindert Zyklen', async () => {
		raum = await data<Location>(await post('/locations', 'admin', { name: 'Materialraum' }), 201);
		regal = await data<Location>(
			await post('/locations', 'admin', { name: 'Regal A', parentId: raum.id }),
			201
		);
		expect(regal.path).toBe('Materialraum › Regal A');
		expect(regal.code).toMatch(/^L-\d{6}$/);
		const err = await fail(
			await patch(`/locations/${raum.id}`, 'admin', { parentId: regal.id }),
			422
		);
		expect(err.code).toBe('validation_failed');
		expect(
			(await fail(await M(`/locations/${raum.id}`, 'admin', { method: 'DELETE' }), 409)).message
		).toMatch(/Unterorte/);
	});

	it('Artikel und mehrere nummerierte Stücke mit fortlaufenden Codes', async () => {
		bahn = await data<Article>(
			await post('/articles', 'admin', { name: 'Kohtenbahn', kind: 'unit' }),
			201
		);
		kreuz = await data<Article>(
			await post('/articles', 'admin', { name: 'Kohtenkreuz', kind: 'unit' }),
			201
		);
		tassen = await data<Article>(
			await post('/articles', 'admin', { name: 'Tasse', kind: 'bulk', minQuantity: 20 }),
			201
		);
		kiste = await data<Article>(
			await post('/articles', 'admin', { name: 'Kochkiste', kind: 'unit' }),
			201
		);
		bahnen = await data<UnitSummary[]>(
			await post('/units', 'admin', { articleId: bahn.id, count: 10, locationId: regal.id }),
			201
		);
		expect(bahnen).toHaveLength(10);
		expect(bahnen[0]!.name).toBe('Kohtenbahn 01');
		expect(bahnen[9]!.name).toBe('Kohtenbahn 10');
		expect(new Set(bahnen.map((b) => b.code)).size).toBe(10);
		expect(bahnen[0]!.locationPath).toBe('Materialraum › Regal A');
		// Mengenartikel haben keine Stücke
		await fail(await post('/units', 'admin', { articleId: tassen.id }), 422);
		// nur lesen → 403
		await fail(await post('/units', 'nurlesen', { articleId: bahn.id }), 403);
	});

	it('eigener Code: frei → übernommen, doppelt → 422', async () => {
		const [k] = await data<UnitSummary[]>(
			await post('/units', 'admin', {
				articleId: kiste.id,
				label: 'Kochkiste 1',
				code: 'kk-1',
				isContainer: true,
				locationId: raum.id
			}),
			201
		);
		kochkiste = k!;
		expect(kochkiste.code).toBe('KK-1');
		await fail(await post('/units', 'admin', { articleId: kiste.id, code: 'KK-1' }), 422);
		const target = await data<CodeTarget>(
			await M(
				`/codes/${encodeURIComponent('https://x.test/modules/material/scan/KK-1')}`,
				'nurlesen'
			)
		);
		expect(target).toMatchObject({ type: 'unit', id: kochkiste.id });
		await fail(await M('/codes/GIBTSNICHT', 'nurlesen'), 404);
	});

	it('Kisten: Inhalt, Ort über die Kiste, keine Kiste in sich selbst', async () => {
		const [kreuz1] = await data<UnitSummary[]>(
			await post('/units', 'admin', {
				articleId: kreuz.id,
				label: 'Kreuz 1',
				containerId: kochkiste.id
			}),
			201
		);
		expect(kreuz1!.locationPath).toBe('Materialraum › Kochkiste 1');
		await fail(
			await post(`/units/${kochkiste.id}/move`, 'admin', { containerId: kochkiste.id }),
			422
		);
		const stock = await data<StockEntry[]>(
			await post('/stock/set', 'admin', {
				articleId: tassen.id,
				holder: { containerId: kochkiste.id },
				quantity: 12
			}),
			201
		);
		expect(stock[0]).toMatchObject({ quantity: 12, holderName: 'Materialraum › Kochkiste 1' });
		await data(
			await M(`/units/${kochkiste.id}/targets`, 'admin', {
				method: 'PUT',
				json: { targets: [{ articleId: tassen.id, quantity: 15 }] }
			})
		);
		const detail = await data<UnitDetail>(await M(`/units/${kochkiste.id}`, 'nurlesen'));
		expect(detail.contents?.units.map((u) => u.name)).toEqual(['Kreuz 1']);
		expect(detail.contents?.targets[0]).toMatchObject({ target: 15, actual: 12 });
		await fail(
			await post('/stock/move', 'admin', {
				articleId: tassen.id,
				from: { containerId: kochkiste.id },
				to: { locationId: regal.id },
				quantity: 20
			}),
			409
		);
		const moved = await data<StockEntry[]>(
			await post('/stock/move', 'admin', {
				articleId: tassen.id,
				from: { containerId: kochkiste.id },
				to: { locationId: regal.id },
				quantity: 2
			}),
			201
		);
		expect(moved.map((s) => s.quantity).sort()).toEqual([10, 2]);
		const deep = await data<{ items: UnitSummary[] }>(
			await M(`/units?locationId=${raum.id}&deep=1`, 'nurlesen')
		);
		expect(deep.items).toHaveLength(12);
	});
});

describe('Sets', () => {
	it('Vorlage und Sets mit Vollständigkeit', async () => {
		kohte = await data<SetTemplate>(
			await post('/set-templates', 'admin', {
				name: 'Kohte',
				parts: [{ articleId: bahn.id, quantity: 4 }]
			}),
			201
		);
		kohte1 = await data<MaterialSet>(
			await post('/sets', 'admin', {
				templateId: kohte.id,
				name: 'Kohte 1',
				unitIds: bahnen.slice(0, 4).map((b) => b.id)
			}),
			201
		);
		expect(kohte1.completeness.complete).toBe(true);
		kohte2 = await data<MaterialSet>(
			await post('/sets', 'admin', {
				templateId: kohte.id,
				name: 'Kohte 2',
				unitIds: bahnen.slice(4, 7).map((b) => b.id)
			}),
			201
		);
		expect(kohte2.completeness.missing).toEqual([
			{ articleId: bahn.id, articleName: 'Kohtenbahn', count: 1 }
		]);
		// Umbau: Bahn 08 in Kohte 2, Bahn 01 wandert von Kohte 1 nach Kohte 2
		kohte2 = await data<MaterialSet>(
			await patch(`/sets/${kohte2.id}`, 'admin', {
				unitIds: [...bahnen.slice(4, 8).map((b) => b.id), bahnen[0]!.id]
			})
		);
		expect(kohte2.units).toHaveLength(5);
		expect(kohte2.completeness.extra[0]).toMatchObject({ count: 1 });
		kohte1 = await data<MaterialSet>(await M(`/sets/${kohte1.id}`, 'admin'));
		expect(kohte1.completeness.complete).toBe(false);
		// zurückbauen
		kohte2 = await data<MaterialSet>(
			await patch(`/sets/${kohte2.id}`, 'admin', { unitIds: bahnen.slice(4, 8).map((b) => b.id) })
		);
		kohte1 = await data<MaterialSet>(
			await patch(`/sets/${kohte1.id}`, 'admin', { unitIds: bahnen.slice(0, 4).map((b) => b.id) })
		);
		expect(kohte1.completeness.complete && kohte2.completeness.complete).toBe(true);
		await fail(await M(`/set-templates/${kohte.id}`, 'admin', { method: 'DELETE' }), 409);
	});
});

describe('Reservierungen', () => {
	let sommer: Reservation;

	it('Bahnen-Anfrage gegen den Bestand, Set-Aufteilung als Hinweis', async () => {
		// 10 Bahnen: 2 Sets à 4 + 2 lose
		const check = await data<LineAvailability[]>(
			await post('/availability', 'leitung', {
				startsOn: '2026-07-01',
				endsOn: '2026-07-10',
				lines: [{ kind: 'article', articleId: bahn.id, quantity: 7 }]
			}),
			201
		);
		expect(check[0]).toMatchObject({ ok: true, available: 10 });
		expect(check[0]!.notes.join(' ')).toMatch(/aufgeteilt/);
		sommer = await data<Reservation>(
			await post('/reservations', 'leitung', {
				title: 'Sommerlager',
				startsOn: '2026-07-01',
				endsOn: '2026-07-10',
				lines: [
					{ kind: 'article', articleId: bahn.id, quantity: 6 },
					{ kind: 'unit', unitId: kochkiste.id },
					{ kind: 'article', articleId: tassen.id, quantity: 10 }
				]
			}),
			201
		);
		expect(sommer.lines).toHaveLength(3);
		expect(sommer.canEdit).toBe(true);
	});

	it('Überschneidung: Kiste schon verplant, Bahnen nur noch 4, Tassen nur 2 → 409', async () => {
		const err = await fail(
			await post('/reservations', 'andere', {
				title: 'Wochenende',
				startsOn: '2026-07-05',
				endsOn: '2026-07-06',
				lines: [
					{ kind: 'unit', unitId: kochkiste.id },
					{ kind: 'article', articleId: bahn.id, quantity: 5 },
					{ kind: 'article', articleId: tassen.id, quantity: 3 }
				]
			}),
			409
		);
		expect(err.message).toMatch(/Kochkiste 1 ist im Zeitraum schon verplant/);
		expect(err.message).toMatch(/Nur 4 Kohtenbahn/);
		expect(err.message).toMatch(/Nur 2 von 12 Tasse/);
		// außerhalb des Zeitraums geht alles
		await data(
			await post('/reservations', 'andere', {
				title: 'Herbst',
				startsOn: '2026-10-01',
				endsOn: '2026-10-02',
				lines: [{ kind: 'set', setId: kohte1.id }]
			}),
			201
		);
		// ein Set im Sommer kollidiert nicht, solange Bahnen frei sind (4 frei, Set hat 4)
		const ok = await data<LineAvailability[]>(
			await post('/availability', 'andere', {
				startsOn: '2026-07-05',
				endsOn: '2026-07-06',
				lines: [{ kind: 'set', setId: kohte2.id }]
			}),
			201
		);
		expect(ok[0]!.ok).toBe(true);
	});

	it('fremde Reservierung nicht änderbar, eigene schon', async () => {
		await fail(await patch(`/reservations/${sommer.id}`, 'andere', { title: 'X' }), 403);
		const r = await data<Reservation>(
			await patch(`/reservations/${sommer.id}`, 'leitung', { notes: 'Bitte packen' })
		);
		expect(r.notes).toBe('Bitte packen');
	});

	it('Zuteilung, Ausgabe mit Kiste und Rückgabe mit Schaden', async () => {
		const plan = await data<{ units: UnitSummary[]; splitSets: string[]; missing: number }[]>(
			await M(`/reservations/${sommer.id}/allocation`, 'leitung')
		);
		// 6 Bahnen: ein ganzes Set (4) + 2 lose → kein Set aufgeteilt
		expect(plan[0]!.units).toHaveLength(6);
		expect(plan[0]!.splitSets).toEqual([]);
		expect(plan[0]!.missing).toBe(0);
		const tassenLine = sommer.lines.find((l) => l.articleId === tassen.id)!;
		let r = await data<Reservation>(
			await post(`/reservations/${sommer.id}/issue`, 'leitung', {
				unitIds: [...plan[0]!.units.map((u) => u.id), kochkiste.id],
				bulk: [{ lineId: tassenLine.id, quantity: 10 }]
			}),
			201
		);
		expect(r.status).toBe('issued');
		// Kiste + Kreuz darin + 6 Bahnen
		expect(r.assigned).toHaveLength(8);
		// fremdes Stück ohne allowExtra → 422
		const extra = bahnen.find((b) => !plan[0]!.units.some((u) => u.id === b.id))!;
		await fail(
			await post(`/reservations/${sommer.id}/issue`, 'leitung', { unitIds: [extra.id] }),
			422
		);
		const detail = await data<UnitDetail>(await M(`/units/${kochkiste.id}`, 'nurlesen'));
		expect(detail.issued?.title).toBe('Sommerlager');

		// Teil-Rückgabe: Kiste (mit Inhalt) + eine Bahn beschädigt
		const damaged = plan[0]!.units[0]!;
		r = await data<Reservation>(
			await post(`/reservations/${sommer.id}/return`, 'leitung', {
				units: [
					{ unitId: kochkiste.id, condition: 'ok' },
					{ unitId: damaged.id, condition: 'damaged', note: 'Riss' }
				],
				bulk: [{ lineId: tassenLine.id, quantity: 8 }]
			}),
			201
		);
		expect(r.status).toBe('issued');
		expect(r.assigned.filter((a) => a.returnedAt)).toHaveLength(3);
		// Rest: verloren abschließen → Tassenbestand sinkt um 2
		r = await data<Reservation>(
			await post(`/reservations/${sommer.id}/return`, 'leitung', { closeMissingAsLost: true }),
			201
		);
		expect(r.status).toBe('returned');
		const stock = await data<StockEntry[]>(await M(`/stock?articleId=${tassen.id}`, 'nurlesen'));
		expect(stock.reduce((s, x) => s + x.quantity, 0)).toBe(10);
		const d = await data<UnitDetail>(await M(`/units/${damaged.id}`, 'nurlesen'));
		expect(d.condition).toBe('damaged');
		expect(d.history.map((h) => h.kind)).toContain('returned');
		const lost = await data<UnitDetail>(await M(`/units/${plan[0]!.units[1]!.id}`, 'nurlesen'));
		expect(lost.condition).toBe('lost');
		const { rows } = await listAudit({ action: 'material.reservation', limit: 50 });
		const actions = new Set(rows.map((x) => x.action));
		for (const a of ['created', 'issued', 'returned'])
			expect(actions).toContain(`material.reservation.${a}`);
		expect(JSON.stringify(rows.map((x) => x.metadata))).not.toMatch(/Riss/);
	});

	it('überfällige Rückgabe wird einmal gemeldet', async () => {
		const r = await data<Reservation>(
			await post('/reservations', 'leitung', {
				title: 'Hajk',
				startsOn: '2026-05-20',
				endsOn: '2026-05-25',
				lines: [{ kind: 'unit', unitId: kohte2.units[0]!.id }]
			}),
			201
		);
		await data(
			await post(`/reservations/${r.id}/issue`, 'leitung', { unitIds: [kohte2.units[0]!.id] }),
			201
		);
		const first = await runJobNow(admin, 'material.overdue');
		expect(JSON.stringify(first)).toMatch(/1 überfällige/);
		const second = await runJobNow(admin, 'material.overdue');
		expect(JSON.stringify(second)).toMatch(/Keine/);
		// Stornieren geht nach der Ausgabe nicht mehr
		await fail(await post(`/reservations/${r.id}/cancel`, 'leitung'), 409);
	});
});

describe('Etiketten', () => {
	it('Layout anlegen und Etiketten drucken', async () => {
		const tpl = await data<LabelTemplate>(
			await post('/label-templates', 'admin', {
				name: 'Standard',
				target: 'unit',
				formatKey: 'zweckform-3474',
				layout: {
					widthMm: 70,
					heightMm: 37,
					elements: [
						{
							id: 'n',
							type: 'text',
							x: 2,
							y: 2,
							w: 40,
							h: 8,
							text: '{name}',
							fontSizePt: 10,
							bold: true,
							align: 'left',
							valign: 'top',
							maxLines: 1
						},
						{
							id: 'q',
							type: 'barcode',
							x: 45,
							y: 2,
							w: 22,
							h: 22,
							symbology: 'qrcode',
							value: '{url}'
						}
					]
				}
			}),
			201
		);
		const res = await post('/labels.pdf', 'admin', {
			templateId: tpl.id,
			target: 'unit',
			ids: [kochkiste.id, bahnen[1]!.id],
			copies: 2,
			startIndex: 3
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect(lastPdfHtml.match(/class="label"/g)).toHaveLength(4);
		expect(lastPdfHtml).toContain('Kochkiste 1');
		// nur lesen darf nicht drucken
		await fail(
			await post('/labels.pdf', 'nurlesen', {
				templateId: tpl.id,
				target: 'unit',
				ids: [kochkiste.id]
			}),
			403
		);
		// Leer-Etiketten mit vorab vergebenen Codes
		const { codes } = await data<{ codes: string[] }>(
			await post('/codes/reserve', 'admin', { count: 3 }),
			201
		);
		expect(codes).toHaveLength(3);
		expect(await data<CodeTarget>(await M(`/codes/${codes[0]}`, 'nurlesen'))).toEqual({
			type: 'reserved',
			code: codes[0]
		});
		const [claimed] = await data<UnitSummary[]>(
			await post('/units', 'admin', { articleId: bahn.id, code: codes[0] }),
			201
		);
		expect(claimed!.code).toBe(codes[0]);
	});
});

describe('Ausleihen, Wiederfinden, Listen', () => {
	it('Katalog: freie Anzahl im Zeitraum und Zelttypen', async () => {
		const cat = await data<Catalog>(await M('/catalog?from=2026-07-01&to=2026-07-10', 'leitung'));
		const t = cat.articles.find((a) => a.id === tassen.id)!;
		expect(t).toMatchObject({ kind: 'bulk', total: 10, free: 10 });
		expect(t.code).toMatch(/^A-\d{6}$/);
		const b = cat.articles.find((a) => a.id === bahn.id)!;
		expect(b.free).toBeLessThanOrEqual(b.total);
		const tpl = cat.templates.find((x) => x.id === kohte.id)!;
		expect(tpl.free).toBe(Math.floor(b.free / 4));
		const search = await data<Catalog>(
			await M('/catalog?from=2026-07-01&to=2026-07-10&search=kohte', 'leitung')
		);
		expect(search.templates.map((x) => x.name)).toEqual(['Kohte']);
	});

	it('„Wo ist …?“ findet Kisten, Mengen und Orte mit Pfad', async () => {
		const hits = await data<FindHit[]>(await M('/find?q=Kochkiste', 'nurlesen'));
		expect(hits.find((h) => h.id === kochkiste.id)).toMatchObject({
			type: 'container',
			place: 'Materialraum'
		});
		const byCode = await data<FindHit[]>(await M(`/find?q=${tassen.code}`, 'nurlesen'));
		expect(byCode[0]).toMatchObject({ type: 'article', quantity: 10 });
		expect(byCode[0]!.place).toContain('Regal A');
		expect(await data<CodeTarget>(await M(`/codes/${tassen.code}`, 'nurlesen'))).toMatchObject({
			type: 'article',
			id: tassen.id
		});
	});

	it('Ausgabeliste als PDF: nach Lagerort, Kisteninhalt eingerückt', async () => {
		const r = await data<Reservation>(
			await post('/reservations', 'leitung', {
				title: 'Packliste',
				startsOn: '2026-08-01',
				endsOn: '2026-08-02',
				lines: [
					{ kind: 'unit', unitId: kochkiste.id },
					{ kind: 'article', articleId: tassen.id, quantity: 4 }
				]
			}),
			201
		);
		const res = await M(`/reservations/${r.id}/handout.pdf`, 'nurlesen');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect(lastPdfHtml).toContain('Ausgabeliste Packliste');
		expect(lastPdfHtml).toContain('Kreuz 1');
		expect(lastPdfHtml).toContain('in der Kiste');
		expect(lastPdfHtml).toContain('4 Stück');
		// nur lesen darf nicht reservieren
		await fail(
			await post('/reservations', 'nurlesen', {
				title: 'X',
				startsOn: '2026-08-01',
				endsOn: '2026-08-01',
				lines: []
			}),
			403
		);
	});

	it('Bestandsliste als PDF mit Ortsfilter und Mengen', async () => {
		const res = await post('/inventory.pdf', 'nurlesen', {
			locationId: raum.id,
			columns: ['code', 'name', 'place', 'check']
		});
		expect(res.status).toBe(200);
		expect(lastPdfHtml).toContain('Bestandsliste Material');
		expect(lastPdfHtml).toContain('Kochkiste 1');
		expect(lastPdfHtml).toContain('Geprüft');
		expect(lastPdfHtml).toContain('Mengen');
		await fail(await post('/inventory.pdf', 'nurlesen', { columns: ['gibtsnicht'] }), 422);
	});

	it('Etiketten für Mengenartikel mit Schwarz-Weiß-Wappen auf L7159', async () => {
		const tpl = await data<LabelTemplate>(
			await post('/label-templates', 'admin', {
				name: 'Regalfach',
				target: 'article',
				formatKey: 'avery-l7159',
				layout: {
					widthMm: 63.5,
					heightMm: 33.9,
					elements: [
						{ id: 'l', type: 'image', x: 2, y: 2, w: 8, h: 8, logo: 'wappen', monochrome: true },
						{
							id: 'n',
							type: 'text',
							x: 12,
							y: 2,
							w: 30,
							h: 6,
							text: '{name} ({total} {unit})',
							fontSizePt: 10,
							bold: true,
							align: 'left',
							valign: 'top',
							maxLines: 1
						},
						{
							id: 'v',
							type: 'line',
							x: 44,
							y: 2,
							w: 1,
							h: 28,
							stroke: 0.3,
							orientation: 'vertical'
						},
						{
							id: 'q',
							type: 'barcode',
							x: 46,
							y: 2,
							w: 16,
							h: 16,
							symbology: 'qrcode',
							value: '{url}'
						}
					]
				}
			}),
			201
		);
		const res = await post('/labels.pdf', 'admin', {
			templateId: tpl.id,
			target: 'article',
			ids: [tassen.id]
		});
		expect(res.status).toBe(200);
		expect(lastPdfHtml).toContain('Tasse (10 Stück)');
		expect(lastPdfHtml).toContain(LABEL_LOGO_DATA['wappen-sw']!);
		expect(lastPdfHtml).not.toContain(LABEL_LOGO_DATA.wappen!);
		expect(lastPdfHtml).toContain('x1="0.15" y1="0" x2="0.15" y2="28"');
	});
});

describe('Modul deaktiviert', () => {
	it('liefert 404', async () => {
		await disableModule(admin, 'material');
		await fail(await M('/articles', 'admin'), 404);
		await enableModule(admin, 'material');
	});
});
