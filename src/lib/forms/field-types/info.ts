import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { InfoField } from '../types';

export const infoFieldType: FieldTypeSpec<InfoField> = {
	type: 'info',
	label: 'Infotext',
	description: 'Anzeigetext ohne Antwort',
	icon: 'file-text',
	hasValue: false,
	create: (id, key) => ({ id, key, type: 'info', label: 'Hinweis', text: 'Infotext' }),
	schema() {
		return z.never();
	}
};
