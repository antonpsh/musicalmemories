import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db.ts';
import { clearToken, getToken, setToken } from '#lib/server/google-auth.ts';
import { saveSession } from '#lib/server/lastfm-session.ts';
import { savePicked } from '#lib/server/picked-photos.ts';

const state = vi.hoisted(() => ({ db: undefined as unknown as Db }));

vi.mock('#lib/server/config.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getConfig: () => ({
		google: { clientId: 'cid', clientSecret: 'google-secret' },
		lastfm: { apiKey: 'lastfm-key', sharedSecret: 'lastfm-secret' },
		dataDir: 'unused'
	})
}));

vi.mock('#lib/server/db.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getDb: () => state.db
}));

const { load: pickLoad } = await import('./pick/+page.server.ts');
const { GET: poll } = await import('./session/[id]/+server.ts');
const { load: photosLoad } = await import('./[pickId]/+page.server.ts');
const { GET: thumb } = await import('./[pickId]/thumb/[itemId]/+server.ts');

const TOKEN = 'access-token-xyz';
const HOUR = 60 * 60_000;
const utc = (iso: string) => Date.parse(iso) / 1000;

interface FakeItem {
	id: string;
	createTime: string;
	type?: 'PHOTO' | 'VIDEO';
}

/** A fake Photos Picker API behind the event `fetch`. */
function fakeGoogle(items: FakeItem[], opts: { setAfterPolls?: number; timeoutIn?: string } = {}) {
	const google = {
		polls: 0,
		deleted: [] as string[],
		unauthorized: false,
		thumbStatus: 200,
		thumbType: 'image/jpeg',
		createFails: false,
		getFails: false,
		listFailures: 0,
		listed: 0,
		fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
			expect(auth).toBe(`Bearer ${TOKEN}`);
			if (google.unauthorized) return new Response('', { status: 401 });

			if (url.hostname === 'lh3.googleusercontent.com') {
				if (google.thumbStatus !== 200) return new Response('nope', { status: google.thumbStatus });
				return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': google.thumbType } });
			}
			const method = init?.method ?? 'GET';
			const polling = { pollInterval: '3s', timeoutIn: opts.timeoutIn ?? '1799s' };
			if (url.pathname === '/v1/sessions' && method === 'POST') {
				if (google.createFails) return Response.json({ error: { message: 'Backend error' } }, { status: 500 });
				return Response.json({ id: 'sess-1', pickerUri: 'https://photos.google.com/picker/abc', pollingConfig: polling });
			}
			if (url.pathname === '/v1/sessions/sess-1' && method === 'GET') {
				google.polls++;
				if (google.getFails) return Response.json({ error: { message: 'Session not found' } }, { status: 404 });
				const set = google.polls > (opts.setAfterPolls ?? 0);
				return Response.json({ id: 'sess-1', pickerUri: 'https://photos.google.com/picker/abc', mediaItemsSet: set, pollingConfig: polling });
			}
			if (url.pathname === '/v1/sessions/sess-1' && method === 'DELETE') {
				google.deleted.push('sess-1');
				return Response.json({});
			}
			if (url.pathname === '/v1/mediaItems') {
				if (google.listFailures > 0) {
					google.listFailures--;
					return Response.json({ error: { message: 'Internal error' } }, { status: 500 });
				}
				google.listed++;
				return Response.json({
					mediaItems: items.map((i) => ({
						id: i.id,
						createTime: i.createTime,
						type: i.type ?? 'PHOTO',
						mediaFile: { baseUrl: `https://lh3.googleusercontent.com/${i.id}`, mimeType: 'image/jpeg' }
					}))
				});
			}
			throw new Error(`unexpected Google call ${method} ${url}`);
		})
	};
	return google;
}

