/**
 * #64: Upgrade-Tests für die datenverändernden `actions`-Migrationen mit Bestandsdaten.
 * - 0011_club_expenses: bestehende Stamm-Ausgaben gelten als bezahlt (`club_paid_at = created_at`, `manual`)
 * - 0016_interim_snapshots: alte Zwischenabrechnungen (gesperrte Buchungen über `interim_id`) werden zu
 *   kumulativen Abbildern in `accounting_interim_entries`, `snapshot` bleibt NULL → Anzeige, Kasse und PDF
 *   laufen über `legacySnapshot` (accounting-core.ts). Geprüft: Beträge, PDF (Test-Renderer), Rücknahme,
 *   und dass `legacySnapshot` dieselben Beträge liefert wie ein gespeichertes Abbild.
 *
 * Feste UUIDs (die API prüft das Format): Aktion `0a…01`, Empfänger `0b…0N`, Zwischenabrechnung Nr. N `0c…0N`,
 * Buchungen `e0…01` Stamm-Ausgabe (Lebensmittel), `…02` Spende, `…03` Auslage (Bastelmaterial), `…04` Bahnfahrt.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { migrateModuleRest, migrateModuleTo, moduleSql } from '../helpers/migrations';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { registerModule } from '$lib/server/core/modules/registry';
import { enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { getDb, schema } from '$lib/server/core/database/client';
import { setPdfRendererForTests } from '$lib/server/core/pdf';
import actionsModule from '$lib/modules/actions/module';
import membersModule from '$lib/modules/members/module';
import { actionsService } from '$lib/modules/actions/service';
import type {
	AccountingEntry,
	AccountingInterim,
	EntryFormInput
} from '$lib/modules/actions/schemas';
import type { RequestContext } from '$lib/sdk/types';

let admin: RequestContext;
let adminId: string;
let key: string;
let pdfHtml = '';

async function api(path: string, init: RequestInit & { json?: unknown } = {}) {
	const { json, ...rest } = init;
	const headers = new Headers(rest.headers);
	headers.set('authorization', `Bearer ${key}`);
	if (json !== undefined) {
		rest.body = JSON.stringify(json);
		headers.set('content-type', 'application/json');
	}
	const url = new URL(`http://localhost:5173/api/v1/modules/actions${path}`);
	return handleApiRequest({
		request: new Request(url, { ...rest, headers }),
		url,
		ip: '127.0.0.1'
	});
}

async function data<T>(res: Response, status = 200): Promise<T> {
	const body = await res.json();
	expect(res.status, JSON.stringify(body)).toBe(status);
	return body.data as T;
}

const interims = async (actionId: string) =>
	data<AccountingInterim[]>(await api(`/actions/${actionId}/accounting/interims`));
const totals = (list: AccountingInterim[]) =>
	list.map((i) => ({
		number: i.number,
		entryCount: i.entryCount,
		incomeCents: i.incomeCents,
		expenseCents: i.expenseCents,
		reimbursementCents: i.reimbursementCents,
		openReimbursementCents: i.openReimbursementCents
	}));
/** Alle Euro-Beträge eines Berichts (unabhängig von Zeitstempeln) */
const amountsIn = (html: string) => html.replace(/\s+/g, ' ').match(/-?[\d.]+,\d\d €/g) ?? [];
async function reportHtml(actionId: string, interimId: string): Promise<string> {
	pdfHtml = '';
	const res = await api(`/actions/${actionId}/accounting/interims/${interimId}/report.pdf`);
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toBe('application/pdf');
	return pdfHtml;
}

beforeAll(async () => {
	await useTestDatabase();
	registerCoreApi();
	registerModule(membersModule);
	registerModule(actionsModule);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	adminId = u!.id;
	admin = (await contextForUser(adminId))!.ctx;
	await enableModule(admin, 'members');
	setPdfRendererForTests(async (html) => {
		pdfHtml = html;
		return new TextEncoder().encode('%PDF-fake');
	});
});

afterAll(() => {
	setPdfRendererForTests(undefined);
});

