/**
 * Datensicherung – Kontoschutz beim Wiederherstellen von `core:users`.
 *
 * Die Analyse sammelt aus dem Archiv `public.user`, `public.account` (nur Passwort-Hash des Anbieters
 * `credential`), `public.two_factor`, `public.user_role` und – falls gesichert – `public.role_permission`.
 * Für die ausführende Person:
 *   - Konto mit gleicher ID oder gleicher E-Mail in der Sicherung → Passwort aus der Sicherung muss zum
 *     eingegebenen Passwort passen, das Konto muss aktiv sein und das Recht `core.system.backup` haben
 *     (Administrator-Rolle zählt immer) → Fall `same`; sonst gesperrt (nicht umgehbar).
 *   - kein Treffer → Fall `kept`: das aktuelle Konto (mit Sitzung) bleibt zusätzlich erhalten und behält
 *     seine bisherigen Rollen (keine zusätzlichen, #16). `core:users`/`core:roles` dürfen ohnehin nur
 *     Administrator*innen wiederherstellen (`ADMIN_ONLY_RESTORE_SCOPES` in `access.ts`).
 */
import { eq } from 'drizzle-orm';
import { getAuth } from '../auth';
import { getDb, schema } from '../database/client';
import { ADMIN_ROLE_ID } from '../permissions/catalog';

const BACKUP_PERMISSION = 'core.system.backup';
/** Obergrenze gesammelter Zeilen je Tabelle (Speicher) */
const MAX_ROWS = 200_000;

type Row = Record<string, unknown>;

export interface AccountGuardData {
	users: Map<string, { email: string; active: boolean; twoFactorEnabled: boolean }>;
	/** user_id → Passwort-Hash (Anbieter `credential`) */
	passwords: Map<string, string>;
	twoFactorUsers: Set<string>;
	/** user_id → Rollen */
	userRoles: Map<string, Set<string>>;
	/** role_id → Rechte; `null`, wenn `role_permission` nicht in der Sicherung ist */
	rolePermissions: Map<string, Set<string>> | null;
	truncated: boolean;
}

export function newAccountGuardData(): AccountGuardData {
	return {
		users: new Map(),
		passwords: new Map(),
		twoFactorUsers: new Set(),
		userRoles: new Map(),
		rolePermissions: null,
		truncated: false
	};
}

/** Tabellen, deren Zeilen der Kontoschutz braucht */
export const ACCOUNT_GUARD_TABLES = new Set([
	'public.user',
	'public.account',
	'public.two_factor',
	'public.user_role',
	'public.role_permission'
]);

const bool = (v: unknown) => v === true || v === 't' || v === 'true';

/** Eine Zeile aus dem Archiv aufnehmen (`table` = `schema.tabelle`). */
export function collectAccountRow(data: AccountGuardData, table: string, row: Row): void {
	const add = <K, V>(m: Map<K, V>, k: K, v: V) => {
		if (m.size >= MAX_ROWS) {
			data.truncated = true;
			return;
		}
		m.set(k, v);
	};
	switch (table) {
		case 'public.user':
			if (typeof row.id === 'string') {
				add(data.users, row.id, {
					email: String(row.email ?? '').toLowerCase(),
					active: row.active === undefined ? true : bool(row.active),
					twoFactorEnabled: bool(row.two_factor_enabled)
				});
			}
			break;
		case 'public.account':
			if (
				row.provider_id === 'credential' &&
				typeof row.user_id === 'string' &&
				typeof row.password === 'string' &&
				row.password
			) {
				add(data.passwords, row.user_id, row.password);
			}
			break;
		case 'public.two_factor':
			if (typeof row.user_id === 'string') data.twoFactorUsers.add(row.user_id);
			break;
		case 'public.user_role':
			if (typeof row.user_id === 'string' && typeof row.role_id === 'string') {
				const set = data.userRoles.get(row.user_id) ?? new Set<string>();
				set.add(row.role_id);
				add(data.userRoles, row.user_id, set);
			}
			break;
		case 'public.role_permission':
			data.rolePermissions ??= new Map();
			if (typeof row.role_id === 'string' && typeof row.permission_key === 'string') {
				const set = data.rolePermissions.get(row.role_id) ?? new Set<string>();
				set.add(row.permission_key);
				add(data.rolePermissions, row.role_id, set);
			}
			break;
	}
}

