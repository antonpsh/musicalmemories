import * as privateEnv from '$app/env/private';

export interface Config {
	google: {
		clientId: string;
		clientSecret: string;
	};
	lastfm: {
		apiKey: string;
		sharedSecret: string;
	};
	/** Directory holding the SQLite database file. */
	dataDir: string;
}

export const REQUIRED = [
	'GOOGLE_CLIENT_ID',
	'GOOGLE_CLIENT_SECRET',
	'LASTFM_API_KEY',
	'LASTFM_SHARED_SECRET'
] as const;

export const DEFAULT_DATA_DIR = 'data';

type Env = Record<string, string | undefined>;

/**
 * Builds the typed config from an environment record.
 * Throws one error naming every required variable that is missing or blank.
 */
export function parseConfig(env: Env): Config {
	const missing = REQUIRED.filter((name) => !env[name]?.trim());

	if (missing.length > 0) {
		throw new Error(
			`Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
				'Copy .env.example to .env and fill in every value; see the "Setup" section of README.md.'
		);
	}

	const value = (name: (typeof REQUIRED)[number]) => (env[name] as string).trim();

	return {
		google: {
			clientId: value('GOOGLE_CLIENT_ID'),
			clientSecret: value('GOOGLE_CLIENT_SECRET')
		},
		lastfm: {
			apiKey: value('LASTFM_API_KEY'),
			sharedSecret: value('LASTFM_SHARED_SECRET')
		},
		dataDir: env.DATA_DIR?.trim() || DEFAULT_DATA_DIR
	};
}

/** Reads the config from the server's runtime environment (`.env`). */
export function getConfig(): Config {
	return parseConfig({ ...privateEnv });
}
