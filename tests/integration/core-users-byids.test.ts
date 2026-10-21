/**
 * `core.users.byIds` (#70, 04-06): stückelt intern (Verzeichnis liefert max. 30 je Aufruf), gleiche
 * Sichtbarkeit wie `directory`, deaktivierte/unbekannte fehlen; `userLabel` liefert „Unbekannt“.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { core } from '$lib/server/core';
import { userLabel } from '$lib/sdk/server';
import type { RequestContext } from '$lib/sdk/types';

const ids: string[] = [];
const INACTIVE = 'byids-inaktiv';

function userCtx(userId: string, perms: string[] = []): RequestContext {
	return {
		actor: { type: 'user', id: userId, name: userId },
		userId,
		permissions: new Set(perms),
		ip: null,
		requestId: 'test'
	};
}

beforeAll(async () => {
	await useTestDatabase();
	const rows = Array.from({ length: 100 }, (_, i) => {
		const id = `byids-${String(i).padStart(3, '0')}`;
		ids.push(id);
		return { id, name: `Person ${String(i).padStart(3, '0')}`, email: `${id}@example.test` };
	});
	await getDb()
		.insert(schema.user)
		.values([
			...rows,
			{ id: INACTIVE, name: 'Inaktiv', email: 'inaktiv@example.test', active: false }
		]);
});

describe('core.users.byIds', () => {
	const ctx = () => userCtx(ids[0]!);

	it.each([0, 1, 30, 31, 100])('%i IDs → alle aufgelöst', async (n) => {
		const map = await core.users.byIds(ctx(), ids.slice(0, n));
		expect(map.size).toBe(n);
		for (const id of ids.slice(0, n)) expect(map.get(id)?.id).toBe(id);
	});

	it('Duplikate, leere Werte, unbekannte und deaktivierte Konten', async () => {
		const map = await core.users.byIds(ctx(), [
			ids[1]!,
			ids[1]!,
			null,
			undefined,
			'',
			'gibt-es-nicht',
			INACTIVE
		]);
		expect([...map.keys()]).toEqual([ids[1]!]);
		expect(userLabel(map, ids[1]!)).toBe('Person 001');
		expect(userLabel(map, INACTIVE)).toBe('Unbekannt');
		expect(userLabel(map, null, '—')).toBe('—');
	});

	it('E-Mail nur mit core.users.view (wie directory), eigene immer', async () => {
		const plain = await core.users.byIds(ctx(), [ids[0]!, ids[2]!]);
		expect(plain.get(ids[0]!)?.email).toBe(`${ids[0]}@example.test`);
		expect(plain.get(ids[2]!)?.email).toBe('');
		const viewer = await core.users.byIds(userCtx(ids[0]!, ['core.users.view']), [ids[2]!]);
		expect(viewer.get(ids[2]!)?.email).toBe(`${ids[2]}@example.test`);
	});
});
