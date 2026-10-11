/** The Memory view model shared by `/memory`, `/photos` and `MemoryTiers.svelte` (no secrets). */
import type { TierName } from './tiers.ts';

export interface TrackView {
	artist: string;
	title: string;
	plays: number;
	closest: boolean;
	/** Local start time (`HH:MM`), only in the At the moment Tier. */
	time: string | null;
	youtube: string;
	spotify: string;
}

export interface TierView {
	name: TierName;
	heading: string;
	range: string;
	tracks: TrackView[];
}

/** A Memory as computed for one Capture Time. */
export type LoadedMemory =
	| { state: 'not-connected'; sessionInvalid: boolean }
	| { state: 'memory'; timed: boolean; firstScrobble: string | null; tiers: TierView[] };

/** What a Memory shows below its Capture Time; `error` when its listening history failed to load. */
export type MemoryView = LoadedMemory | { state: 'error'; message: string };
