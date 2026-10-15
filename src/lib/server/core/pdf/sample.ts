import type { PdfBlock } from '$lib/sdk/types';

export const SAMPLE_RECIPIENT = ['Max Mustermann', 'Musterstraße 7', '28207 Bremen'];

const LOREM =
	'Dieser Beispieltext zeigt, wie der Inhalt eines Dokuments auf der Seite gesetzt wird. ' +
	'Er prüft Schriftbild, Zeilenabstand und Seitenränder der Vorlage und enthält Umlaute wie äöüß.';

export function sampleContent(title: string): PdfBlock[] {
	return [
		{ type: 'heading', text: title, level: 1 },
		{ type: 'paragraph', text: `${LOREM}\n${LOREM}` },
		{ type: 'paragraph', text: `${LOREM} ${LOREM}` },
		{ type: 'heading', text: 'Beispieltabelle', level: 2 },
		{
			type: 'table',
			columns: ['Position', 'Bezeichnung', 'Status'],
			rows: [
				['1', 'Erster Eintrag', 'Aktiv'],
				['2', 'Zweiter Eintrag', 'Inaktiv'],
				['3', 'Dritter Eintrag', 'Aktiv']
			]
		},
		{ type: 'list', items: ['Umlaute: äöüß', 'Sonderzeichen: & < > "'], ordered: false },
		{ type: 'paragraph', text: `${LOREM} ${LOREM}` }
	];
}
