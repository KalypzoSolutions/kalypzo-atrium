import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { SelectField } from '../types';
import { hasControlChars, msg, NO_CONTROL } from './shared';

export const selectFieldType: FieldTypeSpec<SelectField> = {
	type: 'select',
	get label() {
		return t('forms.types.select.label');
	},
	get description() {
		return t('forms.types.select.description');
	},
	icon: 'settings',
	hasValue: true,
	create: (id, key) => ({
		id,
		key,
		type: 'select',
		label: t('forms.defaults.newField'),
		options: [
			{ value: 'option1', label: t('forms.defaults.option', { n: '1' }) },
			{ value: 'option2', label: t('forms.defaults.option', { n: '2' }) }
		]
	}),
	schema(field) {
		const values = new Set(field.options.map((o) => o.value));
		const base = z.string(msg('forms.validation.selectRequired')).trim();
		if (field.allowOther) {
			return base
				.max(100, msg('forms.validation.maxChars', { max: '100' }))
				.refine((v) => !hasControlChars(v, false), NO_CONTROL);
		}
		return base.refine((v) => values.has(v), msg('forms.validation.selectInvalid'));
	}
};
