<script lang="ts">
	import MemoryTiers from '#lib/components/MemoryTiers.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Memories of your Photos – musicalimage</title>
</svelte:head>

<main>
	<p><a href="/">← musicalimage</a> · <a href="/photos/pick" data-sveltekit-reload>Pick other Photos</a></p>
	<h1>Memories of your Photos</h1>

	{#if data.tzFallback}
		<p class="note">
			{#if data.requestedTz}
				Timezone “{data.requestedTz}” is unknown, so times are computed in {data.tz}.
			{:else}
				No timezone was given, so times are computed in {data.tz}.
			{/if}
		</p>
	{:else}
		<p class="note">Times and dates are in {data.tz}.</p>
	{/if}

	{#each data.memories as item, i (item.id)}
		<article class="memory" aria-labelledby="photo-{i}">
			<h2 id="photo-{i}">{item.video ? 'Video' : 'Photo'} taken {item.taken}</h2>
			<img
				class="thumb"
				src={item.thumb}
				alt="{item.video ? 'Video' : 'Photo'} taken {item.taken}"
				loading="lazy"
				referrerpolicy="no-referrer"
			/>
			<MemoryTiers memory={item.memory} level={3} idPrefix="photo-{i}-tier" />
		</article>
	{/each}
</main>

<style>
	main {
		max-width: 40rem;
		margin: 4rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.5;
	}
	.note {
		color: #555;
		font-size: 0.9em;
	}
	.memory {
		border-top: 1px solid #ddd;
		padding-top: 1rem;
		margin-top: 2rem;
	}
	.thumb {
		display: block;
		max-width: 100%;
		max-height: 512px;
		border-radius: 0.25rem;
		background: #eee;
	}
</style>
