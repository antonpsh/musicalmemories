import type { Handle } from '@sveltejs/kit/hooks';

/**
 * Hosts the app answers to. Rejecting any other `Host` blocks DNS rebinding: a web page whose
 * domain is re-pointed to 127.0.0.1 would otherwise read Memories and thumbnails same-origin.
 */
export const ALLOWED_HOSTS = new Set(['localhost:3000', '127.0.0.1:3000']);

export const handle: Handle = ({ event, resolve }) => {
	const host = event.request.headers.get('host')?.toLowerCase();
	if (!host || !ALLOWED_HOSTS.has(host)) {
		return new Response('Misdirected request', { status: 421, headers: { 'content-type': 'text/plain' } });
	}
	return resolve(event);
};