/** Stubs Last.fm (global fetch) with a fixed history. */
function stubLastfm(history: { uts: number; artist: string; title: string }[], failsFor?: (from: number) => boolean) {
	const sorted = [...history].sort((a, b) => b.uts - a.uts);
	const fetch = vi.fn(async (input: string | URL) => {
		const p = new URL(String(input)).searchParams;
		if (failsFor && p.has('from') && failsFor(Number(p.get('from')))) {
			return Response.json({ error: 8, message: 'Operation failed - backend down' }, { status: 403 });
		}
		let tracks = sorted;
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
				track: tracks.map((s) => ({ artist: { '#text': s.artist }, name: s.title, date: { uts: String(s.uts) } })),
				'@attr': { page: p.get('page'), totalPages: String(totalPages), total: String(tracks.length) }
			}
		});
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

async function attempt<T>(fn: () => T | Promise<T>) {
	try {
		return { value: await fn() };
	} catch (thrown) {
		if (isRedirect(thrown)) return { redirect: thrown };
		if (isHttpError(thrown)) return { error: thrown };
		throw thrown;
	}
}

const pollOnce = async (google: ReturnType<typeof fakeGoogle>, id = 'sess-1') => {
	const response = (await poll({ params: { id }, fetch: google.fetch } as never)) as Response;
	return { status: response.status, body: await response.json() };
};

const loadPhotos = (pickId: string, tz = 'Europe/Berlin') =>
	attempt(() => photosLoad({ params: { pickId }, url: new URL(`http://localhost:3000/photos/${pickId}?tz=${tz}`) } as never)) as Promise<{
		value?: any;
		error?: any;
	}>;

const getThumb = (pickId: string, itemId: string, google: ReturnType<typeof fakeGoogle>) =>
	thumb({ params: { pickId, itemId }, fetch: google.fetch } as never) as Promise<Response>;

let users = 0;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
	state.db = openDb(':memory:');
	setToken({ accessToken: TOKEN, expiresAt: Date.now() + HOUR });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	clearToken();
	state.db.close();
});

const THREE: FakeItem[] = [
	{ id: 'c', createTime: '2015-01-20T10:00:00Z' },
	{ id: 'a', createTime: '2015-01-01T13:00:00.75Z' },
	{ id: 'b', createTime: '2015-01-01T20:00:00Z', type: 'VIDEO' }
];

