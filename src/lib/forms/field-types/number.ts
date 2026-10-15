import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { NumberField } from '../types';

export const numberFieldType: FieldTypeSpec<NumberField> = {
	type: 'number',
	label: 'Zahl',
	description: 'Numerische Eingabe, optional mit Grenzen',
	icon: 'chart-bar',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'number', label: 'Neues Feld' }),
	schema(field) {
		let num = z.number({ error: 'Bitte eine Zahl eingeben' });
		if (field.integer) num = num.int('Bitte eine ganze Zahl eingeben');
		if (typeof field.min === 'number') num = num.min(field.min, `Mindestens ${field.min}`);
		if (typeof field.max === 'number') num = num.max(field.max, `Höchstens ${field.max}`);
		return z.preprocess((v) => {
			if (typeof v === 'string') {
				const s = v.trim().replace(',', '.');
				if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
			}
			return v;
		}, num);
	}
};
