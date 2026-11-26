// @ts-check
/**
 * Modul-Compiler: schreibt im fertigen Chunk die Importe der Host-ABI (`atrium-host:<schlüssel>`) in Zugriffe auf die
 * Registry des Core um – das Bundle bekommt so dieselben Instanzen (Svelte-Laufzeit, `$app/*`, SDK …) wie der Core.
 *
 *   import * as $ from 'atrium-host:svelte/internal/client'   →  const $ = __atriumHost.get('svelte/internal/client');
 *   import { a, b as c } from 'atrium-host:k'                  →  const __h0 = __atriumHost.get('k', ['a','b']);
 *                                                                 const a = __h0['a']; const c = __h0['b'];
 *   import D from 'atrium-host:k'                              →  … const D = __h0.default;
 *   import 'atrium-host:k'                                     →  (entfällt; der Lader hat vorgeladen)
 *   export { a as b } from 'atrium-host:k'                     →  const __h0 = …; const __hx0 = __h0['a']; export { __hx0 as b };
 *   import('atrium-host:k')                                    →  Promise.resolve(__atriumHost.get('k'))
 *   export * from 'atrium-host:k'                              →  Fehler (Exportliste zur Bauzeit unbekannt)
 *
 * Werte werden beim Laden kopiert (keine Live-Bindings) – die geteilten Exporte sind Funktionen, Klassen, Objekte.
 */
import * as acorn from 'acorn';
import MagicString from 'magic-string';

export const HOST_PREFIX = 'atrium-host:';
const REF = 'globalThis.__atriumHost';

/**
 * @param {string} code
 * @returns {{ code: string, used: Map<string, Set<string>> }} `used`: Schlüssel → benötigte Exportnamen
 */
export function rewriteHostImports(code) {
	/** @type {Map<string, Set<string>>} */
	const used = new Map();
	if (!code.includes(HOST_PREFIX)) return { code, used };
	const ast = /** @type {any} */ (
		acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
	);
	const s = new MagicString(code);
	let n = 0;
	const need = (/** @type {string} */ key, /** @type {string[]} */ names) => {
		const set = used.get(key) ?? new Set();
		for (const x of names) set.add(x);
		used.set(key, set);
	};
	const keyOf = (/** @type {any} */ src) =>
		typeof src?.value === 'string' && src.value.startsWith(HOST_PREFIX)
			? src.value.slice(HOST_PREFIX.length)
			: null;
	const nameOf = (/** @type {any} */ id) => (id.type === 'Literal' ? String(id.value) : id.name);
	const get = (/** @type {string} */ key, /** @type {string[]} */ names) =>
		`${REF}.get(${JSON.stringify(key)}${names.length ? `, ${JSON.stringify([...new Set(names)])}` : ''})`;

	for (const node of ast.body) {
		if (node.type === 'ImportDeclaration') {
			const key = keyOf(node.source);
			if (!key) continue;
			if (!node.specifiers.length) {
				need(key, []);
				s.remove(node.start, node.end);
				continue;
			}
			const names = node.specifiers
				.filter((/** @type {any} */ sp) => sp.type === 'ImportSpecifier')
				.map((/** @type {any} */ sp) => nameOf(sp.imported));
			if (node.specifiers.some((/** @type {any} */ sp) => sp.type === 'ImportDefaultSpecifier'))
				names.push('default');
			need(key, names);
			const ns = `__atriumHost$${n++}`;
			let out = `const ${ns} = ${get(key, names)};`;
			for (const sp of node.specifiers) {
				const local = sp.local.name;
				if (sp.type === 'ImportNamespaceSpecifier') out += ` const ${local} = ${ns};`;
				else if (sp.type === 'ImportDefaultSpecifier') out += ` const ${local} = ${ns}.default;`;
				else out += ` const ${local} = ${ns}[${JSON.stringify(nameOf(sp.imported))}];`;
			}
			s.overwrite(node.start, node.end, out);
		} else if (node.type === 'ExportAllDeclaration') {
			const key = keyOf(node.source);
			if (key)
				throw new Error(
					`„export * from '${key}'“ geht über die Host-ABI nicht – Exporte einzeln nennen`
				);
		} else if (node.type === 'ExportNamedDeclaration' && node.source) {
			const key = keyOf(node.source);
			if (!key) continue;
			const names = node.specifiers.map((/** @type {any} */ sp) => nameOf(sp.local));
			need(key, names);
			const ns = `__atriumHost$${n++}`;
			let out = `const ${ns} = ${get(key, names)};`;
			const exports = [];
			for (const sp of node.specifiers) {
				const tmp = `__atriumHostExport$${n++}`;
				out += ` const ${tmp} = ${ns}[${JSON.stringify(nameOf(sp.local))}];`;
				exports.push(
					`${tmp} as ${sp.exported.type === 'Literal' ? JSON.stringify(sp.exported.value) : sp.exported.name}`
				);
			}
			out += ` export { ${exports.join(', ')} };`;
			s.overwrite(node.start, node.end, out);
		}
	}

	// Dynamische Importe überall im Code (auch in Funktionen)
	walk(ast, (/** @type {any} */ node) => {
		if (node.type !== 'ImportExpression') return;
		const key = keyOf(node.source);
		if (!key) return;
		need(key, []);
		s.overwrite(node.start, node.end, `Promise.resolve(${get(key, [])})`);
	});

	return { code: s.toString(), used };
}

/**
 * @param {any} node
 * @param {(node: any) => void} visit
 */
function walk(node, visit) {
	if (!node || typeof node.type !== 'string') return;
	visit(node);
	for (const key of Object.keys(node)) {
		if (key === 'start' || key === 'end' || key === 'loc') continue;
		const v = node[key];
		if (Array.isArray(v)) for (const c of v) walk(c, visit);
		else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, visit);
	}
}