describe('picking 3 Photos', () => {
	it('creates a session, polls until set, lists, deletes and shows 3 Memories with thumbnails', async () => {
		saveSession(state.db, { username: `owner-${++users}`, sessionKey: 'sk-secret' });
		stubLastfm([
			{ uts: utc('2015-01-01T12:58:00Z'), artist: 'Oasis', title: 'Wonderwall' },
			{ uts: utc('2015-01-20T10:05:00Z'), artist: 'Suede', title: 'Animal Nitrate' }
		]);
		const google = fakeGoogle(THREE, { setAfterPolls: 1 });

		const { value: pick } = await attempt(() => pickLoad({ fetch: google.fetch } as never));
		expect(pick).toEqual({ sessionId: 'sess-1', pickerUri: 'https://photos.google.com/picker/abc/autoclose', pollInterval: 3000 });

		expect(await pollOnce(google)).toEqual({ status: 200, body: { status: 'pending', pollInterval: 3000 } });
		const done = await pollOnce(google);
		expect(done.body.status).toBe('done');
		expect(google.deleted).toEqual(['sess-1']);
		// A late poll gets the same outcome without listing again.
		expect((await pollOnce(google)).body).toEqual(done.body);
		expect(google.fetch.mock.calls.filter(([u]) => String(u).includes('/mediaItems'))).toHaveLength(1);

		const { value: data } = await loadPhotos(done.body.pickId);
		expect(data.memories.map((m: any) => m.id)).toEqual(['a', 'b', 'c']);
		expect(data.memories.map((m: any) => m.taken)).toEqual(['2015-01-01 14:00', '2015-01-01 21:00', '2015-01-20 11:00']);
		expect(data.memories[0].thumb).toBe(`/photos/${done.body.pickId}/thumb/a`);
		expect(data.memories[1].video).toBe(true);
		const first = data.memories[0].memory;
		expect(first.state).toBe('memory');
		expect(first.timed).toBe(true);
		expect(first.tiers[0].heading).toBe('At the moment');
		expect(first.tiers[0].tracks[0]).toMatchObject({ title: 'Wonderwall', closest: true, time: '13:58' });

		const response = await getThumb(done.body.pickId, 'a', google);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
		expect(google.fetch.mock.calls.at(-1)?.[0]).toBe('https://lh3.googleusercontent.com/a=w512-h512');

		await getThumb(done.body.pickId, 'b', google);
		expect(google.fetch.mock.calls.at(-1)?.[0]).toBe('https://lh3.googleusercontent.com/b=w512-h512-no');

		// No secret, token or baseUrl reaches the browser…
		const payloads = JSON.stringify([pick, done.body, data]);
		for (const secret of [TOKEN, 'google-secret', 'lastfm-secret', 'sk-secret', 'lh3.googleusercontent.com']) {
			expect(payloads).not.toContain(secret);
		}
		// …and nothing about the Photos is written to SQLite.
		const tables = state.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
		const dump = JSON.stringify(tables.map(({ name }) => state.db.prepare(`SELECT * FROM "${name}"`).all()));
		for (const leak of [TOKEN, 'lh3.googleusercontent.com', 'sess-1']) expect(dump).not.toContain(leak);
	});

	it('shows an inline error for the one Memory whose listening history fails, keeping the others', async () => {
		saveSession(state.db, { username: `owner-${++users}`, sessionKey: 'sk' });
		stubLastfm(
			[
				{ uts: utc('2015-01-01T12:58:00Z'), artist: 'Oasis', title: 'Wonderwall' },
				{ uts: utc('2017-03-01T12:58:00Z'), artist: 'Blur', title: 'Song 2' }
			],
			(from) => from >= utc('2016-01-01T00:00:00Z') && from < utc('2017-01-01T00:00:00Z')
		);
		const at = (iso: string, id: string) => ({ id, captureUts: utc(iso), baseUrl: `https://lh3.googleusercontent.com/${id}`, video: false });
		const { id } = savePicked([
			at('2015-01-01T13:00:00Z', 'a'),
			at('2016-06-15T13:00:00Z', 'b'),
			at('2017-03-01T13:00:00Z', 'c')
		]);
		const { value: data, error } = await loadPhotos(id);
		expect(error).toBeUndefined();
		expect(data.memories.map((m: any) => m.memory.state)).toEqual(['memory', 'error', 'memory']);
		expect(data.memories[1].memory.message).toContain('backend down');
		expect(data.memories[1].thumb).toBe(`/photos/${id}/thumb/b`);
		expect(data.memories[2].memory.tiers[0].tracks[0].title).toBe('Song 2');
	});

	it('shows thumbnails with the Connect Last.fm prompt when Last.fm is not connected', async () => {
		const lastfm = stubLastfm([]);
		const { id } = savePicked([{ id: 'a', captureUts: utc('2015-01-01T13:00:00Z'), baseUrl: 'https://lh3.googleusercontent.com/a', video: false }]);
		const { value: data } = await loadPhotos(id);
		expect(data.memories[0].thumb).toBe(`/photos/${id}/thumb/a`);
		expect(data.memories[0].memory).toEqual({ state: 'not-connected', sessionInvalid: false });
		expect(lastfm).not.toHaveBeenCalled();
	});

	it('shows the empty Memory for a Photo with no Scrobbles', async () => {
		saveSession(state.db, { username: `owner-${++users}`, sessionKey: 'sk' });
		stubLastfm([{ uts: utc('2009-05-05T10:00:00Z'), artist: 'Early', title: 'First' }]);
		const { id } = savePicked([{ id: 'a', captureUts: utc('2015-01-01T13:00:00Z'), baseUrl: 'https://lh3.googleusercontent.com/a', video: false }]);
		const { value: data } = await loadPhotos(id);
		expect(data.memories[0].memory).toMatchObject({ state: 'memory', tiers: [], firstScrobble: '2009-05-05' });
	});

	it('computes in UTC for an unknown timezone', async () => {
		const { id } = savePicked([{ id: 'a', captureUts: utc('2015-01-01T13:00:00Z'), baseUrl: 'https://lh3.googleusercontent.com/a', video: false }]);
		const { value: data } = await loadPhotos(id, 'Mars/Base');
		expect(data).toMatchObject({ tz: 'UTC', tzFallback: true, requestedTz: 'Mars/Base' });
		expect(data.memories[0].taken).toBe('2015-01-01 13:00');
	});
});