export interface AccountAssessment {
	case: 'same' | 'kept';
	/** Konto-ID nach dem Wiederherstellen (bei `same` die ID aus der Sicherung) */
	effectiveUserId: string;
	willLogout: boolean;
	twoFactorInBackup: boolean;
	/** gesetzt → `core:users` darf nicht wiederhergestellt werden (Text für die Oberfläche) */
	blocked?: string;
}

async function rolesWithBackupRight(roleIds: Set<string>, data: AccountGuardData) {
	if (roleIds.has(ADMIN_ROLE_ID)) return true;
	if (data.rolePermissions) {
		for (const r of roleIds) if (data.rolePermissions.get(r)?.has(BACKUP_PERMISSION)) return true;
		return false;
	}
	// Rollen nicht in der Sicherung → Rechte der Rollen auf diesem Server
	const rows = await getDb()
		.select({ roleId: schema.rolePermission.roleId })
		.from(schema.rolePermission)
		.where(eq(schema.rolePermission.permissionKey, BACKUP_PERMISSION));
	return rows.some((r) => roleIds.has(r.roleId));
}

/** Kontoschutz bewerten (außerhalb jeder Transaktion; `password` = soeben geprüftes Konto-Passwort). */
export async function assessAccount(
	userId: string,
	password: string,
	data: AccountGuardData
): Promise<AccountAssessment> {
	const [me] = await getDb()
		.select({ email: schema.user.email })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	const myEmail = String(me?.email ?? '').toLowerCase();

	let matchId: string | null = data.users.has(userId) ? userId : null;
	if (!matchId && myEmail) {
		for (const [id, u] of data.users) {
			if (u.email === myEmail) {
				matchId = id;
				break;
			}
		}
	}
	if (!matchId) {
		if (data.truncated) {
			return {
				case: 'kept',
				effectiveUserId: userId,
				willLogout: false,
				twoFactorInBackup: false,
				blocked:
					'Die Benutzerdaten der Sicherung sind zu umfangreich für die Prüfung des eigenen Kontos.'
			};
		}
		return { case: 'kept', effectiveUserId: userId, willLogout: false, twoFactorInBackup: false };
	}

	const u = data.users.get(matchId)!;
	const result: AccountAssessment = {
		case: 'same',
		effectiveUserId: matchId,
		willLogout: matchId !== userId,
		twoFactorInBackup: u.twoFactorEnabled || data.twoFactorUsers.has(matchId)
	};
	const hash = data.passwords.get(matchId);
	let ok = false;
	if (hash && password.length > 0 && password.length <= 128) {
		try {
			ok = await (await getAuth().$context).password.verify({ hash, password });
		} catch {
			ok = false;
		}
	}
	if (!ok) {
		result.blocked =
			'Ihr Konto ist in der Sicherung mit einem anderen Passwort enthalten. Benutzer lassen sich nur wiederherstellen, wenn Ihr aktuelles Passwort auch in der Sicherung gilt.';
		return result;
	}
	if (!u.active) {
		result.blocked =
			'Ihr Konto ist in der Sicherung deaktiviert. Benutzer lassen sich so nicht wiederherstellen.';
		return result;
	}
	if (!(await rolesWithBackupRight(data.userRoles.get(matchId) ?? new Set(), data))) {
		result.blocked =
			'Ihr Konto hat in der Sicherung kein Recht für die Datensicherung. Benutzer lassen sich so nicht wiederherstellen.';
	}
	return result;
}
