import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { TextareaField } from '../types';
import { clampLength, hasControlChars, NO_CONTROL } from './shared';

export const textareaFieldType: FieldTypeSpec<TextareaField> = {
	type: 'textarea',
	label: 'Langtext',
	description: 'Mehrzeilige Texteingabe',
	icon: 'file-text',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'textarea', label: 'Neues Feld' }),
	schema(field) {
		const max = clampLength(field.maxLength, 2000, 10000);
		return z
			.string({ error: 'Bitte Text eingeben' })
			.trim()
			.max(max, `Höchstens ${max} Zeichen`)
			.refine((v) => !hasControlChars(v, true), NO_CONTROL);
	}
};
