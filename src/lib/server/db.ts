import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getConfig } from './config.ts';

export type Db = Database.Database;

/**
 * Ordered schema migrations. Migration `i` brings the schema from version `i` to
 * `i + 1` (tracked in `PRAGMA user_version`). Only ever append; never edit or
 * reorder an entry that has shipped.
 */
export const migrations: string[] = [
	// 1: the Owner's Last.fm session (single row; one Owner per instance).
	`CREATE TABLE lastfm_session (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		username TEXT NOT NULL,
		session_key TEXT NOT NULL,
		connected_at INTEGER NOT NULL
	)`,
	// 2: cached Scrobbles, the settled months fully cached, and the Last.fm
	// account the cache belongs to. The primary key leads with `uts`, so range
	// queries need no extra index.
	`CREATE TABLE scrobble (
		uts INTEGER NOT NULL,
		artist TEXT NOT NULL,
		title TEXT NOT NULL,
		PRIMARY KEY (uts, artist, title)
	);
	CREATE TABLE scrobble_month (
		month TEXT PRIMARY KEY,
		fetched_at INTEGER NOT NULL
	);
	CREATE TABLE scrobble_owner (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		username TEXT NOT NULL
	)`
];

export const DB_FILE_NAME = 'musicalimage.sqlite';

/** Applies every migration newer than the database's `user_version`. */
export function migrate(db: Db, list: readonly string[] = migrations): void {
	const current = db.pragma('user_version', { simple: true }) as number;

	if (current > list.length) {
		throw new Error(
			`Database schema version ${current} is newer than this code knows (${list.length} migrations). ` +
				'Update musicalimage, or point DATA_DIR at a different folder.'
		);
	}

	for (let version = current; version < list.length; version++) {
		db.transaction(() => {
			db.exec(list[version]);
			db.pragma(`user_version = ${version + 1}`);
		})();
	}
}

/**
 * Opens (and creates, if needed) the SQLite database at `file`, creating its
 * directory, enabling WAL mode and applying pending migrations.
 */
export function openDb(file: string, list: readonly string[] = migrations): Db {
	fs.mkdirSync(path.dirname(file), { recursive: true });

	const db = new Database(file);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db, list);

	return db;
}

let instance: Db | undefined;

/** The app's database, opened lazily on first use in `DATA_DIR`. */
export function getDb(): Db {
	instance ??= openDb(path.resolve(getConfig().dataDir, DB_FILE_NAME));
	return instance;
}
