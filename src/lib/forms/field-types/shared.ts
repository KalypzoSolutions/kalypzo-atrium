/** Enthält Steuerzeichen (optional Zeilenumbruch/Tab erlaubt). */
export function hasControlChars(value: string, allowMultiline: boolean): boolean {
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		if (allowMultiline && (c === 9 || c === 10 || c === 13)) continue;
		if (c < 32 || c === 127) return true;
	}
	return false;
}

export function clampLength(value: number | undefined, fallback: number, max: number): number {
	const v = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(v, max));
}

export const NO_CONTROL = 'Enthält ungültige Zeichen';
