import { getConfig } from './config.ts';
import { getDb, type Db } from './db.ts';
import {
	API_ROOT,
	FETCH_TIMEOUT_MS,
	isErrorBody,
	LastfmError,
	signParams,
	type LastfmCredentials
} from './lastfm.ts';
import { loadSession, type StoredSession } from './lastfm-session.ts';

/** One play of a Track; `uts` is when it started playing (unix seconds, UTC). */
export interface Scrobble {
	uts: number;
	artist: string;
	title: string;
}

/** One UTC calendar month: `start` inclusive, `end` exclusive (unix seconds). */
export interface Month {
	/** `YYYY-MM`. */
	key: string;
	start: number;
	end: number;
}

export interface ScrobbleDeps {
	db: Db;
	fetch: typeof globalThis.fetch;
	/** Current time in milliseconds, like `Date.now`. */
	now: () => number;
	credentials: LastfmCredentials;
	session: (db: Db) => StoredSession | null;
}

/** Scrobbles per `user.getRecentTracks` page (Last.fm's maximum). */
export const PAGE_LIMIT = 200;
/** Last.fm accepts back-dated Scrobbles up to this late; a month is settled this long after it ends. */
export const SETTLE_SECONDS = 14 * 24 * 60 * 60;

/** Thrown when Scrobbles are requested but no Last.fm account is connected. */
export class NotConnectedError extends Error {
	constructor() {
		super('No Last.fm account is connected.');
		this.name = 'NotConnectedError';
	}
}

/** Largest |unix seconds| a JS Date can represent. */
const MAX_DATE_SECONDS = 8.64e12;

function inDateRange(uts: number): boolean {
	return Number.isFinite(uts) && Math.abs(uts) <= MAX_DATE_SECONDS;
}

/** The UTC calendar months overlapping the inclusive range `[fromUts, toUts]`, ascending. */
export function monthsCovering(fromUts: number, toUts: number): Month[] {
	if (!inDateRange(fromUts) || !inDateRange(toUts)) {
		throw new RangeError(
			`Scrobble range bounds must be finite unix seconds within the Date range (got ${fromUts}, ${toUts}).`
		);
	}
	if (fromUts > toUts) return [];

	const first = new Date(fromUts * 1000);
	let year = first.getUTCFullYear();
	let month = first.getUTCMonth();
	const months: Month[] = [];

	for (;;) {
		const start = Date.UTC(year, month, 1) / 1000;
		if (start > toUts) break;
		const end = Date.UTC(year, month + 1, 1) / 1000;
		if (Number.isNaN(end)) throw new RangeError(`Scrobble range exceeds the Date range (to ${toUts}).`);
		months.push({ key: `${year}-${String(month + 1).padStart(2, '0')}`, start, end });
		month++;
		if (month === 12) {
			month = 0;
			year++;
		}
	}

	return months;
}

/**
 * The Owner's Scrobbles with `fromUts ≤ uts ≤ toUts`, ascending by time.
 * Settled months are fetched from Last.fm once and then served from SQLite;
 * unsettled months are re-fetched on every call.
 */
export async function getScrobbles(
	fromUts: number,
	toUts: number,
	deps: Partial<ScrobbleDeps> = {}
): Promise<Scrobble[]> {
	const months = monthsCovering(fromUts, toUts);
	if (months.length === 0) return [];

	const db = deps.db ?? getDb();
	const session = (deps.session ?? loadSession)(db);
	if (!session) throw new NotConnectedError();

	const nowUts = Math.floor((deps.now ?? Date.now)() / 1000);
	const pending = months.filter((m) => m.start <= nowUts);

	claimCache(db, session.username);

	const complete = db.prepare('SELECT 1 FROM scrobble_month WHERE month = ?');
	for (const month of pending) {
		if (complete.get(month.key)) continue;

		const credentials = deps.credentials ?? getConfig().lastfm;
		const fetch = deps.fetch ?? globalThis.fetch;
		const scrobbles = await fetchMonth(month, session, credentials, fetch);
		storeMonth(db, month, scrobbles, month.end + SETTLE_SECONDS <= nowUts, nowUts);
	}

	return db
		.prepare(
			'SELECT uts, artist, title FROM scrobble WHERE uts >= ? AND uts <= ? ORDER BY uts, artist, title'
		)
		.all(fromUts, toUts) as Scrobble[];
}

