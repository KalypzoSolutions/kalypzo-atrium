/**
 * Modulgrenzen (#44) und Core-Interna (#47) für `<Modulverzeichnis>/<id>/**` – früher ESLint
 * (`no-restricted-imports`/`no-restricted-syntax` je Modul), jetzt eigener Prüfer über den TypeScript-AST, weil die
 * Regeln von der eigenen Modul-ID und vom Modulverzeichnis (`ATRIUM_MODULES_DIR`) abhängen und eine statische
 * `biome.json` das nicht abbilden kann. Beschrieben in `docs/module-development.md` → „Erlaubte Importe“.
 *
 * Erlaubt: `$lib/sdk/*`, `$lib/components/{ui,layout,forms}`, `$lib/forms`, `$lib/pdf-lists`, `$lib/utils`,
 * eigene Moduldateien und fremde Module NUR als `import type … from '$modules/<anderes>/contract'`.
 * Die Core-Regeln (#47) erkennen nur direkte Zugriffe (`core.database.db`, kein Destrukturieren/Alias).
 * Tests der Module (`<id>/tests/**`, `_integration/**`) sind ausgenommen.
 *
 * Aufruf: `bun tools/module-boundaries.ts` (Exit-Code 1 bei Verstößen), Test `tests/unit/module-boundaries.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { moduleIds, modulesDir } from './modules-dir.js';

export interface BoundaryViolation {
	/** Pfad relativ zum Modulverzeichnis, mit `/` */
	file: string;
	line: number;
	message: string;
}

const DOCS = '(siehe docs/module-development.md → „Erlaubte Importe“)';
const ALLOWED_LIB =
	/^\$lib\/(?:(?:sdk|forms|pdf-lists)(?:\/|$)|utils(?:\.js)?$|components\/(?:ui|layout|forms)(?:\/|$))/;

