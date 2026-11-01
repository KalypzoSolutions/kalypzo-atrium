import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { EmailField } from '../types';
import { msg } from './shared';

export const emailFieldType: FieldTypeSpec<EmailField> = {
	type: 'email',
	get label() {
		return t('forms.types.email.label');
	},
	get description() {
		return t('forms.types.email.description');
	},
	icon: 'mail',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'email', label: t('forms.defaults.emailLabel') }),
	schema() {
		return z
			.string(msg('forms.validation.emailRequired'))
			.trim()
			.toLowerCase()
			.max(200, msg('forms.validation.maxChars', { max: '200' }))
			.pipe(z.email(msg('forms.validation.emailInvalid')));
	}
};