describe('Bestandsinstallation: actions 0011 und 0016', () => {
	const A = '0a000000-0000-4000-8000-000000000001';

	it('0011 markiert nur bestehende Stamm-Ausgaben als bezahlt', async () => {
		await migrateModuleTo('actions', '0010_member_registration');
		await moduleSql(
			'actions',
			sql`INSERT INTO actions (id, name, starts_on, ends_on, owner_id)
				VALUES (${A}, 'Pfingstlager 2025', '2025-06-06', '2025-06-09', ${adminId})`
		);
		await moduleSql(
			'actions',
			sql`INSERT INTO accounting_payees (id, action_id, name) VALUES ('0b000000-0000-4000-8000-000000000001', ${A}, 'Max Muster')`
		);
		await moduleSql(
			'actions',
			sql`INSERT INTO accounting_entries (id, action_id, type, category, description, amount_cents,
					entry_date, paid_by, payee_id, created_at) VALUES
				('e0000000-0000-4000-8000-000000000001', ${A}, 'expense', 'food', 'Lebensmittel', 5000, '2025-06-06', 'club', NULL,
					'2025-06-06T10:00:00Z'),
				('e0000000-0000-4000-8000-000000000003', ${A}, 'expense', 'materials', 'Bastelmaterial', 1250, '2025-06-07', 'person', '0b000000-0000-4000-8000-000000000001',
					'2025-06-07T10:00:00Z'),
				('e0000000-0000-4000-8000-000000000002', ${A}, 'income', 'misc', 'Spende', 20000, '2025-06-01', 'club', NULL,
					'2025-06-01T10:00:00Z')`
		);
		expect(await migrateModuleTo('actions', '0011_club_expenses')).toEqual(['0011_club_expenses']);
		const rows = await moduleSql(
			'actions',
			sql`SELECT id, club_paid_via, club_paid_at = created_at AS paid_at_created
				FROM accounting_entries ORDER BY id`
		);
		expect(rows).toEqual([
			{
				id: 'e0000000-0000-4000-8000-000000000001',
				club_paid_via: 'manual',
				paid_at_created: true
			},
			{ id: 'e0000000-0000-4000-8000-000000000002', club_paid_via: null, paid_at_created: null },
			{ id: 'e0000000-0000-4000-8000-000000000003', club_paid_via: null, paid_at_created: null }
		]);
	});

	it('0016 macht alte Zwischenabrechnungen zu kumulativen Abbildern ohne Sperre', async () => {
		await migrateModuleTo('actions', '0015_expense_links');
		await moduleSql(
			'actions',
			sql`INSERT INTO accounting_interims (id, action_id, number, created_by, created_at) VALUES
				('0c000000-0000-4000-8000-000000000001', ${A}, 1, ${adminId}, '2025-06-08T10:00:00Z'),
				('0c000000-0000-4000-8000-000000000002', ${A}, 2, ${adminId}, '2025-06-20T10:00:00Z')`
		);
		// Neue Stamm-Ausgabe nach 0011 (offen) in ZA 2; die Spende bleibt offen (keine ZA)
		await moduleSql(
			'actions',
			sql`INSERT INTO accounting_entries (id, action_id, type, category, description, amount_cents,
					entry_date, paid_by, interim_id, created_at)
				VALUES ('e0000000-0000-4000-8000-000000000004', ${A}, 'expense', 'travel', 'Bahnfahrt', 3000, '2025-06-09', 'club', '0c000000-0000-4000-8000-000000000002',
					'2025-06-10T10:00:00Z')`
		);
		await moduleSql(
			'actions',
			sql`UPDATE accounting_entries SET interim_id = '0c000000-0000-4000-8000-000000000001' WHERE id IN ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003')`
		);

		const applied = await migrateModuleRest('actions');
		expect(applied[0]).toBe('0016_interim_snapshots');
		await enableModule(admin, 'actions');
		admin = (await contextForUser(adminId))!.ctx;
		key = (
			await createApiKey(admin, {
				name: 'migrations',
				scopes: [...admin.permissions].filter(
					(p) => p.startsWith('actions.') || p === 'core.api.manage'
				)
			})
		).key;

		expect(
			await moduleSql(
				'actions',
				sql`SELECT interim_id, entry_id FROM accounting_interim_entries ORDER BY interim_id, entry_id`
			)
		).toEqual([
			{
				interim_id: '0c000000-0000-4000-8000-000000000001',
				entry_id: 'e0000000-0000-4000-8000-000000000001'
			},
			{
				interim_id: '0c000000-0000-4000-8000-000000000001',
				entry_id: 'e0000000-0000-4000-8000-000000000003'
			},
			{
				interim_id: '0c000000-0000-4000-8000-000000000002',
				entry_id: 'e0000000-0000-4000-8000-000000000001'
			},
			{
				interim_id: '0c000000-0000-4000-8000-000000000002',
				entry_id: 'e0000000-0000-4000-8000-000000000003'
			},
			{
				interim_id: '0c000000-0000-4000-8000-000000000002',
				entry_id: 'e0000000-0000-4000-8000-000000000004'
			}
		]);
		expect(
			await moduleSql(
				'actions',
				sql`SELECT count(*)::int AS n FROM accounting_entries WHERE interim_id IS NOT NULL`
			)
		).toEqual([{ n: 0 }]);
		expect(
			await moduleSql('actions', sql`SELECT id FROM accounting_interims WHERE snapshot IS NOT NULL`)
		).toEqual([]);
	});

	it('legacySnapshot: Beträge in Liste und Kassen-Dienst', async () => {
		expect(totals(await interims(A))).toEqual([
			{
				number: 1,
				entryCount: 2,
				incomeCents: 0,
				expenseCents: 6250,
				reimbursementCents: 1250,
				openReimbursementCents: 1250
			},
			{
				number: 2,
				entryCount: 3,
				incomeCents: 0,
				expenseCents: 9250,
				reimbursementCents: 1250,
				openReimbursementCents: 1250
			}
		]);
		const refs = await actionsService.listInterims({ actionIds: [A] });
		expect(
			refs.map((r) => [r.number, r.incomeCents, r.expenseCents, r.reimbursementCents])
		).toEqual([
			[1, 0, 6250, 1250],
			[2, 0, 9250, 1250]
		]);
	});

	it('legacySnapshot: PDF-Bericht enthält nur die Buchungen der ZA', async () => {
		const html = await reportHtml(A, '0c000000-0000-4000-8000-000000000001');
		expect(html).toContain('Lebensmittel');
		expect(html).toContain('Bastelmaterial');
		expect(html).toContain('Max Muster');
		expect(html).not.toContain('Bahnfahrt');
		expect(html).not.toContain('Spende');
		expect(amountsIn(html)).toContain('62,50 €');
		const html2 = await reportHtml(A, '0c000000-0000-4000-8000-000000000002');
		expect(html2).toContain('Bahnfahrt');
		expect(amountsIn(html2)).toContain('92,50 €');
	});

	it('legacySnapshot: Rücknahme einer alten ZA', async () => {
		await data(
			await api(`/actions/${A}/accounting/interims/0c000000-0000-4000-8000-000000000002`, {
				method: 'DELETE'
			})
		);
		expect(totals(await interims(A)).map((t) => t.number)).toEqual([1]);
		// Buchungen bleiben unverändert
		expect(
			await moduleSql('actions', sql`SELECT count(*)::int AS n FROM accounting_entries`)
		).toEqual([{ n: 4 }]);
	});
});

