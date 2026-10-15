import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { MultiselectField } from '../types';

export const multiselectFieldType: FieldTypeSpec<MultiselectField> = {
	type: 'multiselect',
	label: 'Mehrfachauswahl',
	description: 'Mehrere Optionen auswählen',
	icon: 'settings',
	hasValue: true,
	create: (id, key) => ({
		id,
		key,
		type: 'multiselect',
		label: 'Neues Feld',
		options: [
			{ value: 'option1', label: 'Option 1' },
			{ value: 'option2', label: 'Option 2' }
		]
	}),
	schema(field) {
		const values = new Set(field.options.map((o) => o.value));
		const { min, max } = field;
		return z
			.array(z.string(), { error: 'Bitte Optionen wählen' })
			.refine((a) => a.every((v) => values.has(v)), 'Bitte nur gültige Optionen wählen')
			.refine((a) => new Set(a).size === a.length, 'Optionen dürfen nicht doppelt vorkommen')
			.refine((a) => typeof min !== 'number' || a.length >= min, `Bitte mindestens ${min} wählen`)
			.refine((a) => typeof max !== 'number' || a.length <= max, `Bitte höchstens ${max} wählen`);
	}
};