describe('/photos/pick', () => {
	it('redirects to Google sign-in when the token has less than 45 minutes left', async () => {
		setToken({ accessToken: TOKEN, expiresAt: Date.now() + 44 * 60_000 });
		const google = fakeGoogle([]);
		const { redirect } = await attempt(() => pickLoad({ fetch: google.fetch } as never));
		expect(redirect?.location).toBe('/auth/google');
		expect(google.fetch).not.toHaveBeenCalled();
	});

	it('starts picking with 45 minutes left', async () => {
		setToken({ accessToken: TOKEN, expiresAt: Date.now() + 45 * 60_000 });
		const google = fakeGoogle([]);
		const { value } = await attempt(() => pickLoad({ fetch: google.fetch } as never));
		expect(value).toMatchObject({ sessionId: 'sess-1' });
	});

	it('answers 502 with pickAgain when Google cannot create a session', async () => {
		const google = fakeGoogle([]);
		google.createFails = true;
		const { error } = await attempt(() => pickLoad({ fetch: google.fetch } as never));
		expect(error?.status).toBe(502);
		expect(error?.body.pickAgain).toBe(true);
	});

	it('redirects to Google sign-in without a token', async () => {
		clearToken();
		const google = fakeGoogle([]);
		const { redirect } = await attempt(() => pickLoad({ fetch: google.fetch } as never));
		expect(redirect?.location).toBe('/auth/google');
		expect(google.fetch).not.toHaveBeenCalled();
	});

	it('drops the token and redirects to sign-in when Google answers 401', async () => {
		const google = fakeGoogle([]);
		google.unauthorized = true;
		const { redirect } = await attempt(() => pickLoad({ fetch: google.fetch } as never));
		expect(redirect?.location).toBe('/auth/google');
		expect(getToken()).toBeNull();
	});
});

describe('/photos/session/[id]', () => {
	it('keeps a pick finished just before the deadline', async () => {
		const google = fakeGoogle(THREE, { setAfterPolls: 1, timeoutIn: '60s' });
		await pickLoad({ fetch: google.fetch } as never);
		expect((await pollOnce(google)).body.status).toBe('pending');

		vi.setSystemTime(Date.now() + 10 * 60_000); // e.g. the laptop slept
		const { body } = await pollOnce(google);
		expect(body.status).toBe('done');
		expect(google.listed).toBe(1);
		expect(google.deleted).toEqual(['sess-1']);
	});

	it('reports nothing picked when Google no longer knows the session after the deadline', async () => {
		const google = fakeGoogle(THREE, { setAfterPolls: Infinity, timeoutIn: '60s' });
		await pickLoad({ fetch: google.fetch } as never);
		google.getFails = true;
		vi.setSystemTime(Date.now() + 61_000);
		expect((await pollOnce(google)).body).toEqual({ status: 'nothing' });
		expect(google.deleted).toEqual(['sess-1']);
	});

	it('answers 502 error when listing fails, then done once Google recovers', async () => {
		const google = fakeGoogle(THREE);
		await pickLoad({ fetch: google.fetch } as never);
		google.listFailures = 1;

		const failed = await pollOnce(google);
		expect(failed.status).toBe(502);
		expect(failed.body.status).toBe('error');
		expect(google.deleted).toEqual([]);

		const done = await pollOnce(google);
		expect(done.body.status).toBe('done');
		expect(google.listed).toBe(1);
		expect(google.deleted).toEqual(['sess-1']);
	});

	it('lists and deletes once for two concurrent polls, returning the same pickId', async () => {
		const google = fakeGoogle(THREE);
		await pickLoad({ fetch: google.fetch } as never);
		const [a, b] = await Promise.all([pollOnce(google), pollOnce(google)]);
		expect(a.body.status).toBe('done');
		expect(b.body).toEqual(a.body);
		expect(google.listed).toBe(1);
		expect(google.deleted).toEqual(['sess-1']);
	});

	it('deletes the session and reports nothing picked once timeoutIn has passed', async () => {
		const google = fakeGoogle(THREE, { setAfterPolls: Infinity, timeoutIn: '60s' });
		await pickLoad({ fetch: google.fetch } as never);
		expect((await pollOnce(google)).body.status).toBe('pending');

		vi.setSystemTime(Date.now() + 61_000);
		expect((await pollOnce(google)).body).toEqual({ status: 'nothing' });
		expect(google.deleted).toEqual(['sess-1']);
		expect(google.fetch.mock.calls.some(([u]) => String(u).includes('/mediaItems'))).toBe(false);
	});

	it('tells the page to sign in again when Google answers 401, dropping the token', async () => {
		const google = fakeGoogle(THREE);
		await pickLoad({ fetch: google.fetch } as never);
		google.unauthorized = true;
		expect((await pollOnce(google)).body).toEqual({ status: 'signin' });
		expect(getToken()).toBeNull();
	});

	it('answers 410 for a session this server did not create', async () => {
		const google = fakeGoogle([]);
		const { status, body } = await pollOnce(google, 'unknown');
		expect(status).toBe(410);
		expect(body.status).toBe('expired');
		expect(google.fetch).not.toHaveBeenCalled();
	});
});

