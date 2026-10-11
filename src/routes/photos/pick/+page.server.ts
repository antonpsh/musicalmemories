import { error, redirect } from '@sveltejs/kit';
import { clearToken, getToken } from '#lib/server/google-auth.ts';
import { trackSession } from '#lib/server/picked-photos.ts';
import { createSession, GoogleApiError, GoogleAuthError } from '#lib/server/photos-picker.ts';
import type { PageServerLoad } from './$types';

/** A picked set lives at most until the token expires, so picking needs this much token time left. */
export const _MIN_TOKEN_REMAINING_MS = 45 * 60_000;

/** Picker URL variant that closes its window once the Owner is done. */
function autoclose(pickerUri: string): string {
	return pickerUri.replace(/\/+$/, '') + '/autoclose';
}

/** Creates a Picker session (signing in to Google first if needed). */
export const load: PageServerLoad = async ({ fetch }) => {
	const now = Date.now();
	const token = getToken(now);
	// A nearly expired token would make the picked set expire almost at once: sign in afresh.
	if (!token || token.expiresAt - now < _MIN_TOKEN_REMAINING_MS) redirect(303, '/auth/google');

	let session;
	try {
		session = await createSession(token.accessToken, fetch);
	} catch (cause) {
		if (cause instanceof GoogleAuthError) {
			clearToken();
			redirect(303, '/auth/google');
		}
		if (cause instanceof GoogleApiError) {
			error(502, `Google Photos could not start the Picker: ${cause.message}`, { pickAgain: true });
		}
		throw cause;
	}

	trackSession(session.id, now + session.timeoutIn, now);
	// Only the session id and the Picker URL leave the server; never the token.
	return {
		sessionId: session.id,
		pickerUri: autoclose(session.pickerUri),
		pollInterval: session.pollInterval
	};
};
