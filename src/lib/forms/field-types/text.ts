import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { TextField } from '../types';
import { clampLength, hasControlChars, NO_CONTROL } from './shared';

export const textFieldType: FieldTypeSpec<TextField> = {
	type: 'text',
	label: 'Kurztext',
	description: 'Einzeilige Texteingabe',
	icon: 'file-text',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'text', label: 'Neues Feld' }),
	schema(field) {
		const max = clampLength(field.maxLength, 200, 2000);
		return z
			.string({ error: 'Bitte Text eingeben' })
			.trim()
			.max(max, `Höchstens ${max} Zeichen`)
			.refine((v) => !hasControlChars(v, false), NO_CONTROL);
	}
};
