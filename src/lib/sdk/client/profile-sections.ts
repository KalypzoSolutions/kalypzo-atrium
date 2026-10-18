import type { ProfileSection } from '$lib/sdk/types/module-ui';

/** Abschnitt mit Modul-ID (Ergebnis von `selectProfileSections`). */
export interface ResolvedProfileSection extends ProfileSection {
	/** `<moduleId>:<id>` – eindeutig ueber alle Module */
	key: string;
	moduleId: string;
}

/**
 * Waehlt die Profil-Abschnitte aktiver Module: nur Module in `activeModules`, nur mit vorhandenem Recht
 * (`permission` leer = fuer alle), sortiert nach `order` (Standard 100), dann Modul-ID und Abschnitts-ID.
 * Reine Funktion (Unit-Test: `tests/unit/profile-sections.test.ts`).
 */
export function selectProfileSections(
	byModule: Record<string, readonly ProfileSection[] | undefined>,
	activeModules: readonly string[],
	permissions: readonly string[]
): ResolvedProfileSection[] {
	const active = new Set(activeModules);
	const perms = new Set(permissions);
	const out: ResolvedProfileSection[] = [];
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
