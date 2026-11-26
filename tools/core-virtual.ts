/**
 * Virtuelle Module des Core – gemeinsam für das Vite-Plugin (`tools/vite-plugin-atrium-modules.ts`) und
 * `bun test` (`tests/bun/preload.ts`). Ersetzen `import.meta.glob`, das es nur in Vite gibt.
 *
 * - `virtual:atrium-core/messages` – Core-Texte `src/lib/i18n/messages/<sprache>/<bereich>.json`:
 *   `eager` (Deutsch, sofort geladen) und `lazy` (alle Sprachen, Lazy-Loader); Schlüssel wie früher bei
 *   `import.meta.glob`: `./messages/<sprache>/<bereich>.json`
 * - `virtual:atrium-core/pdf-templates` – Default-Exporte aller `src/lib/server/core/pdf/templates/*.ts`
 * - `virtual:atrium-core/fonts` – Carlito als Data-URLs (`regular`, `bold`), wie früher Vites `?inline`
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_ROOT } from './modules-dir.js';

export const CORE_MESSAGES_ID = 'virtual:atrium-core/messages';
export const PDF_TEMPLATES_ID = 'virtual:atrium-core/pdf-templates';
export const FONTS_ID = 'virtual:atrium-core/fonts';

const posix = (p: string) => p.replace(/\\/g, '/');
const I18N_DIR = posix(join(CORE_ROOT, 'src', 'lib', 'i18n'));
const TEMPLATES_DIR = posix(join(CORE_ROOT, 'src', 'lib', 'server', 'core', 'pdf', 'templates'));
const EAGER_LOCALE = 'de';

function messageFiles(): { key: string; file: string; locale: string }[] {
	const root = join(I18N_DIR, 'messages');
	if (!existsSync(root)) return [];
	const out: { key: string; file: string; locale: string }[] = [];
	for (const locale of readdirSync(root).sort()) {
		const dir = join(root, locale);
		if (!/^[a-z]{2}$/.test(locale)) continue;
		for (const f of readdirSync(dir).sort()) {
			if (!f.endsWith('.json')) continue;
			out.push({
				key: `./messages/${locale}/${f}`,
				file: `${I18N_DIR}/messages/${locale}/${f}`,
				locale
			});
		}
	}
	return out;
}

export function coreMessagesSource(): string {
	const files = messageFiles();
	const eager = files.filter((f) => f.locale === EAGER_LOCALE);
	const imports = eager.map((f, i) => `import m${i} from ${JSON.stringify(f.file)};`);
	const eagerEntries = eager.map((f, i) => `\t${JSON.stringify(f.key)}: m${i}`);
	const lazyEntries = files.map(
		(f) =>
			`\t${JSON.stringify(f.key)}: () => import(${JSON.stringify(f.file)}).then((m) => m.default)`
	);
	return [
		...imports,
		`export const eager = {\n${eagerEntries.join(',\n')}\n};`,
		`export const lazy = {\n${lazyEntries.join(',\n')}\n};`
	].join('\n');
}

export function pdfTemplatesSource(): string {
	const files = existsSync(TEMPLATES_DIR)
		? readdirSync(TEMPLATES_DIR)
				.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'))
				.sort()
		: [];
	const imports = files.map(
		(f, i) => `import t${i} from ${JSON.stringify(`${TEMPLATES_DIR}/${f}`)};`
	);
	return [
		...imports,
		`export const templates = [${files.map((_, i) => `t${i}`).join(', ')}];`
	].join('\n');
}

const FONTS_DIR = join(CORE_ROOT, 'src', 'lib', 'server', 'core', 'pdf', 'assets', 'fonts');

/** Carlito Regular/Bold als `data:font/ttf;base64,…` (Briefvorlagen laden nie externe Schriften) */
export function fontsSource(): string {
	const dataUrl = (file: string) =>
		`data:font/ttf;base64,${readFileSync(join(FONTS_DIR, file)).toString('base64')}`;
	return [
		`export const regular = ${JSON.stringify(dataUrl('Carlito-Regular.ttf'))};`,
		`export const bold = ${JSON.stringify(dataUrl('Carlito-Bold.ttf'))};`
	].join('\n');
}
