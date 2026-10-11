import { defineEnvVars } from '@sveltejs/kit/env';

// Declares the environment variables the app reads. All are private (server-only)
// and dynamic (read from the environment when the server starts, never inlined into
// the build). They are optional here so that the server still starts with an
// incomplete `.env`; `getConfig()` in `src/lib/server/config.ts` reports every
// missing variable at once with a pointer to the README.
const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
	GOOGLE_CLIENT_ID: {
		schema: optional,
		description: 'OAuth client ID of your Google Cloud "Web application" client.'
	},
	GOOGLE_CLIENT_SECRET: {
		schema: optional,
		description: 'OAuth client secret of your Google Cloud "Web application" client.'
	},
	LASTFM_API_KEY: {
		schema: optional,
		description: 'API key of your Last.fm API account.'
	},
	LASTFM_SHARED_SECRET: {
		schema: optional,
		description: 'Shared secret of your Last.fm API account.'
	},
	DATA_DIR: {
		schema: optional,
		description: 'Directory for the local SQLite database. Defaults to `data`.'
	}
});
