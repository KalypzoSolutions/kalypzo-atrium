import { t } from '$lib/i18n';
import { z } from 'zod';
import { defineEndpoint } from '../api/registry';
import { describeEmbeds, EMBED_DESCRIBE_MAX, listEmbedKinds, searchEmbeds } from './service';

const TAGS = ['api.tags.embeds'];
const RATE = { limit: 120, windowSec: 60 };

const key = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, { error: () => t('embeds.invalidKey') });

const describeInput = z
	.object({
		items: z
			.array(
				z
					.object({
						module: key,
						kind: key,
						refId: z
							.string()
							.trim()
							.regex(/^[A-Za-z0-9_-]{1,64}$/, { error: () => t('embeds.invalidId') })
					})
					.strict()
			)
			.max(EMBED_DESCRIBE_MAX, { error: () => t('embeds.tooMany', { max: EMBED_DESCRIBE_MAX }) })
	})
	.strict();

/** Einbettbare Inhalte anderer Module suchen und auflösen (nur Anmeldung; je Modul dessen Recht) */
export function embedEndpoints() {
	return [
		defineEndpoint({
			method: 'GET',
			path: '/embeds',
			summary: 'embeds.endpoints.search',
			tags: TAGS,
			permission: null,
			authenticated: true,
			rateLimit: RATE,
			query: z.object({ q: z.string().max(200).default('') }),
			handler: ({ ctx, query }) => searchEmbeds(ctx, query.q)
		}),
		defineEndpoint({
			method: 'GET',
			path: '/embeds/kinds',
			summary: 'embeds.endpoints.kinds',
			tags: TAGS,
			permission: null,
			authenticated: true,
			rateLimit: RATE,
			handler: ({ ctx }) => listEmbedKinds(ctx)
		}),
		defineEndpoint({
			method: 'POST',
			path: '/embeds/describe',
			summary: 'embeds.endpoints.describe',
			tags: TAGS,
			permission: null,
			authenticated: true,
			rateLimit: RATE,
			body: describeInput,
			handler: ({ ctx, body }) => describeEmbeds(ctx, body.items)
		})
	];
}
