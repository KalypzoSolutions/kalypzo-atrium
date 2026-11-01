import pkg from '../../../../package.json';

/** Version des Core (Kalypzo Atrium) aus `package.json`; Module geben passende Bereiche in `atrium-module.json` → `core` an. */
export const CORE_VERSION: string = pkg.version;

/** npm-Pakete des Core (Plattform-Pakete, die Module mitnutzen) mit ihren Versionsbereichen */
export const CORE_PACKAGES: Readonly<Record<string, string>> = {
	...(pkg.devDependencies as Record<string, string>),
	...(pkg.dependencies as Record<string, string>)
};
