/**
 * Groups Scrobbles into the Tiers of a Memory (see `tiers.md`). Pure: no I/O,
 * no clock, no environment; the timezone is always a parameter.
 */
import type { Scrobble } from './server/scrobbles.ts';
import {
	addDays,
	addMonths,
	assertTimeZone,
	localDateOf,
	parseDate,
	startOfDay,
	startOfMonth,
	startOfWeek,
	mondayOf,
	type LocalDate
} from './zoned-time.ts';

/** An instant (unix seconds, UTC) or a date without time of day (`YYYY-MM-DD`, in the given timezone). */
export type CaptureTime = { uts: number } | { date: string };

export type TierName = 'moment' | 'day' | 'week' | 'month';

export interface TierTrack {
	artist: string;
	title: string;
	plays: number;
	/** First play within the Tier's range (for At the moment: the Scrobble's own time). */
	uts: number;
	/** Set on the one At the moment entry closest to the Capture Time. */
	closest?: true;
}

/** A UTC range in unix seconds: `from` inclusive, `to` exclusive. */
export interface TierRange {
	name: TierName;
	from: number;
	to: number;
}

export interface Tier extends TierRange {
	tracks: TierTrack[];
}

/** At the moment includes Scrobbles within this many seconds of the Capture Time, inclusive. */
export const MOMENT_WINDOW = 1800;

const LIMITS: Record<Exclude<TierName, 'moment'>, number> = { day: 10, week: 5, month: 5 };

/** The Tier ranges for a Capture Time, in `tiers.md` order. Throws `RangeError` on bad input. */
export function tierRanges(capture: CaptureTime, tz: string): TierRange[] {
	assertTimeZone(tz);
	let date: LocalDate;
	const ranges: TierRange[] = [];
	if ('uts' in capture) {
		const c = capture.uts;
		if (typeof c !== 'number' || !Number.isFinite(c)) throw new RangeError(`Invalid uts: ${c}`);
		// Half-open like the others; with integer Scrobble times this includes c + MOMENT_WINDOW.
		ranges.push({ name: 'moment', from: Math.ceil(c - MOMENT_WINDOW), to: Math.floor(c + MOMENT_WINDOW) + 1 });
		date = localDateOf(c, tz);
	} else {
		date = parseDate(capture.date);
	}
	ranges.push(
		{ name: 'day', from: startOfDay(date, tz), to: startOfDay(addDays(date, 1), tz) },
		{ name: 'week', from: startOfWeek(date, tz), to: startOfDay(addDays(mondayOf(date), 7), tz) },
		{ name: 'month', from: startOfMonth(date, tz), to: startOfDay(addMonths(date, 1), tz) }
	);
	return ranges;
}

/** The single UTC range (`from` inclusive, `to` exclusive) a caller must fetch to cover every Tier. */
export function fetchRange(capture: CaptureTime, tz: string): { from: number; to: number } {
	const ranges = tierRanges(capture, tz);
	return {
		from: Math.min(...ranges.map((r) => r.from)),
		to: Math.max(...ranges.map((r) => r.to))
	};
}

const norm = (s: string) => s.trim().toLowerCase();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The non-empty Tiers for a Capture Time, in `tiers.md` order; `[]` when all are empty. */
export function computeTiers(capture: CaptureTime, tz: string, scrobbles: readonly Scrobble[]): Tier[] {
	const ranges = tierRanges(capture, tz);
	// Stable sort: equal times keep input order.
	const sorted = [...scrobbles].sort((a, b) => a.uts - b.uts);
	const tiers: Tier[] = [];
	for (const range of ranges) {
		const tracks =
			range.name === 'moment'
				? momentTracks((capture as { uts: number }).uts, sorted)
				: rankTracks(
						sorted.filter((s) => s.uts >= range.from && s.uts < range.to),
						LIMITS[range.name]
					);
		if (tracks.length > 0) tiers.push({ ...range, tracks });
	}
	return tiers;
}

/** Individual Scrobbles within the window, chronological; the closest (earlier on a tie) flagged. */
function momentTracks(capture: number, sorted: readonly Scrobble[]): TierTrack[] {
	const tracks: TierTrack[] = sorted
		.filter((s) => Math.abs(s.uts - capture) <= MOMENT_WINDOW)
		.map((s) => ({ artist: s.artist, title: s.title, plays: 1, uts: s.uts }));
	let best = -1;
	for (let i = 0; i < tracks.length; i++) {
		if (best < 0 || Math.abs(tracks[i].uts - capture) < Math.abs(tracks[best].uts - capture)) best = i;
	}
	if (best >= 0) tracks[best].closest = true;
	return tracks;
}

/** Aggregates chronological Scrobbles into Tracks and ranks them. */
function rankTracks(sorted: readonly Scrobble[], limit: number): TierTrack[] {
	const byKey = new Map<string, TierTrack & { a: string; t: string }>();
	for (const s of sorted) {
		const a = norm(s.artist);
		const t = norm(s.title);
		const key = `${a}\u0000${t}`;
		const existing = byKey.get(key);
		if (existing) existing.plays++;
		else byKey.set(key, { artist: s.artist, title: s.title, plays: 1, uts: s.uts, a, t });
	}
	return [...byKey.values()]
		.sort((x, y) => y.plays - x.plays || x.uts - y.uts || cmp(x.a, y.a) || cmp(x.t, y.t))
		.slice(0, limit)
		.map(({ artist, title, plays, uts }) => ({ artist, title, plays, uts }));
}
