import { describe, expect, it } from 'vitest';
import type { Scrobble } from './server/scrobbles.ts';
import { computeTiers, fetchRange, tierRanges, type Tier } from './tiers.ts';

const BERLIN = 'Europe/Berlin';
/** Unix seconds for an ISO string with explicit offset. */
const at = (iso: string) => Date.parse(iso) / 1000;
/** Unix seconds for a Berlin winter-time (UTC+1) local time `YYYY-MM-DDTHH:MM`. */
const cet = (local: string) => at(`${local}:00+01:00`);

let n = 0;
const s = (uts: number, artist = `A${n}`, title = `T${n++}`): Scrobble => ({ uts, artist, title });

const tier = (tiers: Tier[], name: Tier['name']) => tiers.find((t) => t.name === name);
const utsIn = (tiers: Tier[], name: Tier['name']) => tier(tiers, name)?.tracks.map((t) => t.uts);

describe('computeTiers — boundaries', () => {
	// Spec row says capture 00:30, but 23:50 is then 40 min away (outside ±30 min);
	// 00:20 keeps the scenario (previous-evening Scrobble in At the moment) consistent.
	it('photo just after midnight: previous-evening Scrobble only in At the moment', () => {
		const capture = { uts: cet('2015-01-01T00:20') };
		const before = s(cet('2014-12-31T23:50'));
		const after = s(cet('2015-01-01T00:10'));
		const tiers = computeTiers(capture, BERLIN, [after, before]);

		expect(utsIn(tiers, 'moment')).toEqual([before.uts, after.uts]);
		expect(utsIn(tiers, 'day')).toEqual([after.uts]);
		expect(utsIn(tiers, 'month')).toEqual([after.uts]);
		expect(tier(tiers, 'day')).toMatchObject({
			from: cet('2015-01-01T00:00'),
			to: cet('2015-01-02T00:00')
		});
		// 2014-12-31 is in the week 2014-12-29 – 2015-01-05, so both are in That week.
		expect(utsIn(tiers, 'week')).toHaveLength(2);
	});

	it('week change: Monday Scrobble not in the Sunday week', () => {
		// Spec row says 23:00 / 00:30 (90 min apart); shifted to stay within ±30 min.
		const capture = { uts: cet('2015-01-04T23:45') };
		const monday = s(cet('2015-01-05T00:10'));
		const tiers = computeTiers(capture, BERLIN, [monday]);

		expect(utsIn(tiers, 'moment')).toEqual([monday.uts]);
		expect(tier(tiers, 'week')).toBeUndefined();
		expect(tierRanges(capture, BERLIN).find((r) => r.name === 'week')).toEqual({
			name: 'week',
			from: cet('2014-12-29T00:00'),
			to: cet('2015-01-05T00:00')
		});
	});

	it('month change: February Scrobble not in January', () => {
		const capture = { uts: cet('2015-01-31T23:45') };
		const feb = s(cet('2015-02-01T00:05'));
		const tiers = computeTiers(capture, BERLIN, [feb]);

		expect(utsIn(tiers, 'moment')).toEqual([feb.uts]);
		expect(tier(tiers, 'month')).toBeUndefined();
		expect(tier(tiers, 'day')).toBeUndefined();
	});

	it('date without time: no At the moment, full local day', () => {
		const capture = { date: '2015-01-01' };
		const ranges = tierRanges(capture, BERLIN);
		expect(ranges.map((r) => r.name)).toEqual(['day', 'week', 'month']);
		expect(ranges[0]).toEqual({
			name: 'day',
			from: cet('2015-01-01T00:00'),
			to: cet('2015-01-02T00:00')
		});

		const tiers = computeTiers(capture, BERLIN, [s(cet('2015-01-01T00:00')), s(cet('2015-01-01T23:59'))]);
		expect(tiers.map((t) => t.name)).toEqual(['day', 'week', 'month']);
		expect(tier(tiers, 'day')?.tracks).toHaveLength(2);
	});

	it('UTC vs local day differs', () => {
		const capture = { uts: cet('2015-01-01T00:30') };
		const utcDay = tierRanges(capture, 'UTC').find((r) => r.name === 'day');
		const berlinDay = tierRanges(capture, BERLIN).find((r) => r.name === 'day');
		expect(utcDay).toMatchObject({ from: at('2014-12-31T00:00:00Z'), to: at('2015-01-01T00:00:00Z') });
		expect(berlinDay).toMatchObject({ from: cet('2015-01-01T00:00'), to: cet('2015-01-02T00:00') });
	});

	it('DST: spring-forward day spans 23 hours', () => {
		const capture = { uts: at('2015-03-29T12:00:00+02:00') };
		const day = tierRanges(capture, BERLIN).find((r) => r.name === 'day')!;
		expect(day.from).toBe(at('2015-03-29T00:00:00+01:00'));
		expect(day.to).toBe(at('2015-03-30T00:00:00+02:00'));
		expect(day.to - day.from).toBe(23 * 3600);
	});

	it('DST: fall-back day spans 25 hours', () => {
		const day = tierRanges({ date: '2015-10-25' }, BERLIN)[0];
		expect(day.to - day.from).toBe(25 * 3600);
	});

	it('DST gap at midnight: day starts at the transition', () => {
		const day = tierRanges({ date: '2015-10-18' }, 'America/Sao_Paulo')[0];
		expect(day.from).toBe(at('2015-10-18T01:00:00-02:00'));
		expect(day.from).toBe(at('2015-10-18T03:00:00Z'));
		expect(day.to - day.from).toBe(23 * 3600);
	});

	it('week starting before DST change is DST-correct', () => {
		const week = tierRanges({ date: '2015-03-29' }, BERLIN).find((r) => r.name === 'week')!;
		expect(week.from).toBe(at('2015-03-23T00:00:00+01:00'));
		expect(week.to).toBe(at('2015-03-30T00:00:00+02:00'));
	});
});

