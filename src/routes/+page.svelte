<script lang="ts">
	import DateForm from '#lib/components/DateForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>musicalimage</title>
</svelte:head>

<main>
	<h1>musicalimage</h1>
	<p>Bring back the music you were listening to when a photo was taken.</p>

	<section aria-labelledby="lastfm-heading">
		<h2 id="lastfm-heading">Last.fm</h2>
		{#if data.lastfm}
			<p>Connected as <strong>{data.lastfm.username}</strong></p>
			<form method="POST" action="/auth/lastfm/disconnect">
				<button type="submit">Disconnect</button>
			</form>
		{:else}
			<p><a href="/auth/lastfm" data-sveltekit-reload>Connect Last.fm</a></p>
		{/if}
	</section>

	<section aria-labelledby="photos-heading">
		<h2 id="photos-heading">Remember a Photo</h2>
		<p>Pick Photos from Google Photos to see what you were listening to when they were taken.</p>
		<p><a href="/photos/pick" data-sveltekit-reload>Pick Photos</a></p>
	</section>

	{#if data.lastfm}
		<section aria-labelledby="memory-heading">
			<h2 id="memory-heading">Remember a date</h2>
			<p>Enter a date, and optionally a time, to see what you were listening to.</p>
			<DateForm />
		</section>
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
