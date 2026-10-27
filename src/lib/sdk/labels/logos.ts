import wappen from './assets/wappen.png?inline';
import lilie from './assets/lilie.png?inline';
import wappenSw from './assets/wappen-sw.png?inline';
import lilieSw from './assets/lilie-sw.png?inline';
import { logoKey } from './layout';
import type { LabelImageElement } from './types';

/**
 * Stammes-Logos für Etiketten als `data:`-URL (verkleinert): farbig und in Schwarz-Weiß (schwarze Flächen und
 * Kontur auf Weiß, für Laser-/Thermodrucker). Schlüssel über `logoKey`.
 */
export const LABEL_LOGO_DATA: Record<string, string> = {
	wappen,
	lilie,
	'wappen-sw': wappenSw,
	'lilie-sw': lilieSw
};

/** `data:`-URL für ein Logo-Element */
export function logoDataUrl(el: Pick<LabelImageElement, 'logo' | 'monochrome'>): string {
	return LABEL_LOGO_DATA[logoKey(el)] ?? LABEL_LOGO_DATA[el.logo]!;
}
