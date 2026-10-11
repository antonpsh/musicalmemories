import { timingSafeEqual } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import { getConfig } from '#lib/server/config.ts';
import { errorPage } from '#lib/server/error-page.ts';
import {
	exchangeCode,
	GoogleApiError,
	setToken,
	STATE_COOKIE,
	STATE_COOKIE_PATH,
	STATE_MAX_AGE_SECONDS
} from '#lib/server/google-auth.ts';
import type { RequestHandler } from './$types';

function sameState(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/** Google redirects here with `?code=…&state=…` (or `?error=…`); stores the access token in memory. */
export const GET: RequestHandler = async ({ url, cookies, fetch }) => {
	const expected = cookies.get(STATE_COOKIE);
	cookies.delete(STATE_COOKIE, { path: STATE_COOKIE_PATH });

	const googleError = url.searchParams.get('error');
	if (googleError === 'access_denied') {
		return errorPage(400, 'Google sign-in was cancelled.');
	}
	if (googleError) {
		return errorPage(400, `Google sign-in failed: ${googleError}. Please try again.`);
	}

	const state = url.searchParams.get('state');
	if (!expected || !state || !sameState(state, expected)) {
		return errorPage(
			400,
			`This Google sign-in was not started from this browser, or it took longer than ${STATE_MAX_AGE_SECONDS / 60} minutes. Please try again.`
		);
	}

	const code = url.searchParams.get('code');
	if (!code) {
		return errorPage(400, 'Google did not send a sign-in code. Please try again.');
	}

	let google;
	try {
		google = getConfig().google;
	} catch (cause) {
		return errorPage(500, (cause as Error).message);
	}

	try {
		setToken(await exchangeCode(code, fetch, google));
	} catch (cause) {
		if (cause instanceof GoogleApiError) {
			return errorPage(cause.status === 403 ? 403 : 502, cause.message);
		}
		throw cause;
	}

	redirect(303, '/photos/pick');
};
