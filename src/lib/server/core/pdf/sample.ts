import type { PdfBlock } from '$lib/sdk/types';

export const SAMPLE_RECIPIENT = ['Max Mustermann', 'Musterstraße 7', '28207 Bremen'];

const LOREM =
	'Dieser Beispieltext zeigt, wie der Inhalt eines Dokuments auf der Seite gesetzt wird. ' +
	'Er prüft Schriftbild, Zeilenabstand und Seitenränder der Vorlage und enthält Umlaute wie äöüß.';

/**
 * Beispielinhalt für Vorschau und Testdokument. Ohne eigene Hauptüberschrift: den Titel setzt
 * der `titleBlock` der Vorlage. Bewusst so kurz, dass er auch auf A4 quer (Textbereich ca.
 * 140 mm hoch) mit Abstand zur Fußzeile auf eine Seite passt.
 */
export function sampleContent(): PdfBlock[] {
	return [
		{ type: 'paragraph', text: `${LOREM}\n${LOREM}` },
		{ type: 'paragraph', text: LOREM },
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
		{ type: 'paragraph', text: LOREM }
	];
}
