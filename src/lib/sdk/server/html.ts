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
