/**
 * Google OAuth (authorization-code web-server flow, `access_type=online`) and the
 * in-memory access token. The token is never stored on disk and never sent to the browser.
 */
import { getConfig } from './config.ts';

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';

/** Registered as "Authorized redirect URI" of the Owner's OAuth client (README). */
export const REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
/** httpOnly cookie holding the `state` sent to Google, to bind the callback to this browser. */
export const STATE_COOKIE = 'google_auth_state';
export const STATE_COOKIE_PATH = '/auth/google';
export const STATE_MAX_AGE_SECONDS = 10 * 60;
/** Give up on a Google request after this long. */
export const FETCH_TIMEOUT_MS = 10_000;
/** Treat the token as expired this long before Google does, so no request races its expiry. */
export const EXPIRY_MARGIN_MS = 60_000;

export interface GoogleClient {
	clientId: string;
	clientSecret: string;
}

export interface GoogleToken {
	accessToken: string;
	/** When the token expires, in milliseconds since the epoch. */
	expiresAt: number;
}

/** Google rejected the access token (HTTP 401): the Owner must sign in again. */
export class GoogleAuthError extends Error {
	constructor(message = 'Google sign-in has expired.') {
		super(message);
		this.name = 'GoogleAuthError';
	}
}

/** Any other failed Google call; `status` is the HTTP status, or 0 when unreachable. */
export class GoogleApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'GoogleApiError';
		this.status = status;
	}
}

/** The Google consent page; Google then redirects to `REDIRECT_URI?code=…&state=…`. */
export function authUrl(state: string, client: Pick<GoogleClient, 'clientId'> = getConfig().google): string {
	const url = new URL(AUTH_ENDPOINT);
	url.searchParams.set('client_id', client.clientId);
	url.searchParams.set('redirect_uri', REDIRECT_URI);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', SCOPE);
	url.searchParams.set('access_type', 'online');
	url.searchParams.set('state', state);
	return url.toString();
}

/**
 * Exchanges an authorization `code` for an access token.
 * Throws `GoogleApiError` when Google refuses, or when the Photos Picker scope was not granted.
 */
export async function exchangeCode(
	code: string,
	fetch: typeof globalThis.fetch,
	client: GoogleClient = getConfig().google,
	now: () => number = Date.now
): Promise<GoogleToken> {
	let response: Response;
	try {
		response = await fetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: client.clientId,
				client_secret: client.clientSecret,
				redirect_uri: REDIRECT_URI,
				grant_type: 'authorization_code'
			}),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
	} catch (cause) {
		throw new GoogleApiError(0, `Could not reach Google: ${(cause as Error).message}`);
	}

	let data: Record<string, unknown> | undefined;
	try {
		data = (await response.json()) as Record<string, unknown>;
	} catch {
		data = undefined;
	}

	if (!response.ok) {
		const detail =
			typeof data?.error_description === 'string'
				? data.error_description
				: typeof data?.error === 'string'
					? data.error
					: `HTTP ${response.status}`;
		throw new GoogleApiError(response.status, `Google refused the sign-in: ${detail}`);
	}

	const accessToken = data?.access_token;
	const expiresIn = Number(data?.expires_in);
	if (typeof accessToken !== 'string' || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
		throw new GoogleApiError(response.status, 'Google returned an unexpected response.');
	}
	if (typeof data?.scope === 'string' && !data.scope.split(' ').includes(SCOPE)) {
		throw new GoogleApiError(
			403,
			'Access to Google Photos was not granted. Please sign in again and allow musicalimage to view the Photos you pick.'
		);
	}

	return { accessToken, expiresAt: now() + expiresIn * 1000 };
}

// One Owner per instance: a single token, in memory only.
let current: GoogleToken | null = null;

/** The current access token, or `null` when none is stored or it is (about to be) expired. */
export function getToken(now: number = Date.now()): GoogleToken | null {
	if (current && current.expiresAt - EXPIRY_MARGIN_MS <= now) current = null;
	return current;
}

export function setToken(token: GoogleToken): void {
	current = token;
}

export function clearToken(): void {
	current = null;
}
