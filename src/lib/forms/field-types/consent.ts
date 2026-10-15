import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { ConsentField } from '../types';

export const consentFieldType: FieldTypeSpec<ConsentField> = {
	type: 'consent',
	label: 'Zustimmung',
	description: 'Pflicht-Checkbox mit Text und optionalem Link',
	icon: 'shield',
	hasValue: true,
	create: (id, key) => ({
		id,
		key,
		type: 'consent',
		label: 'Zustimmung',
		text: 'Ich stimme zu.',
		required: true
	}),
	schema() {
		return z.literal(true, { error: 'Bitte bestätigen' });
	}
};
