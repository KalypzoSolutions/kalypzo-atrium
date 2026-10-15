import type { RequestHandler } from '@sveltejs/kit';
import { handleApiRequest } from '$lib/server/core/api/router';
import { initCore } from '$lib/server/core/init';

const handler: RequestHandler = async ({ request, url, getClientAddress }) => {
	await initCore();
	let ip: string | null;
	try {
		ip = getClientAddress();
	} catch {
		ip = null;
	}
	return handleApiRequest({ request, url, ip });
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
