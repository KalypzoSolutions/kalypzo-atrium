/**
 * Fixture-Modul „Bundle“ (nur Tests des Core): liegt bewusst **nicht** im Modulverzeichnis der Fixtures und wird nie in
 * den App-Build hineinkompiliert. Tests kompilieren es mit `scripts/module-compiler` und laden es als Bundle
 * (`ATRIUM_DATA_DIR/bundles`). Tabelle mit Migration, Endpunkt mit Modultext (i18n), Seite mit Core-Bausteinen.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	defineEndpoint,
	defineModule,
	manifestFromPackage,
	moduleDb,
	rowsOf
} from '$lib/sdk/server';
import { t } from '$lib/sdk/i18n';
import pkg from './atrium-module.json';
import m0001 from './migrations/0001_init.sql?raw';

export const MODULE_ID = 'fx-bundle';
export const PERM_VIEW = 'fx-bundle.item.view';

const itemInput = z.strictObject({ name: z.string().trim().min(1).max(80) });

export default defineModule({
	package: pkg,
	manifest: {
		...manifestFromPackage(pkg),
		permissions: [PERM_VIEW],
		permissionDescriptions: { [PERM_VIEW]: 'Einträge des Bundle-Fixtures sehen' },
		navigation: [
			{ label: 'Bundle', icon: 'package', path: '/modules/fx-bundle', permission: PERM_VIEW }
		]
	},
	migrations: [{ name: '0001_init', sql: m0001 }],
	endpoints: [
		defineEndpoint({
			method: 'GET',
			path: '/items',
			summary: 'Einträge des Bundle-Fixtures',
			permission: PERM_VIEW,
			handler: async () => {
				const items = await moduleDb(MODULE_ID).transaction((tx) =>
					rowsOf(tx, sql`SELECT name FROM items ORDER BY name`)
				);
				return { greeting: t('fx-bundle.greeting'), items: items.map((r) => String(r.name)) };
			}
		}),
		defineEndpoint({
			method: 'POST',
			path: '/items',
			summary: 'Eintrag anlegen',
			permission: PERM_VIEW,
			body: itemInput,
			handler: async ({ body }) => {
				await moduleDb(MODULE_ID).transaction((tx) =>
					tx.execute(
						sql`INSERT INTO items (id, name) VALUES (${crypto.randomUUID()}, ${body.name})`
					)
				);
				return { ok: true };
			}
		})
	]
});