describe('computeTiers — At the moment window', () => {
	const capture = { uts: cet('2015-06-15T12:00') };

	it('includes exactly ±1800 s, excludes ±1801 s', () => {
		const c = capture.uts;
		const tiers = computeTiers(capture, BERLIN, [
			s(c - 1801),
			s(c - 1800),
			s(c + 1800),
			s(c + 1801)
		]);
		expect(utsIn(tiers, 'moment')).toEqual([c - 1800, c + 1800]);
	});

	it('flags exactly one closest entry; earlier on a tie', () => {
		const c = capture.uts;
		const tiers = computeTiers(capture, BERLIN, [s(c + 600), s(c - 600), s(c + 1200)]);
		const moment = tier(tiers, 'moment')!;
		expect(moment.tracks.map((t) => t.uts)).toEqual([c - 600, c + 600, c + 1200]);
		expect(moment.tracks.map((t) => !!t.closest)).toEqual([true, false, false]);
		expect(moment.tracks.every((t) => t.plays === 1)).toBe(true);
	});

	it('moment entries are individual Scrobbles, not aggregated', () => {
		const c = capture.uts;
		const tiers = computeTiers(capture, BERLIN, [s(c - 300, 'X', 'Y'), s(c + 300, 'X', 'Y')]);
		expect(tier(tiers, 'moment')!.tracks).toHaveLength(2);
		expect(tier(tiers, 'day')!.tracks).toEqual([{ artist: 'X', title: 'Y', plays: 2, uts: c - 300 }]);
	});
});

describe('computeTiers — ranking', () => {
	it('ranks by plays, ties by earliest play, cuts day to 10', () => {
		const capture = { date: '2015-01-10' };
		const h = (hh: number) => cet(`2015-01-10T${String(hh).padStart(2, '0')}:00`);
		const scrobbles: Scrobble[] = [];
		// 9 single plays early in the day.
		for (let i = 0; i < 9; i++) scrobbles.push(s(h(1) + i * 60, 'Single', `S${i}`));
		// Tied pair at 2×: "Late" first played after "Early".
		scrobbles.push(s(h(5), 'Pair', 'Late'), s(h(6), 'Pair', 'Late'));
		scrobbles.push(s(h(3), 'Pair', 'Early'), s(h(7), 'Pair', 'Early'));
		// Top at 3×.
		scrobbles.push(s(h(8), 'Top', 'Hit'), s(h(9), 'Top', 'Hit'), s(h(10), 'Top', 'Hit'));

		const day = tier(computeTiers(capture, BERLIN, scrobbles), 'day')!;
		expect(day.tracks).toHaveLength(10);
		expect(day.tracks.slice(0, 3)).toEqual([
			{ artist: 'Top', title: 'Hit', plays: 3, uts: h(8) },
			{ artist: 'Pair', title: 'Early', plays: 2, uts: h(3) },
			{ artist: 'Pair', title: 'Late', plays: 2, uts: h(5) }
		]);
		expect(day.tracks.slice(3).map((t) => t.title)).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
	});

	it('cuts week and month to 5', () => {
		const capture = { date: '2015-01-10' };
		const scrobbles = Array.from({ length: 8 }, (_, i) => s(cet('2015-01-10T10:00') + i));
		const tiers = computeTiers(capture, BERLIN, scrobbles);
		expect(tier(tiers, 'day')!.tracks).toHaveLength(8);
		expect(tier(tiers, 'week')!.tracks).toHaveLength(5);
		expect(tier(tiers, 'month')!.tracks).toHaveLength(5);
	});

	it('breaks full ties by artist, then title', () => {
		const t = cet('2015-01-10T10:00');
		const day = tier(
			computeTiers({ date: '2015-01-10' }, BERLIN, [s(t, 'b', 'x'), s(t, 'a', 'z'), s(t, 'a', 'y')]),
			'day'
		)!;
		expect(day.tracks.map((x) => `${x.artist}/${x.title}`)).toEqual(['a/y', 'a/z', 'b/x']);
	});

	it('merges case and whitespace variants, keeps first spelling', () => {
		const t = cet('2015-01-10T10:00');
		const day = tier(
			computeTiers({ date: '2015-01-10' }, BERLIN, [s(t + 60, 'artist ', 'song'), s(t, 'Artist', 'Song')]),
			'day'
		)!;
		expect(day.tracks).toEqual([{ artist: 'Artist', title: 'Song', plays: 2, uts: t }]);
	});

	it('uses the first play within the range for spelling and uts', () => {
		// December play is outside That month (January) but inside That week.
		const dec = s(cet('2014-12-31T10:00'), 'ARTIST', 'SONG');
		const jan = s(cet('2015-01-01T10:00'), 'Artist', 'Song');
		const tiers = computeTiers({ date: '2015-01-01' }, BERLIN, [dec, jan]);
		expect(tier(tiers, 'month')!.tracks).toEqual([{ artist: 'Artist', title: 'Song', plays: 1, uts: jan.uts }]);
		expect(tier(tiers, 'week')!.tracks).toEqual([{ artist: 'ARTIST', title: 'SONG', plays: 2, uts: dec.uts }]);
	});
});

