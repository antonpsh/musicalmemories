import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from './db.ts';
import { API_ROOT, FETCH_TIMEOUT_MS, LastfmError, signParams } from './lastfm.ts';
import { clearSession, loadSession, saveSession } from './lastfm-session.ts';
import {
	getFirstScrobbleUts,
	getScrobbles,
	monthsCovering,
	NotConnectedError,
	PAGE_LIMIT,
	type ScrobbleDeps
} from './scrobbles.ts';

const credentials = { apiKey: 'key', sharedSecret: 'secret' };
const utc = (iso: string) => Date.parse(iso) / 1000;

const JAN_2015 = utc('2015-01-01T00:00:00Z');
const FEB_2015 = utc('2015-02-01T00:00:00Z');
const MAR_2015 = utc('2015-03-01T00:00:00Z');
/** "Now" for most tests: long after 2015. */
const NOW_MS = Date.parse('2026-10-09T12:00:00Z');

type Track = { uts?: number; artist: string; title: string; nowPlaying?: boolean };

/** A `user.getRecentTracks` JSON body. */
function page(tracks: Track[] | Track, totalPages: number, asObject = false) {
	const list = (Array.isArray(tracks) ? tracks : [tracks]).map((t) => ({
		artist: { mbid: '', '#text': t.artist },
		name: t.title,
		...(t.uts === undefined ? {} : { date: { uts: String(t.uts), '#text': 'x' } }),
		...(t.nowPlaying ? { '@attr': { nowplaying: 'true' } } : {})
	}));
	return {
		recenttracks: {
			track: asObject ? list[0] : list,
			'@attr': { user: 'owner', page: '1', perPage: String(PAGE_LIMIT), totalPages: String(totalPages), total: '0' }
		}
	};
}

type Responder = (params: URLSearchParams) => { status?: number; body: unknown };

/** A `fetch` stub answering each request via `respond(params)`. */
function stubFetch(respond: Responder) {
	return vi.fn(async (input: string | URL) => {
		const params = new URL(input).searchParams;
		const { status = 200, body } = respond(params);
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
}

/** Serves `pages[month start]` (1-based page list) for each month. */
function byMonth(pages: Record<number, unknown[]>): Responder {
	return (params) => {
		const start = Number(params.get('from')) + 1;
		const list = pages[start] ?? [page([], 0)];
		return { body: list[Number(params.get('page')) - 1] };
	};
}

function paramsOf(fetch: ReturnType<typeof vi.fn>, call: number): URLSearchParams {
	return new URL(fetch.mock.calls[call][0] as string | URL).searchParams;
}

let tmp: string;
let file: string;
let db: Db;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musicalimage-scrobbles-'));
	file = path.join(tmp, 'app.sqlite');
	db = openDb(file);
	saveSession(db, { username: 'owner', sessionKey: 'sk-1' });
});

afterEach(() => {
	db.close();
	fs.rmSync(tmp, { recursive: true, force: true });
});

function deps(fetch: typeof globalThis.fetch, nowMs = NOW_MS): Partial<ScrobbleDeps> {
	return { db, fetch, now: () => nowMs, credentials, session: loadSession };
}

const monthRows = () => db.prepare('SELECT month FROM scrobble_month ORDER BY month').pluck().all();
const scrobbleCount = () => db.prepare('SELECT COUNT(*) FROM scrobble').pluck().get();

