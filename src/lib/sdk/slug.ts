/**
 * Adress-Teil (Slug) aus einem Text (rein, Client + Server): Kleinbuchstaben, ä→ae, ö→oe, ü→ue, ß→ss, übrige Akzente
 * entfernt, alles andere → Bindestrich, höchstens `maxLength` Zeichen ohne Bindestrich am Rand.
 */
export function slugify(text: string, maxLength = 80): string {
	return text
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, maxLength)
		.replace(/-+$/g, '');
}

/** Gültiger Slug: Kleinbuchstaben/Ziffern, durch einzelne Bindestriche getrennt */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
