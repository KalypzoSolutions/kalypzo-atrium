import { bootstrapAdmin } from './auth/users';
import { registerCoreApi } from './api/endpoints';
import { runCoreMigrations } from './database/migrate';
import { getDb } from './database/client';
import { env } from './env';
import { loadBuiltInModules } from './modules/load';
import { syncModules } from './modules/service';

let started: Promise<void> | undefined;
let apiRegistered = false;

/** Fuehrt die Startsequenz genau einmal aus. */
export function initCore(opts: { migrate?: boolean } = {}): Promise<void> {
	started ??= (async () => {
		const e = env();
		if (opts.migrate ?? true) await runCoreMigrations(getDb());
		if (!apiRegistered) {
			registerCoreApi();
			apiRegistered = true;
		}
		loadBuiltInModules();
		await syncModules();
		if (e.INITIAL_ADMIN_EMAIL && e.INITIAL_ADMIN_PASSWORD) {
			const created = await bootstrapAdmin(e.INITIAL_ADMIN_EMAIL, e.INITIAL_ADMIN_PASSWORD);
			if (created) console.info('[core] Initialer Administrator wurde angelegt.');
		}
	})().catch((err) => {
		started = undefined;
		throw err;
	});
	return started;
}
