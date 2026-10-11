import { redirect } from '@sveltejs/kit';
import { getConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { errorPage } from '#lib/server/error-page.ts';
import {
	getSession,
	LastfmError,
	NONCE_COOKIE,
	NONCE_COOKIE_PATH,
	NONCE_MAX_AGE_SECONDS
} from '#lib/server/lastfm.ts';
import { saveSession } from '#lib/server/lastfm-session.ts';
import type { RequestHandler } from './$types';

/** Last.fm redirects here with `?token=…`; exchanges it for a session and stores it. */
export const GET: RequestHandler = async ({ url, cookies, fetch }) => {
	const nonce = cookies.get(NONCE_COOKIE);
	cookies.delete(NONCE_COOKIE, { path: NONCE_COOKIE_PATH });

	if (!nonce) {
		return errorPage(
			400,
			`This Last.fm login was not started from this browser, or it took longer than ${NONCE_MAX_AGE_SECONDS / 60} minutes. Please connect again.`
		);
	}

	const token = url.searchParams.get('token');
	if (!token) {
		return errorPage(400, 'Last.fm did not send a login token. Please connect again.');
	}

	let config;
	try {
		config = getConfig();
	} catch (cause) {
		return errorPage(500, (cause as Error).message);
	}

	let session;
	try {
		session = await getSession(token, config.lastfm, fetch);
	} catch (cause) {
		if (cause instanceof LastfmError) {
			return errorPage(502, `Last.fm login failed: ${cause.message}`);
		}
		throw cause;
	}

	saveSession(getDb(), session);
	redirect(303, '/');
};
