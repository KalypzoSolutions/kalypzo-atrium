/**
 * Gemeinsamer Zugriffsbaustein für Objekte mit Principal-Freigaben (`<obj>_shares`, siehe `sharing.ts`).
 * Eine Implementierung für `events`, `galleries` (Fabrik `createShareAccess`) und `files` (Bausteine
 * `shareLevelOn`, `loadObjectShares`, `replaceObjectShares` – Ordnervererbung bleibt im Modul).
 *
 * Regeln der Fabrik (die Basisberechtigung `<modul>.<obj>.view` prüft bereits der Router):
 *   - System-Kontext, `perms.editAll`                       -> bearbeiten
 *   - Eigentümer*in (`ownerColumn`, Standard `owner_id`)    -> bearbeiten
 *   - Freigabe `edit` an einen passenden Principal           -> bearbeiten
 *   - Freigabe `read`, `perms.viewAll`, `readIf` erfüllt     -> lesen
 *   - sonst kein Zugriff (`null` bzw. 404, damit die Existenz nicht verraten wird)
 *
 * `keys` sind die Principal-Schlüssel des Aufrufers (`principalKeysFor(ctx, modul)`), immer VOR der
 * Transaktion ermittelt. Alle Funktionen mit `tx` laufen in der Modul-Transaktion und rufen keine
 * Core-Dienste außer `core.permissions.has` (rein im Speicher) auf.
 */
import { sql, type SQL } from 'drizzle-orm';
import { core } from '$lib/server/core';
import { errors } from '$lib/server/core/errors';
import type { Tx } from '$lib/server/core/database/client';
import type { RequestContext } from '$lib/sdk/types';
import type { PrincipalType } from '$lib/sdk/types/sharing';
import { inList, rowsOf } from './db';
import { principalMatchSql } from './sharing';

export type ShareAccessLevel = 'read' | 'edit';

/** Zugriff auf ein Objekt (`isOwner` = Aufrufer ist Eigentümer*in) */
export interface ObjectAccess {
	level: ShareAccessLevel;
	isOwner: boolean;
}

/** Eine gespeicherte Freigabe */
export interface StoredShare {
	type: PrincipalType;
	id: string;
	level: ShareAccessLevel;
}

/** Freigabe-Tabelle eines Moduls: `<shareTable>(<fk>, principal_type, principal_id, level, created_by, created_at)` */
export interface ShareTable {
	/** z. B. `event_shares` */
	shareTable: string;
	/** Fremdschlüssel-Spalte auf das Objekt, z. B. `event_id` */
	fk: string;
}

export interface ShareAccessConfig extends ShareTable {
	/** Objekttabelle, z. B. `events` */
	table: string;
	/** Spalte der Eigentümer*in (Standard `owner_id`) */
	ownerColumn?: string;
	/** Rechte für „alles sehen“ / „alles bearbeiten“ */
	perms: { viewAll: string; editAll: string };
	/** Zusätzliche Lesefreigabe über eine Spalte des Objekts, z. B. `{ column: 'visibility', equals: 'public' }` */
	readIf?: { column: string; equals: string };
	/** Text für 404 (kein Zugriff / unbekannt) */
	notFoundText: string;
	/** Text für 403 (lesen ja, bearbeiten nein) */
	forbiddenText: string;
}

