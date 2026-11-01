import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { MultiselectField } from '../types';
import { msg } from './shared';

export const multiselectFieldType: FieldTypeSpec<MultiselectField> = {
	type: 'multiselect',
	get label() {
		return t('forms.types.multiselect.label');
	},
	get description() {
		return t('forms.types.multiselect.description');
	},
	icon: 'settings',
	hasValue: true,
	create: (id, key) => ({
		id,
		key,
		type: 'multiselect',
		label: t('forms.defaults.newField'),
		options: [
			{ value: 'option1', label: t('forms.defaults.option', { n: '1' }) },
			{ value: 'option2', label: t('forms.defaults.option', { n: '2' }) }
		]
	}),
	schema(field) {
		const values = new Set(field.options.map((o) => o.value));
		const { min, max } = field;
		return z
			.array(z.string(), msg('forms.validation.optionsRequired'))
			.refine((a) => a.every((v) => values.has(v)), msg('forms.validation.optionsInvalid'))
			.refine((a) => new Set(a).size === a.length, msg('forms.validation.optionsDuplicate'))
			.refine(
				(a) => typeof min !== 'number' || a.length >= min,
				msg('forms.validation.optionsMin', { min: String(min) })
			)
			.refine(
				(a) => typeof max !== 'number' || a.length <= max,
				msg('forms.validation.optionsMax', { max: String(max) })
			);
	}
};