/** Prüft den Quelltext einer Datei des Moduls `ownId`; `file` ist absolut oder relativ zum Modulverzeichnis. */
export function checkModuleSource(
	code: string,
	opts: { file: string; ownId: string; ids: string[]; dir?: string }
): BoundaryViolation[] {
	const dir = (opts.dir ?? modulesDir()).replace(/\\/g, '/');
	const abs = resolve(dir, opts.file).replace(/\\/g, '/');
	const rel = relative(dir, abs).split(sep).join('/');
	const out: BoundaryViolation[] = [];
	for (const block of scriptBlocks(abs, code)) {
		const sf = ts.createSourceFile(abs, block.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		const report = (node: ts.Node, message: string) => {
			const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
			out.push({ file: rel, line: line + 1 + block.lineOffset, message });
		};
		const checkSource = (spec: ts.Node, source: string, typeOnly: boolean) => {
			const msg = importViolation(source, typeOnly, abs, opts.ownId, opts.ids, dir);
			if (msg) report(spec, msg);
		};
		const visit = (node: ts.Node) => {
			if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
				checkSource(node, node.moduleSpecifier.text, !!node.importClause?.isTypeOnly);
			} else if (
				ts.isExportDeclaration(node) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				checkSource(node, node.moduleSpecifier.text, node.isTypeOnly);
			} else if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword &&
				node.arguments[0] &&
				ts.isStringLiteralLike(node.arguments[0])
			) {
				checkSource(node, node.arguments[0].text, false);
			} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
				const lit = node.argument.literal;
				if (ts.isStringLiteral(lit)) checkSource(node, lit.text, true);
			} else if (ts.isPropertyAccessExpression(node)) {
				const msg = coreInternalViolation(node);
				if (msg) report(node, msg);
			} else if (ts.isCallExpression(node)) {
				const msg = forModuleViolation(node, opts.ownId);
				if (msg) report(node, msg);
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
	return out;
}

function importViolation(
	source: string,
	typeOnly: boolean,
	file: string,
	ownId: string,
	ids: string[],
	dir: string
): string | null {
	if (
		/^\$lib\/(?:server|core)(?:\/|$)/.test(source) ||
		/^\.\.\/(?:.*\/)?server(?:\/|$)/.test(source)
	)
		return `Module dürfen nicht auf $lib/server/* zugreifen – nur $lib/sdk/* ${DOCS}.`;
	if (source.startsWith('$lib/') && !ALLOWED_LIB.test(source))
		return `Nicht freigegebene $lib-Bibliothek für Module ${DOCS}.`;
	const mod = /^\$modules\/([^/]+)(\/.*)?$/.exec(source);
	if (mod && mod[1] !== ownId) {
		if (mod[2] !== '/contract')
			return `Fremde Module nur über ihren Vertrag: import type … from '$modules/<id>/contract' ${DOCS}.`;
		if (!typeOnly)
			return `Verträge fremder Module nur als \`import type\` (Laufzeit über core.modules.use) ${DOCS}.`;
	}
	if (source.startsWith('.')) {
		const target = relative(dir, resolve(dirname(file), source))
			.split(sep)
			.join('/');
		const first = target.split('/')[0];
		// Aufgelöst ins Nachbarmodul oder (wie früher die ESLint-Muster) `../…/<anderes Modul>` in beliebiger Tiefe
		const named = /^(?:\.\.\/)+([^./][^/]*)/.exec(source)?.[1];
		const hit = (x: string | undefined) => !!x && x !== ownId && ids.includes(x);
		if (hit(first) || hit(named))
			return `Relative Importe in andere Module sind verboten – nur import type aus '$modules/<id>/contract' ${DOCS}.`;
	}
	return null;
}

/** `core.database.db|transaction`, `core.system`, `core.modules.enable|disable`, `core.auth.instance` */
function coreInternalViolation(node: ts.PropertyAccessExpression): string | null {
	const name = node.name.text;
	const obj = node.expression;
	if (ts.isIdentifier(obj) && obj.text === 'core' && name === 'system')
		return `core.system (Reset/Wartung) ist Core-intern ${DOCS}.`;
	if (
		ts.isPropertyAccessExpression(obj) &&
		ts.isIdentifier(obj.expression) &&
		obj.expression.text === 'core'
	) {
		const area = obj.name.text;
		if (area === 'database' && (name === 'db' || name === 'transaction'))
			return `core.database.${name} umgeht die Schema-Isolation – nur core.database.forModule(MODULE_ID) ${DOCS}.`;
		if (area === 'modules' && (name === 'enable' || name === 'disable'))
			return `Module aktivieren/deaktivieren darf nur die Verwaltung, kein Modul ${DOCS}.`;
		if (area === 'auth' && name === 'instance')
			return `core.auth.instance (Better Auth) ist Core-intern ${DOCS}.`;
	}
	return null;
}

/** `….forModule('<fremde ID>')` */
function forModuleViolation(node: ts.CallExpression, ownId: string): string | null {
	const callee = node.expression;
	const arg = node.arguments[0];
	if (
		ts.isPropertyAccessExpression(callee) &&
		callee.name.text === 'forModule' &&
		arg &&
		ts.isStringLiteralLike(arg) &&
		arg.text !== ownId
	)
		return `forModule(...) nur mit der eigenen Modul-ID ('${ownId}' bzw. MODULE_ID) ${DOCS}.`;
	return null;
}

/** TS/JS komplett, bei `.svelte` die `<script>`-Blöcke mit Zeilenversatz */
export function scriptBlocks(file: string, code: string): { code: string; lineOffset: number }[] {
	if (!file.endsWith('.svelte')) return [{ code, lineOffset: 0 }];
	const blocks: { code: string; lineOffset: number }[] = [];
	// Attributwerte in Anführungszeichen überspringen: `generics="T extends Foo<Bar>"` enthält ein `>`
	for (const m of code.matchAll(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script>/g)) {
		const body = m[1] ?? '';
		const start = (m.index ?? 0) + m[0].length - '</script>'.length - body.length;
		blocks.push({ code: body, lineOffset: code.slice(0, start).split('\n').length - 1 });
	}
	return blocks;
}

/** Alle Quelldateien eines Moduls außer Tests */
function moduleFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? ['tests', 'node_modules'].includes(e.name)
				? []
				: moduleFiles(join(dir, e.name))
			: /\.(?:ts|js|mjs|svelte)$/.test(e.name)
				? [join(dir, e.name)]
				: []
	);
}

/** Prüft alle installierten Module im Modulverzeichnis */
export function checkAllModules(dir = modulesDir()): BoundaryViolation[] {
	const ids = moduleIds(dir);
	return ids.flatMap((id) =>
		moduleFiles(join(dir, id)).flatMap((file) =>
			checkModuleSource(readFileSync(file, 'utf8'), { file, ownId: id, ids, dir })
		)
	);
}

if (import.meta.main) {
	const found = checkAllModules();
	for (const v of found) console.error(`${v.file}:${v.line}  ${v.message}`);
	const n = moduleIds().length;
	if (found.length) {
		console.error(`\n${found.length} Verstöße gegen die Modulgrenzen in ${n} Modulen.`);
		process.exit(1);
	}
	console.log(`Modulgrenzen: ${n} Module geprüft, keine Verstöße.`);
}
