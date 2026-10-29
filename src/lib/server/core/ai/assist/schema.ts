import { z } from 'zod';
import { ASSIST_ADDRESSES, ASSIST_TASKS } from '$lib/sdk/types/assist';

const slug = z.string().regex(/^[a-z][a-z0-9-]{0,60}$/);

/** Eingabe von `POST /ai/assist` */
export const assistRequestSchema = z.object({
	module: slug,
	purpose: slug,
	task: z
		.enum(ASSIST_TASKS as [string, ...string[]])
		.transform((t) => t as (typeof ASSIST_TASKS)[number]),
	text: z.string().max(20_000),
	instruction: z.string().max(1000).optional(),
	address: z
		.enum(ASSIST_ADDRESSES as [string, ...string[]])
		.transform((a) => a as (typeof ASSIST_ADDRESSES)[number])
		.optional(),
	context: z.object({ module: slug, kind: slug, id: z.string().min(1).max(100) }).optional(),
	extra: z.record(z.string().max(40), z.string().max(5000)).optional()
});