/** Empties the cache when it holds another Last.fm account's history, then records the owner. */
function claimCache(db: Db, username: string): void {
	const owner = db.prepare('SELECT username FROM scrobble_owner WHERE id = 1').pluck().get() as
		| string
		| undefined;
	if (owner === username) return;

	db.transaction(() => {
		db.prepare('DELETE FROM scrobble').run();
		db.prepare('DELETE FROM scrobble_month').run();
		db.prepare(
			`INSERT INTO scrobble_owner (id, username) VALUES (1, ?)
			 ON CONFLICT (id) DO UPDATE SET username = excluded.username`
		).run(username);
	})();
}

/** Replaces the month's stored Scrobbles and, if settled, marks it complete — atomically. */
function storeMonth(
	db: Db,
	month: Month,
	scrobbles: Scrobble[],
	settled: boolean,
	nowUts: number
): void {
	db.transaction(() => {
		db.prepare('DELETE FROM scrobble WHERE uts >= ? AND uts < ?').run(month.start, month.end);
		const insert = db.prepare('INSERT OR IGNORE INTO scrobble (uts, artist, title) VALUES (?, ?, ?)');
		for (const s of scrobbles) insert.run(s.uts, s.artist, s.title);
		if (settled) {
			db.prepare(
				`INSERT INTO scrobble_month (month, fetched_at) VALUES (?, ?)
				 ON CONFLICT (month) DO UPDATE SET fetched_at = excluded.fetched_at`
			).run(month.key, nowUts);
		}
	})();
}

/** Every Scrobble inside `month`, fetched page by page; throws `LastfmError` if any page fails. */
export async function fetchMonth(
	month: Month,
	session: { username: string; sessionKey: string },
	credentials: LastfmCredentials,
	fetch: typeof globalThis.fetch
): Promise<Scrobble[]> {
	const scrobbles: Scrobble[] = [];
	let page = 1;
	let totalPages: number;

	do {
		const result = await fetchPage(month, page, session, credentials, fetch);
		totalPages = result.totalPages;
		for (const s of result.scrobbles) {
			// The request overlaps the month by a second on each side; keep only its own Scrobbles.
			if (s.uts >= month.start && s.uts < month.end) scrobbles.push(s);
		}
		page++;
	} while (page <= totalPages);

	return scrobbles;
}

async function fetchPage(
	month: Month,
	page: number,
	session: { username: string; sessionKey: string },
	credentials: LastfmCredentials,
	fetch: typeof globalThis.fetch
): Promise<{ scrobbles: Scrobble[]; totalPages: number }> {
	const { scrobbles, totalPages } = await requestRecentTracks(
		{
			// Overlap by one second: Last.fm documents `from` as "after this time"
			// and leaves `to` inclusivity unstated.
			from: String(month.start - 1),
			to: String(month.end),
			limit: String(PAGE_LIMIT),
			page: String(page)
		},
		session,
		credentials,
		fetch
	);
	return { scrobbles, totalPages };
}

