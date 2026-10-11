import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db.ts';
import { saveSession } from '#lib/server/lastfm-session.ts';

const state = vi.hoisted(() => ({
	db: undefined as unknown as Db,
	configError: undefined as Error | undefined
}));

vi.mock('#lib/server/config.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getConfig: () => {
		if (state.configError) throw state.configError;
		return {
			google: { clientId: 'g', clientSecret: 'google-secret' },
			lastfm: { apiKey: 'test-key', sharedSecret: 'test-secret' },
			dataDir: 'unused'
		};
	}
}));

vi.mock('#lib/server/db.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getDb: () => state.db
}));

const { load } = await import('./+page.server.ts');

const utc = (iso: string) => Date.parse(iso) / 1000;
type Fixture = { uts: number; artist: string; title: string };

/** Stubs Last.fm's `user.getRecentTracks`, serving `history` (any order). */
function stubLastfm(history: Fixture[], failure?: { error: number; message: string }) {
	const sorted = [...history].sort((a, b) => b.uts - a.uts); // Last.fm: newest first
	const entry = (s: Fixture) => ({
		artist: { '#text': s.artist },
		name: s.title,
		date: { uts: String(s.uts) }
	});
	const fetch = vi.fn(async (input: string | URL) => {
		if (failure) return Response.json(failure, { status: 403 });
		const p = new URL(input).searchParams;
		let tracks: Fixture[];
		let totalPages = 1;
		if (p.has('from')) {
			tracks = sorted.filter((s) => s.uts > Number(p.get('from')) && s.uts <= Number(p.get('to')));
		} else {
			const page = Number(p.get('page'));
			tracks = sorted.slice(page - 1, page);
			totalPages = sorted.length;
		}
		return Response.json({
			recenttracks: {
				track: tracks.map(entry),
				'@attr': { page: p.get('page'), totalPages: String(totalPages), total: String(p.has('from') ? tracks.length : sorted.length) }
			}
		});
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

let users = 0;
function connect() {
	// A fresh username per test keeps the in-memory first-Scrobble cache apart.
	saveSession(state.db, { username: `owner-${++users}`, sessionKey: 'sk-secret-key' });
}

async function run(query: string) {
	try {
		return { data: (await load({ url: new URL(`http://localhost:3000/memory${query}`) } as never)) as any };
	} catch (thrown) {
		if (isHttpError(thrown)) return { error: thrown };
		throw thrown;
	}
}

/** Scrobbles around 2015-01-01 14:00 Berlin (13:00 UTC). */
const HISTORY: Fixture[] = [
	{ uts: utc('2015-01-01T12:40:00Z'), artist: 'AC/DC', title: "Don't Stop / Live" },
	{ uts: utc('2015-01-01T12:58:00Z'), artist: 'Oasis', title: 'Wonderwall' },
	{ uts: utc('2015-01-01T13:20:00Z'), artist: 'Oasis', title: 'Wonderwall' },
	{ uts: utc('2015-01-01T20:00:00Z'), artist: 'Blur', title: 'Song 2' },
	{ uts: utc('2014-12-30T10:00:00Z'), artist: 'Pulp', title: 'Common People' },
	{ uts: utc('2015-01-20T10:00:00Z'), artist: 'Suede', title: 'Animal Nitrate' },
	{ uts: utc('2009-05-05T10:00:00Z'), artist: 'Early', title: 'First' }
];

beforeEach(() => {
	state.db = openDb(':memory:');
	state.configError = undefined;
});

afterEach(() => {
	state.db.close();
	vi.unstubAllGlobals();
});

describe('GET /memory load', () => {
	it('shows That day/week/month and no At the moment for a date without time', async () => {
		connect();
		stubLastfm(HISTORY);
		const { data } = await run('?date=2015-01-01&tz=Europe/Berlin');

		expect(data.state).toBe('memory');
		expect(data.timed).toBe(false);
		expect(data.tz).toBe('Europe/Berlin');
		expect(data.tzFallback).toBe(false);
		expect(data.tiers.map((t: any) => t.heading)).toEqual(['That day', 'That week', 'That month']);
		expect(data.tiers.map((t: any) => t.range)).toEqual([
			'2015-01-01',
			'2014-12-29 – 2015-01-04',
			'2015-01-01 – 2015-01-31'
		]);
		const day = data.tiers[0];
		expect(day.tracks[0]).toMatchObject({ title: 'Wonderwall', artist: 'Oasis', plays: 2, time: null });
		expect(data.tiers[1].tracks.map((t: any) => t.title)).toContain('Common People');
		expect(data.values).toEqual({ date: '2015-01-01', time: '', tz: 'Europe/Berlin' });
	});

	it('adds At the moment with the closest Scrobble highlighted when a time is given', async () => {
		connect();
		stubLastfm(HISTORY);
		const { data } = await run('?date=2015-01-01&time=14:00&tz=Europe/Berlin');

		expect(data.timed).toBe(true);
		expect(data.tiers.map((t: any) => t.heading)).toEqual([
			'At the moment',
			'That day',
			'That week',
			'That month'
		]);
		const moment = data.tiers[0];
		expect(moment.range).toBe('2015-01-01 13:30 – 14:30');
		expect(moment.tracks.map((t: any) => [t.time, t.title, t.closest])).toEqual([
			['13:40', "Don't Stop / Live", false],
			['13:58', 'Wonderwall', true],
			['14:20', 'Wonderwall', false]
		]);
	});

	it('builds encoded YouTube and Spotify search links per Track', async () => {
		connect();
		stubLastfm(HISTORY);
		const { data } = await run('?date=2015-01-01&time=14:00&tz=Europe/Berlin');
		const track = data.tiers[0].tracks[0];
		const q = encodeURIComponent("Don't Stop / Live AC/DC");
		expect(track.youtube).toBe(`https://www.youtube.com/results?search_query=${q}`);
		expect(track.spotify).toBe(`https://open.spotify.com/search/${q}`);
	});

	it('never puts the session key or secrets into the page data', async () => {
		connect();
		stubLastfm(HISTORY);
		for (const query of ['?date=2015-01-01&time=14:00&tz=Europe/Berlin', '?date=1990-01-01&tz=UTC']) {
			const json = JSON.stringify((await run(query)).data);
			for (const secret of ['sk-secret-key', 'test-secret', 'google-secret', 'test-key']) {
				expect(json).not.toContain(secret);
			}
		}
	});

	it('returns no Tiers and the first Scrobble date when everything is empty', async () => {
		connect();
		stubLastfm(HISTORY);
		const { data } = await run('?date=2012-06-15&tz=Europe/Berlin');
		expect(data.tiers).toEqual([]);
		expect(data.firstScrobble).toBe('2009-05-05');
	});

	it('returns firstScrobble null when the account has no Scrobbles', async () => {
		connect();
		stubLastfm([]);
		const { data } = await run('?date=2012-06-15&tz=UTC');
		expect(data.tiers).toEqual([]);
		expect(data.firstScrobble).toBeNull();
	});

	it('does not ask Last.fm for future months', async () => {
		connect();
		const fetch = stubLastfm(HISTORY);
		const { data } = await run('?date=2999-01-01&time=12:00&tz=Europe/Berlin');
		expect(data.tiers).toEqual([]);
		expect(data.firstScrobble).toBe('2009-05-05');
		for (const [input] of fetch.mock.calls) {
			expect(new URL(input as string).searchParams.has('from')).toBe(false);
		}
	});

	it.each([
		['', 'date'],
		['?date=', 'date'],
		['?date=2015-13-40', 'date'],
		['?date=2015-01-01&time=7pm', 'time']
	])('answers 400 with a field error for %s and does not fetch', async (query, field) => {
		connect();
		const fetch = stubLastfm(HISTORY);
		const { error } = await run(query);
		expect(error?.status).toBe(400);
		expect(error?.body.fieldErrors?.[field as 'date' | 'time']).toBeTruthy();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('computes in UTC for an unknown timezone and says so', async () => {
		connect();
		stubLastfm(HISTORY);
		const { data } = await run('?date=2015-01-01&time=13:00&tz=Mars/Base');
		expect(data.tz).toBe('UTC');
		expect(data.tzFallback).toBe(true);
		expect(data.requestedTz).toBe('Mars/Base');
		expect(data.tiers[0].tracks.find((t: any) => t.closest)?.time).toBe('12:58');
	});

	it('reports not connected without a stored session', async () => {
		const fetch = stubLastfm(HISTORY);
		const { data } = await run('?date=2015-01-01&tz=UTC');
		expect(data.state).toBe('not-connected');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('reports not connected when the config is incomplete', async () => {
		state.configError = new Error('Missing environment variable: LASTFM_API_KEY.');
		const { data } = await run('?date=2015-01-01&tz=UTC');
		expect(data.state).toBe('not-connected');
	});

	it("answers 502 with Last.fm's message and a retry flag when Last.fm fails", async () => {
		connect();
		stubLastfm([], { error: 8, message: 'Operation failed - Most likely the backend service failed' });
		const { error } = await run('?date=2015-01-01&tz=UTC');
		expect(error?.status).toBe(502);
		expect(error?.body.message).toContain('Operation failed');
		expect(error?.body.retry).toBe(true);
	});

	it('reports not connected, with a note, when Last.fm rejects the session key (code 9)', async () => {
		connect();
		stubLastfm([], { error: 9, message: 'Invalid session key - Please re-authenticate' });
		const { data, error } = await run('?date=2015-01-01&tz=UTC');
		expect(error).toBeUndefined();
		expect(data.state).toBe('not-connected');
		expect(data.sessionInvalid).toBe(true);
	});

	it('labels an At the moment range that crosses midnight with both dates', async () => {
		connect();
		stubLastfm([{ uts: utc('2015-01-01T23:55:00Z'), artist: 'A', title: 'late' }]);
		const { data } = await run('?date=2015-01-01&time=23:50&tz=UTC');
		expect(data.tiers[0].name).toBe('moment');
		expect(data.tiers[0].range).toBe('2015-01-01 23:20 – 2015-01-02 00:20');
	});
});
