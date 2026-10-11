<script lang="ts">
	import type { MemoryView } from '#lib/memory-view.ts';
	import PreviewButton from './PreviewButton.svelte';

	interface Props {
		memory: MemoryView;
		/** Heading level of each Tier (and of the empty message). */
		level?: 2 | 3;
		/** Prefix keeping heading ids unique when several Memories share a page. */
		idPrefix?: string;
	}

	let { memory, level = 2, idPrefix = 'tier' }: Props = $props();
	const tag = $derived(`h${level}`);
</script>

{#if memory.state === 'error'}
	<p role="alert">Could not load the listening history: {memory.message}</p>
{:else if memory.state === 'not-connected'}
	{#if memory.sessionInvalid}
		<p role="alert">Your Last.fm login is no longer valid. Please connect again.</p>
	{/if}
	<p>
		Connect your Last.fm account to see what you were listening to.
		<a href="/auth/lastfm" data-sveltekit-reload>Connect Last.fm</a>
	</p>
{:else if memory.tiers.length === 0}
	<section class="empty">
		<svelte:element this={tag}>No listening history for this date</svelte:element>
		{#if memory.firstScrobble}
			<p>Your first Scrobble is from {memory.firstScrobble}.</p>
		{:else}
			<p>Your Last.fm account has no Scrobbles yet.</p>
		{/if}
	</section>
{:else}
	{#each memory.tiers as tier (tier.name)}
		<section aria-labelledby="{idPrefix}-{tier.name}">
			<svelte:element this={tag} id="{idPrefix}-{tier.name}">{tier.heading}</svelte:element>
			<p class="range">{tier.range}</p>
			<ol class="tracks">
				{#each tier.tracks as track, i (i)}
					<li class:closest={track.closest}>
						<PreviewButton artist={track.artist} title={track.title} />
						{#if track.time}<span class="time">{track.time}</span>{/if}
						<span class="track"><strong>{track.title}</strong> – {track.artist}</span>
						{#if track.closest}<span class="badge">closest</span>{/if}
						{#if !track.time}<span class="plays">{track.plays} {track.plays === 1 ? 'play' : 'plays'}</span>{/if}
						<span class="links">
							<a href={track.youtube} target="_blank" rel="noopener noreferrer">YouTube</a>
							<a href={track.spotify} target="_blank" rel="noopener noreferrer">Spotify</a>
						</span>
					</li>
				{/each}
			</ol>
		</section>
	{/each}
{/if}

<style>
	.range {
		color: #555;
		font-size: 0.9em;
		margin-top: -0.75rem;
	}
	.tracks {
		padding-left: 1.5rem;
	}
	.tracks li {
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
	}
	.closest {
		background: #fff3c4;
		outline: 2px solid #e0b000;
	}
	.badge {
		font-size: 0.75em;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #7a5c00;
		margin-left: 0.25rem;
	}
	.time {
		font-variant-numeric: tabular-nums;
		margin-right: 0.5rem;
	}
	.plays {
		color: #555;
		margin-left: 0.5rem;
	}
	.links {
		margin-left: 0.5rem;
		white-space: nowrap;
	}
	.links a + a {
		margin-left: 0.5rem;
	}
</style>
