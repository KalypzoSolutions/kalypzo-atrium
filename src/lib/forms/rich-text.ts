/**
 * Formatierter Text (HTML aus dem `RichTextEditor`) als Knotenbaum für die Anzeige ohne `{@html}`.
 * Läuft im Browser und auf dem Server. Sicher durch Konstruktion: Es entstehen nur Elemente aus
 * `RICH_TAGS`, Links nur mit http(s)/mailto, alles andere wird zu Text (den Svelte escaped) oder entfällt.
 */

export const RICH_TAGS = [
	'p',
	'br',
	'strong',
	'b',
	'em',
	'i',
	'u',
	's',
	'ul',
	'ol',
	'li',
	'blockquote',
	'h2',
	'h3',
	'a',
	'hr'
] as const;
export type RichTag = (typeof RICH_TAGS)[number];

export type RichNode =
	| { type: 'text'; text: string }
	| { type: 'element'; tag: RichTag; href?: string; children: RichNode[] };

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'source', 'area']);
/** Inhalt dieser Tags wird komplett verworfen */
const DROP_CONTENT = new Set(['script', 'style', 'template', 'iframe', 'object', 'svg', 'math']);
const MAX_DEPTH = 20;

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0',
	shy: '\u00ad'
};

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const code =
				e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: '';
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

/** Nur http(s)- und mailto-Links */
export function safeHref(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const v = decodeEntities(raw).trim();
	if (/^mailto:[^\s]+$/i.test(v)) return v;
	try {
		const u = new URL(v);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
	} catch {
		return undefined;
	}
}

function attr(attrs: string, name: string): string | undefined {
	const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
	const m = re.exec(attrs);
	return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

const TAG_RE = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)>/g;

/** Zerlegt HTML in einen Knotenbaum (unbekannte Tags entfallen, ihr Text bleibt). */
export function parseRichText(html: string): RichNode[] {
	const root: RichNode[] = [];
	const stack: { tag: string; children: RichNode[]; keep: boolean }[] = [];
	let drop: string | null = null;
	const current = () => stack[stack.length - 1]?.children ?? root;
	const pushText = (t: string) => {
		if (drop || !t) return;
		const text = decodeEntities(t);
		const list = current();
		const last = list[list.length - 1];
		if (last?.type === 'text') last.text += text;
		else list.push({ type: 'text', text });
	};
	let pos = 0;
	for (const m of html.matchAll(TAG_RE)) {
		pushText(html.slice(pos, m.index));
		pos = m.index + m[0].length;
		if (!m[2]) continue; // Kommentar
		const closing = m[1] === '/';
		const tag = m[2].toLowerCase();
		if (drop) {
			if (closing && tag === drop) drop = null;
			continue;
		}
		if (DROP_CONTENT.has(tag)) {
			if (!closing && !/\/\s*$/.test(m[3] ?? '')) drop = tag;
			continue;
		}
		const allowed = (RICH_TAGS as readonly string[]).includes(tag);
		if (closing) {
			const at = stack.map((s) => s.tag).lastIndexOf(tag);
			if (at >= 0) stack.length = at;
			continue;
		}
		if (!allowed) {
			if (!VOID.has(tag) && stack.length < MAX_DEPTH) {
				// Unbekannter Container: Kinder an den Elternknoten hängen
				stack.push({ tag, children: current(), keep: false });
			}
			continue;
		}
		const node: RichNode = { type: 'element', tag: tag as RichTag, children: [] };
		if (tag === 'a') node.href = safeHref(attr(m[3] ?? '', 'href'));
		current().push(node);
		if (!VOID.has(tag) && stack.length < MAX_DEPTH) {
			stack.push({ tag, children: node.children, keep: true });
		}
	}
	pushText(html.slice(pos));
	return root;
}

/** Reiner Text (für Längen-/Leer-Prüfungen und Vorschauen) */
export function richTextToPlain(html: string): string {
	const out: string[] = [];
	const walk = (nodes: RichNode[]) => {
		for (const n of nodes) {
			if (n.type === 'text') out.push(n.text);
			else {
				if (n.tag === 'br') out.push('\n');
				walk(n.children);
				if (['p', 'li', 'h2', 'h3', 'blockquote'].includes(n.tag)) out.push('\n');
			}
		}
	};
	walk(parseRichText(html));
	return out
		.join('')
		.replace(/[ \t\u00a0]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Einfachen Text (Zeilenumbrüche) in Editor-HTML umwandeln, z. B. für alte Infotexte */
export function plainToRichText(text: string): string {
	const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]!);
	return text
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
		.join('');
}
