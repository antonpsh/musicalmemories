import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db.ts';
import { NONCE_COOKIE, NONCE_COOKIE_PATH } from '#lib/server/lastfm.ts';
import { loadSession, saveSession } from '#lib/server/lastfm-session.ts';

const state = vi.hoisted(() => ({
	db: undefined as unknown as Db,
	configError: undefined as Error | undefined
}));

vi.mock('#lib/server/config.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getConfig: () => {
		if (state.configError) throw state.configError;
		return {
			google: { clientId: 'g', clientSecret: 'gs' },
			lastfm: { apiKey: 'test-key', sharedSecret: 'test-secret' },
			dataDir: 'unused'
		};
	}
}));

vi.mock('#lib/server/db.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getDb: () => state.db
}));

const { GET: start } = await import('./+server.ts');
const { GET: callback } = await import('./callback/+server.ts');
const { POST: disconnect } = await import('./disconnect/+server.ts');
const { load } = await import('../../+page.server.ts');

function fakeCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	const options = new Map<string, Record<string, unknown>>();
	const deleted = new Map<string, Record<string, unknown>>();
	return {
		jar,
		options,
		deleted,
		get: (name: string) => jar.get(name),
		set: (name: string, value: string, opts: Record<string, unknown>) => {
			jar.set(name, value);
			options.set(name, opts);
		},
		delete: (name: string, opts: Record<string, unknown>) => {
			jar.delete(name);
			deleted.set(name, opts);
		}
	};
}

async function run(handler: (event: any) => unknown, event: Record<string, unknown>) {
	try {
		return { response: (await handler(event)) as Response | undefined };
	} catch (thrown) {
		if (isRedirect(thrown)) return { redirect: thrown };
		throw thrown;
	}
}

function callbackEvent(query: string, cookies: ReturnType<typeof fakeCookies>, fetch = vi.fn()) {
	return {
		url: new URL(`http://localhost:3000/auth/lastfm/callback${query}`),
		cookies,
		fetch
	};
}

beforeEach(() => {
	state.db = openDb(':memory:');
	state.configError = undefined;
});

afterEach(() => {
	state.db.close();
});

describe('GET /auth/lastfm', () => {
	it('sets the nonce cookie and redirects to last.fm with the callback URL', async () => {
		const cookies = fakeCookies();
		const { redirect } = await run(start, {
			url: new URL('http://localhost:3000/auth/lastfm'),
			cookies
		});

		expect(redirect?.status).toBe(302);
		const target = new URL(redirect!.location);
		expect(target.origin + target.pathname).toBe('https://www.last.fm/api/auth/');
		expect(target.searchParams.get('api_key')).toBe('test-key');
		expect(target.searchParams.get('cb')).toBe('http://localhost:3000/auth/lastfm/callback');
		expect(cookies.jar.get(NONCE_COOKIE)).toBeTruthy();
		expect(cookies.options.get(NONCE_COOKIE)).toMatchObject({
			httpOnly: true,
			sameSite: 'lax',
			path: '/auth/lastfm',
			maxAge: 600
		});
	});

	it('does not redirect and names missing variables when config is incomplete', async () => {
		state.configError = new Error('Missing environment variables: LASTFM_API_KEY, LASTFM_SHARED_SECRET.');
		const cookies = fakeCookies();
		const { response } = await run(start, {
			url: new URL('http://localhost:3000/auth/lastfm'),
			cookies
		});

		expect(response?.status).toBe(500);
		const html = await response!.text();
		expect(html).toContain('LASTFM_API_KEY');
		expect(html).toContain('href="/"');
		expect(cookies.jar.has(NONCE_COOKIE)).toBe(false);
	});
});

describe('GET /auth/lastfm/callback', () => {
	const ok = () =>
		vi.fn(async () => Response.json({ session: { name: 'owner', key: 'sk-1', subscriber: 0 } }));

	it('stores the session, clears the nonce and redirects home', async () => {
		const cookies = fakeCookies({ [NONCE_COOKIE]: 'n' });
		const { redirect } = await run(callback, callbackEvent('?token=t', cookies, ok()));

		expect(redirect?.status).toBe(303);
		expect(redirect?.location).toBe('/');
		expect(loadSession(state.db)).toMatchObject({ username: 'owner', sessionKey: 'sk-1' });
		expect(cookies.jar.has(NONCE_COOKIE)).toBe(false);
		expect(cookies.deleted.get(NONCE_COOKIE)).toMatchObject({ path: NONCE_COOKIE_PATH });
	});

	it('replaces a stored session on re-login', async () => {
		saveSession(state.db, { username: 'old', sessionKey: 'sk-0' });
		await run(callback, callbackEvent('?token=t', fakeCookies({ [NONCE_COOKIE]: 'n' }), ok()));
		expect(loadSession(state.db)?.username).toBe('owner');
	});

	it('answers 400 without a token and leaves the session unchanged', async () => {
		saveSession(state.db, { username: 'old', sessionKey: 'sk-0' });
		const fetch = vi.fn();
		const { response } = await run(
			callback,
			callbackEvent('', fakeCookies({ [NONCE_COOKIE]: 'n' }), fetch)
		);

		expect(response?.status).toBe(400);
		expect(await response!.text()).toContain('href="/"');
		expect(fetch).not.toHaveBeenCalled();
		expect(loadSession(state.db)?.username).toBe('old');
	});

	it('answers 400 without the nonce cookie and does not call Last.fm', async () => {
		const fetch = vi.fn();
		const { response } = await run(callback, callbackEvent('?token=t', fakeCookies(), fetch));

		expect(response?.status).toBe(400);
		expect(await response!.text()).toContain('href="/"');
		expect(fetch).not.toHaveBeenCalled();
		expect(loadSession(state.db)).toBeNull();
	});

	it("answers 502 with Last.fm's message on an error and leaves the session unchanged", async () => {
		saveSession(state.db, { username: 'old', sessionKey: 'sk-0' });
		const fetch = vi.fn(async () =>
			Response.json({ error: 4, message: 'Invalid authentication token' }, { status: 403 })
		);
		const { response } = await run(
			callback,
			callbackEvent('?token=t', fakeCookies({ [NONCE_COOKIE]: 'n' }), fetch)
		);

		expect(response?.status).toBe(502);
		const html = await response!.text();
		expect(html).toContain('Invalid authentication token');
		expect(html).toContain('href="/"');
		expect(loadSession(state.db)?.username).toBe('old');
	});
});

describe('POST /auth/lastfm/disconnect', () => {
	it('deletes the stored session and redirects home', async () => {
		saveSession(state.db, { username: 'owner', sessionKey: 'sk-1' });
		const { redirect } = await run(disconnect, {});

		expect(redirect?.status).toBe(303);
		expect(redirect?.location).toBe('/');
		expect(loadSession(state.db)).toBeNull();
	});
});

describe('home page load', () => {
	it('returns null when not connected', async () => {
		expect(await load({} as never)).toEqual({ lastfm: null });
	});

	it('returns only the username when connected', async () => {
		saveSession(state.db, { username: 'owner', sessionKey: 'sk-secret-key' });
		const data = await load({} as never);

		expect(data).toEqual({ lastfm: { username: 'owner' } });
		expect(JSON.stringify(data)).not.toContain('sk-secret-key');
	});

	it('returns null instead of failing when config is incomplete', async () => {
		state.configError = new Error('Missing environment variable: LASTFM_API_KEY.');
		expect(await load({} as never)).toEqual({ lastfm: null });
	});
});
