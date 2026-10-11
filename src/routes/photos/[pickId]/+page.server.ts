import { error } from '@sveltejs/kit';
import { resolveTimeZone } from '#lib/memory-input.ts';
import { getToken } from '#lib/server/google-auth.ts';
import type { MemoryView } from '#lib/memory-view.ts';
import { LastfmError } from '#lib/server/lastfm.ts';
import { computeMemory } from '#lib/server/memory.ts';
import { getPicked } from '#lib/server/picked-photos.ts';
import { formatLocalDate, formatLocalTime } from '#lib/zoned-time.ts';
import type { PageServerLoad } from './$types';

const EXPIRED_MESSAGE = 'Picked Photos expired — pick again.';

/** One Memory per picked Photo, ascending by Capture Time. */
export const load: PageServerLoad = async ({ params, url }) => {
	const now = Date.now();
	const set = getPicked(params.pickId, now);
	// The thumbnails need both the picked `baseUrl`s and a valid token; without either nothing is shown.
	if (!set || !getToken(now)) error(410, EXPIRED_MESSAGE, { pickAgain: true });

	const requestedTz = (url.searchParams.get('tz') ?? '').trim();
	const { tz, tzFallback } = resolveTimeZone(requestedTz);

	const memories = [];
	// Sequential: Memories close in time share months that the first one caches in SQLite.
	for (const item of set.items) {
		let memory: MemoryView;
		try {
			memory = await computeMemory({ uts: item.captureUts }, tz);
		} catch (cause) {
			// One failed Memory must not hide the others; it keeps its thumbnail.
			if (!(cause instanceof LastfmError)) throw cause;
			memory = { state: 'error', message: cause.message };
		}
		memories.push({
			id: item.id,
			video: item.video,
			taken: `${formatLocalDate(item.captureUts, tz)} ${formatLocalTime(item.captureUts, tz)}`,
			thumb: `/photos/${encodeURIComponent(set.id)}/thumb/${encodeURIComponent(item.id)}`,
			memory
		});
	}

	// No `baseUrl`, token or secret leaves the server: thumbnails go through the proxy route.
	return { tz, tzFallback, requestedTz, memories };
};
