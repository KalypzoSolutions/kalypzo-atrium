import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { SectionField } from '../types';

export const sectionFieldType: FieldTypeSpec<SectionField> = {
	type: 'section',
	label: 'Abschnitt',
	description: 'Überschrift zum Gliedern, ohne Eingabe',
	icon: 'heading',
	hasValue: false,
	create: (id, key) => ({ id, key, type: 'section', label: 'Neuer Abschnitt' }),
	schema() {
		return z.never();
	}
};
