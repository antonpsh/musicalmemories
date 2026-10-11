/**
 * Deezer public search (no key, no login) for 30-second preview clips. Preview URLs are
 * signed and expire after ~15 minutes, so they are looked up when the Owner presses play.
 */
import type { TrackRef } from '#lib/playback-links.ts';

export const DEEZER_SEARCH = 'https://api.deezer.com/search';
export const FETCH_TIMEOUT_MS = 10_000;
const RESULT_LIMIT = 10;

type Fetch = typeof globalThis.fetch;

export interface Preview {
	/** Signed 30-second MP3 URL on Deezer's CDN. */
	url: string;
	/** The Track's page on deezer.com. */
	link: string;
}

/** A failed Deezer search; `status` is the HTTP status, 200 for an error body, or 0 when unreachable. */
export class DeezerError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'DeezerError';
		this.status = status;
	}
}

/** Lowercase, no accents, no bracketed or " - …" suffixes ("(Remastered 2011)", "- Live"), letters and digits only. */
export function normalize(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
		.replace(/\s-\s.*$/, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

/** True only for `https://*.dzcdn.net/…`, Deezer's media CDN. */
export function isDeezerMediaUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname.endsWith('.dzcdn.net') && !url.username && !url.password;
	} catch {
		return false;
	}
}

interface DeezerTrack {
	title?: unknown;
	title_short?: unknown;
	link?: unknown;
	preview?: unknown;
	artist?: { name?: unknown };
}

function matches(entry: DeezerTrack, artist: string, title: string): boolean {
	const name = typeof entry.artist?.name === 'string' ? normalize(entry.artist.name) : '';
	if (!name || name !== artist) return false;
	return [entry.title, entry.title_short].some((t) => typeof t === 'string' && normalize(t) === title);
}

/** Finds the preview of the Track whose artist and title match; `null` when Deezer has none. */
export async function findPreview(track: TrackRef, fetch: Fetch): Promise<Preview | null> {
	const artist = normalize(track.artist);
	const title = normalize(track.title);
	if (!artist || !title) return null;

	const url = new URL(DEEZER_SEARCH);
	url.searchParams.set('q', `${track.artist} ${track.title}`);
	url.searchParams.set('limit', String(RESULT_LIMIT));

	let response: Response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch (cause) {
		throw new DeezerError(0, `Could not reach Deezer: ${(cause as Error).message}`);
	}
	if (!response.ok) throw new DeezerError(response.status, `Deezer answered HTTP ${response.status}`);
	let data: { data?: unknown; error?: { message?: unknown } };
	try {
		data = await response.json();
	} catch {
		throw new DeezerError(response.status, 'Deezer returned an unexpected response.');
	}
	if (data?.error) {
		const message = typeof data.error.message === 'string' ? data.error.message : 'unknown error';
		throw new DeezerError(200, `Deezer answered: ${message}`);
	}

	const entries = (Array.isArray(data?.data) ? data.data : []) as DeezerTrack[];
	const hit = entries.find((e) => matches(e, artist, title) && isDeezerMediaUrl(e.preview));
	if (!hit) return null;
	return {
		url: hit.preview as string,
		link: typeof hit.link === 'string' && hit.link.startsWith('https://www.deezer.com/') ? hit.link : ''
	};
}
