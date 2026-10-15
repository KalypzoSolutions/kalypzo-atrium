import { randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

export function isoDate(d: Date | null | undefined): string | null {
	return d ? d.toISOString() : null;
}
