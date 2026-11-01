import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { TextareaField } from '../types';
import { clampLength, hasControlChars, msg, NO_CONTROL } from './shared';

export const textareaFieldType: FieldTypeSpec<TextareaField> = {
	type: 'textarea',
	get label() {
		return t('forms.types.textarea.label');
	},
	get description() {
		return t('forms.types.textarea.description');
	},
	icon: 'file-text',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'textarea', label: t('forms.defaults.newField') }),
	schema(field) {
		const max = clampLength(field.maxLength, 2000, 10000);
		return z
			.string(msg('forms.validation.textRequired'))
			.trim()
			.max(max, msg('forms.validation.maxChars', { max: String(max) }))
			.refine((v) => !hasControlChars(v, true), NO_CONTROL);
	}
};
