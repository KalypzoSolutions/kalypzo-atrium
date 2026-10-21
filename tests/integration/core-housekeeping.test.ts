import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { listJobs, runJobNow, setJobClockForTests } from '$lib/server/core/jobs';
import { HOUSEKEEPING_BATCH } from '$lib/server/core/jobs/housekeeping';
import { setSetting } from '$lib/server/core/settings/service';
import type { RequestContext } from '$lib/sdk/types';

// Core-Job `core.housekeeping`: Aufbewahrungsfristen für api_log und audit_log (Migration 0007).

let close: () => Promise<void>;
let admin: RequestContext;
const DAY = 24 * 60 * 60_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
	return ((await getDb().execute(q)) as unknown as { rows: Row[] }).rows;
}

async function insertApiLog(id: string, createdAt: string, path = '/api/v1/me') {
	await getDb().execute(sql`
		INSERT INTO api_log (id, request_id, method, path, status, duration_ms, actor_type, ip, created_at)
		VALUES (${id}, ${id}, 'GET', ${path}, 200, 1, 'anonymous', '192.0.2.1', ${createdAt})`);
}

async function insertAudit(id: string, createdAt: string, ip: string | null = '192.0.2.7') {
	await getDb().execute(sql`
		INSERT INTO audit_log (id, action, actor_type, actor_name, target, ip, metadata, created_at)
		VALUES (${id}, 'test.item.created', 'user', 'Erika Muster', ${`t-${id}`}, ${ip}, '{}'::jsonb,
			${createdAt})`);
}

/** Der Trigger lehnt ab (Meldung steckt bei drizzle in `cause`) */
async function expectImmutable(p: Promise<unknown>) {
	const e = (await p.then(
		() => null,
		(err: unknown) => err
	)) as { message?: string; cause?: { message?: string } } | null;
	expect(e, 'Abfrage hätte abgelehnt werden müssen').not.toBeNull();
	expect(`${e?.message} ${e?.cause?.message}`).toMatch(/unveraenderlich/);
}

const auditById = async (id: string) =>
	(await rows(sql`SELECT id, ip FROM audit_log WHERE id = ${id}`))[0];

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@test.local', 'Sehr-Sicheres-Passwort-1');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@test.local'));
	admin = (await contextForUser(u!.id))!.ctx;
	setJobClockForTests(() => now);
});

afterAll(async () => {
	setJobClockForTests(undefined);
	await close();
});

describe('Audit-Trigger', () => {
	it('weist UPDATE, DELETE und TRUNCATE ohne Flag weiterhin ab', async () => {
		await insertAudit('trig-1', ago(1));
		await expectImmutable(getDb().execute(sql`UPDATE audit_log SET ip = NULL WHERE id = 'trig-1'`));
		await expectImmutable(getDb().execute(sql`DELETE FROM audit_log WHERE id = 'trig-1'`));
		await expectImmutable(getDb().execute(sql`TRUNCATE audit_log`));
		expect((await auditById('trig-1'))?.ip).toBe('192.0.2.7');
	});

	it('erlaubt mit `app.audit_retention` nur das Leeren der IP, keine anderen Änderungen', async () => {
		const withFlag = (q: ReturnType<typeof sql>) =>
			getDb().transaction(async (tx) => {
				await tx.execute(sql.raw(`SET LOCAL app.audit_retention = 'on'`));
				await tx.execute(q);
			});
		await expectImmutable(
			withFlag(sql`UPDATE audit_log SET action = 'x.y.z', ip = NULL WHERE id = 'trig-1'`)
		);
		await expectImmutable(
			withFlag(sql`UPDATE audit_log SET ip = '198.51.100.1' WHERE id = 'trig-1'`)
		);
		await expectImmutable(
			withFlag(sql`UPDATE audit_log SET metadata = '{"a":1}'::jsonb WHERE id = 'trig-1'`)
		);
		await withFlag(sql`UPDATE audit_log SET ip = NULL WHERE id = 'trig-1'`);
		expect((await auditById('trig-1'))?.ip).toBeNull();
		// Flag gilt nur in der Transaktion
		await expectImmutable(getDb().execute(sql`DELETE FROM audit_log WHERE id = 'trig-1'`));
	});
});

