/**
 * Wort-Diff für die Vorschau der Schreibhilfe (neu / entfällt / gleich). Reine Funktionen,
 * Test `tests/unit/ai-assist.test.ts`.
 */

export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffPart {
	kind: DiffKind;
	text: string;
}

/** Ab dieser Länge (Wörter je Seite) wird kein Diff berechnet */
export const MAX_DIFF_TOKENS = 1500;

/** HTML → lesbarer Text (Absätze als Zeilenumbruch, Listen mit „• “) */
export function textOfHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<li[^>]*>/gi, '• ')
		.replace(/<\/(p|h2|h3|li|blockquote|ul|ol)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function tokens(text: string): string[] {
	return text.match(/\S+\s*|\s+/g) ?? [];
}

function push(out: DiffPart[], kind: DiffKind, text: string): void {
	const last = out[out.length - 1];
	if (last && last.kind === kind) last.text += text;
	else out.push({ kind, text });
}

/** Diff zweier Texte auf Wortebene; `null`, wenn die Texte zu lang sind */
export function wordDiff(before: string, after: string): DiffPart[] | null {
	const a = tokens(before);
	const b = tokens(after);
	if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) return null;
	const n = a.length;
	const m = b.length;
	// LCS-Tabelle von hinten (Zeile i, Spalte j = Länge der LCS von a[i..], b[j..])
	const table: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i]![j] =
				a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
		}
	}
	const out: DiffPart[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			push(out, 'same', a[i]!);
			i++;
			j++;
		} else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
			push(out, 'removed', a[i]!);
			i++;
		} else {
			push(out, 'added', b[j]!);
			j++;
		}
	}
	while (i < n) push(out, 'removed', a[i++]!);
	while (j < m) push(out, 'added', b[j++]!);
	return out;
}
