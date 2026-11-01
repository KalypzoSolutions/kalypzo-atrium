import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { TextField } from '../types';
import { clampLength, hasControlChars, msg, NO_CONTROL } from './shared';

export const textFieldType: FieldTypeSpec<TextField> = {
	type: 'text',
	get label() {
		return t('forms.types.text.label');
	},
	get description() {
		return t('forms.types.text.description');
	},
	icon: 'file-text',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'text', label: t('forms.defaults.newField') }),
	schema(field) {
		const max = clampLength(field.maxLength, 200, 2000);
		return z
			.string(msg('forms.validation.textRequired'))
			.trim()
			.max(max, msg('forms.validation.maxChars', { max: String(max) }))
			.refine((v) => !hasControlChars(v, false), NO_CONTROL);
	}
};
