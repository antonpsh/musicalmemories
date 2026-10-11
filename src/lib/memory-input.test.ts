import { describe, expect, it } from 'vitest';
import { parseMemoryInput } from './memory-input.ts';

const parse = (query: string) => parseMemoryInput(new URLSearchParams(query));
const utc = (iso: string) => Date.parse(iso) / 1000;

describe('parseMemoryInput', () => {
	it('yields a date-only Capture Time without a time', () => {
		expect(parse('date=2015-01-01&tz=Europe/Berlin')).toEqual({
			ok: true,
			values: { date: '2015-01-01', time: '', tz: 'Europe/Berlin' },
			capture: { date: '2015-01-01' },
			tz: 'Europe/Berlin',
			tzFallback: false
		});
	});

	it('converts date + time in tz to an instant', () => {
		const r = parse('date=2015-01-01&time=14:00&tz=Europe/Berlin');
		expect(r.ok && r.capture).toEqual({ uts: utc('2015-01-01T13:00:00Z') });
	});

	it('treats an empty time as no time', () => {
		const r = parse('date=2015-01-01&time=&tz=UTC');
		expect(r.ok && r.capture).toEqual({ date: '2015-01-01' });
	});

	it('falls back to UTC for an unknown or missing timezone', () => {
		const unknown = parse('date=2015-01-01&time=14:00&tz=Mars/Base');
		expect(unknown).toMatchObject({ ok: true, tz: 'UTC', tzFallback: true, capture: { uts: utc('2015-01-01T14:00:00Z') } });
		expect(parse('date=2015-01-01')).toMatchObject({ ok: true, tz: 'UTC', tzFallback: true });
		expect(parse('date=2015-01-01&tz=')).toMatchObject({ ok: true, tz: 'UTC', tzFallback: true });
		expect(parse('date=2015-01-01&tz=UTC')).toMatchObject({ ok: true, tz: 'UTC', tzFallback: false });
	});

	it('reports field errors for a missing or invalid date', () => {
		for (const q of ['', 'date=', 'date=2015-13-40', 'date=2015-02-29', 'date=01.01.2015']) {
			const r = parse(q);
			expect(r.ok).toBe(false);
			expect(!r.ok && r.errors.date).toBeTruthy();
		}
	});

	it('reports a field error for a bad time and keeps the values', () => {
		const r = parse('date=2015-01-01&time=25:00&tz=UTC');
		expect(r).toEqual({
			ok: false,
			values: { date: '2015-01-01', time: '25:00', tz: 'UTC' },
			errors: { time: expect.any(String) }
		});
	});
});
