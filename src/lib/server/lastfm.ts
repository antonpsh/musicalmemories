import { createHash } from 'node:crypto';

export const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
export const AUTH_ROOT = 'https://www.last.fm/api/auth/';

/** Path Last.fm redirects to after authorization (registered in README). */
export const CALLBACK_PATH = '/auth/lastfm/callback';
/** httpOnly cookie binding a callback to a login started from this browser. */
export const NONCE_COOKIE = 'lastfm_auth_nonce';
export const NONCE_COOKIE_PATH = '/auth/lastfm';
export const NONCE_MAX_AGE_SECONDS = 10 * 60;
/** Give up on a Last.fm request after this long. */
export const FETCH_TIMEOUT_MS = 10_000;

export interface LastfmCredentials {
	apiKey: string;
	sharedSecret: string;
}

export interface LastfmSession {
	username: string;
	sessionKey: string;
}

/** A failed Last.fm call; `code` is Last.fm's error code, or the HTTP status, or 0 when unreachable. */
export class LastfmError extends Error {
	readonly code: number;

	constructor(code: number, message: string) {
		super(message);
		this.name = 'LastfmError';
		this.code = code;
	}
}

/** Parameters never included in the signature. */
const UNSIGNED = new Set(['format', 'callback']);

/**
 * Last.fm `api_sig`: md5 of every parameter (except `format` and `callback`)
 * sorted by name, each written as name followed by value, then the shared secret.
 */
export function signParams(params: Record<string, string>, secret: string): string {
	const payload = Object.keys(params)
		.filter((name) => !UNSIGNED.has(name))
		.sort()
		.map((name) => name + params[name])
		.join('');

	return createHash('md5').update(payload + secret, 'utf8').digest('hex');
}

/** The last.fm page where the Owner authorizes this app; Last.fm then redirects to `callback?token=…`. */
export function authUrl(apiKey: string, callback: string): string {
	const url = new URL(AUTH_ROOT);
	url.searchParams.set('api_key', apiKey);
	url.searchParams.set('cb', callback);
	return url.toString();
}

/** Exchanges a web-auth `token` for a session via signed `auth.getSession`. */
export async function getSession(
	token: string,
	config: LastfmCredentials,
	fetch: typeof globalThis.fetch
): Promise<LastfmSession> {
	const params: Record<string, string> = {
		method: 'auth.getSession',
		api_key: config.apiKey,
		token
	};
	const body = new URLSearchParams({
		...params,
		api_sig: signParams(params, config.sharedSecret),
		format: 'json'
	});

	let response: Response;
	try {
		response = await fetch(API_ROOT, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
	} catch (cause) {
		throw new LastfmError(0, `Could not reach Last.fm: ${(cause as Error).message}`);
	}

	let data: unknown;
	try {
		data = await response.json();
	} catch {
		data = undefined;
	}

	if (isErrorBody(data)) throw new LastfmError(data.error, data.message);
	if (!response.ok) {
		throw new LastfmError(response.status, `Last.fm answered HTTP ${response.status}.`);
	}

	const session = (data as { session?: { name?: unknown; key?: unknown } } | undefined)?.session;
	if (
		typeof session?.name !== 'string' ||
		typeof session.key !== 'string' ||
		!session.name ||
		!session.key
	) {
		throw new LastfmError(response.status, 'Last.fm returned an unexpected response.');
	}

	return { username: session.name, sessionKey: session.key };
}

/** True for Last.fm's `{ error, message }` error body. */
export function isErrorBody(data: unknown): data is { error: number; message: string } {
	return (
		typeof data === 'object' &&
		data !== null &&
		'error' in data &&
		typeof (data as { error: unknown }).error === 'number' &&
		typeof (data as { message?: unknown }).message === 'string'
	);
}
