import { error } from '@sveltejs/kit';
import { parseMemoryInput } from '#lib/memory-input.ts';
import { buildMemory } from '#lib/server/memory.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const input = parseMemoryInput(url.searchParams);
	if (!input.ok) {
		error(400, 'Please correct the form.', { fieldErrors: input.errors });
	}
	const { values, capture, tz, tzFallback } = input;

	return { values, tz, tzFallback, requestedTz: values.tz, ...(await buildMemory(capture, tz)) };
};
