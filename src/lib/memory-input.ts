/**
 * Parses the Memory query (`date`, optional `time`, `tz`) into a Capture Time.
 * Pure: no I/O; the timezone comes from the query, never from the environment.
 */
import type { CaptureTime } from './tiers.ts';
import { assertTimeZone, localDateTimeToUts, parseDate, parseTime } from './zoned-time.ts';

/** Raw form values, for prefilling the form. */
export interface MemoryFormValues {
	date: string;
	time: string;
	tz: string;
}

export interface MemoryFieldErrors {
	date?: string;
	time?: string;
}

export type MemoryInput =
	| {
			ok: true;
			values: MemoryFormValues;
			capture: CaptureTime;
			/** The timezone used for computing (the requested one, or `UTC`). */
			tz: string;
			/** True when `tz` was missing or unknown and `UTC` is used instead. */
			tzFallback: boolean;
	  }
	| { ok: false; values: MemoryFormValues; errors: MemoryFieldErrors };

export const FALLBACK_TZ = 'UTC';

function validTimeZone(tz: string): boolean {
	if (!tz) return false;
	try {
		assertTimeZone(tz);
		return true;
	} catch {
		return false;
	}
}

/** The timezone to compute in: `requested` when it is a known IANA zone, else `UTC` (`tzFallback`). */
export function resolveTimeZone(requested: string): { tz: string; tzFallback: boolean } {
	const tzFallback = !validTimeZone(requested);
	return { tz: tzFallback ? FALLBACK_TZ : requested, tzFallback };
}

export function parseMemoryInput(params: URLSearchParams): MemoryInput {
	const values: MemoryFormValues = {
		date: (params.get('date') ?? '').trim(),
		time: (params.get('time') ?? '').trim(),
		tz: (params.get('tz') ?? '').trim()
	};

	const errors: MemoryFieldErrors = {};
	if (!values.date) {
		errors.date = 'Enter a date.';
	} else {
		try {
			parseDate(values.date);
		} catch {
			errors.date = 'Enter a valid date (YYYY-MM-DD).';
		}
	}
	if (values.time) {
		try {
			parseTime(values.time);
		} catch {
			errors.time = 'Enter a valid time (HH:MM) or leave it empty.';
		}
	}
	if (errors.date || errors.time) return { ok: false, values, errors };

	const { tz, tzFallback } = resolveTimeZone(values.tz);
	const capture: CaptureTime = values.time
		? { uts: localDateTimeToUts(values.date, values.time, tz) }
		: { date: values.date };

	return { ok: true, values, capture, tz, tzFallback };
}
