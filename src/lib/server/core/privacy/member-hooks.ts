/**
 * Modul-Hook `onMemberDeleted` (siehe `ModuleDefinition`): Die Personenquelle (`ModuleDefinition.principals`,
 * z. B. Mitglieder & Gruppen) meldet gelöschte oder
 * anonymisierte Mitglieder, alle anderen aktiven Module räumen ihre Kopien auf (z. B. `actions`:
 * verknüpfte Teilnehmende anonymisieren). Je Modul eine eigene Modul-Transaktion, danach
 * `afterCommit`; Fehler eines Moduls brechen nicht ab.
 */
import type { MemberDeletedInfo } from '../modules/types';
import { forModule } from '../database/module-db';
import { errors } from '../errors';
import { allDefinitions, principalSource } from '../modules/registry';
import { isModuleEnabled } from '../modules/service';
import { t } from '$lib/i18n';

/** Rückgabe = Modul-IDs, deren Aufräumen fehlgeschlagen ist (für das Audit des Aufrufers). */
export async function notifyMembersDeleted(
	callerModuleId: string,
	info: MemberDeletedInfo
): Promise<string[]> {
	// Nur die Personenquelle darf das Ereignis auslösen
	const source = principalSource()?.id;
	if (!source || callerModuleId !== source) {
		throw errors.forbidden(t('privacy.onlyMemberSource'));
	}
	const memberIds = [...new Set(info.memberIds)].filter(Boolean);
	if (!memberIds.length) return [];
	const failed: string[] = [];
	for (const def of allDefinitions()) {
		const hook = def.onMemberDeleted;
		const moduleId = def.manifest.id;
		if (!hook || moduleId === source) continue;
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
