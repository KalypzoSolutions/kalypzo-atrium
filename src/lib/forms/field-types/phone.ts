import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { PhoneField } from '../types';

const MSG = 'Bitte eine gültige Telefonnummer eingeben';

export const phoneFieldType: FieldTypeSpec<PhoneField> = {
	type: 'phone',
	label: 'Telefon',
	description: 'Telefonnummer',
	icon: 'users',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'phone', label: 'Telefonnummer' }),
	schema() {
		return z
			.string({ error: MSG })
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
