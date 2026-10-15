import carlitoRegular from './assets/fonts/Carlito-Regular.ttf?inline';
import carlitoBold from './assets/fonts/Carlito-Bold.ttf?inline';

/**
 * Carlito (SIL OFL 1.1, metrisch kompatibel zu Calibri) als eingebettete Data-URLs. Es werden nie
 * externe Schriften nachgeladen (CSP des PDF-Dokuments: `font-src data:`).
 */
export function carlitoFontFaceCss(): string {
	return `
		@font-face { font-family: 'Carlito'; font-style: normal; font-weight: 400; src: url(${carlitoRegular}) format('truetype'); }
		@font-face { font-family: 'Carlito'; font-style: normal; font-weight: 700; src: url(${carlitoBold}) format('truetype'); }
	`;
}

export const CARLITO_STACK = "'Carlito', Calibri, Arial, sans-serif";
