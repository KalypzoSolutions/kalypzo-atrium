/**
 * Analyse eines gefundenen Moduls gegen den installierten Stand – ohne Modulcode auszuführen:
 * Art der Änderung, Core-Version, Rechte, Migrationen (veränderte bereits angewendete Migration sperrt),
 * npm-Pakete (Überschneidung mit dem Core) und Hinweise aus einem Import-Scan.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import semver from 'semver';
import { localized, t } from '$lib/i18n';
import { getDb, schema } from '../../database/client';
import { CORE_PACKAGES, CORE_VERSION } from '../../version';
import { canonicalChecksumFor } from '../migration-checksum';
import { versionSatisfies } from '../package/schema';
import { getDefinition, getModulePackage } from '../registry';
import { RESERVED_MODULE_IDS } from '../types';
import type { DiscoveredModule } from './discover';
import { runtimeModulesDir } from './supervisor-link';

export type InstallAction = 'install' | 'update' | 'reinstall' | 'unchanged' | 'downgrade';

export interface NpmCheck {
	name: string;
	version: string;
	/** `core`: liefert der Core in passender Version; `new`: wird mit installiert; `conflict`: passt nicht */
	status: 'core' | 'new' | 'conflict';
	coreRange?: string;
}

export interface ModuleAnalysis {
	id: string;
	name: string;
	description: string;
	version: string;
	installedVersion: string | null;
	action: InstallAction;
	coreRange: string;
	permissionsAdded: string[];
	permissionsRemoved: string[];
	/** Noch nicht angewendete Migrationen (laufen beim Aktivieren bzw. Start) */
	newMigrations: string[];
	npm: NpmCheck[];
	contentHash: string;
	fileCount: number;
	/** Unterschied zu den Dateien im laufenden Modulverzeichnis (nur bei vorhandenem Modul) */
	fileChanges: { added: string[]; changed: string[]; removed: string[] } | null;
	/** Sperrt die Installation */
	blockers: string[];
	/** Hinweise (Installation möglich) */
	warnings: string[];
}

