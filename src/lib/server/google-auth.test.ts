import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getConfig: () => ({
		google: { clientId: 'cid', clientSecret: 'csecret' },
		lastfm: { apiKey: 'k', sharedSecret: 's' },
		dataDir: 'unused'
	})
}));

const {
	authUrl,
	clearToken,
	exchangeCode,
	EXPIRY_MARGIN_MS,
	getToken,
	GoogleApiError,
	REDIRECT_URI,
	SCOPE,
	setToken,
	TOKEN_ENDPOINT
} = await import('./google-auth.ts');

afterEach(() => clearToken());

describe('authUrl', () => {
	it('builds an online authorization-code request for the Picker scope', () => {
		const url = new URL(authUrl('st4te'));
		expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: 'cid',
			redirect_uri: 'http://localhost:3000/auth/google/callback',
			response_type: 'code',
			scope: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
			access_type: 'online',
			state: 'st4te'
		});
		expect(url.toString()).not.toContain('csecret');
	});
});

describe('exchangeCode', () => {
	const ok = (extra: Record<string, unknown> = {}) =>
		vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
			Response.json({ access_token: 'at-1', expires_in: 3599, token_type: 'Bearer', scope: SCOPE, ...extra })
		);

	it('posts the code with client credentials and returns token and expiry', async () => {
		const fetch = ok();
		const token = await exchangeCode('the-code', fetch, undefined, () => 1_000_000);

		expect(token).toEqual({ accessToken: 'at-1', expiresAt: 1_000_000 + 3599 * 1000 });
		const [input, init] = fetch.mock.calls[0];
		expect(input).toBe(TOKEN_ENDPOINT);
		expect(init?.method).toBe('POST');
		expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
			code: 'the-code',
			client_id: 'cid',
			client_secret: 'csecret',
			redirect_uri: REDIRECT_URI,
			grant_type: 'authorization_code'
		});
	});

	it("throws GoogleApiError with Google's description on refusal", async () => {
		const fetch = vi.fn(async () =>
			Response.json({ error: 'invalid_grant', error_description: 'Bad Request' }, { status: 400 })
		);
		await expect(exchangeCode('c', fetch)).rejects.toThrow(GoogleApiError);
		await expect(exchangeCode('c', fetch)).rejects.toThrow('Bad Request');
	});

	it('throws GoogleApiError when Google is unreachable', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		await expect(exchangeCode('c', fetch)).rejects.toMatchObject({ status: 0 });
	});

	it('throws GoogleApiError on an unexpected body', async () => {
		await expect(exchangeCode('c', vi.fn(async () => Response.json({ foo: 1 })))).rejects.toThrow(
			'unexpected response'
		);
	});

	it('throws a 403 GoogleApiError when the Photos scope was not granted', async () => {
		await expect(exchangeCode('c', ok({ scope: 'openid' }))).rejects.toMatchObject({ status: 403 });
	});
});

describe('token store', () => {
	it('is empty until set and empty again after clear', () => {
		expect(getToken(0)).toBeNull();
		setToken({ accessToken: 'at', expiresAt: 10 * 60_000 });
		expect(getToken(0)).toEqual({ accessToken: 'at', expiresAt: 10 * 60_000 });
		clearToken();
		expect(getToken(0)).toBeNull();
	});

	it('drops the token shortly before it expires', () => {
		const expiresAt = 10 * 60_000;
		setToken({ accessToken: 'at', expiresAt });
		expect(getToken(expiresAt - EXPIRY_MARGIN_MS - 1)).not.toBeNull();
		expect(getToken(expiresAt - EXPIRY_MARGIN_MS)).toBeNull();
		expect(getToken(0)).toBeNull();
	});
});
