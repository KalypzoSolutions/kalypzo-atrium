/**
 * Lebenszyklus des Server-Prozesses (Kalypzo Atrium, Phase 6):
 * - Geordnetes Beenden: adapter-node schließt bei SIGTERM/SIGINT den HTTP-Server und meldet `sveltekit:shutdown`;
 *   dann Job-Zeitgeber anhalten und den Datenbank-Pool schließen. Der Supervisor schickt unter Windows (keine
 *   Signale an Kindprozesse) die IPC-Nachricht `atrium:shutdown`, die dasselbe auslöst.
 * - Probelauf (`ATRIUM_VERIFY_ONLY=1`): nur Module registrieren und prüfen, Ergebnis als JSON-Zeile ausgeben,
 *   Prozess beenden – ohne Datenbank. Damit prüft der Supervisor eine neue Generation vor dem Tausch.
 */
import { closeDb } from './database/client';
import { stopJobRunner } from './jobs';
import { loadBuiltInModules } from './modules/load';
import { allDefinitions, brokenModules, excludeUnresolvableModules } from './modules/registry';

const HARD_EXIT_MS = 30_000;
let installed = false;

export function installShutdownHandlers(): void {
	if (installed) return;
	installed = true;
	process.on('message', (m: unknown) => {
		if ((m as { type?: string } | null)?.type !== 'atrium:shutdown') return;
		// Wie SIGTERM: adapter-node schließt den Server geordnet (unter Windows kein echtes Signal möglich)
		if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM');
		else process.exit(0);
		setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();
	});
	process.on('sveltekit:shutdown' as never, () => {
		stopJobRunner();
		void closeDb().catch((e) =>
			console.error('[core] Datenbank beim Beenden nicht geschlossen:', e)
		);
	});
}

export const VERIFY_PREFIX = 'ATRIUM_VERIFY ';

/** Probelauf: Module laden und prüfen, Ergebnis ausgeben, beenden */
export function runVerifyAndExit(): void {
	try {
		loadBuiltInModules();
		excludeUnresolvableModules();
		const report = {
			modules: allDefinitions().map((d) => ({ id: d.manifest.id, version: d.manifest.version })),
			broken: brokenModules()
		};
		process.stdout.write(`${VERIFY_PREFIX}${JSON.stringify(report)}\n`, () => process.exit(0));
	} catch (e) {
		process.stdout.write(
			`${VERIFY_PREFIX}${JSON.stringify({ error: e instanceof Error ? e.message : String(e) })}\n`,
			() => process.exit(1)
		);
	}
}
