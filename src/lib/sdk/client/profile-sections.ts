import type { ProfileSection, UserAdminSection } from '$lib/sdk/types/module-ui';

/** Gemeinsame Form von Modul-Abschnitten (Profil, Benutzer-Dialog) */
interface SectionLike {
	id: string;
	order?: number;
	permission?: string;
}

/** Abschnitt mit Modul-ID (Ergebnis von `selectProfileSections`). */
export type Resolved<T extends SectionLike> = T & {
	/** `<moduleId>:<id>` – eindeutig über alle Module */
	key: string;
	moduleId: string;
};
export type ResolvedProfileSection = Resolved<ProfileSection>;
export type ResolvedUserAdminSection = Resolved<UserAdminSection>;

/**
 * Wählt die Profil-Abschnitte aktiver Module: nur Module in `activeModules`, nur mit vorhandenem Recht
 * (`permission` leer = für alle), sortiert nach `order` (Standard 100), dann Modul-ID und Abschnitts-ID.
 * Reine Funktion (Unit-Test: `tests/unit/profile-sections.test.ts`).
 */
export function selectProfileSections<T extends SectionLike = ProfileSection>(
	byModule: Record<string, readonly T[] | undefined>,
	activeModules: readonly string[],
	permissions: readonly string[]
): Resolved<T>[] {
	const active = new Set(activeModules);
	const perms = new Set(permissions);
	const out: Resolved<T>[] = [];
	for (const [moduleId, sections] of Object.entries(byModule)) {
		if (!active.has(moduleId)) continue;
		for (const s of sections ?? []) {
			if (s.permission && !perms.has(s.permission)) continue;
			out.push({ ...s, moduleId, key: `${moduleId}:${s.id}` });
		}
	}
	return out.sort(
		(a, b) =>
			(a.order ?? 100) - (b.order ?? 100) ||
			a.moduleId.localeCompare(b.moduleId) ||
			a.id.localeCompare(b.id)
	);
}

/** Gleiche Auswahl für die Abschnitte im Dialog „Benutzer bearbeiten“ (`ModuleUi.userAdminSections`) */
export const selectUserAdminSections = (
	byModule: Record<string, readonly UserAdminSection[] | undefined>,
	activeModules: readonly string[],
	permissions: readonly string[]
): ResolvedUserAdminSection[] => selectProfileSections(byModule, activeModules, permissions);
