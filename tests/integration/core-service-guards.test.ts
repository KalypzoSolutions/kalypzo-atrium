/**
 * #67 (01a-12): Core-Dienste, die Modulen über `core` zur Verfügung stehen, prüfen selbst Rechte bzw.
 * begrenzen auf das eigene Modul – nicht nur der aufrufende Endpunkt.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/db';
import { anonymousContext, systemContext } from '$lib/server/core/auth/context';
import { auditFromContext } from '$lib/server/core/audit/service';
import { core } from '$lib/server/core';
import type { RequestContext } from '$lib/sdk/types';

function userCtx(...permissions: string[]): RequestContext {
	return {
		actor: { type: 'user', id: 'u-guard', name: 'Guard' },
		userId: 'u-guard',
		permissions: new Set(permissions),
		ip: null,
		requestId: 'req-guard'
	};
}

const T1 = '0f8c3b8e-1111-4111-8111-000000000001';
const T2 = '0f8c3b8e-2222-4222-8222-000000000002';

beforeAll(async () => {
	await useTestDatabase();
	const sys = systemContext('test');
	await auditFromContext(sys, 'treasury.invoice.created', { target: T1 });
	await auditFromContext(sys, 'members.member.updated', { target: T1 });
	await auditFromContext(sys, 'treasury.invoice.updated', { target: T2 });
	await auditFromContext(sys, 'core.user.created', { target: T2 });
});

describe('core.audit.listForModule', () => {
	it('ohne Recht des Moduls → 403, ohne Anmeldung → 401', async () => {
		await expect(
			core.audit.listForModule(userCtx('members.member.view'), 'treasury', { targets: [T1] })
		).rejects.toMatchObject({ code: 'forbidden' });
		await expect(
			core.audit.listForModule(anonymousContext(), 'treasury', { targets: [T1] })
		).rejects.toMatchObject({ code: 'unauthenticated' });
	});

	it('liefert nur Einträge des eigenen Moduls zu den angegebenen Objekten', async () => {
		const { rows } = await core.audit.listForModule(userCtx('treasury.cash.view'), 'treasury', {
			targets: [T1, T2]
		});
		expect(rows.map((r) => r.action).sort()).toEqual([
			'treasury.invoice.created',
			'treasury.invoice.updated'
		]);
	});

	it('ohne targets → keine Einträge (kein Gesamt-Log)', async () => {
		const { rows, total } = await core.audit.listForModule(
			userCtx('treasury.cash.view'),
			'treasury',
			{ targets: [] }
		);
		expect(rows).toEqual([]);
		expect(total).toBe(0);
	});

	it('ungültige Modul-ID → 400', async () => {
		await expect(
			core.audit.listForModule(userCtx('treasury.cash.view'), "treasury%' OR 1=1", {
				targets: [T1]
			})
		).rejects.toMatchObject({ code: 'bad_request' });
	});

	it('Übergangs-API core.audit.list verlangt targets', async () => {
		// @ts-expect-error – targets ist Pflicht
		await expect(core.audit.list({ limit: 10 })).rejects.toMatchObject({ code: 'bad_request' });
		const { rows } = await core.audit.list({ targets: [T2] });
		expect(rows).toHaveLength(2);
	});
});

describe('core.settings.listPublic', () => {
	it('ohne core.settings.view → 403, ohne Anmeldung → 401', async () => {
		await expect(core.settings.listPublic(userCtx('treasury.cash.view'))).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(core.settings.listPublic(anonymousContext())).rejects.toMatchObject({
			code: 'unauthenticated'
		});
	});

	it('mit Recht: Werte ohne Secrets', async () => {
		const list = await core.settings.listPublic(userCtx('core.settings.view'), {
			group: 'smtp'
		});
		expect(list.length).toBeGreaterThan(0);
		for (const s of list.filter((x) => x.secret)) expect(s.value).toBeNull();
	});
});

describe('core.database', () => {
	it('bietet Modulen nur noch forModule (kein db/transaction ohne Schema-Isolation)', () => {
		expect(Object.keys(core.database)).toEqual(['forModule']);
	});
});
