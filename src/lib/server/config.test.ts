import { describe, expect, it } from 'vitest';
import { variables } from '../../env.ts';
import { DEFAULT_DATA_DIR, parseConfig, REQUIRED } from './config.ts';

const complete = {
	GOOGLE_CLIENT_ID: 'google-id',
	GOOGLE_CLIENT_SECRET: 'google-secret',
	LASTFM_API_KEY: 'lastfm-key',
	LASTFM_SHARED_SECRET: 'lastfm-secret'
};

describe('parseConfig', () => {
	it('returns the typed config when all keys are set', () => {
		expect(parseConfig(complete)).toEqual({
			google: { clientId: 'google-id', clientSecret: 'google-secret' },
			lastfm: { apiKey: 'lastfm-key', sharedSecret: 'lastfm-secret' },
			dataDir: DEFAULT_DATA_DIR
		});
	});

	it('uses DATA_DIR when set', () => {
		expect(parseConfig({ ...complete, DATA_DIR: '/var/lib/musicalimage' }).dataDir).toBe(
			'/var/lib/musicalimage'
		);
	});

	it('throws when a key is blank', () => {
		expect(() => parseConfig({ ...complete, LASTFM_API_KEY: '' })).toThrow(/LASTFM_API_KEY/);
		expect(() => parseConfig({ ...complete, LASTFM_API_KEY: '   ' })).toThrow(/LASTFM_API_KEY/);
	});

	it('names every missing variable and points to the README', () => {
		let message = '';
		try {
			parseConfig({ GOOGLE_CLIENT_ID: 'google-id', LASTFM_API_KEY: '' });
		} catch (error) {
			message = (error as Error).message;
		}

		expect(message).toContain('GOOGLE_CLIENT_SECRET');
		expect(message).toContain('LASTFM_API_KEY');
		expect(message).toContain('LASTFM_SHARED_SECRET');
		expect(message).not.toContain('GOOGLE_CLIENT_ID');
		expect(message).toContain('README.md');
	});

	it('reads only variables declared in src/env.ts', () => {
		for (const name of [...REQUIRED, 'DATA_DIR']) {
			expect(Object.keys(variables)).toContain(name);
		}
	});
});