/** One signed `user.getRecentTracks` page; throws `LastfmError` on any failure. */
async function requestRecentTracks(
	extra: Record<string, string>,
	session: { username: string; sessionKey: string },
	credentials: LastfmCredentials,
	fetch: typeof globalThis.fetch
): Promise<{ scrobbles: Scrobble[]; totalPages: number; total: number }> {
	const params: Record<string, string> = {
		method: 'user.getRecentTracks',
		api_key: credentials.apiKey,
		sk: session.sessionKey,
		user: session.username,
		...extra
	};
	const url = new URL(API_ROOT);
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
	url.searchParams.set('api_sig', signParams(params, credentials.sharedSecret));
	url.searchParams.set('format', 'json');

	let response: Response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch (cause) {
		throw new LastfmError(0, `Could not reach Last.fm: ${(cause as Error).message}`);
	}

	let data: unknown;
	try {
		data = await response.json();
	} catch (cause) {
		if ((cause as Error)?.name === 'TimeoutError' || (cause as Error)?.name === 'AbortError') {
			throw new LastfmError(0, `Could not reach Last.fm: ${(cause as Error).message}`);
		}
		data = undefined;
	}

	if (isErrorBody(data)) throw new LastfmError(data.error, data.message);
	if (!response.ok) {
		throw new LastfmError(response.status, `Last.fm answered HTTP ${response.status}.`);
	}

	const recent = (data as { recenttracks?: unknown } | undefined)?.recenttracks;
	const attr =
		typeof recent === 'object' && recent !== null
			? (recent as { '@attr'?: { totalPages?: unknown; total?: unknown } })['@attr']
			: undefined;
	const totalPages = Number(attr?.totalPages);
	if (
		attr?.totalPages === undefined ||
		attr.totalPages === '' ||
		!Number.isInteger(totalPages) ||
		totalPages < 0
	) {
		throw new LastfmError(response.status, 'Last.fm returned an unexpected response.');
	}
	// `total` is only required by callers that use it (see `getFirstScrobbleUts`).
	const total = attr.total === undefined || attr.total === '' ? NaN : Number(attr.total);

	const track = (recent as { track?: unknown }).track;
	const entries = Array.isArray(track) ? track : track ? [track] : [];
	const scrobbles = entries.map(toScrobble).filter((s): s is Scrobble => s !== null);

	return { scrobbles, totalPages, total };
}

export type FirstScrobbleDeps = ScrobbleDeps & {
	/** Per-username cache of known first Scrobble times. */
	cache: Map<string, number>;
};

const firstScrobbleCache = new Map<string, number>();

/**
 * When the Owner's oldest Scrobble started (unix seconds), or `null` if the account has none.
 * Reads `total` with `limit=1`, then fetches the last page, which holds the oldest Scrobble.
 * Found values are cached in memory per username. Throws `NotConnectedError` or `LastfmError`.
 */
export async function getFirstScrobbleUts(
	deps: Partial<FirstScrobbleDeps> = {}
): Promise<number | null> {
	const db = deps.db ?? getDb();
	const session = (deps.session ?? loadSession)(db);
	if (!session) throw new NotConnectedError();

	const cache = deps.cache ?? firstScrobbleCache;
	const cached = cache.get(session.username);
	if (cached !== undefined) return cached;

	const credentials = deps.credentials ?? getConfig().lastfm;
	const fetch = deps.fetch ?? globalThis.fetch;
	// Pin both requests to the same end, so a Scrobble arriving in between cannot shift the pages.
	const to = String(Math.floor((deps.now ?? Date.now)() / 1000));

	const head = await requestRecentTracks({ limit: '1', page: '1', to }, session, credentials, fetch);
	if (!Number.isInteger(head.total) || head.total < 0) {
		throw new LastfmError(200, 'Last.fm returned an unexpected response.');
	}
	if (head.total === 0) return null;

	const last = await requestRecentTracks(
		{ limit: '1', page: String(head.total), to },
		session,
		credentials,
		fetch
	);
	if (last.scrobbles.length === 0) {
		throw new LastfmError(200, 'Last.fm returned an unexpected response.');
	}

	const first = Math.min(...last.scrobbles.map((s) => s.uts));
	cache.set(session.username, first);
	return first;
}

/** A Last.fm track entry as a Scrobble; `null` for "now playing" or malformed entries. */
function toScrobble(entry: unknown): Scrobble | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const { date, artist, name } = entry as {
		date?: { uts?: unknown };
		artist?: { '#text'?: unknown; name?: unknown };
		name?: unknown;
	};

	const uts = typeof date?.uts === 'string' && /^\d+$/.test(date.uts) ? Number(date.uts) : NaN;
	const artistName = artist?.['#text'] ?? artist?.name;
	if (!Number.isSafeInteger(uts) || typeof artistName !== 'string' || typeof name !== 'string') {
		return null;
	}

	return { uts, artist: artistName, title: name };
}
