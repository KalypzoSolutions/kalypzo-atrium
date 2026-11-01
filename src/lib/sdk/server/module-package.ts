import type { ModuleManifest } from '$lib/sdk/types';

/** Die Felder aus `atrium-module.json`, die `manifestFromPackage` liest (Prüfung beim Registrieren). */
interface PackageLike {
	id: string;
	name: string;
	description?: string;
	version: string;
	dependencies?: Record<string, unknown>;
	optionalDependencies?: Record<string, unknown>;
}

/**
 * Übernimmt Kennung, Name, Beschreibung, Version und Abhängigkeiten aus `atrium-module.json` ins Manifest –
 * die JSON-Datei ist dafür die einzige Quelle:
 *
 * ```ts
 * import pkg from './atrium-module.json';
 * export default defineModule({ package: pkg, manifest: { ...manifestFromPackage(pkg), permissions, navigation } });
 * ```
 */
export function manifestFromPackage(
	pkg: PackageLike
): Pick<
	ModuleManifest,
	'id' | 'name' | 'description' | 'version' | 'dependencies' | 'optionalDependencies'
> {
	return {
		id: pkg.id,
		name: pkg.name,
		...(pkg.description ? { description: pkg.description } : {}),
		version: pkg.version,
		dependencies: Object.keys(pkg.dependencies ?? {}),
		optionalDependencies: Object.keys(pkg.optionalDependencies ?? {})
	};
}
