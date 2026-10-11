<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PollResponse } from '#lib/pick-status.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Phase = 'idle' | 'waiting' | 'done' | 'nothing' | 'error';
	let phase = $state<Phase>('idle');
	let message = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let destroyed = false;
	let failures = 0;
	/** Wait after a failed request to our own server before polling again. */
	const RETRY_MS = 5_000;
	/** Give up after this many failed polls in a row. */
	const MAX_FAILURES = 3;

	function schedule(ms: number) {
		clearTimeout(timer);
		if (destroyed) return;
		timer = setTimeout(poll, Math.max(ms, 1_000));
	}

	function fail(text: string) {
		clearTimeout(timer);
		phase = 'error';
		message = text;
	}

	function startWaiting() {
		if (phase === 'waiting') return;
		phase = 'waiting';
		schedule(data.pollInterval);
	}

	/** Opens the Picker; must run in a click handler, or popup blockers stop it. */
	function openPicker() {
		window.open(data.pickerUri, '_blank', 'popup,noopener,width=1000,height=800');
		startWaiting();
	}

	/** A failed poll: retry, unless it was the third in a row. */
	function failedPoll(text: string) {
		failures += 1;
		if (failures >= MAX_FAILURES) fail(text);
		else schedule(RETRY_MS);
	}

	async function poll() {
		if (destroyed) return;
		let body: PollResponse;
		try {
			const response = await fetch(`/photos/session/${encodeURIComponent(data.sessionId)}`);
			body = (await response.json()) as PollResponse;
			// Error statuses carry a JSON body with a message (410 expired, 502 error); others are failures.
			if (!response.ok && body?.status !== 'expired' && body?.status !== 'error') {
				throw new Error(`HTTP ${response.status}`);
			}
		} catch {
			if (!destroyed) failedPoll('Could not check whether you finished picking.');
			return;
		}
		if (destroyed) return;

		switch (body.status) {
			case 'pending':
				failures = 0;
				schedule(body.pollInterval);
				break;
			case 'done': {
				phase = 'done';
				const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
				await goto(`/photos/${encodeURIComponent(body.pickId)}?tz=${encodeURIComponent(tz)}`);
				break;
			}
			case 'nothing':
				phase = 'nothing';
				break;
			case 'signin':
				window.location.href = '/auth/google';
				break;
			case 'expired':
				fail(body.message);
				break;
			case 'error':
				failedPoll(body.message);
				break;
			default:
				failedPoll('Got an unexpected answer while checking whether you finished picking.');
		}
	}

	onDestroy(() => {
		destroyed = true;
		clearTimeout(timer);
	});
</script>

<svelte:head>
	<title>Pick Photos – musicalimage</title>
</svelte:head>

<main>
	<p><a href="/">← musicalimage</a></p>
	<h1>Pick Photos</h1>

	{#if phase === 'idle'}
		<p>Choose up to 20 Photos in Google Photos. Each one becomes a Memory.</p>
		<p><button type="button" onclick={openPicker}>Open Google Photos</button></p>
	{:else if phase === 'waiting'}
		<p role="status">Waiting for you to pick Photos in the Google Photos window…</p>
		<p class="hint">
			No window? <a href={data.pickerUri} target="_blank" rel="noopener noreferrer">Open Google Photos here</a>.
		</p>
	{:else if phase === 'done'}
		<p role="status">Loading your Memories…</p>
	{:else if phase === 'nothing'}
		<p role="alert">Nothing was picked.</p>
		<p><a href="/photos/pick" data-sveltekit-reload>Pick again</a></p>
	{:else}
		<p role="alert">{message}</p>
		<p><a href="/photos/pick" data-sveltekit-reload>Pick again</a></p>
	{/if}
</main>

<style>
	main {
		max-width: 40rem;
		margin: 4rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.5;
	}
	.hint {
		color: #555;
		font-size: 0.9em;
	}
</style>
