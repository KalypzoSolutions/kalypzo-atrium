/**
 * Module in einem entpackten Repository finden (ohne Code auszuführen):
 * 1. Katalog `atrium-modules.json` im Basisordner → dessen Einträge,
 * 2. sonst `<basis>/modules/*` bzw. `<basis>/*` mit `atrium-module.json`,
 * 3. sonst `<basis>/atrium-module.json` (Ein-Modul-Repository bzw. Link direkt auf einen Modulordner).
 * Jeder Modulordner braucht `atrium-module.json` und `module.ts`; die Ordner-ID muss zur Paket-ID passen.
 */
import { errors } from '../../errors';
import {
	MODULE_CATALOG_FILE,
	MODULE_PACKAGE_FILE,
	moduleCatalogSchema,
	parseModulePackage,
	type ModulePackage
} from '../package/schema';
import { contentHash, type ArchiveFiles } from './archive';

export interface DiscoveredModule {
	id: string;
	/** Ordner im Archiv (ohne abschließenden `/`) */
	dir: string;
	pkg: ModulePackage;
	/** Dateien relativ zum Modulordner */
	files: ArchiveFiles;
	/** `migrations/*.sql` nach Name sortiert */
	migrations: { name: string; sql: string }[];
	contentHash: string;
}

export interface DiscoveredRepo {
	/** Name aus dem Katalog bzw. `null` */
	catalogName: string | null;
	modules: DiscoveredModule[];
	/** Ordner, die wie Module aussehen, aber nicht lesbar sind (Grund) */
	problems: { dir: string; reason: string }[];
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const join = (...p: string[]) => p.filter(Boolean).join('/');
/** Byte-Order-Mark am Dateianfang (manche Editoren schreiben sie in JSON) */
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

function parseJson(files: ArchiveFiles, path: string): unknown {
	const data = files.get(path);
	if (!data) return undefined;
	try {
		return JSON.parse(text(data).replace(BOM, ''));
	} catch {
		throw errors.validation([{ path: ['archive'], message: `${path} ist kein gültiges JSON` }]);
	}
}

function readModule(files: ArchiveFiles, dir: string, expectedId?: string): DiscoveredModule {
	const pkg = parseModulePackage(
		parseJson(files, join(dir, MODULE_PACKAGE_FILE)),
		join(dir, MODULE_PACKAGE_FILE)
	);
	if (expectedId && pkg.id !== expectedId) {
		throw new Error(`Katalog nennt „${expectedId}“, atrium-module.json „${pkg.id}“`);
	}
	if (!files.has(join(dir, 'module.ts'))) throw new Error('module.ts fehlt');
	const prefix = dir ? `${dir}/` : '';
	const own: ArchiveFiles = new Map();
	for (const [k, v] of files) if (k.startsWith(prefix)) own.set(k.slice(prefix.length), v);
	const folder = dir.split('/').pop() ?? '';
	if (dir && folder !== pkg.id) {
		throw new Error(`Ordner „${folder}“ passt nicht zur Modul-ID „${pkg.id}“`);
	}
	const migrations = [...own.keys()]
		.filter((k) => /^migrations\/[^/]+\.sql$/.test(k))
		.sort()
		.map((k) => ({ name: k.slice('migrations/'.length, -4), sql: text(own.get(k)!) }));
	return { id: pkg.id, dir, pkg, files: own, migrations, contentHash: contentHash(own) };
}

/** Module unterhalb von `base` (Pfad im Archiv, leer = Wurzel) finden */
export function discoverModules(files: ArchiveFiles, base = ''): DiscoveredRepo {
	const b = base.replace(/^\/+|\/+$/g, '');
	if (b && ![...files.keys()].some((k) => k.startsWith(`${b}/`))) {
		throw errors.notFound(`Ordner „${b}“ gibt es im Repository nicht`);
	}
	const problems: DiscoveredRepo['problems'] = [];
	const modules: DiscoveredModule[] = [];
	const tryRead = (dir: string, expectedId?: string) => {
		try {
			modules.push(readModule(files, dir, expectedId));
		} catch (e) {
			problems.push({ dir: dir || '.', reason: e instanceof Error ? e.message : String(e) });
		}
	};

	const catalogRaw = parseJson(files, join(b, MODULE_CATALOG_FILE));
	if (catalogRaw !== undefined) {
		const r = moduleCatalogSchema.safeParse(catalogRaw);
		if (!r.success) {
			throw errors.validation([
				{
					path: ['archive'],
					message: `${MODULE_CATALOG_FILE}: ${r.error.issues[0]?.message ?? 'ungültig'}`
				}
			]);
		}
		for (const m of r.data.modules) tryRead(join(b, m.path), m.id);
		return { catalogName: r.data.name, modules, problems };
	}

	if (files.has(join(b, MODULE_PACKAGE_FILE))) {
		tryRead(b);
		return { catalogName: null, modules, problems };
	}

	// Unterordner mit atrium-module.json (direkt bzw. unter modules/)
	const dirs = new Set<string>();
	for (const k of files.keys()) {
		const rel = b ? (k.startsWith(`${b}/`) ? k.slice(b.length + 1) : null) : k;
		if (!rel) continue;
		const m = /^(?:(modules)\/)?([^/]+)\/atrium-module\.json$/.exec(rel);
		if (m) dirs.add(join(b, m[1] ?? '', m[2]!));
	}
	for (const d of [...dirs].sort()) tryRead(d);
	if (!modules.length && !problems.length) {
		throw errors.validation([
			{
				path: ['archive'],
				message: `Keine Module gefunden (erwartet ${MODULE_CATALOG_FILE} oder ${MODULE_PACKAGE_FILE})`
			}
		]);
	}
	return { catalogName: null, modules, problems };
}
