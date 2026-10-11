<script lang="ts">
	import { page } from '$app/state';

	const retryHref = $derived(page.url.pathname + page.url.search);
</script>

<svelte:head>
	<title>Photos – musicalimage</title>
</svelte:head>

<main>
	<p><a href="/">← musicalimage</a></p>
	<h1>Photos</h1>

	<p role="alert">{page.error?.message ?? 'Something went wrong.'}</p>
	{#if page.error?.retry}
		<p><a href={retryHref} data-sveltekit-reload>Try again</a></p>
	{/if}
	{#if page.error?.pickAgain || page.status === 410}
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
</style>
