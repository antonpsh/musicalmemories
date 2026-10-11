import { describe, expect, it } from 'vitest';
import { formatLocalDate, formatLocalTime, localDateTimeToUts, parseTime } from './zoned-time.ts';

const utc = (iso: string) => Date.parse(iso) / 1000;

describe('localDateTimeToUts', () => {
	it('converts a local wall-clock time in winter and summer', () => {
		expect(localDateTimeToUts('2015-01-01', '14:00', 'Europe/Berlin')).toBe(utc('2015-01-01T13:00:00Z'));
		expect(localDateTimeToUts('2015-07-01', '14:00', 'Europe/Berlin')).toBe(utc('2015-07-01T12:00:00Z'));
		expect(localDateTimeToUts('2015-01-01', '14:00', 'UTC')).toBe(utc('2015-01-01T14:00:00Z'));
		expect(localDateTimeToUts('2015-01-01', '00:00', 'America/New_York')).toBe(
			utc('2015-01-01T05:00:00Z')
		);
	});

	it('accepts a LocalDate object', () => {
		expect(localDateTimeToUts({ year: 2015, month: 1, day: 1 }, '14:00', 'Asia/Tokyo')).toBe(
			utc('2015-01-01T05:00:00Z')
		);
	});

	it('moves a time in a spring-forward gap forward by the gap', () => {
		// Berlin 2015-03-29: 02:00 CET → 03:00 CEST; 02:30 does not exist and becomes 03:30 CEST.
		expect(localDateTimeToUts('2015-03-29', '02:30', 'Europe/Berlin')).toBe(utc('2015-03-29T01:30:00Z'));
		expect(localDateTimeToUts('2015-03-29', '02:00', 'Europe/Berlin')).toBe(utc('2015-03-29T01:00:00Z'));
		// New York 2015-03-08: 02:00 EST → 03:00 EDT.
		expect(localDateTimeToUts('2015-03-08', '02:15', 'America/New_York')).toBe(
			utc('2015-03-08T07:15:00Z')
		);
		// Just around the gap.
		expect(localDateTimeToUts('2015-03-29', '01:59', 'Europe/Berlin')).toBe(utc('2015-03-29T00:59:00Z'));
		expect(localDateTimeToUts('2015-03-29', '03:00', 'Europe/Berlin')).toBe(utc('2015-03-29T01:00:00Z'));
	});

	it('picks the earlier instant in a fall-back overlap', () => {
		// Berlin 2015-10-25: 03:00 CEST → 02:00 CET; 02:30 happens twice.
		expect(localDateTimeToUts('2015-10-25', '02:30', 'Europe/Berlin')).toBe(utc('2015-10-25T00:30:00Z'));
		// New York 2015-11-01: 01:30 happens twice (EDT first).
		expect(localDateTimeToUts('2015-11-01', '01:30', 'America/New_York')).toBe(
			utc('2015-11-01T05:30:00Z')
		);
	});

	it('handles a southern-hemisphere transition', () => {
		// Sydney 2015-10-04: 02:00 AEST → 03:00 AEDT.
		expect(localDateTimeToUts('2015-10-04', '02:30', 'Australia/Sydney')).toBe(
			utc('2015-10-03T16:30:00Z')
		);
		// Sydney 2015-04-05: 03:00 AEDT → 02:00 AEST; 02:30 twice, earlier is AEDT.
		expect(localDateTimeToUts('2015-04-05', '02:30', 'Australia/Sydney')).toBe(
			utc('2015-04-04T15:30:00Z')
		);
	});

	it('throws RangeError on malformed input or unknown timezone', () => {
		expect(() => localDateTimeToUts('2015-13-40', '14:00', 'UTC')).toThrow(RangeError);
		expect(() => localDateTimeToUts('2015-01-01', '24:00', 'UTC')).toThrow(RangeError);
		expect(() => localDateTimeToUts('2015-01-01', '14:00', 'Mars/Base')).toThrow(RangeError);
	});
});

describe('parseTime', () => {
	it('accepts HH:MM and rejects anything else', () => {
		expect(parseTime('00:00')).toEqual({ hour: 0, minute: 0 });
		expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 });
		for (const bad of ['', '7:00', '24:00', '12:60', '12:00:00', 'noon']) {
			expect(() => parseTime(bad)).toThrow(RangeError);
		}
	});
});

describe('formatLocalDate / formatLocalTime', () => {
	it('formats an instant in the given timezone', () => {
		const t = utc('2014-12-31T23:30:00Z');
		expect(formatLocalDate(t, 'UTC')).toBe('2014-12-31');
		expect(formatLocalDate(t, 'Europe/Berlin')).toBe('2015-01-01');
		expect(formatLocalTime(t, 'Europe/Berlin')).toBe('00:30');
		expect(formatLocalTime(t, 'UTC')).toBe('23:30');
	});
});
