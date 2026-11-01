/**
 * Benachrichtigungstypen aus den Moduldefinitionen und die Profilansicht je Person.
 */
import type { RequestContext } from '$lib/sdk/types';
import {
	NOTIFICATION_SCOPE_MAX,
	allowedChannels,
	type ModuleNotificationType,
	type NotificationChannel,
	type NotificationDelivery,
	type NotificationPrefGroup,
	type NotificationPrefItem
} from '$lib/sdk/types/notifications';
import { logError } from '../db-errors';
import { allDefinitions, getDefinition } from '../modules/registry';
import { enabledModuleIds } from '../modules/state';
import { hasAny } from '../permissions/service';
import { loadPrefs, prefKey } from './prefs';
import { intlLocale, localized } from '$lib/i18n';

export interface ResolvedType extends ModuleNotificationType {
	moduleId: string;
	/** `<modul>.<key>` */
	fullKey: string;
}

/** Typ zu `<modul>.<key>` (unabhängig vom Modulstatus) oder `null` */
export function findType(fullKey: string): ResolvedType | null {
	const dot = fullKey.indexOf('.');
	if (dot < 1) return null;
	const moduleId = fullKey.slice(0, dot);
	const key = fullKey.slice(dot + 1);
	const t = getDefinition(moduleId)?.notifications?.types.find((x) => x.key === key);
	return t ? { ...t, moduleId, fullKey } : null;
}

export function defaultChannelOf(t: ModuleNotificationType): NotificationChannel {
	return t.defaultChannel ?? 'email';
}

/** Gespeicherte Wahl auf das Erlaubte begrenzen (Typ kann sich seit dem Speichern geändert haben) */
export function effectiveChoice(
	t: ModuleNotificationType,
	pref: { channel: string; delivery: string } | undefined
): { channel: NotificationChannel; delivery: NotificationDelivery } {
	const allowed = allowedChannels(t);
	const channel = allowed.includes(pref?.channel as NotificationChannel)
		? (pref!.channel as NotificationChannel)
		: defaultChannelOf(t);
	const delivery: NotificationDelivery =
		t.digest && pref?.delivery === 'daily' && channel !== 'off' ? 'daily' : 'immediate';
	return { channel, delivery };
}

function visibleStatic(ctx: RequestContext, t: ModuleNotificationType): boolean {
	if (t.scoped) return false;
	const perms = [...(t.permission ? [t.permission] : []), ...(t.anyPermission ?? [])];
	return perms.length === 0 || hasAny(ctx, perms);
}

interface Row {
	type: ResolvedType;
	scope: string;
	label: string;
	description: string | null;
	group: string | null;
}

/** Alle Einträge, die die Person einstellen kann (aktive Module, nach Rechten) */
async function rowsForUser(
	ctx: RequestContext
): Promise<{ id: string; label: string; rows: Row[] }[]> {
	const enabled = await enabledModuleIds();
	const out: { id: string; label: string; rows: Row[] }[] = [];
	for (const def of allDefinitions()) {
		const n = def.notifications;
		const moduleId = def.manifest.id;
		if (!n || !enabled.has(moduleId)) continue;
		const rows: Row[] = [];
		for (const t of n.types) {
			if (!visibleStatic(ctx, t)) continue;
			rows.push({
				type: { ...t, moduleId, fullKey: `${moduleId}.${t.key}` },
				scope: '',
				label: t.label,
				description: t.description ?? null,
				group: null
			});
		}
		if (n.forUser) {
			try {
				const seen = new Set<string>();
				for (const e of await n.forUser(ctx)) {
					const t = n.types.find((x) => x.key === e.key && x.scoped);
					const id = `${e.key}|${e.scope}`;
					if (!t || !e.scope || e.scope.length > NOTIFICATION_SCOPE_MAX || seen.has(id)) continue;
					seen.add(id);
					rows.push({
						type: { ...t, moduleId, fullKey: `${moduleId}.${t.key}` },
						scope: e.scope,
						label: e.label,
						description: e.description ?? t.description ?? null,
						group: e.group ?? null
					});
				}
			} catch (e) {
				logError(`[notifications] forUser von ${moduleId} fehlgeschlagen`, e);
			}
		}
		if (rows.length) out.push({ id: moduleId, label: localized(def.manifest.name), rows });
	}
	return out.sort((a, b) => a.label.localeCompare(b.label, intlLocale()));
}

/** Profilansicht: Gruppen je Modul mit der wirksamen Wahl */
export async function preferenceGroups(ctx: RequestContext): Promise<NotificationPrefGroup[]> {
	if (!ctx.userId) return [];
	const groups = await rowsForUser(ctx);
	const prefs = await loadPrefs(
		[ctx.userId],
		groups.flatMap((g) => g.rows.map((r) => r.type.fullKey))
	);
	return groups.map((g) => ({
		id: g.id,
		label: g.label,
		items: g.rows.map((r): NotificationPrefItem => {
			const choice = effectiveChoice(
				r.type,
				prefs.get(prefKey(ctx.userId!, r.type.fullKey, r.scope))
			);
			return {
				type: r.type.fullKey,
				scope: r.scope,
				label: r.label,
				description: r.description,
				group: r.group,
				channel: choice.channel,
				delivery: choice.delivery,
				defaultChannel: defaultChannelOf(r.type),
				mandatory: !!r.type.mandatory,
				digest: !!r.type.digest,
				pushOnly: !!r.type.pushOnly
			};
		})
	}));
}

/** Darf die Person diesen Eintrag einstellen? (gleiche Regeln wie die Profilansicht) */
export async function findEditableRow(
	ctx: RequestContext,
	fullKey: string,
	scope: string
): Promise<ResolvedType | null> {
	const groups = await rowsForUser(ctx);
	for (const g of groups) {
		const row = g.rows.find((r) => r.type.fullKey === fullKey && r.scope === scope);
		if (row) return row.type;
	}
	return null;
}
