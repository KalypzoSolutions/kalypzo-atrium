import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { NumberField } from '../types';
import { msg } from './shared';

export const numberFieldType: FieldTypeSpec<NumberField> = {
	type: 'number',
	get label() {
		return t('forms.types.number.label');
	},
	get description() {
		return t('forms.types.number.description');
	},
	icon: 'chart-bar',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'number', label: t('forms.defaults.newField') }),
	schema(field) {
		let num = z.number(msg('forms.validation.numberRequired'));
		if (field.integer) num = num.int(msg('forms.validation.integerRequired'));
		if (typeof field.min === 'number')
			num = num.min(field.min, msg('forms.validation.numberMin', { min: String(field.min) }));
		if (typeof field.max === 'number')
			num = num.max(field.max, msg('forms.validation.numberMax', { max: String(field.max) }));
		return z.preprocess((v) => {
			if (typeof v === 'string') {
				const s = v.trim().replace(',', '.');
				if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
			}
			return v;
		}, num);
	}
};
