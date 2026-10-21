import { readdirSync } from 'node:fs';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/**
 * Offene Verstöße gegen die Modulgrenze (#44), je Datei die ausnahmsweise erlaubten Importpfade. Liegen in
 * Dateien, die gerade andere Arbeitspakete ändern; beim Beheben den Eintrag hier löschen.
 */
const OPEN_BOUNDARY_EXCEPTIONS = {};

export default ts.config(
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'node_modules/',
			'drizzle/',
			'playwright-report/',
			'test-results/',
			'coverage/',
			// Lokale Demo-/Testdaten (PGlite, Screenshots, Skripte) – im sauberen Checkout nicht vorhanden
			'.data/',
			// Eigene App mit eigener Lint-Konfiguration (website/eslint.config.js)
			'website/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			// Leere catch-Blöcke verschlucken Fehler (#72) – mindestens begründen oder logBestEffort nutzen
			'no-empty': ['error', { allowEmptyCatch: false }],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'svelte/no-navigation-without-resolve': 'off',
			// Lokale, nicht reaktive Temporaerobjekte in Event-Handlern sind unproblematisch
			'svelte/prefer-svelte-reactivity': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser } }
	},
	...moduleBoundaryConfigs()
);

/**
 * Modulgrenzen (#44) und Core-Interna (#47) für `src/lib/modules/<id>/**` – je Modul ein Block, weil die
 * eigene Modul-ID erlaubt ist. Beschrieben in `docs/module-development.md` → „Erlaubte Importe“;
 * geprüft durch `tests/unit/module-boundaries.test.ts`.
 *
 * Erlaubt: `$lib/sdk/*`, `$lib/components/{ui,layout,forms}`, `$lib/forms`, `$lib/pdf-lists`, `$lib/utils`,
 * eigene Moduldateien und fremde Module NUR als `import type … from '$lib/modules/<anderes>/contract'`.
 * Die Core-Regeln (#47) erkennen nur direkte Zugriffe (`core.database.db`, kein Destrukturieren/Alias).
 */
function moduleBoundaryConfigs() {
	const ids = readdirSync(new URL('./src/lib/modules/', import.meta.url), { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name);
	const blocks = ids.map((id) => ({
		files: [`src/lib/modules/${id}/**/*.{ts,svelte}`],
		rules: moduleRules(id, ids, [])
	}));
	for (const [file, allowed] of Object.entries(OPEN_BOUNDARY_EXCEPTIONS)) {
		const id = file.split('/')[3];
		blocks.push({ files: [file], rules: moduleRules(id, ids, allowed) });
	}
	return blocks;
}

/** Regeln für Modul `id`; `allowed` = ausnahmsweise erlaubte Importpfade (siehe OPEN_BOUNDARY_EXCEPTIONS) */
function moduleRules(id, ids, allowed) {
	const docs = '(siehe docs/module-development.md → „Erlaubte Importe“)';
	const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const exceptions = allowed.map((a) => `(?!${escape(a)}$)`).join('');
	const relOthers = ids
		.filter((o) => o !== id)
		.flatMap((o) =>
			['../', '../../', '../../../', '../../../../'].flatMap((up) => [`${up}${o}`, `${up}${o}/**`])
		);
	return {
		'no-restricted-imports': 'off',
		'@typescript-eslint/no-restricted-imports': [
			'error',
			{
				patterns: [
					{
						group: ['$lib/server/*', '$lib/core/*', '../**/server/**'],
						message: `Module dürfen nicht auf $lib/server/* zugreifen – nur $lib/sdk/* ${docs}.`
					},
					{
						// Alles unter $lib außer der freigegebenen Oberfläche ($lib/modules regeln die Muster unten)
						regex:
							'^[$]lib/(?!(sdk|forms|pdf-lists|modules|server|core)(/|$)|utils([.]js)?$|components/(ui|layout|forms)(/|$))',
						message: `Nicht freigegebene $lib-Bibliothek für Module ${docs}.`
					},
					{
						// Fremde Module: alles außer ihrem Vertrag
						regex: `^${exceptions}[$]lib/modules/(?!${id}(/|$))[^/]+(/(?!contract$).*)?$`,
						message: `Fremde Module nur über ihren Vertrag: import type … from '$lib/modules/<id>/contract' ${docs}.`
					},
					{
						// Vertrag fremder Module: nur als Typ (Laufzeit über core.modules.use)
						regex: `^[$]lib/modules/(?!${id}/)[^/]+/contract$`,
						allowTypeImports: true,
						message: `Verträge fremder Module nur als \`import type\` (Laufzeit über core.modules.use) ${docs}.`
					},
					{
						group: relOthers,
						message: `Relative Importe in andere Module sind verboten – nur import type aus '$lib/modules/<id>/contract' ${docs}.`
					}
				]
			}
		],
		'no-restricted-syntax': [
			'error',
			{
				selector:
					"MemberExpression[object.object.name='core'][object.property.name='database'][property.name='db']",
				message: `core.database.db umgeht die Schema-Isolation – nur core.database.forModule(MODULE_ID) ${docs}.`
			},
			{
				selector: "MemberExpression[object.name='core'][property.name='system']",
				message: `core.system (Reset/Wartung) ist Core-intern ${docs}.`
			},
			{
				selector:
					"MemberExpression[object.object.name='core'][object.property.name='modules'][property.name=/^(enable|disable)$/]",
				message: `Module aktivieren/deaktivieren darf nur die Verwaltung, kein Modul ${docs}.`
			},
			{
				selector:
					"MemberExpression[object.object.name='core'][object.property.name='auth'][property.name='instance']",
				message: `core.auth.instance (Better Auth) ist Core-intern ${docs}.`
			},
			{
				selector: `CallExpression[callee.property.name='forModule'][arguments.0.type='Literal'][arguments.0.value!='${id}']`,
				message: `forModule(...) nur mit der eigenen Modul-ID ('${id}' bzw. MODULE_ID) ${docs}.`
			}
		]
	};
}
