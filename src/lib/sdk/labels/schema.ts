import { z } from 'zod';
import { BARCODE_TYPES, LABEL_LOGO_KEY } from './types';
import { formatProblem } from './layout';

/** Zod-Schemas für Etikett-Formate und -Layouts (Client-Validierung und API) */

const mm = (max: number) => z.number().finite().min(0).max(max);
const size = (max: number) => z.number().finite().min(1).max(max);

const base = {
	id: z.string().min(1).max(40),
	x: mm(400),
	y: mm(400),
	w: size(400),
	h: size(400)
};

export const labelElementSchema = z.discriminatedUnion('type', [
	z.object({
		...base,
		type: z.literal('text'),
		text: z.string().max(500),
		fontSizePt: z.number().finite().min(4).max(96),
		bold: z.boolean(),
		align: z.enum(['left', 'center', 'right']),
		valign: z.enum(['top', 'middle', 'bottom']),
		maxLines: z.number().int().min(1).max(20)
	}),
	z.object({
		...base,
		type: z.literal('barcode'),
		symbology: z.enum(BARCODE_TYPES),
		value: z.string().min(1).max(300)
	}),
	z.object({
		...base,
		type: z.literal('image'),
		logo: z.string().regex(LABEL_LOGO_KEY),
		monochrome: z.boolean().optional()
	}),
	z.object({
		...base,
		type: z.literal('rect'),
		stroke: mm(5),
		radius: mm(50),
		filled: z.boolean()
	}),
	z.object({
		...base,
		type: z.literal('line'),
		stroke: z.number().finite().min(0.1).max(5),
		orientation: z.enum(['horizontal', 'vertical'])
	})
]);

export const labelLayoutSchema = z.object({
	widthMm: size(400),
	heightMm: size(400),
	elements: z.array(labelElementSchema).max(40)
});

export const labelFormatSchema = z
	.discriminatedUnion('kind', [
		z.object({
			kind: z.literal('sheet'),
			pageWidthMm: size(500),
			pageHeightMm: size(500),
			cols: z.number().int().min(1).max(20),
			rows: z.number().int().min(1).max(40),
			labelWidthMm: size(400),
			labelHeightMm: size(400),
			marginTopMm: mm(200),
			marginLeftMm: mm(200),
			gapXMm: mm(100),
			gapYMm: mm(100)
		}),
		z.object({ kind: z.literal('roll'), labelWidthMm: size(400), labelHeightMm: size(1000) })
	])
	.superRefine((f, ctx) => {
		const problem = formatProblem(f);
		if (problem) ctx.addIssue({ code: 'custom', message: problem });
	});
