/**
 * Calendar boundaries in an IANA timezone, as unix seconds (UTC).
 * Pure: the timezone is always a parameter, never read from the environment.
 */

/** A calendar date without time of day. `month` is 1–12. */
export interface LocalDate {
	year: number;
	month: number;
	day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Throws `RangeError` for an unknown timezone (from `Intl.DateTimeFormat`). */
function formatter(tz: string): Intl.DateTimeFormat {
	let f = formatters.get(tz);
	if (!f) {
		if (typeof tz !== 'string' || tz === '') throw new RangeError(`Invalid time zone: ${tz}`);
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		formatters.set(tz, f);
	}
	return f;
}

/** Throws `RangeError` unless `tz` is a known IANA timezone. */
export function assertTimeZone(tz: string): void {
	formatter(tz);
}

/** Local wall-clock fields of an instant in `tz`. */
function wallClock(uts: number, tz: string) {
	const fields: Record<string, number> = {};
	for (const p of formatter(tz).formatToParts(uts * 1000)) {
		if (p.type !== 'literal') fields[p.type] = Number(p.value);
	}
	return fields as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** Offset of `tz` from UTC at instant `uts`, in seconds (positive east of Greenwich). */
function offsetAt(uts: number, tz: string): number {
	const w = wallClock(Math.floor(uts), tz);
	const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) / 1000;
	return asUtc - Math.floor(uts);
}

/** Days since the epoch for a calendar date (proleptic Gregorian). */
function epochDay(d: LocalDate): number {
	return Date.UTC(d.year, d.month - 1, d.day) / 86400000;
}

function fromEpochDay(days: number): LocalDate {
	const dt = new Date(days * 86400000);
	return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** Parses `YYYY-MM-DD`; throws `RangeError` when malformed or not a real date. */
export function parseDate(s: string): LocalDate {
	const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
	if (!m) throw new RangeError(`Malformed date: ${s}`);
	const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
	const back = fromEpochDay(epochDay(date));
	if (back.year !== date.year || back.month !== date.month || back.day !== date.day) {
		throw new RangeError(`Invalid date: ${s}`);
	}
	return date;
}

/** The calendar date of instant `uts` in `tz`. */
export function localDateOf(uts: number, tz: string): LocalDate {
	const w = wallClock(Math.floor(uts), tz);
	return { year: w.year, month: w.month, day: w.day };
}

export function addDays(date: LocalDate, days: number): LocalDate {
	return fromEpochDay(epochDay(date) + days);
}

export function addMonths(date: LocalDate, months: number): LocalDate {
	const total = date.year * 12 + (date.month - 1) + months;
	return { year: Math.floor(total / 12), month: (total % 12 + 12) % 12 + 1, day: 1 };
}

/**
 * First instant of `date` in `tz` (local midnight). If midnight does not exist
 * (DST gap at 00:00), the day starts at the transition instant.
 */
export function startOfDay(date: LocalDate, tz: string): number {
	const wall = epochDay(date) * 86400;
	const o1 = offsetAt(wall, tz);
	const t1 = wall - o1;
	const o2 = offsetAt(t1, tz);
	if (o2 === o1) return t1;
	const t2 = wall - o2;
	if (offsetAt(t2, tz) === o2) return t2;
	// Gap: local midnight is skipped; the first local instant of the day is the later candidate.
	return Math.max(t1, t2);
}

/** Monday of the calendar week containing `date`. */
export function mondayOf(date: LocalDate): LocalDate {
	const weekday = new Date(epochDay(date) * 86400000).getUTCDay(); // 0 = Sunday
	return addDays(date, -((weekday + 6) % 7));
}

/** First instant of the Monday–Sunday week containing `date`, in `tz`. */
export function startOfWeek(date: LocalDate, tz: string): number {
	return startOfDay(mondayOf(date), tz);
}

/** First instant of the calendar month containing `date`, in `tz`. */
export function startOfMonth(date: LocalDate, tz: string): number {
	return startOfDay({ year: date.year, month: date.month, day: 1 }, tz);
}

/** Parses `HH:MM` (24-hour); throws `RangeError` when malformed. */
export function parseTime(s: string): { hour: number; minute: number } {
	const m = typeof s === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) : null;
	if (!m) throw new RangeError(`Malformed time: ${s}`);
	return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * The instant (unix seconds, UTC) of local wall-clock `date` + `time` (`HH:MM`) in `tz`.
 * DST-correct: in a fall-back overlap the earlier instant wins; a time inside a
 * spring-forward gap moves forward by the gap (02:30 in a 02:00→03:00 gap is 03:30).
 * Throws `RangeError` on a malformed date or time or an unknown timezone.
 */
export function localDateTimeToUts(date: LocalDate | string, time: string, tz: string): number {
	const d = typeof date === 'string' ? parseDate(date) : date;
	const { hour, minute } = parseTime(time);
	assertTimeZone(tz);
	const wall = epochDay(d) * 86400 + hour * 3600 + minute * 60;
	// Offsets in force a day either side cover any single transition near `wall`.
	const before = offsetAt(wall - 86400, tz);
	const after = offsetAt(wall + 86400, tz);
	const valid = [...new Set([before, after, offsetAt(wall, tz)])]
		.map((o) => wall - o)
		.filter((t) => wall - t === offsetAt(t, tz));
	if (valid.length > 0) return Math.min(...valid);
	// Gap: interpret with the offset before the transition, which lands past it by the gap.
	return wall - before;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for a calendar date. */
export function formatDate(date: LocalDate): string {
	return `${String(date.year).padStart(4, '0')}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** Local `YYYY-MM-DD` of instant `uts` in `tz`. */
export function formatLocalDate(uts: number, tz: string): string {
	return formatDate(localDateOf(uts, tz));
}

/** Local `HH:MM` of instant `uts` in `tz`. */
export function formatLocalTime(uts: number, tz: string): string {
	const w = wallClock(Math.floor(uts), tz);
	return `${pad2(w.hour)}:${pad2(w.minute)}`;
}
