import { z } from 'zod';
import type { FieldTypeSpec } from '../registry';
import type { DateField } from '../types';

export function isIsoDate(value: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!m) return false;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	const dt = new Date(Date.UTC(y, mo - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function formatDe(iso: string): string {
	const [y, m, d] = iso.split('-');
	return `${d}.${m}.${y}`;
}

export const dateFieldType: FieldTypeSpec<DateField> = {
	type: 'date',
	label: 'Datum',
	description: 'Kalenderdatum',
	icon: 'calendar',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'date', label: 'Neues Feld' }),
	schema(field) {
		const { min, max } = field;
		return z
			.string({ error: 'Bitte ein Datum angeben' })
			.trim()
			.refine(isIsoDate, 'Bitte ein gültiges Datum angeben')
			.refine((v) => !min || !isIsoDate(min) || v >= min, `Frühestens ${formatDe(min ?? '')}`)
			.refine((v) => !max || !isIsoDate(max) || v <= max, `Spätestens ${formatDe(max ?? '')}`);
	}
};
