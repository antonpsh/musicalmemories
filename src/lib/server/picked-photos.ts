/**
 * Picked sets: the items of one finished Picker session, kept in server memory only
 * (never in SQLite or files) until their `baseUrl`s expire.
 */
import { randomUUID } from 'node:crypto';
import type { PollResponse } from '#lib/pick-status.ts';
import type { PickedMediaItem } from './photos-picker.ts';

/** Picker `baseUrl`s stay valid this long after listing. */
export const PICKED_LIFETIME_MS = 60 * 60_000;

export interface PickedSet {
	/** Random id, used in `/photos/[pickId]`. */
	id: string;
	/** Ascending by Capture Time. */
	items: PickedMediaItem[];
	/** Milliseconds since the epoch. */
	expiresAt: number;
}

export type PickedStore = Map<string, PickedSet>;

const defaultStore: PickedStore = new Map();

/**
 * Saves picked items, sorted ascending by Capture Time. The set expires 60 minutes from `now`,
 * or at `tokenExpiresAt` when that is earlier. Expired sets are dropped on the way.
 */
export function savePicked(
	items: readonly PickedMediaItem[],
	options: { now?: number; tokenExpiresAt?: number; store?: PickedStore } = {}
): PickedSet {
	const now = options.now ?? Date.now();
	const store = options.store ?? defaultStore;
	for (const [id, set] of store) if (set.expiresAt <= now) store.delete(id);

	const set: PickedSet = {
		id: randomUUID(),
		items: [...items].sort((a, b) => a.captureUts - b.captureUts),
		expiresAt: Math.min(now + PICKED_LIFETIME_MS, options.tokenExpiresAt ?? Infinity)
	};
	store.set(set.id, set);
	return set;
}

/** The picked set, or `null` when unknown (e.g. after a restart) or expired. */
export function getPicked(id: string, now: number = Date.now(), store: PickedStore = defaultStore): PickedSet | null {
	const set = store.get(id);
	if (!set) return null;
	if (set.expiresAt <= now) {
		store.delete(id);
		return null;
	}
	return set;
}

/** What the status endpoint answers once a Picker session is finished. */
export type PickOutcome = Extract<PollResponse, { status: 'done' | 'nothing' }>;

/** A Picker session created by `/photos/pick` that the browser is polling. */
export interface PendingSession {
	/** Stop polling Google at this time (ms since the epoch): `timeoutIn` after creation. */
	deadline: number;
	/** Set once listing (or the timeout) has finished; repeated polls answer the same. */
	outcome?: PickOutcome;
	/** In-flight list/delete/save, so overlapping polls do not list twice. */
	finishing?: Promise<PickOutcome>;
}

export type PendingStore = Map<string, PendingSession>;

const defaultPending: PendingStore = new Map();

/** Keep finished or timed-out sessions this long so a late poll still gets its outcome. */
const PENDING_GRACE_MS = PICKED_LIFETIME_MS;

/** Remembers a newly created Picker session; only tracked sessions can be polled. */
export function trackSession(
	id: string,
	deadline: number,
	now: number = Date.now(),
	store: PendingStore = defaultPending
): PendingSession {
	for (const [key, entry] of store) if (entry.deadline + PENDING_GRACE_MS <= now) store.delete(key);
	const entry: PendingSession = { deadline };
	store.set(id, entry);
	return entry;
}

/** The tracked session, or `null` when this server never created it (or restarted since). */
export function getPendingSession(id: string, store: PendingStore = defaultPending): PendingSession | null {
	return store.get(id) ?? null;
}
