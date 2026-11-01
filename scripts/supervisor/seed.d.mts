// Typen für scripts/supervisor/seed.mjs

export interface SeedSource {
	owner: string;
	repo: string;
	path: string;
	commit: string;
	modules: string[] | null;
	contentHashes: Record<string, string>;
}

export declare function parseSeed(json: unknown): { sources: SeedSource[] };
export declare function readSeed(
	coreRoot: string,
	env?: Record<string, string | undefined>
): { sources: SeedSource[]; hash: string } | null;
export declare function extractSeedModules(
	zip: Uint8Array,
	path: string,
	wanted: string[] | null,
	coreRoot: string
): Record<
	string,
	{ dir: string; files: Map<string, Uint8Array>; pkg: { id: string; version: string } }
>;
export declare function writeModuleFiles(dir: string, files: Map<string, Uint8Array>): void;
export declare function downloadZipball(
	owner: string,
	repo: string,
	commit: string,
	env?: Record<string, string | undefined>
): Promise<Uint8Array>;