describe('monthsCovering', () => {
	it('covers the range with whole UTC months, start inclusive and end exclusive', () => {
		expect(monthsCovering(utc('2015-01-30T00:00:00Z'), utc('2015-02-02T00:00:00Z'))).toEqual([
			{ key: '2015-01', start: JAN_2015, end: FEB_2015 },
			{ key: '2015-02', start: FEB_2015, end: MAR_2015 }
		]);
	});

	it('treats the last second of a month and the first of the next as different months', () => {
		expect(monthsCovering(FEB_2015 - 1, FEB_2015 - 1).map((m) => m.key)).toEqual(['2015-01']);
		expect(monthsCovering(FEB_2015, FEB_2015).map((m) => m.key)).toEqual(['2015-02']);
	});

	it('crosses a year boundary', () => {
		expect(
			monthsCovering(utc('2014-12-31T23:00:00Z'), utc('2015-01-01T01:00:00Z')).map((m) => m.key)
		).toEqual(['2014-12', '2015-01']);
	});

	it('throws RangeError for non-finite bounds', () => {
		expect(() => monthsCovering(NaN, JAN_2015)).toThrow(RangeError);
		expect(() => monthsCovering(JAN_2015, Infinity)).toThrow(RangeError);
	});

	it('throws RangeError for finite bounds beyond the Date range', () => {
		expect(() => monthsCovering(JAN_2015, 8.64e12 + 1)).toThrow(RangeError);
		expect(() => monthsCovering(-8.64e12 - 1, JAN_2015)).toThrow(RangeError);
		expect(() => monthsCovering(8.64e12 - 1, 8.64e12)).toThrow(RangeError);
	});

	it('returns no months for a reversed range', () => {
		expect(monthsCovering(FEB_2015, JAN_2015)).toEqual([]);
	});
});

