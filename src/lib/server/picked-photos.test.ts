import { describe, expect, it } from 'vitest';
import {
	getPendingSession,
	getPicked,
	PICKED_LIFETIME_MS,
	savePicked,
	trackSession,
	type PendingStore,
	type PickedStore
} from './picked-photos.ts';

const item = (id: string, captureUts: number) => ({ id, captureUts, baseUrl: `https://lh3/${id}`, video: false });

describe('picked sets', () => {
	it('saves items sorted by Capture Time under a random id', () => {
		const store: PickedStore = new Map();
		const a = savePicked([item('late', 300), item('early', 100), item('mid', 200)], { now: 0, store });
		const b = savePicked([item('x', 1)], { now: 0, store });

		expect(a.id).not.toBe(b.id);
		expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(getPicked(a.id, 0, store)?.items.map((i) => i.id)).toEqual(['early', 'mid', 'late']);
	});

	it('expires 60 minutes after listing', () => {
		const store: PickedStore = new Map();
		const { id, expiresAt } = savePicked([item('a', 1)], { now: 1000, store });
		expect(expiresAt).toBe(1000 + PICKED_LIFETIME_MS);
		expect(getPicked(id, expiresAt - 1, store)).not.toBeNull();
		expect(getPicked(id, expiresAt, store)).toBeNull();
		expect(store.size).toBe(0);
	});

	it('expires with the token when that is earlier', () => {
		const store: PickedStore = new Map();
		const { id } = savePicked([item('a', 1)], { now: 0, tokenExpiresAt: 5000, store });
		expect(getPicked(id, 4999, store)).not.toBeNull();
		expect(getPicked(id, 5000, store)).toBeNull();
	});

	it('returns null for unknown ids', () => {
		expect(getPicked('nope', 0, new Map())).toBeNull();
	});

	it('prunes expired sets when saving', () => {
		const store: PickedStore = new Map();
		savePicked([item('a', 1)], { now: 0, store });
		savePicked([item('b', 1)], { now: PICKED_LIFETIME_MS, store });
		expect(store.size).toBe(1);
	});
});

describe('pending sessions', () => {
	it('tracks created sessions only', () => {
		const store: PendingStore = new Map();
		trackSession('s1', 1000, 0, store);
		expect(getPendingSession('s1', store)).toEqual({ deadline: 1000 });
		expect(getPendingSession('s2', store)).toBeNull();
	});
});
