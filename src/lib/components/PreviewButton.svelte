<script lang="ts" module>
	/** One clip plays (or loads) at a time across all buttons on the page. */
	let current: (() => void) | null = null;
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	interface Props {
		artist: string;
		title: string;
	}

	let { artist, title }: Props = $props();
	let state = $state<'idle' | 'loading' | 'playing' | 'unavailable' | 'error'>('idle');
	let audio: HTMLAudioElement | null = null;
	let request: AbortController | null = null;
	/** Bumped on every start and stop, so a late response of an older attempt is ignored. */
	let attempt = 0;

	function release() {
		request?.abort();
		request = null;
		if (audio) {
			audio.removeEventListener('ended', stop);
			audio.pause();
			audio.removeAttribute('src');
			audio.load();
			audio = null;
		}
		if (current === stop) current = null;
	}

	function stop() {
		attempt++;
		release();
		if (state === 'playing' || state === 'loading') state = 'idle';
	}

	async function start() {
		current?.();
		const mine = ++attempt;
		current = stop;
		request = new AbortController();
		state = 'loading';
		try {
			const params = new URLSearchParams({ artist, title });
			const response = await fetch(`/preview?${params}`, { signal: request.signal });
			if (mine !== attempt) return;
			if (response.status === 404) {
				release();
				state = 'unavailable';
				return;
			}
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const { url } = (await response.json()) as { url: string };
			if (mine !== attempt) return;
			// A fresh element per play: the signed URL expires after ~15 minutes.
			audio = new Audio(url);
			audio.addEventListener('ended', stop);
			await audio.play();
			if (mine === attempt) state = 'playing';
		} catch {
			if (mine !== attempt) return;
			release();
			state = 'error';
		}
	}

	function toggle() {
		if (state === 'unavailable') return;
		if (state === 'playing' || state === 'loading') stop();
		else void start();
	}

	onDestroy(stop);

	const label = $derived(
		{
			idle: `Play 30-second preview of ${title} by ${artist}`,
			loading: `Loading preview of ${title}`,
			playing: `Stop preview of ${title}`,
			unavailable: `No preview available for ${title}`,
			error: `Preview of ${title} failed, try again`
		}[state]
	);
	const status = $derived(
		state === 'unavailable' ? `No preview available for ${title}` : state === 'error' ? `Preview of ${title} failed` : ''
	);
</script>

<button
	type="button"
	class="preview"
	class:playing={state === 'playing'}
	class:unavailable={state === 'unavailable'}
	onclick={toggle}
	aria-pressed={state === 'playing'}
	aria-disabled={state === 'unavailable'}
	aria-label={label}
	title={label}
>
	{#if state === 'playing'}■{:else if state === 'loading'}…{:else if state === 'unavailable'}–{:else if state === 'error'}!{:else}▶{/if}
</button>
<span class="visually-hidden" role="status">{status}</span>

<style>
	.preview {
		width: 1.9rem;
		height: 1.9rem;
		margin-right: 0.4rem;
		border: 1px solid #aaa;
		border-radius: 50%;
		background: #fff;
		cursor: pointer;
		font-size: 0.8rem;
		line-height: 1;
		vertical-align: middle;
	}
	.unavailable {
		cursor: default;
		color: #999;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.playing {
		background: #a238ff;
		border-color: #a238ff;
		color: #fff;
	}
</style>
