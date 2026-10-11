/** Answers of the Picker status endpoint `/photos/session/[id]`, polled by `/photos/pick`. */
export type PollResponse =
	| { status: 'done'; pickId: string }
	| { status: 'nothing' }
	| { status: 'pending'; pollInterval: number }
	| { status: 'signin' }
	| { status: 'expired'; message: string }
	| { status: 'error'; message: string };
