import { mailIdleForTests } from '$lib/server/core/mail';

/**
 * Wartet, bis ohne `await` („fire and forget“) gestartete Mails verschickt sind – ereignisbasiert statt
 * fester Wartezeit (#75). Eine Runde der Ereignisschleife vorab erfasst Aufrufe, die erst nach dem
 * Ende des Requests starten. Für positive Erwartungen zusätzlich `vi.waitFor(...)` nutzen.
 */
export async function settleMails(): Promise<void> {
	await new Promise<void>((r) => setImmediate(r));
	await mailIdleForTests();
}