describe('expired picked sets', () => {
	const pickedNow = () =>
		savePicked([{ id: 'a', captureUts: utc('2015-01-01T13:00:00Z'), baseUrl: 'https://lh3.googleusercontent.com/a', video: false }], {
			tokenExpiresAt: getToken()!.expiresAt
		}).id;

	it('answers 410 "pick again" for the page and the thumbnail after 60 minutes, without calling Google', async () => {
		const id = pickedNow();
		setToken({ accessToken: TOKEN, expiresAt: Date.now() + 3 * HOUR }); // a fresh sign-in does not revive it
		vi.setSystemTime(Date.now() + HOUR);
		const google = fakeGoogle([]);

		const { error } = await loadPhotos(id);
		expect(error?.status).toBe(410);
		expect(error?.body).toMatchObject({ message: 'Picked Photos expired — pick again.', pickAgain: true });
		const response = await getThumb(id, 'a', google);
		expect(response.status).toBe(410);
		expect(google.fetch).not.toHaveBeenCalled();
	});

	it('answers 410 for an unknown pick id (e.g. after a restart)', async () => {
		expect((await loadPhotos('00000000-0000-0000-0000-000000000000')).error?.status).toBe(410);
	});

	it('answers 410 once the token is gone', async () => {
		const id = pickedNow();
		clearToken();
		expect((await loadPhotos(id)).error?.status).toBe(410);
	});
});

describe('/photos/[pickId]/thumb/[itemId]', () => {
	const picked = () =>
		savePicked([{ id: 'a', captureUts: utc('2015-01-01T13:00:00Z'), baseUrl: 'https://lh3.googleusercontent.com/a', video: false }]).id;

	it('answers 502 when Google fails, storing nothing', async () => {
		const google = fakeGoogle([]);
		google.thumbStatus = 500;
		const response = await getThumb(picked(), 'a', google);
		expect(response.status).toBe(502);
	});

	it('answers 502 when Google answers with something other than an image', async () => {
		const google = fakeGoogle([]);
		google.thumbType = 'text/html';
		const response = await getThumb(picked(), 'a', google);
		expect(response.status).toBe(502);
		expect(response.headers.get('content-type')).toContain('text/plain');
	});

	it('answers 404 for an item that is not in the pick', async () => {
		const google = fakeGoogle([]);
		expect((await getThumb(picked(), 'zzz', google)).status).toBe(404);
		expect(google.fetch).not.toHaveBeenCalled();
	});

	it('drops the token on 401', async () => {
		const google = fakeGoogle([]);
		google.unauthorized = true;
		expect((await getThumb(picked(), 'a', google)).status).toBe(401);
		expect(getToken()).toBeNull();
	});
});
