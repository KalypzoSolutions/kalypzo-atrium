import type { PdfBlock } from '$lib/sdk/types';
import { t } from '$lib/i18n';

/** Beispieladresse für Vorschau und Testdokument (in der Sprache der Anzeige) */
export function sampleRecipient(): string[] {
	return [
		t('pdf.sample.recipientName'),
		t('pdf.sample.recipientStreet'),
		t('pdf.sample.recipientCity')
	];
}

/**
 * Beispielinhalt für Vorschau und Testdokument. Ohne eigene Hauptüberschrift: den Titel setzt
 * der `titleBlock` der Vorlage. Bewusst so kurz, dass er auch auf A4 quer (Textbereich ca.
 * 140 mm hoch) mit Abstand zur Fußzeile auf eine Seite passt.
 */
export function sampleContent(): PdfBlock[] {
	const lorem = t('pdf.sample.lorem');
	return [
		{ type: 'paragraph', text: `${lorem}\n${lorem}` },
		{ type: 'paragraph', text: lorem },
		{ type: 'heading', text: t('pdf.sample.tableHeading'), level: 2 },
		{
			type: 'table',
			columns: [t('pdf.sample.colPosition'), t('pdf.sample.colName'), t('pdf.sample.colStatus')],
			rows: [
				['1', t('pdf.sample.row1'), t('pdf.sample.active')],
				['2', t('pdf.sample.row2'), t('pdf.sample.inactive')],
				['3', t('pdf.sample.row3'), t('pdf.sample.active')]
			]
		},
		{
			type: 'list',
			items: [t('pdf.sample.listUmlauts'), t('pdf.sample.listSpecial')],
			ordered: false
		},
		{ type: 'paragraph', text: lorem }
	];
}
