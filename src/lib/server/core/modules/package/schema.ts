/**
 * Paketformat der Fachmodule (Kalypzo Atrium, Phase 2).
 *
 * - `modules/<id>/atrium-module.json` beschreibt ein Modul **statisch** (wird nie ausgeführt): Grundlage für die
 *   Installationsvorschau, die Abhängigkeitsauflösung und die Lock-Datei. `module.ts` übernimmt Kennung, Name,
 *   Version und Abhängigkeiten per `manifestFromPackage` von hier; der Start prüft, dass beides übereinstimmt.
 * - `atrium-modules.json` (Katalog) listet die Module eines Repositorys.
 *
 * Bewusst ohne `$lib`-Importe: wird auch vom Vite-Plugin und von Werkzeugen außerhalb der App gelesen.
 */
import semver from 'semver';
import { z } from 'zod';

export const MODULE_PACKAGE_FILE = 'atrium-module.json';
export const MODULE_CATALOG_FILE = 'atrium-modules.json';
export const MODULE_PACKAGE_SCHEMA_VERSION = 1;

const ID = /^[a-z][a-z0-9-]{1,30}$/;
const PERMISSION = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
/** npm-Paketname (mit optionalem Scope) */
const NPM_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * Quelle eines Moduls: `github:<owner>/<repo>[/<pfad>][#<ref>]` oder
 * `https://github.com/<owner>/<repo>[/tree/<ref>[/<pfad>]]`.
 */
