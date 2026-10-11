import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import { getConfig } from '#lib/server/config.ts';
import { errorPage } from '#lib/server/error-page.ts';
import {
	authUrl,
	CALLBACK_PATH,
	NONCE_COOKIE,
	NONCE_COOKIE_PATH,
	NONCE_MAX_AGE_SECONDS
} from '#lib/server/lastfm.ts';
import type { RequestHandler } from './$types';

/** Starts Last.fm web auth: sets the nonce cookie and sends the Owner to last.fm. */
export const GET: RequestHandler = ({ url, cookies }) => {
	let apiKey: string;
	try {
		apiKey = getConfig().lastfm.apiKey;
	} catch (cause) {
		return errorPage(500, (cause as Error).message);
	}

	cookies.set(NONCE_COOKIE, randomUUID(), {
		path: NONCE_COOKIE_PATH,
		httpOnly: true,
		sameSite: 'lax',
		maxAge: NONCE_MAX_AGE_SECONDS
	});

	redirect(302, authUrl(apiKey, new URL(CALLBACK_PATH, url.origin).toString()), {
		external: ['https://www.last.fm']
	});
};
