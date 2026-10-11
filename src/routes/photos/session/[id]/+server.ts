import { json } from '@sveltejs/kit';
import type { PollResponse } from '#lib/pick-status.ts';
import { clearToken, getToken, type GoogleToken } from '#lib/server/google-auth.ts';
import {
	getPendingSession,
	savePicked,
	type PendingSession,
	type PickOutcome
} from '#lib/server/picked-photos.ts';
import {
	deleteSession,
	getSession,
	GoogleApiError,
	GoogleAuthError,
	listMediaItems
} from '#lib/server/photos-picker.ts';
import type { RequestHandler } from './$types';

type Fetch = typeof globalThis.fetch;

/** Deletes the Picker session; a failure must not hide the Owner's picks. */
async function deleteQuietly(token: GoogleToken, id: string, fetch: Fetch): Promise<void> {
	try {
		await deleteSession(token.accessToken, id, fetch);
	} catch {
		// The session expires on Google's side anyway.
	}
}

async function finish(entry: PendingSession, id: string, token: GoogleToken, fetch: Fetch): Promise<PickOutcome> {
	const items = await listMediaItems(token.accessToken, id, fetch);
	await deleteQuietly(token, id, fetch);
	const outcome: PickOutcome =
		items.length === 0
			? { status: 'nothing' }
			: { status: 'done', pickId: savePicked(items, { tokenExpiresAt: token.expiresAt }).id };
	entry.outcome = outcome;
	return outcome;
}

async function timeOut(entry: PendingSession, id: string, token: GoogleToken, fetch: Fetch): Promise<PickOutcome> {
	await deleteQuietly(token, id, fetch);
	entry.outcome = { status: 'nothing' };
	return entry.outcome;
}

/**
 * Polled by `/photos/pick`: one `sessions.get` per call; once the session's deadline has
 * passed, a last `sessions.get` decides between finishing and timing out.
 * Once `mediaItemsSet`, lists the items, deletes the session and saves the picked set.
 */
export const GET: RequestHandler = async ({ params, fetch }) => {
	const answer = (body: PollResponse, status = 200) => json(body, { status, headers: { 'cache-control': 'no-store' } });

	const entry = getPendingSession(params.id);
	if (!entry) {
		return answer({ status: 'expired', message: 'This Picker session is no longer known. Please pick again.' }, 410);
	}
	if (entry.outcome) return answer(entry.outcome);

	const now = Date.now();
	const token = getToken(now);
	if (!token) return answer({ status: 'signin' });

	try {
		if (entry.finishing) return answer(await entry.finishing);
		const pastDeadline = now >= entry.deadline;

		let session;
		try {
			session = await getSession(token.accessToken, params.id, fetch);
		} catch (cause) {
			// Past the deadline Google may no longer know the session: give up instead of erroring forever.
			if (!(pastDeadline && cause instanceof GoogleApiError)) throw cause;
		}

		// Checked even past the deadline, so a pick finished in the last interval (or before a sleep) is kept.
		if (session?.mediaItemsSet) {
			entry.finishing ??= finish(entry, params.id, token, fetch);
			return answer(await entry.finishing);
		}
		if (!session || pastDeadline || session.timeoutIn <= 0) {
			entry.finishing ??= timeOut(entry, params.id, token, fetch);
			return answer(await entry.finishing);
		}
		entry.deadline = Math.min(entry.deadline, now + session.timeoutIn);
		return answer({ status: 'pending', pollInterval: session.pollInterval });
	} catch (cause) {
		entry.finishing = undefined; // let the next poll retry
		if (cause instanceof GoogleAuthError) {
			clearToken();
			return answer({ status: 'signin' });
		}
		if (cause instanceof GoogleApiError) {
			return answer({ status: 'error', message: cause.message }, 502);
		}
		throw cause;
	}
};
