/**
 * Modul-Hook `onMemberDeleted` (siehe `ModuleDefinition`): Das Modul `members` meldet gelöschte oder
 * anonymisierte Mitglieder, alle anderen aktiven Module räumen ihre Kopien auf (z. B. `actions`:
 * verknüpfte Teilnehmende anonymisieren). Je Modul eine eigene Modul-Transaktion, danach
 * `afterCommit`; Fehler eines Moduls brechen nicht ab.
 */
import type { MemberDeletedInfo } from '../modules/types';
import { forModule } from '../database/module-db';
import { errors } from '../errors';
import { allDefinitions } from '../modules/registry';
import { isModuleEnabled } from '../modules/service';

/** Nur das Mitgliedermodul darf das Ereignis auslösen */
const SOURCE_MODULE = 'members';

/** Rückgabe = Modul-IDs, deren Aufräumen fehlgeschlagen ist (für das Audit des Aufrufers). */
export async function notifyMembersDeleted(
	callerModuleId: string,
	info: MemberDeletedInfo
): Promise<string[]> {
	if (callerModuleId !== SOURCE_MODULE) {
		throw errors.forbidden('Nur das Mitgliedermodul darf gelöschte Mitglieder melden');
	}
	const memberIds = [...new Set(info.memberIds)].filter(Boolean);
	if (!memberIds.length) return [];
	const failed: string[] = [];
	for (const def of allDefinitions()) {
		const hook = def.onMemberDeleted;
		const moduleId = def.manifest.id;
		if (!hook || moduleId === SOURCE_MODULE) continue;
		try {
			if (!(await isModuleEnabled(moduleId))) continue;
			const result = await forModule(moduleId).transaction((tx) =>
				hook(tx, { memberIds, reason: info.reason })
			);
			if (result?.afterCommit) await result.afterCommit();
		} catch (err) {
			failed.push(moduleId);
			console.error(
				`[privacy] Aufräumen im Modul ${moduleId} nach dem Löschen von Mitgliedern fehlgeschlagen:`,
				(err as Error)?.message
			);
		}
	}
	return failed;
}
