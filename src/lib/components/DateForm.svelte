<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		date?: string;
		time?: string;
		tz?: string;
		errors?: { date?: string; time?: string };
	}

	let { date = '', time = '', tz: initialTz = '', errors = {} }: Props = $props();

	// A given timezone (e.g. from the Memory URL) wins; otherwise the browser's, once mounted.
	let browserTz = $state('');
	const tz = $derived(initialTz || browserTz);
	onMount(() => {
		browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
	});
</script>

<form method="GET" action="/memory" class="date-form">
	<div class="field">
		<label for="memory-date">Date</label>
		<input
			id="memory-date"
			type="date"
			name="date"
			value={date}
			required
			aria-invalid={errors.date ? 'true' : undefined}
			aria-describedby={errors.date ? 'memory-date-error' : undefined}
		/>
		{#if errors.date}<p id="memory-date-error" class="error">{errors.date}</p>{/if}
	</div>
	<div class="field">
		<label for="memory-time">Time <span class="hint">(optional)</span></label>
		<input
			id="memory-time"
			type="time"
			name="time"
			value={time}
			aria-invalid={errors.time ? 'true' : undefined}
			aria-describedby={errors.time ? 'memory-time-error' : undefined}
		/>
		{#if errors.time}<p id="memory-time-error" class="error">{errors.time}</p>{/if}
	</div>
	<input type="hidden" name="tz" value={tz} />
	<button type="submit">Show Memory</button>
</form>

<style>
	.date-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: flex-end;
	}
	.field {
		display: flex;
		flex-direction: column;
	}
	.hint {
		color: #666;
		font-size: 0.875em;
	}
	.error {
		color: #b00020;
		margin: 0.25rem 0 0;
		font-size: 0.875em;
	}
</style>