export interface ShareAccess {
	canEditAll(ctx: RequestContext): boolean;
	canViewAll(ctx: RequestContext): boolean;
	/** Zugriff des Kontexts auf ein Objekt oder `null` (nicht vorhanden / kein Zugriff) */
	resolveAccess(
		tx: Tx,
		ctx: RequestContext,
		id: string,
		keys: readonly string[]
	): Promise<ObjectAccess | null>;
	/** Wie `resolveAccess`, wirft aber `notFound` ohne Zugriff und `forbidden` bei fehlendem `edit` */
	requireAccess(
		tx: Tx,
		ctx: RequestContext,
		id: string,
		keys: readonly string[],
		need?: ShareAccessLevel
	): Promise<ObjectAccess>;
	/** SQL-Bedingung für Listen (`alias` = Alias der Objekttabelle): alles oder eigene + (`readIf`) + freigegebene */
	visibleFilter(ctx: RequestContext, keys: readonly string[], alias: string): SQL;
	/**
	 * Zugriffsstufe je Objekt für Listen (ein Abfrageschritt für alle Zeilen). Objekte ohne
	 * Bearbeiten-Treffer bekommen `read` (sie sind nur über Freigabe/`readIf`/`viewAll` sichtbar).
	 */
	accessForMany(
		tx: Tx,
		ctx: RequestContext,
		rows: readonly { id: string; ownerId: string }[],
		keys: readonly string[]
	): Promise<Map<string, ObjectAccess>>;
	/** Freigaben eines Objekts, stabil sortiert */
	loadShares(tx: Tx, id: string): Promise<StoredShare[]>;
	/** Freigaben eines Objekts vollständig ersetzen (`created_by` = Aufrufer) */
	replaceShares(
		tx: Tx,
		ctx: RequestContext,
		id: string,
		shares: readonly StoredShare[]
	): Promise<void>;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): ReturnType<typeof sql.identifier> {
	if (!IDENT_RE.test(name)) throw new Error(`Ungültiger SQL-Bezeichner: ${name}`);
	return sql.identifier(name);
}

const levelOf = (v: unknown): ShareAccessLevel => (String(v) === 'edit' ? 'edit' : 'read');

/** Höchste Freigabestufe des Aufrufers auf einer Liste von Objekten (z. B. Knoten + Vorfahren) */
export async function shareLevelOn(
	tx: Tx,
	table: ShareTable,
	ids: readonly string[],
	keys: readonly string[]
): Promise<ShareAccessLevel | null> {
	if (ids.length === 0 || keys.length === 0) return null;
	const rows = await rowsOf(
		tx,
		sql`SELECT DISTINCT s.level FROM ${ident(table.shareTable)} s
			WHERE s.${ident(table.fk)} IN (${inList(ids)}) AND ${principalMatchSql('s', keys)}`
	);
	if (rows.some((r) => r.level === 'edit')) return 'edit';
	return rows.length > 0 ? 'read' : null;
}

/** Freigaben mehrerer Objekte (`objectId` = Wert der Fremdschlüssel-Spalte), stabil sortiert */
export async function loadObjectShares(
	tx: Tx,
	table: ShareTable,
	ids: readonly string[]
): Promise<(StoredShare & { objectId: string })[]> {
	if (ids.length === 0) return [];
	const fk = ident(table.fk);
	const rows = await rowsOf(
		tx,
		sql`SELECT ${fk} AS object_id, principal_type, principal_id, level
			FROM ${ident(table.shareTable)}
			WHERE ${fk} IN (${inList(ids)})
			ORDER BY created_at, principal_type, principal_id`
	);
	return rows.map((r) => ({
		objectId: String(r.object_id),
		type: String(r.principal_type) as PrincipalType,
		id: String(r.principal_id),
		level: levelOf(r.level)
	}));
}

/**
 * Freigaben eines Objekts vollständig ersetzen. Doppelte Principals in `shares` (verhindern die
 * Eingabeschemas bereits) überschreiben sich – die letzte Stufe gewinnt.
 */
export async function replaceObjectShares(
	tx: Tx,
	ctx: RequestContext,
	table: ShareTable,
	id: string,
	shares: readonly StoredShare[]
): Promise<void> {
	const shareTable = ident(table.shareTable);
	const fk = ident(table.fk);
	await tx.execute(sql`DELETE FROM ${shareTable} WHERE ${fk} = ${id}`);
	for (const s of shares) {
		await tx.execute(
			sql`INSERT INTO ${shareTable} (${fk}, principal_type, principal_id, level, created_by)
				VALUES (${id}, ${s.type}, ${s.id}, ${s.level}, ${ctx.userId ?? null})
				ON CONFLICT (${fk}, principal_type, principal_id) DO UPDATE SET level = EXCLUDED.level`
		);
	}
}

