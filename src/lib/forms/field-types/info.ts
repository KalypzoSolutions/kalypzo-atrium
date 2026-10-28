import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { InfoField } from '../types';

export const infoFieldType: FieldTypeSpec<InfoField> = {
	type: 'info',
	label: 'Infotext',
	description: 'Formatierter Text ohne Eingabe, z. B. Hinweise',
	icon: 'file-text',
	hasValue: false,
	create: (id, key) => ({
		id,
		key,
		type: 'info',
		label: 'Hinweis',
		text: '<p>Infotext</p>',
		format: 'html'
	}),
	schema() {
		return z.never();
	}
};
