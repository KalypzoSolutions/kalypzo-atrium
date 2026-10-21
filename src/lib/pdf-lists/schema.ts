/**
 * Zod-Eingabe für die Spaltenauswahl der PDF-Listen (gemeinsam für `members` und `actions`).
 */
import { z } from 'zod';
import { LIST_MAX_COLUMNS } from './types';

/** Auswahl der Listenspalten (Schlüssel prüft der Server gegen den Katalog; ohne Auswahl gilt „Fahrt“) */
export const listSelectionInput = z
	.object({
		preset: z.string().max(40).optional(),
		columns: z
			.array(z.string().min(1).max(60))
			.min(1, 'Mindestens eine Spalte wählen')
			.max(LIST_MAX_COLUMNS, `Höchstens ${LIST_MAX_COLUMNS} Spalten`),
		hideEmpty: z.boolean().default(true)
	})
	.strict();
