import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'node_modules/',
			'drizzle/',
			'playwright-report/',
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
	{
		// Module-Grenze: Module duerfen nur das oeffentliche SDK verwenden.
		files: ['src/lib/modules/**/*.{ts,svelte}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/server/*', '$lib/core/*', '../**/server/**'],
							message: 'Module duerfen nur $lib/sdk/* verwenden (siehe docs/module-development.md).'
						}
					]
				}
			]
		}
	}
);