describe('core.housekeeping', () => {
	it('ist als täglicher Core-Job registriert', async () => {
		const job = (await listJobs()).find((j) => j.key === 'core.housekeeping');
		expect(job).toMatchObject({ moduleId: 'core', schedule: 'daily', enabled: true });
	});

	it('löscht alte Zeilen (in Stapeln), entfernt alte IPs und behält neue', async () => {
		await insertApiLog('api-old', ago(31));
		await insertApiLog('api-new', ago(29));
		// mehr als ein Stapel alter Zeilen
		await getDb().execute(sql`
			INSERT INTO api_log (id, request_id, method, path, status, duration_ms, actor_type, created_at)
			SELECT 'bulk-' || g, 'r', 'GET', '/api/v1/me', 200, 1, 'anonymous', ${ago(40)}::timestamptz
			FROM generate_series(1, ${HOUSEKEEPING_BATCH + 3}) g`);
		await insertAudit('aud-old', ago(731));
		await insertAudit('aud-ip-old', ago(91));
		await insertAudit('aud-new', ago(89));

		const info = await runJobNow(admin, 'core.housekeeping');
		expect(info.lastStatus, info.lastMessage ?? '').toBe('ok');

		const api = await rows(sql`SELECT id FROM api_log WHERE id LIKE 'api-%' OR id LIKE 'bulk-%'`);
		expect(api.map((r) => r.id)).toEqual(['api-new']);
		expect(await auditById('aud-old')).toBeUndefined();
		expect((await auditById('aud-ip-old'))?.ip).toBeNull();
		expect((await auditById('aud-new'))?.ip).toBe('192.0.2.7');

		const [entry] = await rows(sql`
			SELECT metadata, ip FROM audit_log WHERE action = 'core.system.housekeeping'
			ORDER BY created_at DESC LIMIT 1`);
		const meta = entry!.metadata as Record<string, unknown>;
		expect(meta).toMatchObject({
			apiLogDeleted: HOUSEKEEPING_BATCH + 4,
			auditDeleted: 1,
			apiLogDays: 30,
			auditIpDays: 90,
			auditDays: 730
		});
		expect(meta.auditIpCleared).toBeGreaterThanOrEqual(1);
		// nur Zähler, keine Inhalte
		expect(JSON.stringify(meta)).not.toMatch(/192\.0\.2|Erika|t-aud/);
	});

	it('hält sich an die Einstellungen (0 = Audit-Log nie löschen)', async () => {
		await setSetting(admin, 'core.retention.auditDays', 0);
		await setSetting(admin, 'core.retention.apiLogDays', 5);
		await insertAudit('keep-forever', ago(5000), null);
		await insertApiLog('api-6d', ago(6));
		await runJobNow(admin, 'core.housekeeping');
		expect(await auditById('keep-forever')).toBeDefined();
		expect(await rows(sql`SELECT id FROM api_log WHERE id = 'api-6d'`)).toHaveLength(0);
	});

	it('validiert die Fristen', async () => {
		await expect(setSetting(admin, 'core.retention.auditDays', 10)).rejects.toMatchObject({
			status: 422
		});
		await expect(setSetting(admin, 'core.retention.apiLogDays', 0)).rejects.toMatchObject({
			status: 422
		});
		await setSetting(admin, 'core.retention.auditDays', 30);
	});
});

describe('Migration 0007: Bestand im api_log', () => {
	it('maskiert Link-Tokens öffentlicher Endpunkte und entfernt Health-Checks', async () => {
		const token = 'Zq3vLk9xP2mN7rT4wY8bC1dF6gH0jK5s';
		await insertApiLog('m-files', ago(1), `/api/v1/modules/files/public/links/${token}/nodes`);
		await insertApiLog('m-form', ago(1), `/api/v1/modules/actions/public/forms/${token}`);
		await insertApiLog('m-link', ago(1), `/api/v1/modules/members/public/link/${token}/claim`);
		await insertApiLog('m-health', ago(1), '/api/v1/health');
		await insertApiLog('m-other', ago(1), '/api/v1/modules/offices/offices');

		const file = readFileSync(resolve(process.cwd(), 'drizzle/0007_log_retention.sql'), 'utf8');
		const statements = file.split('--> statement-breakpoint').map((s) => s.trim());
		for (const s of statements.filter((s) =>
			/^(--[^\n]*\n)*\s*(UPDATE "api_log"|DELETE FROM "api_log")/.test(s)
		)) {
			await getDb().execute(sql.raw(s));
		}
		const paths = Object.fromEntries(
			(await rows(sql`SELECT id, path FROM api_log WHERE id LIKE 'm-%'`)).map((r) => [r.id, r.path])
		);
		expect(paths).toEqual({
			'm-files': '/api/v1/modules/files/public/links/:token/nodes',
			'm-form': '/api/v1/modules/actions/public/forms/:token',
			'm-link': '/api/v1/modules/members/public/link/:token/claim',
			'm-other': '/api/v1/modules/offices/offices'
		});
	});
});
