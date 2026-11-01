import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { ConsentField } from '../types';
import { msg } from './shared';

export const consentFieldType: FieldTypeSpec<ConsentField> = {
	type: 'consent',
	get label() {
		return t('forms.types.consent.label');
	},
	get description() {
		return t('forms.types.consent.description');
	},
	icon: 'shield',
	hasValue: true,
	create: (id, key) => ({
		id,
		key,
		type: 'consent',
		label: t('forms.defaults.consentLabel'),
		text: t('forms.defaults.consentText'),
		required: true
	}),
	schema() {
		return z.literal(true, msg('forms.validation.confirm'));
	}
};
