import { t } from '$lib/i18n';
import { z } from 'zod';
import { formatDate } from '$lib/i18n/intl';
import type { FieldTypeSpec } from '../registry';
import type { DateField } from '../types';
import { msg } from './shared';

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
	return formatDate(iso, iso);
}

export const dateFieldType: FieldTypeSpec<DateField> = {
	type: 'date',
	get label() {
		return t('forms.types.date.label');
	},
	get description() {
		return t('forms.types.date.description');
	},
	icon: 'calendar',
	hasValue: true,
	create: (id, key) => ({ id, key, type: 'date', label: t('forms.defaults.newField') }),
	schema(field) {
		const { min, max } = field;
		return z
			.string(msg('forms.validation.dateRequired'))
			.trim()
			.refine(isIsoDate, msg('forms.validation.dateInvalid'))
			.refine(
				(v) => !min || !isIsoDate(min) || v >= min,
				msg('forms.validation.dateMin', { date: formatDe(min ?? '') })
			)
			.refine(
				(v) => !max || !isIsoDate(max) || v <= max,
				msg('forms.validation.dateMax', { date: formatDe(max ?? '') })
			);
	}
};
