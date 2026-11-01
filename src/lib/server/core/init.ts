import { bootstrapAdmin } from './auth/users';
import { registerCoreApi } from './api/endpoints';
import { runCoreMigrations } from './database/migrate';
import { getDb } from './database/client';
import { env } from './env';
import { loadBuiltInModules } from './modules/load';
import { syncModules } from './modules/service';
import { reconcileInstallEvents } from './modules/install/supervisor-link';
import { syncInstallsFromLock } from './modules/install/manage';
import { seedSettingsFromEnv } from './settings/env-seed';

let started: Promise<void> | undefined;
let apiRegistered = false;

/** Führt die Startsequenz genau einmal aus. */
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
		// Ergebnisse von Neubauten des Supervisors übernehmen (Verlauf, Wunschzustand)
		const reconciled = await reconcileInstallEvents().catch((err) => {
			console.error('[core] Abgleich der Modul-Installationen fehlgeschlagen:', err);
			return 0;
		});
		if (reconciled) console.info(`[core] ${reconciled} Modul-Installation(en) abgeschlossen.`);
		// Module aus der Lock-Datei (z. B. Seed eines frischen Deployments) als Wunschzustand übernehmen
		await syncInstallsFromLock().catch((err) =>
			console.error('[core] Übernahme der Lock-Datei fehlgeschlagen:', err)
		);
		const seeded = await seedSettingsFromEnv();
		if (seeded.length)
			console.info(`[core] Einstellungen aus Umgebung vorbelegt: ${seeded.join(', ')}`);
	})().catch((err) => {
		started = undefined;
		throw err;
	});
	return started;
}
