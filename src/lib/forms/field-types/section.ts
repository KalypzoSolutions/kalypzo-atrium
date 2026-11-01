import { t } from '$lib/i18n';
import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { SectionField } from '../types';

export const sectionFieldType: FieldTypeSpec<SectionField> = {
	type: 'section',
	get label() {
		return t('forms.types.section.label');
	},
	get description() {
		return t('forms.types.section.description');
	},
	icon: 'heading',
	hasValue: false,
	create: (id, key) => ({ id, key, type: 'section', label: t('forms.defaults.newSection') }),
	schema() {
		return z.never();
	}
};
