import { redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { clearSession } from '#lib/server/lastfm-session.ts';
import type { RequestHandler } from './$types';

/** Forgets the stored Last.fm session. SvelteKit's origin check guards against CSRF. */
export const POST: RequestHandler = () => {
	clearSession(getDb());
	redirect(303, '/');
};