describe('legacySnapshot liefert dieselben Beträge wie ein gespeichertes Abbild', () => {
	const entry = (over: Partial<EntryFormInput>): EntryFormInput => ({
		type: 'expense',
		category: 'food',
		description: 'Einkauf',
		amountCents: 5000,
		entryDate: '2026-07-12',
		paidBy: 'club',
		payeeId: null,
		...over
	});

	it('Liste, Kassen-Dienst und PDF-Beträge sind vor und nach `snapshot = NULL` gleich', async () => {
		const action = await data<{ id: string }>(
			await api('/actions', {
				method: 'POST',
				json: {
					name: 'Sommerlager',
					description: null,
					location: null,
					startsOn: '2026-07-10',
					startsTime: null,
					endsOn: '2026-07-17',
					endsTime: null
				}
			}),
			201
		);
		const id = action.id;
		await moduleSql(
			'actions',
			sql`INSERT INTO accounting_payees (id, action_id, name) VALUES ('0b000000-0000-4000-8000-000000000002', ${id}, 'Erika Beispiel')`
		);
		const add = async (body: EntryFormInput) =>
			data<AccountingEntry>(
				await api(`/actions/${id}/accounting/entries`, { method: 'POST', json: body }),
				201
			);
		await add(entry({ description: 'Lebensmittel Rewe', amountCents: 12345 }));
		await add(
			entry({
				paidBy: 'person',
				payeeId: '0b000000-0000-4000-8000-000000000002',
				amountCents: 2599,
				category: 'materials'
			})
		);
		await add(
			entry({ type: 'income', category: 'misc', description: 'Spende', amountCents: 50000 })
		);
		const za = await data<AccountingInterim>(
			await api(`/actions/${id}/accounting/interims`, {
				method: 'POST',
				json: { acceptMissingReceipts: true }
			}),
			201
		);
		// Nach der ZA weitere Buchung – gehört in keines der beiden Abbilder
		await add(entry({ description: 'Nachzügler', amountCents: 777 }));

		const before = totals(await interims(id));
		const refsBefore = await actionsService.listInterims({ actionIds: [id] });
		const pdfBefore = amountsIn(await reportHtml(id, za.id));
		expect(before[0]).toMatchObject({ entryCount: 3, expenseCents: 14944, incomeCents: 50000 });

		await moduleSql(
			'actions',
			sql`UPDATE accounting_interims SET snapshot = NULL WHERE id = ${za.id}`
		);
		expect(totals(await interims(id))).toEqual(before);
		expect(await actionsService.listInterims({ actionIds: [id] })).toEqual(refsBefore);
		const html = await reportHtml(id, za.id);
		expect(html).not.toContain('Nachzügler');
		expect(amountsIn(html)).toEqual(pdfBefore);
	});
});
