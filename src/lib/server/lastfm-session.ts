import type { Db } from './db.ts';

export interface StoredSession {
	username: string;
	sessionKey: string;
	/** Unix seconds. */
	connectedAt: number;
}

/** The stored Last.fm session, or `null` when the Owner has not connected. */
export function loadSession(db: Db): StoredSession | null {
	const row = db
		.prepare('SELECT username, session_key, connected_at FROM lastfm_session WHERE id = 1')
		.get() as { username: string; session_key: string; connected_at: number } | undefined;

	return row
		? { username: row.username, sessionKey: row.session_key, connectedAt: row.connected_at }
		: null;
}

/** Stores the session, replacing any previous one (one Owner per instance). */
export function saveSession(
	db: Db,
	session: { username: string; sessionKey: string },
	now: number = Math.floor(Date.now() / 1000)
): void {
	db.prepare(
		`INSERT INTO lastfm_session (id, username, session_key, connected_at)
		 VALUES (1, ?, ?, ?)
		 ON CONFLICT (id) DO UPDATE SET
		   username = excluded.username,
		   session_key = excluded.session_key,
		   connected_at = excluded.connected_at`
	).run(session.username, session.sessionKey, now);
}

/** Deletes the stored session. */
export function clearSession(db: Db): void {
	db.prepare('DELETE FROM lastfm_session').run();
}
