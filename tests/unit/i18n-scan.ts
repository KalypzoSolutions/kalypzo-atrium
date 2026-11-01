/**
 * Findet fest eingetragene Oberflächentexte im Core (`src/**`), die über `t()` laufen müssten (Phase N).
 * Genutzt von `i18n-guard.test.ts`; einzeln aufrufbar mit `I18N_GUARD_PATHS=src/routes/login,src/lib/x.ts`.
 *
 * Svelte: Textknoten und Text-Attribute (`placeholder`, `title`, `aria-label`, `label` …) sowie deutsche
 * Zeichenketten in Ausdrücken/Skripten. TypeScript: Zeichenketten, die nach deutschem Text aussehen (Umlaute
 * oder häufige Wörter), außer Importpfade, Schlüssel, `t()`-Argumente, `console.*`, `new Error(…)` (Programmierfehler)
 * und Typen. Kommentare zählen nie.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { parse } from 'svelte/compiler';

export interface Finding {
	file: string;
	line: number;
	text: string;
}

const ROOT = join(__dirname, '..', '..');

/** Nie geprüft: Texte selbst, Typdeklarationen, Daten (Suchbegriffe), SQL */
const SKIP = [
	/^src\/lib\/i18n\//,
	/\.d\.ts$/,
	/^src\/lib\/sdk\/icons\/(keywords-de|data)/,
	/^src\/lib\/server\/core\/database\//
];

const TEXT_ATTRS = new Set([
	'placeholder',
	'title',
	'aria-label',
	'aria-description',
	'alt',
	'label',
	'description',
	'hint',
	'emptyLabel',
	'emptyText',
	'emptyResultText',
	'searchLabel',
	'everyoneLabel',
	'confirmLabel',
	'cancelLabel',
	'message',
	'heading',
	'subtitle',
	'legend',
	'tooltip',
	'text',
	'value-label',
	'loadingLabel',
	'busyLabel'
]);

const GERMAN_WORDS =
	/(^|[^\p{L}])(der|die|das|dem|den|des|und|oder|nicht|kein|keine|keinen|keiner|mit|für|bitte|ist|sind|wird|werden|wurde|wurden|kann|können|darf|dürfen|muss|müssen|noch|schon|alle|alles|neu|neue|neuen|neuer|bearbeiten|speichern|gespeichert|löschen|gelöscht|abbrechen|schließen|anlegen|angelegt|hinzufügen|entfernen|entfernt|suchen|ungültig|ungültige|unbekannt|unbekannte|fehlt|fehlen|gefunden|Fehler|Datei|Dateien|Benutzer|Benutzerin|Rolle|Rollen|Rechte|Recht|Berechtigung|Einstellung|Einstellungen|Seite|Zurück|Weiter|Beschreibung|Ja|Nein|Laden|Lädt|Speichert|eine|einer|einen|einem|zum|zur|vom|beim|auf|aus|bei|nach|über|unter|bis|seit|wenn|dann|als|auch|nur|mehr|wieder|jetzt|heute|gestern|morgen|Tag|Tage|Woche|Monat|Jahr|Uhr|Anmeldung|Konto|Passwort|Sitzung)(?=$|[^\p{L}])/iu;

export function looksGerman(s: string): boolean {
	const v = s.trim();
	if (!v) return false;
	if (/[äöüÄÖÜß]/.test(v)) return true;
	// Bezeichner, Pfade, Schlüssel, CSS-Klassen: keine Leerzeichen und nur ASCII-Kleinschreibung/Ziffern/Zeichen
	if (!/\s/.test(v) && !/^[A-ZÄÖÜ][a-zäöüß]{2,}$/.test(v)) return false;
	return GERMAN_WORDS.test(v);
}

/** Sichtbarer Text in Markup: mindestens zwei Buchstaben, nicht nur Abkürzungen/Zahlen/Zeichen */
export function isVisibleText(s: string): boolean {
	const v = s.replace(/&[a-z]+;|&#\d+;/gi, ' ').trim();
	if (!/\p{L}{2,}/u.test(v)) return false;
	if (/^[\p{Lu}\d\s.,:;/+\-–—·()%&#|×*@'"!?]+$/u.test(v)) return false; // PDF, CSV, 2FA, S3, A4 …
	return true;
}

function lineOf(src: string, offset: number): number {
	let n = 1;
	for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
	return n;
}

// ---------------------------------------------------------------------------------------------
// TypeScript (auch Skripte und Ausdrücke in Svelte)
// ---------------------------------------------------------------------------------------------

const IGNORED_CALLS = new Set(['t', 'tl', 'localized', 'require', 'import']);
const IGNORED_MEMBER_CALLS =
	/^(console\.\w+|logError|logBestEffort|bestEffort|describe|it|test|expect|vi\.\w+)$/;

function calleeName(expr: ts.Expression): string {
	if (ts.isIdentifier(expr)) return expr.text;
	if (ts.isPropertyAccessExpression(expr))
		return `${calleeName(expr.expression)}.${expr.name.text}`;
	return '';
}

function ignoredContext(node: ts.Node): boolean {
	for (
		let p: ts.Node | undefined = node.parent, child: ts.Node = node;
		p;
		child = p, p = p.parent
	) {
		if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportTypeNode(p))
			return true;
		if (ts.isLiteralTypeNode(p) || ts.isTypeNode(p)) return true;
		if (ts.isPropertyAssignment(p) && p.name === child) return true;
		if (ts.isElementAccessExpression(p) && p.argumentExpression === child) return true;
		if (ts.isTaggedTemplateExpression(p)) {
			const tag = calleeName(p.tag);
			if (tag === 'sql' || tag.endsWith('.raw') || tag === 'html') return true;
		}
		if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && /Error$/.test(p.expression.text))
			return true;
		if (ts.isCallExpression(p)) {
			const name = calleeName(p.expression);
			const last = name.split('.').pop() ?? '';
			if (IGNORED_CALLS.has(last) || IGNORED_MEMBER_CALLS.test(name)) return true;
		}
		if (ts.isCaseClause(p) || ts.isBinaryExpression(p)) {
			// Vergleiche (`x === 'aus'`) sind Werte, keine Texte
			if (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText()))
				return true;
		}
		if (ts.isFunctionLike(p) || ts.isSourceFile(p)) break;
	}
	return false;
}