describe('getScrobbles', () => {
	const from = utc('2015-01-10T00:00:00Z');
	const to = utc('2015-01-20T00:00:00Z');
	const jan = [
		page(
			[
				{ uts: utc('2015-01-15T10:00:00Z'), artist: 'B', title: 'two' },
				{ uts: utc('2015-01-05T10:00:00Z'), artist: 'A', title: 'outside' }
			],
			3
		),
		page([{ uts: utc('2015-01-12T10:00:00Z'), artist: 'A', title: 'one' }], 3),
		page(
			[
				{ uts: utc('2015-01-18T10:00:00Z'), artist: 'C', title: 'three' },
				// Duplicate of page 1's row: stored once.
				{ uts: utc('2015-01-15T10:00:00Z'), artist: 'B', title: 'two' }
			],
			3
		)
	];
	const expected = [
		{ uts: utc('2015-01-12T10:00:00Z'), artist: 'A', title: 'one' },
		{ uts: utc('2015-01-15T10:00:00Z'), artist: 'B', title: 'two' },
		{ uts: utc('2015-01-18T10:00:00Z'), artist: 'C', title: 'three' }
	];

	it('past range, cold: fetches every page signed, stores, marks complete, returns ascending', async () => {
		const fetch = stubFetch(byMonth({ [JAN_2015]: jan }));

		await expect(getScrobbles(from, to, deps(fetch))).resolves.toEqual(expected);

		expect(fetch).toHaveBeenCalledTimes(3);
		for (let i = 0; i < 3; i++) {
			const [url, init] = fetch.mock.calls[i] as [URL, RequestInit];
			expect(url.origin + url.pathname).toBe(API_ROOT);
			expect(init.signal).toBeInstanceOf(AbortSignal);
			const params = paramsOf(fetch, i);
			expect(params.get('method')).toBe('user.getRecentTracks');
			expect(params.get('page')).toBe(String(i + 1));
			expect(params.get('from')).toBe(String(JAN_2015 - 1));
			expect(params.get('to')).toBe(String(FEB_2015));
			expect(params.get('limit')).toBe('200');
			expect(params.get('sk')).toBe('sk-1');
			expect(params.get('user')).toBe('owner');
			expect(params.get('api_key')).toBe('key');
			expect(params.get('format')).toBe('json');

			const signed = Object.fromEntries(params);
			delete signed.api_sig;
			expect(params.get('api_sig')).toBe(signParams(signed, 'secret'));
			expect(params.toString()).not.toContain('secret');
		}
		expect(monthRows()).toEqual(['2015-01']);
		expect(scrobbleCount()).toBe(4);
	});

	it('past range, warm: no Last.fm call, same result', async () => {
		await getScrobbles(from, to, deps(stubFetch(byMonth({ [JAN_2015]: jan }))));
		const fetch = stubFetch(byMonth({}));

		await expect(getScrobbles(from, to, deps(fetch))).resolves.toEqual(expected);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('serves a completed month from cache after a restart', async () => {
		await getScrobbles(from, to, deps(stubFetch(byMonth({ [JAN_2015]: jan }))));
		db.close();
		db = openDb(file);
		const fetch = stubFetch(byMonth({}));

		await expect(getScrobbles(from, to, deps(fetch))).resolves.toEqual(expected);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('range spans months: fetches each once and merges', async () => {
		const fetch = stubFetch(
			byMonth({
				[JAN_2015]: [page([{ uts: FEB_2015 - 1, artist: 'A', title: 'last jan' }], 1)],
				[FEB_2015]: [page([{ uts: FEB_2015, artist: 'B', title: 'first feb' }], 1)]
			})
		);
		const range = [utc('2015-01-30T00:00:00Z'), utc('2015-02-02T00:00:00Z')] as const;

		const result = await getScrobbles(...range, deps(fetch));
		expect(result).toEqual([
			{ uts: FEB_2015 - 1, artist: 'A', title: 'last jan' },
			{ uts: FEB_2015, artist: 'B', title: 'first feb' }
		]);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(paramsOf(fetch, 0).get('from')).toBe(String(JAN_2015 - 1));
		expect(paramsOf(fetch, 0).get('to')).toBe(String(FEB_2015));
		expect(paramsOf(fetch, 1).get('from')).toBe(String(FEB_2015 - 1));
		expect(paramsOf(fetch, 1).get('to')).toBe(String(MAR_2015));

		await getScrobbles(...range, deps(fetch));
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('keeps overlap-second Scrobbles out of the neighbouring month', async () => {
		// Last.fm may return rows on the overlapping seconds; each month stores only its own.
		const fetch = stubFetch(
			byMonth({
				[FEB_2015]: [
					page(
						[
							{ uts: FEB_2015 - 1, artist: 'X', title: 'jan edge' },
							{ uts: MAR_2015, artist: 'Y', title: 'mar edge' },
							{ uts: FEB_2015 + 5, artist: 'Z', title: 'feb' }
						],
						1
					)
				]
			})
		);
		await getScrobbles(FEB_2015, MAR_2015 - 1, deps(fetch));
		expect(db.prepare('SELECT title FROM scrobble').pluck().all()).toEqual(['feb']);
	});

	it('current month: fetched on every call, rows replaced, never marked complete', async () => {
		const now = Date.parse('2026-10-09T12:00:00Z');
		const oct = utc('2026-10-01T00:00:00Z');
		let version = 1;
		const fetch = stubFetch(() => ({
			body:
				version === 1
					? page([{ uts: oct + 10, artist: 'A', title: 'old' }], 1)
					: page([{ uts: oct + 20, artist: 'B', title: 'new' }], 1)
		}));
		const range = [oct, now / 1000] as const;

		expect(await getScrobbles(...range, deps(fetch, now))).toEqual([
			{ uts: oct + 10, artist: 'A', title: 'old' }
		]);
		version = 2;
		expect(await getScrobbles(...range, deps(fetch, now))).toEqual([
			{ uts: oct + 20, artist: 'B', title: 'new' }
		]);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(monthRows()).toEqual([]);
	});

	it('grace period: re-fetched until 14 days after month end, then fetched once more and completed', async () => {
		const fetch = stubFetch(() => ({ body: page([{ uts: JAN_2015 + 5, artist: 'A', title: 'x' }], 1) }));
		const DAY = 86_400_000;
		const febMs = FEB_2015 * 1000;

		await getScrobbles(from, to, deps(fetch, febMs + 3 * DAY));
		await getScrobbles(from, to, deps(fetch, febMs + 14 * DAY - 1000));
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(monthRows()).toEqual([]);

		await getScrobbles(from, to, deps(fetch, febMs + 14 * DAY));
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(monthRows()).toEqual(['2015-01']);

		await getScrobbles(from, to, deps(fetch, febMs + 20 * DAY));
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('now playing: skips entries without a date', async () => {
		const fetch = stubFetch(() => ({
			body: page(
				[
					{ artist: 'Live', title: 'playing', nowPlaying: true },
					{ uts: JAN_2015 + 864_000, artist: 'A', title: 'played' }
				],
				1
			)
		}));
		expect(await getScrobbles(JAN_2015, FEB_2015 - 1, deps(fetch))).toEqual([
			{ uts: JAN_2015 + 864_000, artist: 'A', title: 'played' }
		]);
	});

	it('single track object: treated as a one-element list', async () => {
		const fetch = stubFetch(() => ({
			body: page({ uts: JAN_2015 + 864_000, artist: 'A', title: 'only' }, 1, true)
		}));
		expect(await getScrobbles(JAN_2015, FEB_2015 - 1, deps(fetch))).toEqual([
			{ uts: JAN_2015 + 864_000, artist: 'A', title: 'only' }
		]);
	});

	it('empty month: marked complete, empty result', async () => {
		const fetch = stubFetch(() => ({ body: page([], 0) }));
		expect(await getScrobbles(from, to, deps(fetch))).toEqual([]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(monthRows()).toEqual(['2015-01']);
	});

	it('page fails: throws LastfmError, stores nothing, not complete', async () => {
		const fetch = stubFetch((params) =>
			params.get('page') === '2'
				? { status: 500, body: { error: 8, message: 'Operation failed' } }
				: { body: page([{ uts: JAN_2015 + 864_000, artist: 'A', title: 'x' }], 3) }
		);
		const error = await getScrobbles(from, to, deps(fetch)).catch((e) => e);
		expect(error).toBeInstanceOf(LastfmError);
		expect(error).toMatchObject({ code: 8, message: 'Operation failed' });
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(scrobbleCount()).toBe(0);
		expect(monthRows()).toEqual([]);
	});

	it('page fails on a later month: earlier months stay intact, failed month not stored', async () => {
		const fetch = stubFetch((params) =>
			Number(params.get('from')) + 1 === FEB_2015
				? { status: 503, body: 'down' }
				: { body: page([{ uts: JAN_2015 + 5, artist: 'A', title: 'x' }], 1) }
		);
		const error = await getScrobbles(JAN_2015, MAR_2015 - 1, deps(fetch)).catch((e) => e);
		expect(error).toBeInstanceOf(LastfmError);
		expect(error.code).toBe(503);
		expect(monthRows()).toEqual(['2015-01']);
	});

	it.each([
		['{}', {}],
		['recenttracks without @attr.totalPages', { recenttracks: { track: [] } }],
		['non-numeric totalPages', { recenttracks: { track: [], '@attr': { totalPages: 'many' } } }],
		['empty totalPages', { recenttracks: { track: [], '@attr': { totalPages: '' } } }],
		['-1', { recenttracks: { track: [], '@attr': { totalPages: '-1' } } }]
	])('malformed 200 body (%s): throws LastfmError, stores nothing', async (_name, body) => {
		const fetch = stubFetch(() => ({ body }));
		await expect(getScrobbles(from, to, deps(fetch))).rejects.toBeInstanceOf(LastfmError);
		expect(scrobbleCount()).toBe(0);
		expect(monthRows()).toEqual([]);
	});

	it('not connected: throws NotConnectedError without a call', async () => {
		clearSession(db);
		const fetch = stubFetch(byMonth({}));
		await expect(getScrobbles(from, to, deps(fetch))).rejects.toBeInstanceOf(NotConnectedError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('future range: empty result without a call', async () => {
		const fetch = stubFetch(byMonth({}));
		const start = utc('2026-11-01T00:00:00Z');
		expect(await getScrobbles(start, start + 86_400 * 40, deps(fetch))).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('range ending in the future fetches only months started by now', async () => {
		const fetch = stubFetch(() => ({ body: page([], 0) }));
		await getScrobbles(utc('2026-10-05T00:00:00Z'), utc('2026-12-05T00:00:00Z'), deps(fetch));
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(paramsOf(fetch, 0).get('from')).toBe(String(utc('2026-10-01T00:00:00Z') - 1));
	});

	it('another Last.fm account: discards the previous account’s cache', async () => {
		await getScrobbles(from, to, deps(stubFetch(byMonth({ [JAN_2015]: jan }))));
		saveSession(db, { username: 'someone-else', sessionKey: 'sk-2' });
		const fetch = stubFetch(() => ({ body: page([], 0) }));

		expect(await getScrobbles(from, to, deps(fetch))).toEqual([]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(paramsOf(fetch, 0).get('user')).toBe('someone-else');
		expect(paramsOf(fetch, 0).get('sk')).toBe('sk-2');
	});

	it('returns only Scrobbles with from ≤ uts ≤ to (inclusive bounds)', async () => {
		const fetch = stubFetch(() => ({
			body: page(
				[
					{ uts: from - 1, artist: 'A', title: 'before' },
					{ uts: from, artist: 'A', title: 'at from' },
					{ uts: to, artist: 'A', title: 'at to' },
					{ uts: to + 1, artist: 'A', title: 'after' }
				],
				1
			)
		}));
		const result = await getScrobbles(from, to, deps(fetch));
		expect(result.map((s) => s.title)).toEqual(['at from', 'at to']);
	});

	it('throws RangeError for non-finite bounds without touching anything', async () => {
		const fetch = stubFetch(byMonth({}));
		await expect(getScrobbles(NaN, to, deps(fetch))).rejects.toBeInstanceOf(RangeError);
		await expect(getScrobbles(from, Infinity, deps(fetch))).rejects.toBeInstanceOf(RangeError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('reversed range: empty result without a call, even when not connected', async () => {
		const fetch = stubFetch(byMonth({}));
		expect(await getScrobbles(to, from, deps(fetch))).toEqual([]);
		clearSession(db);
		expect(await getScrobbles(to, from, deps(fetch))).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('maps a timeout while reading the body to LastfmError code 0, storing nothing', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new DOMException('timeout', 'TimeoutError'));
						}
					}),
					{ status: 200 }
				)
		) as unknown as typeof globalThis.fetch;

		const error = await getScrobbles(from, to, deps(fetch)).catch((e) => e);
		expect(error).toBeInstanceOf(LastfmError);
		expect(error.code).toBe(0);
		expect(scrobbleCount()).toBe(0);
		expect(monthRows()).toEqual([]);
	});

	it('passes a timeout signal and maps an abort to LastfmError code 0', async () => {
		// AbortSignal.timeout uses Node-internal timers that fake timers cannot drive,
		// so hand out a signal the test fires itself.
		const controller = new AbortController();
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
		try {
			const fetch = vi.fn(
				(_url: URL, init: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
					})
			) as unknown as typeof globalThis.fetch;

			const result = getScrobbles(from, to, deps(fetch)).catch((e) => e);
			await vi.waitFor(() => expect(timeout).toHaveBeenCalledWith(FETCH_TIMEOUT_MS));
			controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
			const error = await result;

			expect(error).toBeInstanceOf(LastfmError);
			expect(error.code).toBe(0);
			expect(monthRows()).toEqual([]);
		} finally {
			timeout.mockRestore();
		}
	});
});

describe('getFirstScrobbleUts', () => {
	/** A `user.getRecentTracks` body with `total` set. */
	function totalPage(tracks: Track[], total: number) {
		const body = page(tracks, total);
		body.recenttracks['@attr'].total = String(total);
		return body;
	}

	const firstDeps = (fetch: typeof globalThis.fetch, cache = new Map<string, number>()) => ({
		db,
		fetch,
		now: () => NOW_MS,
		credentials,
		session: loadSession,
		cache
	});

	it('reads total with limit=1, then the last page, and returns its Scrobble time', async () => {
		const oldest = utc('2008-03-02T10:00:00Z');
		const fetch = stubFetch((params) =>
			params.get('page') === '1'
				? {
						body: totalPage(
							[
								{ artist: 'Now', title: 'playing', nowPlaying: true },
								{ uts: utc('2026-10-09T10:00:00Z'), artist: 'A', title: 'latest' }
							],
							4321
						)
					}
				: { body: totalPage([{ uts: oldest, artist: 'B', title: 'first' }], 4321) }
		);

		expect(await getFirstScrobbleUts(firstDeps(fetch))).toBe(oldest);
		expect(fetch).toHaveBeenCalledTimes(2);
		const head = paramsOf(fetch, 0);
		expect(head.get('method')).toBe('user.getRecentTracks');
		expect(head.get('limit')).toBe('1');
		expect(head.get('page')).toBe('1');
		expect(head.get('sk')).toBe('sk-1');
		expect(head.get('user')).toBe('owner');
		const { api_sig, format, ...signed } = Object.fromEntries(head);
		expect(format).toBe('json');
		expect(api_sig).toBe(signParams(signed, credentials.sharedSecret));
		const last = paramsOf(fetch, 1);
		expect(last.get('limit')).toBe('1');
		expect(last.get('page')).toBe('4321');
	});

	it('pins both requests to the same end time (now)', async () => {
		const fetch = stubFetch(() => ({
			body: totalPage([{ uts: utc('2010-01-01T00:00:00Z'), artist: 'A', title: 'x' }], 2)
		}));
		await getFirstScrobbleUts(firstDeps(fetch));
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(paramsOf(fetch, 0).get('to')).toBe(String(NOW_MS / 1000));
		expect(paramsOf(fetch, 1).get('to')).toBe(String(NOW_MS / 1000));
		expect(paramsOf(fetch, 0).has('from')).toBe(false);
	});

	it('throws LastfmError, and caches nothing, when the last page is empty despite total > 0', async () => {
		const cache = new Map<string, number>();
		const fetch = stubFetch((params) =>
			params.get('page') === '1'
				? { body: totalPage([{ uts: utc('2026-10-09T10:00:00Z'), artist: 'A', title: 'x' }], 5) }
				: { body: totalPage([], 5) }
		);
		await expect(getFirstScrobbleUts(firstDeps(fetch, cache))).rejects.toBeInstanceOf(LastfmError);
		expect(cache.size).toBe(0);
	});

	it('returns null when the account has no Scrobbles, with one request', async () => {
		const fetch = stubFetch(() => ({ body: totalPage([], 0) }));
		expect(await getFirstScrobbleUts(firstDeps(fetch))).toBeNull();
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('caches the result per username', async () => {
		const cache = new Map<string, number>();
		const oldest = utc('2010-01-01T00:00:00Z');
		const fetch = stubFetch(() => ({ body: totalPage([{ uts: oldest, artist: 'A', title: 'x' }], 1) }));

		expect(await getFirstScrobbleUts(firstDeps(fetch, cache))).toBe(oldest);
		expect(await getFirstScrobbleUts(firstDeps(fetch, cache))).toBe(oldest);
		expect(fetch).toHaveBeenCalledTimes(2);

		saveSession(db, { username: 'other', sessionKey: 'sk-2' });
		await getFirstScrobbleUts(firstDeps(fetch, cache));
		expect(fetch).toHaveBeenCalledTimes(4);
	});

	it('throws NotConnectedError without a session', async () => {
		clearSession(db);
		const fetch = stubFetch(() => ({ body: totalPage([], 0) }));
		await expect(getFirstScrobbleUts(firstDeps(fetch))).rejects.toBeInstanceOf(NotConnectedError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("throws LastfmError with Last.fm's message", async () => {
		const fetch = stubFetch(() => ({ status: 403, body: { error: 9, message: 'Invalid session key' } }));
		const failure = getFirstScrobbleUts(firstDeps(fetch));
		await expect(failure).rejects.toBeInstanceOf(LastfmError);
		await expect(failure).rejects.toThrow('Invalid session key');
	});

	it('throws LastfmError when total is missing', async () => {
		const body = page([], 1) as { recenttracks: { '@attr': Record<string, string> } };
		delete body.recenttracks['@attr'].total;
		const noTotal = stubFetch(() => ({ body }));
		await expect(getFirstScrobbleUts(firstDeps(noTotal))).rejects.toBeInstanceOf(LastfmError);
	});
});