/** Auffällige Muster in Moduldateien (nur Hinweise – Module haben ohnehin volle Rechte) */
const SCAN: { re: RegExp; text: string }[] = [
	{ re: /from\s+['"]\$lib\/server\//, text: 'install.analyze.scan.serverImport' },
	{ re: /['"](node:)?child_process['"]/, text: 'install.analyze.scan.childProcess' },
	{ re: /process\.env\b/, text: 'install.analyze.scan.env' },
	{ re: /\beval\s*\(|new\s+Function\s*\(/, text: 'install.analyze.scan.eval' },
	{ re: /['"](node:)?(fs|fs\/promises)['"]/, text: 'install.analyze.scan.fs' },
	{ re: /['"](node:)?(net|dgram|tls)['"]/, text: 'install.analyze.scan.net' }
];

export function scanSources(files: Map<string, Uint8Array>): string[] {
	const found = new Map<string, string>();
	const decoder = new TextDecoder();
	for (const [path, data] of files) {
		if (!/\.(ts|js|mjs|svelte)$/.test(path) || path.startsWith('tests/') || path.startsWith('e2e/'))
			continue;
		const src = decoder.decode(data);
		for (const s of SCAN) if (!found.has(s.text) && s.re.test(src)) found.set(s.text, path);
	}
	return [...found].map(([key, path]) => t('install.analyze.scanHit', { text: t(key), path }));
}

/** Dateien des Moduls im laufenden Modulverzeichnis gegen den neuen Stand (Listen je höchstens 200) */
export function installedFileChanges(
	id: string,
	next: Map<string, Uint8Array>
): ModuleAnalysis['fileChanges'] {
	const dir = join(runtimeModulesDir(), id);
	if (!existsSync(dir)) return null;
	const current = new Map<string, Uint8Array>();
	const walk = (d: string) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) {
				if (name !== 'node_modules') walk(p);
			} else current.set(relative(dir, p).split(sep).join('/'), new Uint8Array(readFileSync(p)));
		}
	};
	walk(dir);
	const same = (a: Uint8Array, b: Uint8Array) =>
		a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));
	const added = [...next.keys()].filter((k) => !current.has(k)).sort();
	const removed = [...current.keys()].filter((k) => !next.has(k)).sort();
	const changed = [...next.keys()]
		.filter((k) => current.has(k) && !same(current.get(k)!, next.get(k)!))
		.sort();
	return {
		added: added.slice(0, 200),
		changed: changed.slice(0, 200),
		removed: removed.slice(0, 200)
	};
}

export async function analyzeModule(mod: DiscoveredModule): Promise<ModuleAnalysis> {
	const { pkg } = mod;
	const blockers: string[] = [];
	const warnings: string[] = [];
	if (RESERVED_MODULE_IDS.has(pkg.id))
		blockers.push(t('install.analyze.reservedId', { id: pkg.id }));
	if (!versionSatisfies(CORE_VERSION, pkg.core)) {
		blockers.push(t('install.analyze.coreVersion', { range: pkg.core, version: CORE_VERSION }));
	}

	const db = getDb();
	const [state] = await db
		.select()
		.from(schema.moduleState)
		.where(eq(schema.moduleState.id, pkg.id));
	const [lock] = await db
		.select()
		.from(schema.moduleInstall)
		.where(eq(schema.moduleInstall.id, pkg.id));
	const def = getDefinition(pkg.id);
	// Auch kopiert/gebaut, aber noch nicht geladen (Neustart ausstehend): Wunschzustand `module_install`
	const installedVersion =
		def?.manifest.version ?? lock?.version ?? state?.installedVersion ?? null;
	let action: InstallAction = 'install';
	if (installedVersion) {
		const cmp = semver.valid(installedVersion) ? semver.compare(pkg.version, installedVersion) : 1;
		if (cmp > 0) action = 'update';
		else if (cmp < 0) action = 'downgrade';
		else action = lock?.contentHash === mod.contentHash ? 'unchanged' : 'reinstall';
	}
	if (action === 'downgrade') {
		warnings.push(t('install.analyze.downgrade', { version: installedVersion ?? '' }));
	}
	if (action === 'reinstall' && def) {
		warnings.push(t('install.analyze.reinstall'));
	}

	// Rechte
	const before = new Set(def?.manifest.permissions ?? getModulePackage(pkg.id)?.permissions ?? []);
	const after = new Set(pkg.permissions);
	const permissionsAdded = [...after].filter((p) => !before.has(p)).sort();
	const permissionsRemoved = def ? [...before].filter((p) => !after.has(p)).sort() : [];

	// Migrationen gegen bereits angewendete
	const applied = await db
		.select()
		.from(schema.moduleMigration)
		.where(eq(schema.moduleMigration.moduleId, pkg.id));
	const byName = new Map(mod.migrations.map((m) => [m.name, m.sql]));
	for (const row of applied) {
		const sql = byName.get(row.name);
		if (sql === undefined) {
			blockers.push(t('install.analyze.migrationMissing', { name: row.name }));
		} else if (!canonicalChecksumFor(row.checksum, sql)) {
			blockers.push(t('install.analyze.migrationChanged', { name: row.name }));
		}
	}
	const appliedNames = new Set(applied.map((r) => r.name));
	const newMigrations = mod.migrations.map((m) => m.name).filter((n) => !appliedNames.has(n));
	const lastApplied = [...appliedNames].sort().pop();
	if (lastApplied && newMigrations.some((n) => n < lastApplied)) {
		blockers.push(t('install.analyze.migrationOrder'));
	}

	// npm-Pakete
	const npm: NpmCheck[] = Object.entries(pkg.npm).map(([name, version]) => {
		const coreRange = CORE_PACKAGES[name];
		if (!coreRange) return { name, version, status: 'new' };
		const ok = semver.validRange(coreRange) && semver.satisfies(version, coreRange);
		return { name, version, status: ok ? 'core' : 'conflict', coreRange };
	});
	for (const n of npm.filter((x) => x.status === 'conflict')) {
		blockers.push(
			t('install.analyze.npmConflict', {
				name: n.name,
				version: n.version,
				range: n.coreRange ?? ''
			})
		);
	}
	if (npm.some((n) => n.status === 'new')) {
		warnings.push(t('install.analyze.npmNew'));
	}

	warnings.push(...scanSources(mod.files));
	const fileChanges = installedFileChanges(pkg.id, mod.files);
	return {
		id: pkg.id,
		name: localized(pkg.name),
		description: localized(pkg.description),
		version: pkg.version,
		installedVersion,
		action,
		coreRange: pkg.core,
		permissionsAdded,
		permissionsRemoved,
		newMigrations,
		npm,
		contentHash: mod.contentHash,
		fileCount: mod.files.size,
		fileChanges,
		blockers,
		warnings
	};
}
