import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { SelectField } from '../types';
import { hasControlChars, NO_CONTROL } from './shared';

export const selectFieldType: FieldTypeSpec<SelectField> = {
	type: 'select',
	label: 'Auswahl (eine)',
	description: 'Genau eine Option auswählen',
	icon: 'settings',
	hasValue: true,
	create: (id, key) => ({
		id,
		key,
		type: 'select',
		label: 'Neues Feld',
		options: [
			{ value: 'option1', label: 'Option 1' },
			{ value: 'option2', label: 'Option 2' }
		]
	}),
	schema(field) {
		const values = new Set(field.options.map((o) => o.value));
		const base = z.string({ error: 'Bitte eine Option wählen' }).trim();
		if (field.allowOther) {
			return base
				.max(100, 'Höchstens 100 Zeichen')
				.refine((v) => !hasControlChars(v, false), NO_CONTROL);
		}
		return base.refine((v) => values.has(v), 'Bitte eine gültige Option wählen');
	}
};
