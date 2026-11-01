/**
 * Fixture-Modul „Verbraucher“ (nur Tests des Core): harte Abhängigkeit auf `fx-board` (Dienst über
 * `core.modules.use`), optionale auf `fx-people`. Keine Tabellen, keine Oberfläche.
 */
import { core, defineEndpoint, defineModule, manifestFromPackage } from '$lib/sdk/server';
import pkg from './atrium-module.json';

/**
 * Vertrag von `fx-board` (`fx-board/contract.ts`). Absichtlich hier wiederholt: Fixtures liegen nicht immer im
 * Modulverzeichnis (`$modules`), und relative Importe in Nachbarmodule sind verboten.
 */
interface BoardService {
	countNotes(): Promise<number>;
}

export const MODULE_ID = 'fx-consumer';
export const PERM_STATS = 'fx-consumer.stats.view';

export default defineModule({
	package: pkg,
	manifest: {
		...manifestFromPackage(pkg),
		permissions: [PERM_STATS],
		permissionDescriptions: { [PERM_STATS]: 'Zahlen der Pinnwand sehen' },
		navigation: []
	},
	migrations: [],
	endpoints: [
		defineEndpoint({
			method: 'GET',
			path: '/stats',
			summary: 'Zahl der Pinnwand-Einträge (über den Dienst von fx-board)',
			permission: PERM_STATS,
			handler: async () => {
				const board = await core.modules.use<BoardService>('fx-board', MODULE_ID);
				const people = await core.modules.useOptional<object>('fx-people', MODULE_ID);
				return { notes: await board.countNotes(), peopleActive: people !== null };
			}
		})
	]
});
