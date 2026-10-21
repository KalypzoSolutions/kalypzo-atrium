import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb } from '$lib/server/core/database/client';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { setHealthProbeForTests } from '$lib/server/core/api/health';
import { resetAllForTests } from '$lib/server/core/rate-limit';

// Health-Check prüft die Datenbank und schreibt kein api_log; andere Aufrufe protokollieren das Muster.

let close: () => Promise<void>;

async function call(path: string) {
	resetAllForTests();
	const url = new URL(`http://localhost/api/v1${path}`);
	const res = await handleApiRequest({ request: new Request(url), url, ip: '192.0.2.9' });
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function readApiLogPaths(): Promise<string[]> {
	const res = (await getDb().execute(
		sql`SELECT path FROM api_log ORDER BY created_at`
	)) as unknown as {
		rows: { path: string }[];
	};
	return res.rows.map((r) => r.path);
}

const MARKER = '/users/markermarkermarkermarkermarker1';
const MARKER_PATTERN = '/api/v1/users/:id';

/**
 * logAccess läuft ohne await (#75: keine feste Wartezeit): danach einen Markierungsaufruf absetzen und
 * warten, bis er protokolliert ist – frühere Einträge wurden vorher angestoßen.
 */
async function apiLogPaths(): Promise<string[]> {
	const count = async () => (await readApiLogPaths()).filter((p) => p === MARKER_PATTERN).length;
	const before = await count();
	await call(MARKER);
	await vi.waitFor(async () => expect(await count()).toBeGreaterThan(before), {
		timeout: 2000,
		interval: 10
	});
	return readApiLogPaths();
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
});

afterEach(() => setHealthProbeForTests(undefined));

afterAll(async () => {
	await close();
});

describe('GET /api/v1/health', () => {
	it('prüft die Datenbank und erzeugt keinen api_log-Eintrag', async () => {
		const r = await call('/health');
		expect(r.status).toBe(200);
		expect(r.body.data).toEqual({ status: 'ok', database: 'ok' });
		expect(await apiLogPaths()).not.toContain('/api/v1/health');
	});

	it('antwortet 503, wenn die Datenbank nicht erreichbar ist', async () => {
		setHealthProbeForTests(() => Promise.reject(new Error('connection refused')));
		const r = await call('/health');
		expect(r.status).toBe(503);
		expect((r.body.error as { code: string }).code).toBe('unavailable');
		expect(JSON.stringify(r.body)).not.toContain('connection refused');
		expect(await apiLogPaths()).not.toContain('/api/v1/health');
	});

	it('antwortet 503 bei hängender Datenbank (Timeout)', async () => {
		setHealthProbeForTests(() => new Promise(() => {}));
		const started = Date.now();
		const r = await call('/health');
		expect(r.status).toBe(503);
		expect(Date.now() - started).toBeLessThan(5000);
	});
});

describe('Zugriffsprotokoll', () => {
	it('speichert das Endpunkt-Muster bzw. maskierte Pfade', async () => {
		const usersLogged = (p: string[]) => p.filter((x) => x === MARKER_PATTERN).length;
		const before = usersLogged(await readApiLogPaths());
		await call('/users/abcdefghijklmnopqrstuvwxyz012345');
		const token = 'Zq3vLk9xP2mN7rT4wY8bC1dF6gH0jK5s';
		await call(`/modules/files/public/links/${token}`);
		const paths = await apiLogPaths();
		// eigener Aufruf + Markierung
		expect(usersLogged(paths)).toBe(before + 2);
		expect(paths.join(' ')).not.toContain(token);
		expect(paths.join(' ')).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
	});
});
