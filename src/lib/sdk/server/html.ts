/**
 * Bereinigung von Rich-Text aus dem `RichTextEditor` (nur Server). Der Browser schickt HTML, der Server vertraut ihm nie:
 * Es bleiben nur einfache Formatierungen, http(s)/mailto-Links und – nur wenn erlaubt – Bilder als Verweis auf eine
 * Bild-ID des Moduls (`<img data-image-id="…" alt="…">`, nie ein freies `src`).
 */
import sanitizeHtml from 'sanitize-html';

/** Tags, die der `RichTextEditor` erzeugt (ohne Bilder) */
export const RICH_TEXT_TAGS: readonly string[] = [
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
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface SanitizeRichTextOptions {
	/**
	 * Bilder erlauben: Rückgabe `true` für Bild-IDs, die bleiben dürfen. Ohne Angabe entfallen alle Bilder.
	 * Erlaubte Bilder werden zu `<img data-image-id="<uuid>" alt="…">` (Alt-Text ≤ 300 Zeichen).
	 */
	images?: (id: string) => boolean;
}

/** Bereinigtes HTML-Fragment (Skripte, Event-Handler, fremde Tags und `javascript:`-Links entfallen) */
export function sanitizeRichText(html: string, options: SanitizeRichTextOptions = {}): string {
	const allowImage = options.images;
	return sanitizeHtml(html, {
		allowedTags: allowImage ? [...RICH_TEXT_TAGS, 'img'] : [...RICH_TEXT_TAGS],
		allowedAttributes: { a: ['href', 'target', 'rel'], img: ['data-image-id', 'alt'] },
		allowedSchemes: ['http', 'https', 'mailto'],
		allowedSchemesAppliedToAttributes: ['href'],
		allowProtocolRelative: false,
		transformTags: {
			a: (_tag, attribs) => ({
				tagName: 'a',
				attribs: { href: attribs.href ?? '', target: '_blank', rel: 'noopener noreferrer' }
			}),
			img: (_tag, attribs) => ({
				tagName: 'img',
				attribs: {
					'data-image-id': (attribs['data-image-id'] ?? '').toLowerCase(),
					alt: (attribs.alt ?? '').slice(0, 300)
				}
			})
		},
		exclusiveFilter: (frame) =>
			frame.tag === 'img' &&
			(!allowImage ||
				!UUID_RE.test(frame.attribs['data-image-id'] ?? '') ||
				!allowImage(frame.attribs['data-image-id'] ?? ''))
	}).trim();
}

/** Bild-IDs (`data-image-id`) in einem bereinigten Fragment, in Reihenfolge, ohne Duplikate */
export function richTextImageIds(html: string): string[] {
	const ids = new Set<string>();
	for (const m of html.matchAll(/data-image-id="([0-9a-f-]{36})"/g)) ids.add(m[1]!);
	return [...ids];
}

// --- Dokument-HTML (Export, PDF-Block `richText`) ----------------------------------------------------

/** Tags für ganze Dokumente: Rich-Text plus Überschriften, Tabellen, Code, Markierungen, Bilder, Aufgaben */
export const DOCUMENT_TAGS: readonly string[] = [
	...RICH_TEXT_TAGS,
	'h1',
	'h4',
	'h5',
	'h6',
	'table',
	'colgroup',
	'col',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'pre',
	'code',
	'span',
	'mark',
	'div',
	'img',
	'input'
];

/** Größte Bild-Data-URL im Dokument-HTML (Zeichen) */
export const MAX_DOCUMENT_IMAGE_CHARS = 10 * 1024 * 1024;

const DOC_IMAGE_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const COLOR_RE = [
	/^#[0-9a-f]{3}$/i,
	/^#[0-9a-f]{6}$/i,
	/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/i
];
/** 8–96 px bzw. 6–72 pt */
const FONT_SIZE_RE = [/^(?:[89]|[1-8]\d|9[0-6])(?:\.\d{1,2})?px$/, /^(?:[6-9]|[1-6]\d|7[0-2])pt$/];
const ALIGN_RE = [/^(?:left|right|center|justify)$/];
const WIDTH_RE = [/^\d{1,4}(?:\.\d{1,2})?px$/, /^\d{1,3}(?:\.\d{1,3})?%$/];
const SPAN_RE = /^(?:[1-9]|[1-9]\d)$/;
const PX_RE = /^\d{1,5}$/;

const textStyles = { color: COLOR_RE, 'background-color': COLOR_RE, 'font-size': FONT_SIZE_RE };
const blockStyles = { ...textStyles, 'text-align': ALIGN_RE };
const cellStyles = { ...blockStyles, width: WIDTH_RE, 'min-width': WIDTH_RE };

/** Nur Attribute behalten, deren Wert zum Muster passt */
function keepMatching(
	attribs: Record<string, string>,
	rules: Record<string, RegExp>
): Record<string, string> {
	const out = { ...attribs };
	for (const [k, re] of Object.entries(rules)) {
		if (out[k] !== undefined && !re.test(out[k])) delete out[k];
	}
	return out;
}

/**
 * Bereinigtes Dokument-HTML für Export und PDF (`core.pdf`-Block `richText`). Erlaubt sind nur die Tags aus
 * `DOCUMENT_TAGS`; `style` nur mit `color`, `background-color` (Hex/rgb()), `font-size` (8–96 px bzw. 6–72 pt), auf
 * Absätzen, Überschriften und Zellen zusätzlich `text-align` (Zellen/Spalten: `width`). Bilder nur als
 * `data:image/(png|jpeg|webp|gif);base64` bis `MAX_DOCUMENT_IMAGE_CHARS`, Links nur http/https/mailto, `input` nur als
 * gesperrte Checkbox (Aufgaben). Klassen nur aus einer festen Liste (Aufgaben, Platzhalter für eingebettete Inhalte).
 */
export function sanitizeDocumentHtml(html: string): string {
	const headings = Object.fromEntries(
		['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((h) => [h, blockStyles])
	);
	return sanitizeHtml(html, {
		allowedTags: [...DOCUMENT_TAGS],
		allowedAttributes: {
			a: ['href', 'target', 'rel'],
			img: ['src', 'alt', 'width', 'height', 'style'],
			td: ['colspan', 'rowspan', 'style'],
			th: ['colspan', 'rowspan', 'style'],
			col: ['style'],
			ol: ['start'],
			input: ['type', 'checked', 'disabled'],
			p: ['style'],
			h1: ['style'],
			h2: ['style'],
			h3: ['style'],
			h4: ['style'],
			h5: ['style'],
			h6: ['style'],
			span: ['style'],
			mark: ['style'],
			ul: ['class'],
			li: ['class'],
			div: ['class']
		},
		allowedClasses: {
			ul: ['task-list'],
			li: ['task-item', 'checked'],
			div: ['embed-box', 'embed-title', 'embed-link', 'note-page', 'page-break']
		},
		allowedStyles: {
			...headings,
			p: blockStyles,
			span: textStyles,
			mark: textStyles,
			td: cellStyles,
			th: cellStyles,
			col: { width: WIDTH_RE },
			img: { width: WIDTH_RE, 'max-width': WIDTH_RE }
		},
		allowedSchemes: ['http', 'https', 'mailto'],
		allowedSchemesByTag: { img: ['data'] },
		allowedSchemesAppliedToAttributes: ['href', 'src'],
		allowProtocolRelative: false,
		transformTags: {
			a: (_tag, attribs) => ({
				tagName: 'a',
				attribs: { href: attribs.href ?? '', target: '_blank', rel: 'noopener noreferrer' }
			}),
			input: (_tag, attribs) => ({
				tagName: 'input',
				attribs: {
					type: 'checkbox',
					disabled: 'disabled',
					...(attribs.checked !== undefined ? { checked: 'checked' } : {})
				}
			}),
			td: (tagName, attribs) => ({
				tagName,
				attribs: keepMatching(attribs, { colspan: SPAN_RE, rowspan: SPAN_RE })
			}),
			th: (tagName, attribs) => ({
				tagName,
				attribs: keepMatching(attribs, { colspan: SPAN_RE, rowspan: SPAN_RE })
			}),
			ol: (tagName, attribs) => ({
				tagName,
				attribs: keepMatching(attribs, { start: /^\d{1,6}$/ })
			}),
			img: (tagName, attribs) => ({
				tagName,
				attribs: {
					...keepMatching(attribs, { width: PX_RE, height: PX_RE }),
					alt: (attribs.alt ?? '').slice(0, 300)
				}
			})
		},
		// Bilder ohne gültige Data-URL entfallen ganz (kein leeres `<img>`, keine externen Adressen)
		exclusiveFilter: (frame) => {
			if (frame.tag !== 'img') return false;
			const src = frame.attribs.src ?? '';
			return src.length > MAX_DOCUMENT_IMAGE_CHARS || !DOC_IMAGE_RE.test(src);
		}
	}).trim();
}
