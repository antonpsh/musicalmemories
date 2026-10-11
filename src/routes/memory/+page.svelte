<script lang="ts">
	import DateForm from '#lib/components/DateForm.svelte';
	import MemoryTiers from '#lib/components/MemoryTiers.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Memory {data.values.date}{data.values.time ? ` ${data.values.time}` : ''} – musicalimage</title>
</svelte:head>

<main>
	<p><a href="/">← musicalimage</a></p>
	<h1>Memory of {data.values.date}{data.values.time ? `, ${data.values.time}` : ''}</h1>

	<DateForm date={data.values.date} time={data.values.time} tz={data.values.tz} />

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

	<MemoryTiers memory={data} />
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
</style>