export function scanTs(source: string, file: string, lineOffset = 0, isTsx = false): Finding[] {
	const sf = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	);
	const out: Finding[] = [];
	const visit = (node: ts.Node) => {
		let text: string | null = null;
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
		else if (ts.isTemplateExpression(node))
			text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' … ');
		if (text !== null && looksGerman(text) && !ignoredContext(node)) {
			const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
			out.push({ file, line: line + 1 + lineOffset, text: text.slice(0, 120) });
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return out;
}

// ---------------------------------------------------------------------------------------------
// Svelte
// ---------------------------------------------------------------------------------------------

type AnyNode = { type?: string; start?: number; end?: number; [k: string]: unknown };

function walk(
	node: unknown,
	fn: (n: AnyNode, parent: AnyNode | null) => boolean | void,
	parent: AnyNode | null = null
): void {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const n of node) walk(n, fn, parent);
		return;
	}
	const n = node as AnyNode;
	if (n.type && fn(n, parent) === false) return;
	for (const [k, v] of Object.entries(n)) {
		if (k === 'parent' || k === 'metadata' || k === 'loc') continue;
		if (v && typeof v === 'object') walk(v, fn, n.type ? n : parent);
	}
}

export function scanSvelte(source: string, file: string): Finding[] {
	const out: Finding[] = [];
	let ast: AnyNode;
	try {
		ast = parse(source, { modern: true }) as unknown as AnyNode;
	} catch (e) {
		return [{ file, line: 1, text: `Parserfehler: ${(e as Error).message}` }];
	}
	// Skripte als TypeScript prüfen
	for (const key of ['instance', 'module'] as const) {
		const script = ast[key] as AnyNode | null;
		if (!script) continue;
		const content = script.content as AnyNode;
		const start = Number(content.start ?? 0);
		const end = Number(content.end ?? 0);
		const code = source.slice(start, end);
		out.push(...scanTs(code, file, lineOf(source, start) - 1));
	}
	// Markup: Text, Text-Attribute, Ausdrücke
	walk(ast.fragment, (n, parent) => {
		if (n.type === 'Text') {
			const data = String(n.data ?? n.raw ?? '');
			const inAttr = parent?.type === 'Attribute';
			if (inAttr) return;
			if (isVisibleText(data))
				out.push({ file, line: lineOf(source, Number(n.start)), text: data.trim().slice(0, 120) });
			return;
		}
		if (n.type === 'Attribute') {
			const name = String(n.name);
			const value = n.value;
			if (Array.isArray(value) && TEXT_ATTRS.has(name)) {
				for (const part of value as AnyNode[]) {
					if (part.type === 'Text' && isVisibleText(String(part.data ?? '')))
						out.push({
							file,
							line: lineOf(source, Number(part.start)),
							text: `${name}="${String(part.data).trim().slice(0, 100)}"`
						});
				}
			}
			return;
		}
		if (n.type === 'ExpressionTag' || n.type === 'AttachTag') {
			const expr = n.expression as AnyNode;
			const code = source.slice(Number(expr.start), Number(expr.end));
			out.push(...scanTs(`(${code})`, file, lineOf(source, Number(expr.start)) - 1));
			return false;
		}
		if (n.type === 'Attribute' || n.type === 'StyleDirective' || n.type === 'ClassDirective')
			return;
		if (n.type === 'RegularElement' && (n.name === 'style' || n.name === 'script')) return false;
		return;
	});
	return out;
}

// ---------------------------------------------------------------------------------------------

function listFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) listFiles(p, out);
		else if (/\.(svelte|ts)$/.test(name)) out.push(p);
	}
	return out;
}

export function coreFiles(filter = process.env.I18N_GUARD_PATHS): string[] {
	const prefixes = (filter ?? '')
		.split(',')
		.map((s) => s.trim().replace(/\\/g, '/'))
		.filter(Boolean);
	return listFiles(join(ROOT, 'src'))
		.map((p) => relative(ROOT, p).split(sep).join('/'))
		.filter((f) => !SKIP.some((r) => r.test(f)))
		.filter((f) => !prefixes.length || prefixes.some((p) => f.startsWith(p)))
		.sort();
}

export function scanFile(file: string): Finding[] {
	const src = readFileSync(join(ROOT, file), 'utf8');
	return file.endsWith('.svelte') ? scanSvelte(src, file) : scanTs(src, file);
}

export function scanCore(filter?: string): Finding[] {
	return coreFiles(filter).flatMap(scanFile);
}
