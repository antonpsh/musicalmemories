import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			paths: {
				// The app runs only at this origin (Last.fm/Google callbacks are registered for it).
				// adapter-node otherwise assumes https, which breaks CSRF checks on form POSTs
				// (e.g. Last.fm Disconnect) and the derived callback URL.
				origin: 'http://localhost:3000'
			}
		})
	],
	server: {
		port: 3000,
		strictPort: true
	},
	preview: {
		port: 3000,
		strictPort: true
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