export interface ModuleSource {
	type: 'github';
	owner: string;
	repo: string;
	path: string;
	/** Branch, Tag oder Commit; `null` = Standard-Branch */
	ref: string | null;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const SAFE_PATH = (p: string) =>
	p === '' || p.split('/').every((s) => SEGMENT.test(s) && s !== '.' && s !== '..');
const SAFE_REF = /^[A-Za-z0-9_./-]{1,200}$/;

/** Liest eine Quellangabe; `null` bei ungültigem Format. */
export function parseModuleSource(raw: string): ModuleSource | null {
	const value = raw.trim();
	let owner: string, repo: string, path: string, ref: string | null;
	const short = /^github:([^/#\s]+)\/([^/#\s]+)((?:\/[^#\s]+)?)(?:#(\S+))?$/.exec(value);
	if (short) {
		[owner, repo, path, ref] = [
			short[1]!,
			short[2]!,
			short[3]!.replace(/^\//, ''),
			short[4] ?? null
		];
	} else {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			return null;
		}
		if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search || url.hash)
			return null;
		const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
		if (parts.length < 2) return null;
		owner = parts[0]!;
		repo = parts[1]!.replace(/\.git$/, '');
		if (parts.length === 2) [path, ref] = ['', null];
		else if (parts[2] === 'tree' && parts.length >= 4) {
			// Mehrdeutig bei Branches mit „/“: hier gilt das erste Segment als Ref (Auflösung über die API in Phase 5)
			ref = parts[3]!;
			path = parts.slice(4).join('/');
		} else return null;
	}
	path = path.replace(/\/+$/, '');
	if (!SEGMENT.test(owner) || !SEGMENT.test(repo) || !SAFE_PATH(path)) return null;
	if (ref !== null && (!SAFE_REF.test(ref) || ref.includes('..'))) return null;
	return { type: 'github', owner, repo, path, ref };
}

/** Kurzform `github:owner/repo[/pfad][#ref]` */
export function formatModuleSource(s: ModuleSource): string {
	return `github:${s.owner}/${s.repo}${s.path ? `/${s.path}` : ''}${s.ref ? `#${s.ref}` : ''}`;
}

const dependencySchema = z.strictObject({
	/** SemVer-Bereich, z. B. `^1.14.0` */
	version: z.string().refine((v) => semver.validRange(v) !== null, 'Ungültiger Versionsbereich'),
	/** Woher das Modul geholt wird, wenn es fehlt (sonst: gleiches Repository/Katalog) */
	source: z
		.string()
		.refine((v) => parseModuleSource(v) !== null, 'Ungültige Quelle (github:owner/repo/pfad#ref)')
		.optional()
});

const dependencyMap = z
	.record(z.string().regex(ID, 'Ungültige Modul-ID'), dependencySchema)
	.default({});

export const modulePackageSchema = z
	.strictObject({
		$schema: z.string().optional(),
		schema: z.literal(MODULE_PACKAGE_SCHEMA_VERSION),
		id: z.string().regex(ID, 'Ungültige Modul-ID'),
		name: z.string().trim().min(1).max(80),
		description: z.string().max(500).optional(),
		version: z.string().refine((v) => semver.valid(v) !== null, 'Version muss SemVer sein'),
		/** Passende Core-Versionen (SemVer-Bereich) */
		core: z.string().refine((v) => semver.validRange(v) !== null, 'Ungültiger Versionsbereich'),
		dependencies: dependencyMap,
		optionalDependencies: dependencyMap,
		permissions: z.array(z.string().regex(PERMISSION, 'Ungültiges Recht')).default([]),
		/** Nur modulspezifische npm-Pakete mit exakter Version (Plattform-Pakete liefert der Core) */
		npm: z
			.record(
				z.string().regex(NPM_NAME, 'Ungültiger Paketname'),
				z.string().refine((v) => semver.valid(v) !== null, 'Exakte Version nötig')
			)
			.default({}),
		/** Herkunft (Anzeige), z. B. `github:org/ep-intern-modules` */
		repository: z.string().optional()
	})
	.superRefine((p, ctx) => {
		for (const k of Object.keys(p.dependencies)) {
			if (k === p.id)
				ctx.addIssue({
					code: 'custom',
					path: ['dependencies', k],
					message: 'Modul hängt von sich selbst ab'
				});
			if (k in p.optionalDependencies)
				ctx.addIssue({
					code: 'custom',
					path: ['optionalDependencies', k],
					message: 'Zugleich harte Abhängigkeit'
				});
		}
		if (p.id in p.optionalDependencies)
			ctx.addIssue({
				code: 'custom',
				path: ['optionalDependencies', p.id],
				message: 'Modul hängt von sich selbst ab'
			});
		for (const perm of p.permissions) {
			if (!perm.startsWith(`${p.id}.`))
				ctx.addIssue({
					code: 'custom',
					path: ['permissions'],
					message: `Recht „${perm}“ gehört nicht zum Modul`
				});
		}
	});

export type ModulePackage = z.infer<typeof modulePackageSchema>;

export const moduleCatalogSchema = z.strictObject({
	$schema: z.string().optional(),
	schema: z.literal(MODULE_PACKAGE_SCHEMA_VERSION),
	name: z.string().trim().min(1).max(120),
	description: z.string().max(500).optional(),
	modules: z
		.array(
			z.strictObject({
				id: z.string().regex(ID, 'Ungültige Modul-ID'),
				/** Ordner relativ zum Katalog */
				path: z.string().refine((p) => p !== '' && SAFE_PATH(p), 'Ungültiger Pfad')
			})
		)
		.min(1)
		.max(200)
		.refine((m) => new Set(m.map((x) => x.id)).size === m.length, 'Modul-IDs doppelt')
});

export type ModuleCatalog = z.infer<typeof moduleCatalogSchema>;

/** Prüft ein Paket; wirft mit lesbarer Meldung. */
export function parseModulePackage(raw: unknown, where = MODULE_PACKAGE_FILE): ModulePackage {
	const r = modulePackageSchema.safeParse(raw);
	if (r.success) return r.data;
	const msg = r.error.issues
		.map((i) => `${i.path.join('.') || '(Wurzel)'}: ${i.message}`)
		.join('; ');
	throw new Error(`${where}: ${msg}`);
}

/** Passt `version` zum Bereich? Vorabversionen (`2.0.0-pre.1`) zählen mit. */
export function versionSatisfies(version: string, range: string): boolean {
	return semver.satisfies(version, range, { includePrerelease: true });
}
