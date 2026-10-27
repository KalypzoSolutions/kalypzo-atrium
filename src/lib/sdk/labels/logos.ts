import wappen from './assets/wappen.png?inline';
import lilie from './assets/lilie.png?inline';
import type { LabelLogo } from './types';

/** Stammes-Logos für Etiketten als `data:`-URL (verkleinert, ≈ 20 KB) */
export const LABEL_LOGO_DATA: Record<LabelLogo, string> = { wappen, lilie };