/** Zugriffsbaustein für ein Objekt mit Eigentümer*in und `<obj>_shares` (siehe Dateikopf) */
export function createShareAccess(config: ShareAccessConfig): ShareAccess {
	const table = ident(config.table);
	const shareTable = ident(config.shareTable);
	const fk = ident(config.fk);
	const ownerName = config.ownerColumn ?? 'owner_id';
	const owner = ident(ownerName);
	const readIf = config.readIf ? { col: ident(config.readIf.column), ...config.readIf } : null;

	const canEditAll = (ctx: RequestContext): boolean =>
		ctx.actor.type === 'system' || core.permissions.has(ctx, config.perms.editAll);
	const canViewAll = (ctx: RequestContext): boolean =>
		canEditAll(ctx) || core.permissions.has(ctx, config.perms.viewAll);

	async function resolveAccess(
		tx: Tx,
		ctx: RequestContext,
		id: string,
		keys: readonly string[]
	): Promise<ObjectAccess | null> {
		const columns = readIf
			? sql`${owner} AS owner, ${readIf.col} AS read_if`
			: sql`${owner} AS owner`;
		const [obj] = await rowsOf(tx, sql`SELECT ${columns} FROM ${table} WHERE id = ${id}`);
		if (!obj) return null;
		const isOwner = !!ctx.userId && String(obj.owner) === ctx.userId;

		if (canEditAll(ctx)) return { level: 'edit', isOwner };
		if (isOwner) return { level: 'edit', isOwner: true };

		const shares = await rowsOf(
			tx,
			sql`SELECT s.level FROM ${shareTable} s
				WHERE s.${fk} = ${id} AND ${principalMatchSql('s', keys)}`
		);
		if (shares.some((s) => s.level === 'edit')) return { level: 'edit', isOwner: false };
		if (
			shares.length > 0 ||
			(readIf !== null && obj.read_if === readIf.equals) ||
			core.permissions.has(ctx, config.perms.viewAll)
		) {
			return { level: 'read', isOwner: false };
		}
		return null;
	}

	return {
		canEditAll,
		canViewAll,
		resolveAccess,
		async requireAccess(tx, ctx, id, keys, need = 'read') {
			const access = await resolveAccess(tx, ctx, id, keys);
			if (!access) throw errors.notFound(config.notFoundText);
			if (need === 'edit' && access.level !== 'edit') throw errors.forbidden(config.forbiddenText);
			return access;
		},
		visibleFilter(ctx, keys, alias) {
			if (canViewAll(ctx)) return sql`TRUE`;
			const a = ident(alias);
			const uid = ctx.userId ?? '';
			const extra = readIf ? sql` OR ${a}.${readIf.col} = ${readIf.equals}` : sql``;
			return sql`(${a}.${owner} = ${uid}${extra} OR EXISTS (
				SELECT 1 FROM ${shareTable} s WHERE s.${fk} = ${a}.id AND ${principalMatchSql('s', keys)}
			))`;
		},
		async accessForMany(tx, ctx, rows, keys) {
			const map = new Map<string, ObjectAccess>();
			if (rows.length === 0) return map;
			const editAll = canEditAll(ctx);
			const editShared = new Set<string>();
			if (!editAll) {
				const shareRows = await rowsOf(
					tx,
					sql`SELECT DISTINCT s.${fk} AS object_id FROM ${shareTable} s
						WHERE s.level = 'edit'
							AND s.${fk} IN (${inList(rows.map((r) => r.id))})
							AND ${principalMatchSql('s', keys)}`
				);
				for (const r of shareRows) editShared.add(String(r.object_id));
			}
			for (const r of rows) {
				const isOwner = !!ctx.userId && r.ownerId === ctx.userId;
				const edit = editAll || isOwner || editShared.has(r.id);
				map.set(r.id, { level: edit ? 'edit' : 'read', isOwner });
			}
			return map;
		},
		async loadShares(tx, id) {
			const rows = await loadObjectShares(tx, config, [id]);
			return rows.map(({ type, id: principalId, level }) => ({ type, id: principalId, level }));
		},
		replaceShares(tx, ctx, id, shares) {
			return replaceObjectShares(tx, ctx, config, id, shares);
		}
	};
}
