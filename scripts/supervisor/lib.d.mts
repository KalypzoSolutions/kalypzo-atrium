// Typen für scripts/supervisor/lib.mjs (reines JavaScript; Deklaration für Tests und Editoren)

export declare const VERIFY_PREFIX: string;

export interface LockEntry {
	version: string;
	sourceType: 'github' | 'upload' | 'builtin';
	source: Record<string, unknown>;
	commit: string | null;
	contentHash: string;
}

export interface ModuleLock {
	lockVersion: 1;
	core: string;
	modules: Record<string, LockEntry>;
}

export declare function contentHashOfDir(dir: string): string;
export declare function moduleFolders(dir: string): string[];
export declare function modulePackagesFor(
	modulesDir: string,
	corePkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
): Record<string, string>;
export declare function mergeLock(
	prev: { modules?: Record<string, LockEntry> } | null,
	request: { modules?: Record<string, LockEntry>; remove?: string[] } | null,
	modulesDir: string,
	coreVersion: string
): ModuleLock;

export interface SupervisorOptions {
	coreRoot: string;
	dataDir: string;
	env?: Record<string, string | undefined>;
	baseModulesDir?: string;
	baseBuildDir?: string;
	healthTimeoutMs?: number;
	buildHeapMb?: number;
	log?: (msg: string) => void;
	/** GitHub-Archiv laden (Tests) */
	download?: (
		owner: string,
		repo: string,
		commit: string,
		env?: Record<string, string | undefined>
	) => Promise<Uint8Array>;
}

export declare class Supervisor {
	constructor(opts: SupervisorOptions);
	start(): Promise<void>;
	stop(): Promise<void>;
	/** Wartet, bis alle anstehenden Neubauten fertig sind */
	readonly queue: Promise<void>;
}

/** Entfernt Modul-Pakete, die der Core in derselben Hauptversion mitbringt (außer `wanted`); liefert die Namen */
export declare function dedupeModulePackages(
	modulesDir: string,
	coreRoot: string,
	wanted?: Record<string, string>
): string[];
