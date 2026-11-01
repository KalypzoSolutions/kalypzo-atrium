import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { PhoneField } from '../types';
import { msg } from './shared';

export const phoneFieldType: FieldTypeSpec<PhoneField> = {
	type: 'phone',
	get label() {
		return t('forms.types.phone.label');
	},
	get description() {
		return t('forms.types.phone.description');
	},
	icon: 'users',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'phone', label: t('forms.defaults.phoneLabel') }),
	schema() {
		const MSG = msg('forms.validation.phoneInvalid');
		return z
			.string(MSG)
			.trim()
			.transform((v) => v.replace(/\s+/g, ' '))
			.pipe(
				z
					.string()
					.regex(/^\+?[0-9][0-9 ()/.-]{4,28}$/, MSG)
					.refine((v) => {
						const digits = v.replace(/\D/g, '').length;
						return digits >= 6 && digits <= 15;
					}, MSG)
			);
	}
};
