import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
import { runModuleMigrations } from '$lib/server/core/modules/service';

const ID = 'eol-demo';
const LF = 'CREATE TABLE IF NOT EXISTS items (\n\tid text PRIMARY KEY,\n\tname text\n);\n';
const CRLF = LF.replace(/\n/g, '\r\n');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function useVariant(sqlText: string) {
	unregisterModule(ID);
	registerModule({
		manifest: {
			id: ID,
			name: 'Zeilenenden',
			version: '1.0.0',
			dependencies: [],
			permissions: [],
			navigation: []
		},
		migrations: [{ name: '0001_init', sql: sqlText }]
	});
}

async function storedChecksum(): Promise<string | undefined> {
	const [row] = await getDb()
		.select()
		.from(schema.moduleMigration)
		.where(
			and(eq(schema.moduleMigration.moduleId, ID), eq(schema.moduleMigration.name, '0001_init'))
		);
	return row?.checksum;
}

async function setStoredChecksum(checksum: string) {
	await getDb()
		.update(schema.moduleMigration)
		.set({ checksum })
		.where(eq(schema.moduleMigration.moduleId, ID));
}

beforeAll(async () => {
	await useTestDatabase();
});

describe('runModuleMigrations: Prüfsumme unabhängig von Zeilenenden', () => {
	it('CRLF anwenden, danach LF-Build → kein Fehler, kanonische Prüfsumme', async () => {
		useVariant(CRLF);
		expect(await runModuleMigrations(ID)).toEqual(['0001_init']);
		expect(await storedChecksum()).toBe(sha(LF));
		useVariant(LF);
		expect(await runModuleMigrations(ID)).toEqual([]);
	});

	it('alte CRLF-Rohprüfsumme (Windows-Build) wird beim LF-Build übernommen und aktualisiert', async () => {
		await setStoredChecksum(sha(CRLF));
		useVariant(LF);
		expect(await runModuleMigrations(ID)).toEqual([]);
		expect(await storedChecksum()).toBe(sha(LF));
	});

	it('LF-Rohprüfsumme passt auch zum CRLF-Build', async () => {
		await setStoredChecksum(sha(LF));
		useVariant(CRLF);
		expect(await runModuleMigrations(ID)).toEqual([]);
		expect(await storedChecksum()).toBe(sha(LF));
	});

	it('inhaltliche Änderung bleibt ein Fehler und ändert nichts', async () => {
		useVariant(CRLF.replace('name text', 'name integer'));
		await expect(runModuleMigrations(ID)).rejects.toThrow(
			`Migration ${ID}/0001_init wurde nach Anwendung verändert`
		);
		await setStoredChecksum('0'.repeat(64));
		useVariant(LF);
		await expect(runModuleMigrations(ID)).rejects.toThrow('wurde nach Anwendung verändert');
		expect(await storedChecksum()).toBe('0'.repeat(64));
	});
});
