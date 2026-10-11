import { json } from '@sveltejs/kit';
import { DeezerError, findPreview } from '#lib/server/deezer.ts';
import type { RequestHandler } from './$types';

const MAX_LENGTH = 300;
const headers = { 'cache-control': 'no-store' };

/** `GET /preview?artist=&title=` → `{ url, link }` (200), `{ error }` with 400/404/502. */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const artist = url.searchParams.get('artist')?.trim() ?? '';
	const title = url.searchParams.get('title')?.trim() ?? '';
	if (!artist || !title || artist.length > MAX_LENGTH || title.length > MAX_LENGTH) {
		return json({ error: 'artist and title are required' }, { status: 400, headers });
	}
	try {
		const preview = await findPreview({ artist, title }, fetch);
		if (!preview) return json({ error: 'No preview on Deezer' }, { status: 404, headers });
		return json(preview, { headers });
	} catch (cause) {
		if (cause instanceof DeezerError) return json({ error: cause.message }, { status: 502, headers });
		throw cause;
	}
};
