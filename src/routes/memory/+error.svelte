<script lang="ts">
	import { page } from '$app/state';
	import DateForm from '#lib/components/DateForm.svelte';

	const value = (name: string) => page.url.searchParams.get(name) ?? '';
	const retryHref = $derived(page.url.pathname + page.url.search);
</script>

<svelte:head>
	<title>Memory – musicalimage</title>
</svelte:head>

<main>
	<p><a href="/">← musicalimage</a></p>
	<h1>Memory</h1>

	{#if page.error?.fieldErrors}
		<DateForm
			date={value('date')}
			time={value('time')}
			tz={value('tz')}
			errors={page.error.fieldErrors}
		/>
	{:else}
		<p role="alert">{page.error?.message ?? 'Something went wrong.'}</p>
		{#if page.error?.retry}
			<p><a href={retryHref} data-sveltekit-reload>Try again</a></p>
		{/if}
		<DateForm date={value('date')} time={value('time')} tz={value('tz')} />
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
