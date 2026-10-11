import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, getToken, SCOPE, STATE_COOKIE, STATE_COOKIE_PATH } from '#lib/server/google-auth.ts';

const state = vi.hoisted(() => ({ configError: undefined as Error | undefined }));

vi.mock('#lib/server/config.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getConfig: () => {
		if (state.configError) throw state.configError;
		return {
			google: { clientId: 'cid', clientSecret: 'google-secret' },
			lastfm: { apiKey: 'k', sharedSecret: 's' },
			dataDir: 'unused'
		};
	}
}));

const { GET: start } = await import('./+server.ts');
const { GET: callback } = await import('./callback/+server.ts');

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

const tokenOk = () =>
	vi.fn(async () => Response.json({ access_token: 'access-token-xyz', expires_in: 3599, scope: SCOPE }));

function callbackEvent(query: string, cookies: ReturnType<typeof fakeCookies>, fetch: unknown = tokenOk()) {
	return { url: new URL(`http://localhost:3000/auth/google/callback${query}`), cookies, fetch };
}

beforeEach(() => {
	state.configError = undefined;
	clearToken();
});

afterEach(() => clearToken());

describe('GET /auth/google', () => {
	it('sets the state cookie and redirects to Google with the same state', async () => {
		const cookies = fakeCookies();
		const { redirect } = await run(start, { url: new URL('http://localhost:3000/auth/google'), cookies });

		expect(redirect?.status).toBe(302);
		const target = new URL(redirect!.location);
		expect(target.origin).toBe('https://accounts.google.com');
		const sent = target.searchParams.get('state');
		expect(sent).toBeTruthy();
		expect(cookies.jar.get(STATE_COOKIE)).toBe(sent);
		expect(cookies.options.get(STATE_COOKIE)).toMatchObject({
			httpOnly: true,
			sameSite: 'lax',
			path: '/auth/google',
			maxAge: 600
		});
		expect(redirect!.location).not.toContain('google-secret');
	});

	it('names missing variables instead of redirecting when config is incomplete', async () => {
		state.configError = new Error('Missing environment variable: GOOGLE_CLIENT_ID.');
		const cookies = fakeCookies();
		const { response } = await run(start, { url: new URL('http://localhost:3000/auth/google'), cookies });
		expect(response?.status).toBe(500);
		expect(await response!.text()).toContain('GOOGLE_CLIENT_ID');
		expect(cookies.jar.has(STATE_COOKIE)).toBe(false);
	});
});

describe('GET /auth/google/callback', () => {
	it('stores the token in memory, clears the state cookie and returns to picking', async () => {
		const cookies = fakeCookies({ [STATE_COOKIE]: 'abc' });
		const fetch = tokenOk();
		const { redirect } = await run(callback, callbackEvent('?code=c0de&state=abc', cookies, fetch));

		expect(redirect?.status).toBe(303);
		expect(redirect?.location).toBe('/photos/pick');
		expect(getToken()?.accessToken).toBe('access-token-xyz');
		expect(cookies.jar.has(STATE_COOKIE)).toBe(false);
		expect(cookies.deleted.get(STATE_COOKIE)).toMatchObject({ path: STATE_COOKIE_PATH });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it.each([
		['state mismatch', '?code=c&state=evil', { [STATE_COOKIE]: 'abc' }],
		['no cookie', '?code=c&state=abc', {}],
		['no state param', '?code=c', { [STATE_COOKIE]: 'abc' }]
	])('answers 400 on %s and stores no token', async (_name, query, jar) => {
		const fetch = tokenOk();
		const { response } = await run(callback, callbackEvent(query, fakeCookies(jar), fetch));
		expect(response?.status).toBe(400);
		expect(await response!.text()).toContain('href="/"');
		expect(fetch).not.toHaveBeenCalled();
		expect(getToken()).toBeNull();
	});

	it('says sign-in was cancelled when the Owner denies access', async () => {
		const fetch = tokenOk();
		const { response } = await run(
			callback,
			callbackEvent('?error=access_denied&state=abc', fakeCookies({ [STATE_COOKIE]: 'abc' }), fetch)
		);
		const html = await response!.text();
		expect(html).toContain('Google sign-in was cancelled');
		expect(html).toContain('href="/"');
		expect(fetch).not.toHaveBeenCalled();
		expect(getToken()).toBeNull();
	});

	it('answers 400 without a code', async () => {
		const { response } = await run(callback, callbackEvent('?state=abc', fakeCookies({ [STATE_COOKIE]: 'abc' })));
		expect(response?.status).toBe(400);
		expect(getToken()).toBeNull();
	});

	it("answers 502 with Google's message when the exchange fails", async () => {
		const fetch = vi.fn(async () =>
			Response.json({ error: 'invalid_grant', error_description: 'Malformed auth code.' }, { status: 400 })
		);
		const { response } = await run(
			callback,
			callbackEvent('?code=c&state=abc', fakeCookies({ [STATE_COOKIE]: 'abc' }), fetch)
		);
		expect(response?.status).toBe(502);
		const html = await response!.text();
		expect(html).toContain('Malformed auth code.');
		expect(html).not.toContain('google-secret');
		expect(getToken()).toBeNull();
	});
});
