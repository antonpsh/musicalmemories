import { randomBytes } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import { getConfig } from '#lib/server/config.ts';
import { errorPage } from '#lib/server/error-page.ts';
import {
	authUrl,
	STATE_COOKIE,
	STATE_COOKIE_PATH,
	STATE_MAX_AGE_SECONDS
} from '#lib/server/google-auth.ts';
import type { RequestHandler } from './$types';

/** Starts Google sign-in: sets the `state` cookie and sends the Owner to Google's consent page. */
export const GET: RequestHandler = ({ cookies }) => {
	let google;
	try {
		google = getConfig().google;
	} catch (cause) {
		return errorPage(500, (cause as Error).message);
	}

	const state = randomBytes(32).toString('base64url');
	cookies.set(STATE_COOKIE, state, {
		path: STATE_COOKIE_PATH,
		httpOnly: true,
		sameSite: 'lax',
		maxAge: STATE_MAX_AGE_SECONDS
	});

	redirect(302, authUrl(state, google), { external: ['https://accounts.google.com'] });
};
