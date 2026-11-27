// Typen für scripts/supervisor/lib.mjs (reines JavaScript; Deklaration für Tests und Editoren)

export declare const VERIFY_PREFIX: string;

export type { LockEntry } from './bundles.mjs';

export declare function contentHashOfDir(dir: string): string;
export declare function moduleFolders(dir: string): string[];
export declare function crashDecision(opts: {
	crashes: number;
	current: string | null | undefined;
	previous: string | null | undefined;
	busy: boolean;
}): { action: 'restart' | 'fallback' | 'exit'; delayMs: number; waiting?: boolean };

export interface SupervisorOptions {
	coreRoot: string;
	dataDir: string;
	env?: Record<string, string | undefined>;
	baseModulesDir?: string;
	baseBuildDir?: string;
	healthTimeoutMs?: number;
	log?: (msg: string) => void;
	/** ABI-Kennung vorgeben (sonst aus `tools/host-abi.js`) */
	abi?: string;
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
	/** Wartet, bis alle anstehenden Aufträge fertig sind */
	readonly queue: Promise<void>;
}
