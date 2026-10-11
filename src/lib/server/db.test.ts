import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrations, openDb, type Db } from './db.ts';

const testMigrations = [
	'CREATE TABLE a (id INTEGER PRIMARY KEY)',
	'CREATE TABLE b (id INTEGER PRIMARY KEY)'
];

let tmp: string;
const open: Db[] = [];

function track(db: Db): Db {
	open.push(db);
	return db;
}

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musicalimage-db-'));
});

afterEach(() => {
	for (const db of open.splice(0)) db.close();
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe('openDb', () => {
	it('applies the shipped migration list', () => {
		expect(Array.isArray(migrations)).toBe(true);
		const db = track(openDb(path.join(tmp, 'app.sqlite')));
		expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
	});

	it('creates the directory and file on a fresh start and runs all migrations', () => {
		const file = path.join(tmp, 'nested', 'data', 'app.sqlite');
		const db = track(openDb(file, testMigrations));

		expect(fs.existsSync(file)).toBe(true);
		expect(db.pragma('user_version', { simple: true })).toBe(testMigrations.length);
		expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.pluck()
			.all();
		expect(tables).toEqual(['a', 'b']);
	});

	it('does not re-run applied migrations on an existing database', () => {
		const file = path.join(tmp, 'app.sqlite');
		openDb(file, testMigrations).close();

		// Re-running "CREATE TABLE a" would throw "table a already exists".
		const db = track(openDb(file, testMigrations));
		expect(db.pragma('user_version', { simple: true })).toBe(testMigrations.length);
	});

	it('applies only migrations appended since the last run', () => {
		const file = path.join(tmp, 'app.sqlite');
		openDb(file, testMigrations.slice(0, 1)).close();

		const db = track(openDb(file, testMigrations));
		expect(db.pragma('user_version', { simple: true })).toBe(2);
	});

	it('refuses a database newer than the migration list', () => {
		const file = path.join(tmp, 'app.sqlite');
		openDb(file, testMigrations).close();

		expect(() => openDb(file, testMigrations.slice(0, 1))).toThrow(/newer than this code/);
	});
});
