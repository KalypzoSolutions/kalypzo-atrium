import bwipjs from 'bwip-js';
import type { BarcodeType } from './types';

/**
 * Barcode als SVG-Text (bwip-js, Client und Server). Das SVG skaliert auf seinen Rahmen: 2D-Codes
 * behalten das Seitenverhältnis, Strichcodes füllen die Fläche. Wirft bei ungültigem Inhalt
 * (z. B. Zeichen, die Code 128 nicht kodieren kann). Im Browser nur dynamisch importieren
 * (`await import('$lib/sdk/labels/barcode')`) – die Bibliothek ist groß.
 */
export function barcodeSvg(type: BarcodeType, value: string): string {
	const svg = bwipjs.toSVG({
		bcid: type,
		text: value,
		...(type === 'code128' ? { height: 10, scale: 2 } : { scale: 2 }),
		...(type === 'qrcode' ? { eclevel: 'M' } : {}),
		paddingwidth: 0,
		paddingheight: 0
	});
	const aspect = type === 'code128' ? 'none' : 'xMidYMid meet';
	return svg.replace(
		'<svg ',
		`<svg width="100%" height="100%" preserveAspectRatio="${aspect}" shape-rendering="crispEdges" `
	);
}

/** Wie `barcodeSvg`, aber als `data:`-URL für `<img>`; ungültiger Inhalt → `null` */
export function barcodeDataUrl(type: BarcodeType, value: string): string | null {
	try {
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(barcodeSvg(type, value))}`;
	} catch {
		return null;
	}
}
