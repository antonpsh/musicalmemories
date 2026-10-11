import { error } from '@sveltejs/kit';
import { spotifySearchUrl, youtubeSearchUrl } from '#lib/playback-links.ts';
import type { CaptureTime, Tier, TierName } from '#lib/tiers.ts';
import { computeTiers, fetchRange } from '#lib/tiers.ts';
import type { LoadedMemory, TierView } from '#lib/memory-view.ts';
import { formatLocalDate, formatLocalTime } from '#lib/zoned-time.ts';
import { getConfig } from './config.ts';
import { LastfmError } from './lastfm.ts';
import { getFirstScrobbleUts, getScrobbles, NotConnectedError } from './scrobbles.ts';

/** Last.fm error code for a revoked or expired session key. */
const INVALID_SESSION_KEY = 9;

export type { LoadedMemory, MemoryView, TierView, TrackView } from '#lib/memory-view.ts';

export const HEADINGS: Record<TierName, string> = {
	moment: 'At the moment',
	day: 'That day',
	week: 'That week',
	month: 'That month'
};

/** The local date range of a Tier, as shown under its heading (`to` is exclusive). */
export function rangeLabel(tier: Tier, tz: string): string {
	const from = formatLocalDate(tier.from, tz);
	const last = tier.to - 1;
	if (tier.name === 'moment') {
		const lastDate = formatLocalDate(last, tz);
		return `${from} ${formatLocalTime(tier.from, tz)} – ${lastDate === from ? '' : lastDate + ' '}${formatLocalTime(last, tz)}`;
	}
	const to = formatLocalDate(last, tz);
	return from === to ? from : `${from} – ${to}`;
}

function tierView(tier: Tier, tz: string): TierView {
	return {
		name: tier.name,
		heading: HEADINGS[tier.name],
		range: rangeLabel(tier, tz),
		tracks: tier.tracks.map((track) => ({
			artist: track.artist,
			title: track.title,
			plays: track.plays,
			closest: track.closest === true,
			time: tier.name === 'moment' ? formatLocalTime(track.uts, tz) : null,
			youtube: youtubeSearchUrl(track),
			spotify: spotifySearchUrl(track)
		}))
	};
}

/**
 * The Memory view model for a Capture Time: `fetchRange` → `getScrobbles` → `computeTiers`,
 * plus the first-Scrobble date when every Tier is empty.
 * Not connected (or incomplete config, or a revoked session) → `not-connected`.
 * Other Last.fm failures are thrown as `LastfmError`.
 */
export async function computeMemory(capture: CaptureTime, tz: string): Promise<LoadedMemory> {
	try {
		getConfig();
	} catch {
		// Incomplete `.env`: nothing can be connected; the Connect route explains what is missing.
		return { state: 'not-connected', sessionInvalid: false };
	}

	try {
		const range = fetchRange(capture, tz);
		// `fetchRange` ends exclusive; `getScrobbles` takes an inclusive end.
		const scrobbles = await getScrobbles(range.from, range.to - 1);
		const tiers = computeTiers(capture, tz, scrobbles);
		let firstScrobble: string | null = null;
		if (tiers.length === 0) {
			const first = await getFirstScrobbleUts();
			firstScrobble = first === null ? null : formatLocalDate(first, tz);
		}
		return {
			state: 'memory',
			timed: 'uts' in capture,
			firstScrobble,
			tiers: tiers.map((tier) => tierView(tier, tz))
		};
	} catch (cause) {
		if (cause instanceof NotConnectedError) return { state: 'not-connected', sessionInvalid: false };
		if (cause instanceof LastfmError && cause.code === INVALID_SESSION_KEY) {
			// Retrying cannot help: the Owner must log in to Last.fm again.
			return { state: 'not-connected', sessionInvalid: true };
		}
		throw cause;
	}
}

/** `computeMemory`, with other Last.fm failures as a SvelteKit 502 error with `retry: true`. */
export async function buildMemory(capture: CaptureTime, tz: string): Promise<LoadedMemory> {
	try {
		return await computeMemory(capture, tz);
	} catch (cause) {
		if (cause instanceof LastfmError) {
			error(502, `Last.fm could not load your listening history: ${cause.message}`, {
				retry: true
			});
		}
		throw cause;
	}
}
