// Typen für scripts/module-compiler/lib.mjs (reines JavaScript; Deklaration für Tests und den Lader im Core)

/** Inhalt von `meta.json` eines kompilierten Modul-Bundles */
export interface ModuleBundleMeta {
	metaVersion: 1;
	id: string;
	/** Anzeigename aus `atrium-module.json` (Text oder je Sprache) */
	name?: string | { de: string; en?: string };
	version: string;
	/** Inhaltshash des Modulordners (gleiche Regel wie Installation/Supervisor) */
	contentHash: string;
	/** Host-ABI, gegen die kompiliert wurde (`tools/host-abi.js` `hostAbiHash`) */
	abi: string;
	builtAt: string;
	server: {
		/** Pfad relativ zum Bundle-Ordner; Default-Export = Moduldefinition */
		module: string;
		/** vor dem Import von `module` vorzuladende Host-Schlüssel */
		moduleHost: string[];
		/** `ui.ts` für das Server-Rendering (oder `null`) */
		ui: string | null;
		uiHost: string[];
	};
	client: {
		/** Browser-Einstieg (Default-Export = `ModuleUi`) */
		entry: string;
		/** `<style>`-Blöcke der Svelte-Komponenten */
		css: string[];
		host: string[];
		/** Tailwind-Kandidaten des Moduls (für das gemeinsame Utilities-CSS der App) */
		tailwind: string[];
	};
	/** Namen der `migrations/*.sql` ohne Endung, sortiert */
	migrations: string[];
	/** Texte `messages/<sprache>.json` → Inhalt */
	messages: Record<string, unknown>;
}

export type CompileErrorKind = 'missingPackage' | 'forbiddenImport' | 'invalidModule' | 'build';

export declare const COMPILE_PREFIX: string;
export declare const META_FILE: string;
export declare const META_VERSION: 1;

export declare class CompileError extends Error {
	constructor(message: string, info: { kind: CompileErrorKind; name?: string });
	kind: CompileErrorKind;
	packageName: string | null;
}

export declare function unresolvedPackage(message: string): string | null;
export declare function coreFileIsPure(id: string): boolean;
export declare function removeWorkDir(dir: string): void;
export declare function installedPackageNames(nodeModules: string): string[];
export declare function tailwindCandidates(dir: string): Promise<string[]>;
export declare function compileModule(opts: {
	moduleDir: string;
	outDir: string;
	log?: (line: string) => void;
	installPackages?: boolean;
}): Promise<ModuleBundleMeta>;
