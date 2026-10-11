// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			/** Per-field messages for an invalid Memory form (status 400). */
			fieldErrors?: { date?: string; time?: string };
			/** True when retrying the same request may succeed (e.g. a Last.fm failure). */
			retry?: boolean;
			/** True when the Owner should start a new Photo pick (e.g. the picked set expired). */
			pickAgain?: boolean;
		}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
