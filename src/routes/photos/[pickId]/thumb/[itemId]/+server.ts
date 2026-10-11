import { clearToken, getToken } from '#lib/server/google-auth.ts';
import { getPicked } from '#lib/server/picked-photos.ts';
import { fetchThumbnail, GoogleApiError, GoogleAuthError } from '#lib/server/photos-picker.ts';
import type { RequestHandler } from './$types';

function text(status: number, message: string): Response {
	return new Response(message, {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
}

/** Streams a picked Photo's thumbnail from Google with the Bearer token; nothing is stored. */
export const GET: RequestHandler = async ({ params, fetch }) => {
	const now = Date.now();
	const set = getPicked(params.pickId, now);
	const token = getToken(now);
	if (!set || !token) return text(410, 'Picked Photos expired — pick again.');

	const item = set.items.find((candidate) => candidate.id === params.itemId);
	if (!item) return text(404, 'No such Photo in this pick.');

	let upstream: Response;
	try {
		upstream = await fetchThumbnail(token.accessToken, item.baseUrl, item.video, fetch);
	} catch (cause) {
		if (cause instanceof GoogleAuthError) {
			clearToken();
			return text(401, 'Google sign-in has expired.');
		}
		if (cause instanceof GoogleApiError) return text(502, cause.message);
		throw cause;
	}

	const contentType = upstream.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().startsWith('image/')) {
		await upstream.body?.cancel();
		return text(502, 'Google Photos did not return an image.');
	}

	return new Response(upstream.body, {
		status: 200,
		headers: {
			'content-type': contentType,
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff'
		}
	});
};
