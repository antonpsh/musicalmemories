import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db.ts';
import { clearSession, loadSession, saveSession } from './lastfm-session.ts';

let tmp: string;
let file: string;
let db: Db;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musicalimage-session-'));
	file = path.join(tmp, 'app.sqlite');
	db = openDb(file);
});

afterEach(() => {
	db.close();
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe('lastfm session persistence', () => {
	it('is empty on a fresh database', () => {
		expect(loadSession(db)).toBeNull();
	});

	it('round-trips and survives reopening the database (restart)', () => {
		saveSession(db, { username: 'owner', sessionKey: 'sk-1' }, 1_700_000_000);
		db.close();
		db = openDb(file);

		expect(loadSession(db)).toEqual({
			username: 'owner',
			sessionKey: 'sk-1',
			connectedAt: 1_700_000_000
		});
	});

	it('replaces the stored session on re-login', () => {
		saveSession(db, { username: 'owner', sessionKey: 'sk-1' }, 1);
		saveSession(db, { username: 'other', sessionKey: 'sk-2' }, 2);

		expect(loadSession(db)).toEqual({ username: 'other', sessionKey: 'sk-2', connectedAt: 2 });
		expect(db.prepare('SELECT COUNT(*) FROM lastfm_session').pluck().get()).toBe(1);
	});

	it('clears the stored session', () => {
		saveSession(db, { username: 'owner', sessionKey: 'sk-1' });
		clearSession(db);
		expect(loadSession(db)).toBeNull();
	});
});
