// bwip-js liefert Typen nur unter Plattform-Bedingungen (node/browser) – für `moduleResolution: bundler`
// hier die gemeinsame Schnittstelle (toSVG ist auf beiden Plattformen gleich).
declare module 'bwip-js' {
	interface ToSvgOptions {
		bcid: string;
		text: string;
		scale?: number;
		height?: number;
		eclevel?: string;
		paddingwidth?: number;
		paddingheight?: number;
		includetext?: boolean;
	}
	const bwipjs: { toSVG(opts: ToSvgOptions): string };
	export default bwipjs;
}
