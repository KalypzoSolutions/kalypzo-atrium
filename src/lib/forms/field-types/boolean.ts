import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { BooleanField } from '../types';
import { msg } from './shared';

export const booleanFieldType: FieldTypeSpec<BooleanField> = {
	type: 'boolean',
	get label() {
		return t('forms.types.boolean.label');
	},
	get description() {
		return t('forms.types.boolean.description');
	},
	icon: 'settings',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'boolean', label: t('forms.defaults.newField') }),
	schema() {
		return z.boolean(msg('forms.validation.booleanRequired'));
	}
};
