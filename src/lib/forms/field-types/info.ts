import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { InfoField } from '../types';

export const infoFieldType: FieldTypeSpec<InfoField> = {
	type: 'info',
	get label() {
		return t('forms.types.info.label');
	},
	get description() {
		return t('forms.types.info.description');
	},
	icon: 'file-text',
	hasValue: false,
	create: (id, key) => ({
		id,
		key,
		type: 'info',
		label: t('forms.defaults.infoLabel'),
		text: `<p>${t('forms.defaults.infoText')}</p>`,
		format: 'html'
	}),
	schema() {
		return z.never();
	}
};
