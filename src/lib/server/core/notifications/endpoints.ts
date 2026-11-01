import { z } from 'zod';
import {
	NOTIFICATION_CHANNELS,
	NOTIFICATION_DELIVERIES,
	NOTIFICATION_SCOPE_MAX,
	NOTIFICATION_TYPE_PATTERN
} from '$lib/sdk/types/notifications';
import { defineEndpoint } from '../api/registry';
import { errors } from '../errors';
import { addDevice, listDevices, pushEnabled, removeDevice, vapidKeys } from './push';
import { getMyPreferences, sendTestPush, setMyPreference } from './service';
import { t } from '$lib/i18n';

const base64url = (max: number) =>
	z
		.string()
		.min(1)
		.max(max)
		.regex(/^[A-Za-z0-9_-]+=*$/);

const subscriptionInput = z.object({
	endpoint: z.string().url().max(1000),
	keys: z.object({ p256dh: base64url(200), auth: base64url(100) }),
	label: z.string().max(200).optional()
});

const preferenceInput = z.object({
	type: z.string().max(100).regex(NOTIFICATION_TYPE_PATTERN),
	scope: z.string().max(NOTIFICATION_SCOPE_MAX).default(''),
	channel: z.enum(NOTIFICATION_CHANNELS),
	delivery: z.enum(NOTIFICATION_DELIVERIES).optional()
});

// Schlüssel; die API-Übersicht übersetzt sie beim Anzeigen (`api/text.ts`)
const TAGS = ['notifications.endpoints.tag'];

/** Eigene Benachrichtigungs-Einstellungen und Push-Geräte (nur angemeldete Personen, nur Session) */
export function notificationEndpoints() {
	return [
		defineEndpoint({
			method: 'GET',
			path: '/notifications/preferences',
			summary: 'notifications.endpoints.preferencesGet',
			tags: TAGS,
			permission: null,
			authenticated: true,
			sessionOnly: true,
			rateLimit: { limit: 60, windowSec: 60 },
			handler: ({ ctx }) => getMyPreferences(ctx)
		}),
		defineEndpoint({
			method: 'PUT',
			path: '/notifications/preferences',
			summary: 'notifications.endpoints.preferencesPut',
			tags: TAGS,
			permission: null,
			authenticated: true,
			sessionOnly: true,
			body: preferenceInput,
			rateLimit: { limit: 120, windowSec: 60 },
			handler: ({ ctx, body }) => setMyPreference(ctx, body)
		}),
		defineEndpoint({
			method: 'GET',
			path: '/notifications/push/key',
			summary: 'notifications.endpoints.vapidKey',
			tags: TAGS,
			permission: null,
			authenticated: true,
			sessionOnly: true,
			handler: async () => {
				if (!(await pushEnabled())) {
					throw errors.unavailable(t('notifications.pushDisabled'));
				}
				return { publicKey: (await vapidKeys()).publicKey };
			}
		}),
		defineEndpoint({
			method: 'GET',
			path: '/notifications/push/subscriptions',
			summary: 'notifications.endpoints.devicesList',
			tags: TAGS,
			permission: null,
			authenticated: true,
			sessionOnly: true,
			handler: ({ ctx }) => listDevices(ctx.userId!)
		}),
		defineEndpoint({
			method: 'POST',
			path: '/notifications/push/subscriptions',
			summary: 'notifications.endpoints.deviceAdd',
			tags: TAGS,
			permission: null,
			authenticated: true,
			sessionOnly: true,
			body: subscriptionInput,
			rateLimit: { limit: 20, windowSec: 300 },
			handler: ({ ctx, body }) => addDevice(ctx, body)
		}),
		defineEndpoint({
			method: 'POST',
			path: '/notifications/push/subscriptions/remove',
			summary: 'notifications.endpoints.deviceUnsubscribe',
			tags: TAGS,
			permission: null,
			authenticated: true,
			sessionOnly: true,
			body: z.object({ endpoint: z.string().url().max(1000) }),
			rateLimit: { limit: 20, windowSec: 300 },
			handler: ({ ctx, body }) => removeDevice(ctx, { endpoint: body.endpoint })
		}),
		defineEndpoint({
			method: 'DELETE',
			path: '/notifications/push/subscriptions/:id',
			summary: 'notifications.endpoints.deviceRemove',
			tags: TAGS,
			permission: null,
			authenticated: true,
			sessionOnly: true,
			params: z.object({ id: z.string().uuid() }),
			handler: ({ ctx, params }) => removeDevice(ctx, { id: params.id })
		}),
		defineEndpoint({
			method: 'POST',
			path: '/notifications/push/test',
			summary: 'notifications.endpoints.testPush',
			tags: TAGS,
			permission: null,
			authenticated: true,
			sessionOnly: true,
			rateLimit: { limit: 5, windowSec: 60 },
			handler: ({ ctx }) => sendTestPush(ctx)
		})
	];
}
