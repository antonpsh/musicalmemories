import { getConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { loadSession } from '#lib/server/lastfm-session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	try {
		getConfig();
	} catch {
		// Incomplete `.env`: show the Connect link; the start route explains what is missing.
		return { lastfm: null };
	}

	const session = loadSession(getDb());
	// Only the username leaves the server; never the session key.
	return { lastfm: session ? { username: session.username } : null };
};
