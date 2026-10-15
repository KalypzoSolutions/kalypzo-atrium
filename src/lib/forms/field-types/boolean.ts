import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { BooleanField } from '../types';

export const booleanFieldType: FieldTypeSpec<BooleanField> = {
	type: 'boolean',
	label: 'Ja/Nein',
	description: 'Ja-/Nein-Auswahl (Checkbox)',
	icon: 'settings',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'boolean', label: 'Neues Feld' }),
	schema() {
		return z.boolean({ error: 'Bitte Ja oder Nein wählen' });
	}
};
