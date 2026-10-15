import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { EmailField } from '../types';

export const emailFieldType: FieldTypeSpec<EmailField> = {
	type: 'email',
	label: 'E-Mail',
	description: 'E-Mail-Adresse',
	icon: 'mail',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'email', label: 'E-Mail-Adresse' }),
	schema() {
		return z
			.string({ error: 'Bitte eine E-Mail-Adresse eingeben' })
			.trim()
			.toLowerCase()
			.max(200, 'Höchstens 200 Zeichen')
			.pipe(z.email('Bitte eine gültige E-Mail-Adresse eingeben'));
	}
};