describe('computeTiers — results', () => {
	it('returns [] when every Tier is empty', () => {
		expect(computeTiers({ uts: cet('2015-01-01T12:00') }, BERLIN, [s(cet('2013-01-01T12:00'))])).toEqual([]);
		expect(computeTiers({ date: '2015-01-01' }, BERLIN, [])).toEqual([]);
	});

	it('omits empty Tiers and keeps Tier order', () => {
		// Only in the month, not the day or week.
		const tiers = computeTiers({ date: '2015-01-20' }, BERLIN, [s(cet('2015-01-02T12:00'))]);
		expect(tiers.map((t) => t.name)).toEqual(['month']);
	});

	it('is deterministic', () => {
		const capture = { uts: cet('2015-01-01T00:30') };
		const scrobbles = [s(cet('2014-12-31T23:50')), s(cet('2015-01-01T00:10')), s(cet('2015-01-15T00:10'))];
		expect(computeTiers(capture, BERLIN, scrobbles)).toEqual(computeTiers(capture, BERLIN, scrobbles));
	});
});

describe('fetchRange', () => {
	it('covers the moment window beyond the month', () => {
		// 2015-05-31 is a Sunday, so the week ends with the month.
		const capture = { uts: at('2015-05-31T23:45:00+02:00') };
		expect(fetchRange(capture, BERLIN)).toEqual({
			from: at('2015-05-01T00:00:00+02:00'),
			to: capture.uts + 1801
		});
	});

	it('covers the week beyond the month', () => {
		// Week of 2015-01-01 is 2014-12-29 – 2015-01-05.
		expect(fetchRange({ date: '2015-01-01' }, BERLIN)).toEqual({
			from: cet('2014-12-29T00:00'),
			to: cet('2015-02-01T00:00')
		});
		expect(fetchRange({ uts: cet('2015-01-01T00:10') }, BERLIN)).toEqual({
			from: cet('2014-12-29T00:00'),
			to: cet('2015-02-01T00:00')
		});
	});

	it('equals min/max over tierRanges', () => {
		const capture = { uts: cet('2015-03-31T23:50') };
		const ranges = tierRanges(capture, BERLIN);
		expect(fetchRange(capture, BERLIN)).toEqual({
			from: Math.min(...ranges.map((r) => r.from)),
			to: Math.max(...ranges.map((r) => r.to))
		});
	});

	it('restricting Scrobbles to the fetch range does not change the result', () => {
		const capture = { uts: cet('2015-01-31T23:45') };
		const { from, to } = fetchRange(capture, BERLIN);
		const all: Scrobble[] = [];
		for (let t = cet('2014-12-01T00:00'); t < cet('2015-03-01T00:00'); t += 7919) {
			all.push(s(t, `Artist ${t % 7}`, `Song ${t % 13}`));
		}
		all.push(s(from - 1), s(from), s(to - 1), s(to));
		const limited = all.filter((x) => x.uts >= from && x.uts < to);
		expect(limited.length).toBeLessThan(all.length);
		expect(computeTiers(capture, BERLIN, limited)).toEqual(computeTiers(capture, BERLIN, all));
	});
});

describe('bad input', () => {
	it('throws RangeError on unknown timezone', () => {
		expect(() => tierRanges({ uts: 0 }, 'Mars/Olympus')).toThrow(RangeError);
		expect(() => computeTiers({ date: '2015-01-01' }, 'Nope', [])).toThrow(RangeError);
		expect(() => fetchRange({ uts: 0 }, '')).toThrow(RangeError);
	});

	it.each(['2015-1-01', '2015-02-30', '2015-13-01', '20150101', '2015-01-01T00:00', ''])(
		'throws RangeError on malformed date %j',
		(date) => {
			expect(() => tierRanges({ date }, BERLIN)).toThrow(RangeError);
		}
	);

	it('throws RangeError on non-finite uts', () => {
		expect(() => tierRanges({ uts: Number.NaN }, BERLIN)).toThrow(RangeError);
	});
});
