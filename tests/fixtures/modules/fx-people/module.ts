/**
 * Fixture-Modul „Personen“ (nur Tests des Core): Personenquelle für Freigaben an Principals
 * (`principals`, `provides` = `PrincipalProvider`) und Meldung gelöschter Personen (`core.modules.memberDeleted`).
 * Personen = „Mitglieder“, Teams = „Gruppen“. Absichtlich klein, ohne Oberfläche.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	core,
	defineEndpoint,
	defineModule,
	inList,
	manifestFromPackage,
	moduleDb,
	rowsOf
} from '$lib/sdk/server';
import type { PrincipalProvider } from '$lib/sdk/types/sharing';
import pkg from './atrium-module.json';
import m0001 from './migrations/0001_init.sql?raw';

/** Spaltenwert als Text (leer statt null) */
const text = (v: unknown): string => String(v ?? '');

export const MODULE_ID = 'fx-people';
export const PERM_VIEW = 'fx-people.person.view';
export const PERM_EDIT = 'fx-people.person.edit';

const db = () => moduleDb(MODULE_ID);

export const peopleProvider = {
	async listGroups() {
		const rows = await db().transaction((tx) =>
			rowsOf(tx, sql`SELECT id, name FROM teams ORDER BY name`)
		);
		return rows.map((r) => ({
			id: text(r.id),
			name: text(r.name),
			color: null,
			image: null,
			meetingWeekday: null,
			meetingTime: null,
			meetingEndTime: null,
			meetingPlace: null
		}));
	},
	async principalIdsForUser(userId: string) {
		return db().transaction(async (tx) => {
			const people = await rowsOf(
				tx,
				sql`SELECT id FROM people WHERE user_id = ${userId} AND left_on IS NULL`
			);
			const memberIds = people.map((p) => text(p.id));
			const teams = await rowsOf(
				tx,
				sql`SELECT DISTINCT team_id FROM team_people WHERE person_id IN (${inList(memberIds)})`
			);
			return { memberIds, groupIds: teams.map((t) => text(t.team_id)) };
		});
	},
	async searchMemberPrincipals(ctx, query) {
		if (ctx.actor.type !== 'system' && !core.permissions.has(ctx, PERM_VIEW)) return [];
		const limit = Math.min(query.limit ?? 20, 30);
		return db().transaction(async (tx) => {
			const where = query.ids
				? sql`p.id IN (${inList(query.ids.slice(0, 100))})`
				: sql`p.left_on IS NULL AND p.name ILIKE ${`%${(query.search ?? '').replace(/[%_\\]/g, '\\$&')}%`}`;
			const rows = await rowsOf(
				tx,
				sql`SELECT p.id, p.name,
				       COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name)) FILTER (WHERE t.id IS NOT NULL), '[]') AS groups
				    FROM people p
				    LEFT JOIN team_people tp ON tp.person_id = p.id
				    LEFT JOIN teams t ON t.id = tp.team_id
				    WHERE ${where}
				    GROUP BY p.id, p.name ORDER BY p.name LIMIT ${limit}`
			);
			return rows.map((r) => ({
				id: text(r.id),
				name: text(r.name),
				groups: (typeof r.groups === 'string' ? JSON.parse(r.groups) : r.groups) as {
					id: string;
					name: string;
				}[]
			}));
		});
	},
	async userIdsForPrincipals({ memberIds, groupIds }) {
		return db().transaction(async (tx) => {
			const rows = await rowsOf(
				tx,
				sql`SELECT DISTINCT p.user_id FROM people p
				    LEFT JOIN team_people tp ON tp.person_id = p.id
				    WHERE p.user_id IS NOT NULL AND p.left_on IS NULL
				      AND (p.id IN (${inList(memberIds)}) OR tp.team_id IN (${inList(groupIds)}))`
			);
			return rows.map((r) => text(r.user_id));
		});
	}
} satisfies PrincipalProvider;

const personInput = z.strictObject({
	name: z.string().trim().min(1).max(80),
	userId: z.string().min(1).nullable().default(null),
	teamIds: z.array(z.string()).max(20).default([])
});

export default defineModule({
	package: pkg,
	manifest: {
		...manifestFromPackage(pkg),
		permissions: [PERM_VIEW, PERM_EDIT],
		permissionDescriptions: {
			[PERM_VIEW]: 'Personen in Freigaben sehen',
			[PERM_EDIT]: 'Personen und Teams anlegen und löschen'
		},
		navigation: []
	},
	migrations: [{ name: '0001_init', sql: m0001 }],
	provides: peopleProvider,
	principals: { memberViewPermission: PERM_VIEW },
	endpoints: [
		defineEndpoint({
			method: 'POST',
			path: '/teams',
			summary: 'Team anlegen',
			permission: PERM_EDIT,
			body: z.strictObject({ name: z.string().trim().min(1).max(80) }),
			handler: async ({ body }) => {
				const id = crypto.randomUUID();
				await db().transaction((tx) =>
					tx.execute(sql`INSERT INTO teams (id, name) VALUES (${id}, ${body.name})`)
				);
				return { id };
			}
		}),
		defineEndpoint({
			method: 'POST',
			path: '/people',
			summary: 'Person anlegen',
			permission: PERM_EDIT,
			body: personInput,
			handler: async ({ body }) => {
				const id = crypto.randomUUID();
				await db().transaction(async (tx) => {
					await tx.execute(
						sql`INSERT INTO people (id, name, user_id) VALUES (${id}, ${body.name}, ${body.userId})`
					);
					for (const teamId of body.teamIds) {
						await tx.execute(
							sql`INSERT INTO team_people (team_id, person_id) VALUES (${teamId}, ${id})`
						);
					}
				});
				return { id };
			}
		}),
		defineEndpoint({
			method: 'DELETE',
			path: '/people/:id',
			summary: 'Person löschen (meldet sie an alle Module)',
			permission: PERM_EDIT,
			params: z.object({ id: z.string().min(1) }),
			handler: async ({ params }) => {
				await db().transaction((tx) => tx.execute(sql`DELETE FROM people WHERE id = ${params.id}`));
				const failed = await core.modules.memberDeleted(MODULE_ID, {
					memberIds: [params.id],
					reason: 'deleted'
				});
				return { id: params.id, failed };
			}
		})
	]
});
