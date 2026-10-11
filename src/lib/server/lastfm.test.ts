import { describe, expect, it, vi } from 'vitest';
import {
	API_ROOT,
	authUrl,
	FETCH_TIMEOUT_MS,
	getSession,
	LastfmError,
	signParams
} from './lastfm.ts';

const config = { apiKey: 'xxx', sharedSecret: 'zzz' };

function stubFetch(status: number, body: unknown) {
	return vi.fn(async () =>
		new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
	) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('signParams', () => {
	it('matches a known vector (sorted name+value pairs, then secret, md5)', () => {
		// md5("api_keyxxxmethodauth.getSessiontokenyyyzzz")
		expect(signParams({ token: 'yyy', method: 'auth.getSession', api_key: 'xxx' }, 'zzz')).toBe(
			'75df1fdb6b738160924a52b1732fdde7'
		);
	});

	it('excludes format and callback', () => {
		const base = { token: 'yyy', method: 'auth.getSession', api_key: 'xxx' };
		expect(signParams({ ...base, format: 'json', callback: 'cb' }, 'zzz')).toBe(
			signParams(base, 'zzz')
		);
	});
});

describe('authUrl', () => {
	it('builds the last.fm authorization URL with encoded callback', () => {
		const url = new URL(authUrl('key123', 'http://localhost:3000/auth/lastfm/callback'));
		expect(url.origin + url.pathname).toBe('https://www.last.fm/api/auth/');
		expect(url.searchParams.get('api_key')).toBe('key123');
		expect(url.searchParams.get('cb')).toBe('http://localhost:3000/auth/lastfm/callback');
	});
});

describe('getSession', () => {
	it('returns username and session key on success, sending a signed request', async () => {
		const fetch = stubFetch(200, { session: { name: 'owner', key: 'sk-1', subscriber: 0 } });

		await expect(getSession('yyy', config, fetch)).resolves.toEqual({
			username: 'owner',
			sessionKey: 'sk-1'
		});

		const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(API_ROOT);
		const body = new URLSearchParams(init.body as URLSearchParams);
		expect(body.get('method')).toBe('auth.getSession');
		expect(body.get('token')).toBe('yyy');
		expect(body.get('api_key')).toBe('xxx');
		expect(body.get('format')).toBe('json');
		expect(body.get('api_sig')).toBe('75df1fdb6b738160924a52b1732fdde7');
		expect(body.toString()).not.toContain('zzz');
	});

	it("throws LastfmError with Last.fm's code and message", async () => {
		const fetch = stubFetch(403, { error: 14, message: 'Unauthorized Token' });
		const error = await getSession('yyy', config, fetch).catch((e) => e);
		expect(error).toBeInstanceOf(LastfmError);
		expect(error).toMatchObject({ code: 14, message: 'Unauthorized Token' });
	});

	it('throws LastfmError on a non-2xx response without an error body', async () => {
		const error = await getSession('yyy', config, stubFetch(503, 'Service Unavailable')).catch(
			(e) => e
		);
		expect(error).toBeInstanceOf(LastfmError);
		expect(error.code).toBe(503);
	});

	it('throws LastfmError on an unexpected 200 body', async () => {
		await expect(getSession('yyy', config, stubFetch(200, {}))).rejects.toBeInstanceOf(LastfmError);
	});

	it('treats an empty session name or key as an unexpected response', async () => {
		for (const session of [
			{ name: '', key: 'sk-1' },
			{ name: 'owner', key: '' }
		]) {
			await expect(getSession('yyy', config, stubFetch(200, { session }))).rejects.toBeInstanceOf(
				LastfmError
			);
		}
	});

	it('aborts a hung request after the timeout with LastfmError code 0', async () => {
		// AbortSignal.timeout uses Node-internal timers that fake timers cannot drive,
		// so hand out a signal the test fires itself.
		const controller = new AbortController();
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
		try {
			const fetch = vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
					})
			) as unknown as typeof globalThis.fetch;

			const result = getSession('yyy', config, fetch).catch((e) => e);
			expect(timeout).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
			controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
			const error = await result;

			expect(error).toBeInstanceOf(LastfmError);
			expect(error.code).toBe(0);
		} finally {
			timeout.mockRestore();
		}
	});

	it('throws LastfmError when Last.fm is unreachable', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof globalThis.fetch;
		await expect(getSession('yyy', config, fetch)).rejects.toMatchObject({ code: 0 });
	});
});
