// Typen für scripts/supervisor/bundles.mjs (reines JavaScript; Deklaration für Tests und Editoren)

export declare const ACTIVE_FILE: string;
export declare const PREV_FILE: string;
export declare const NEXT_FILE: string;
export declare const LOCK_FILE: string;
export declare const FAILURES_FILE: string;

export interface LockEntry {
	version: string;
	sourceType: 'github' | 'upload' | 'builtin' | string;
	source: Record<string, unknown>;
	commit: string | null;
	contentHash: string;
}

export interface Active {
	version: 1;
	modules: Record<string, { dir: string }>;
}

export interface Lock {
	lockVersion: 1;
	core: string;
	modules: Record<string, LockEntry>;
}

export interface CompileJob {
	id: string;
	source: string;
	build: string;
	dir: string;
	reuse: boolean;
	requested: boolean;
}

export declare function bundleBuildId(contentHash: string, abi: string): string;
export declare function writeJsonAtomic(file: string, value: unknown): void;
export declare function readActive(bundlesDir: string, file?: string): Active;
export declare function readLock(bundlesDir: string, coreVersion: string): Lock;
export declare function readMeta(bundlesDir: string, dir: string): Record<string, unknown> | null;
export declare function staleModules(bundlesDir: string, active: Active, abi: string): string[];
export declare function planCompile(o: {
	bundlesDir: string;
	active: Active;
	lock: Lock;
	request: { modules?: Record<string, LockEntry>; remove?: string[] };
	recompile?: string[];
	abi: string;
	stagingDir: string | null;
}): { next: Active; nextLock: Lock; jobs: CompileJob[] };
export declare function unreferencedBuilds(bundlesDir: string, keep: Active[]): string[];
