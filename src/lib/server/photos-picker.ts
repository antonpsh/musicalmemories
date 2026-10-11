/**
 * Google Photos Picker API client (ADR 0002: no Library API). Every call takes the
 * Bearer access token and an injected `fetch`; 401 → `GoogleAuthError`, other failures →
 * `GoogleApiError`.
 */
import { FETCH_TIMEOUT_MS, GoogleApiError, GoogleAuthError } from './google-auth.ts';

export { GoogleApiError, GoogleAuthError } from './google-auth.ts';

export const PICKER_ROOT = 'https://photospicker.googleapis.com/v1';
export const MAX_ITEM_COUNT = 20;
export const PAGE_SIZE = 100;
/** Thumbnail size requested from `baseUrl`. */
export const THUMB_SIZE = 'w512-h512';

type Fetch = typeof globalThis.fetch;

export interface PickerSession {
	id: string;
	pickerUri: string;
	mediaItemsSet: boolean;
	/** Recommended wait between polls, in milliseconds. */
	pollInterval: number;
	/** Time left until the session stops accepting picks, in milliseconds. */
	timeoutIn: number;
}

export interface PickedMediaItem {
	id: string;
	/** Capture Time: `createTime` in unix seconds (UTC), fractional seconds floored. */
	captureUts: number;
	baseUrl: string;
	video: boolean;
}

/** Fallbacks when Google omits `pollingConfig`. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

/** Parses a protobuf Duration string (`"5s"`, `"1.5s"`) into milliseconds; `null` if malformed. */
export function parseDuration(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const match = /^(\d+)(?:\.(\d{1,9}))?s$/.exec(value.trim());
	if (!match) return null;
	const fraction = match[2] ? Number(`0.${match[2]}`) : 0;
	return Math.round((Number(match[1]) + fraction) * 1000);
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** RFC 3339 timestamp → unix seconds, fractional seconds floored; `null` if malformed. */
export function parseCreateTime(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const m = RFC3339.exec(value);
	if (!m) return null;
	const [, y, mo, d, h, mi, s, zone] = m;
	let offset = 0;
	if (zone !== 'Z' && zone !== 'z') {
		const sign = zone[0] === '-' ? -1 : 1;
		offset = sign * (Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(4, 6)) * 60);
	}
	const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
	return Number.isFinite(ms) ? ms / 1000 - offset : null;
}

/** True only for `https://*.googleusercontent.com/…`, the only host the Bearer token may go to for media. */
export function isGoogleMediaUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com') && !url.username && !url.password;
	} catch {
		return false;
	}
}

/** Performs a Picker request; returns the response for 2xx, throws otherwise. */
async function call(
	url: string,
	token: string,
	fetch: Fetch,
	init: { method?: string; body?: unknown } = {}
): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: init.method ?? 'GET',
			headers: {
				authorization: `Bearer ${token}`,
				...(init.body === undefined ? {} : { 'content-type': 'application/json' })
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
	} catch (cause) {
		throw new GoogleApiError(0, `Could not reach Google Photos: ${(cause as Error).message}`);
	}
	if (response.status === 401) throw new GoogleAuthError();
	if (!response.ok) {
		let detail = `HTTP ${response.status}`;
		try {
			const data = (await response.json()) as { error?: { message?: unknown; status?: unknown } };
			if (typeof data?.error?.message === 'string') detail = data.error.message;
		} catch {
			// Non-JSON error body: keep the status.
		}
		throw new GoogleApiError(response.status, `Google Photos answered: ${detail}`);
	}
	return response;
}

async function json(response: Response): Promise<Record<string, unknown>> {
	try {
		return (await response.json()) as Record<string, unknown>;
	} catch {
		throw new GoogleApiError(response.status, 'Google Photos returned an unexpected response.');
	}
}

/** `pickerUri` is required only when creating; `sessions.get` may omit it once picking is done. */
function toSession(data: Record<string, unknown>, requirePickerUri: boolean): PickerSession {
	const { id } = data;
	const pickerUri = typeof data.pickerUri === 'string' ? data.pickerUri : '';
	if (typeof id !== 'string' || !id || (requirePickerUri && !pickerUri.startsWith('https://'))) {
		console.error('Unexpected Picker session from Google; fields:', Object.keys(data).slice(0, 20).join(', '));
		throw new GoogleApiError(200, 'Google Photos returned an unexpected session.');
	}
	const polling = (data.pollingConfig ?? {}) as Record<string, unknown>;
	return {
		id,
		pickerUri,
		mediaItemsSet: data.mediaItemsSet === true,
		pollInterval: parseDuration(polling.pollInterval) ?? DEFAULT_POLL_INTERVAL_MS,
		timeoutIn: parseDuration(polling.timeoutIn) ?? DEFAULT_TIMEOUT_MS
	};
}

/** `POST /v1/sessions`: a new Picker session allowing up to 20 items. */
export async function createSession(token: string, fetch: Fetch): Promise<PickerSession> {
	const response = await call(`${PICKER_ROOT}/sessions`, token, fetch, {
		method: 'POST',
		body: { pickingConfig: { maxItemCount: String(MAX_ITEM_COUNT) } }
	});
	return toSession(await json(response), true);
}

/** `GET /v1/sessions/{id}`. */
export async function getSession(token: string, id: string, fetch: Fetch): Promise<PickerSession> {
	const response = await call(`${PICKER_ROOT}/sessions/${encodeURIComponent(id)}`, token, fetch);
	return toSession(await json(response), false);
}

/** `DELETE /v1/sessions/{id}`. */
export async function deleteSession(token: string, id: string, fetch: Fetch): Promise<void> {
	await call(`${PICKER_ROOT}/sessions/${encodeURIComponent(id)}`, token, fetch, { method: 'DELETE' });
}

/** `GET /v1/mediaItems?sessionId=` over all pages. Only valid once `mediaItemsSet` is true. */
export async function listMediaItems(
	token: string,
	sessionId: string,
	fetch: Fetch
): Promise<PickedMediaItem[]> {
	const items: PickedMediaItem[] = [];
	let pageToken: string | undefined;
	do {
		const url = new URL(`${PICKER_ROOT}/mediaItems`);
		url.searchParams.set('sessionId', sessionId);
		url.searchParams.set('pageSize', String(PAGE_SIZE));
		if (pageToken) url.searchParams.set('pageToken', pageToken);

		const data = await json(await call(url.toString(), token, fetch));
		const entries = Array.isArray(data.mediaItems) ? data.mediaItems : [];
		for (const entry of entries as Record<string, unknown>[]) {
			const file = (entry?.mediaFile ?? {}) as Record<string, unknown>;
			const captureUts = parseCreateTime(entry?.createTime);
			if (
				typeof entry?.id !== 'string' ||
				!entry.id ||
				captureUts === null ||
				!isGoogleMediaUrl(file.baseUrl)
			) {
				throw new GoogleApiError(200, 'Google Photos returned an unexpected media item.');
			}
			items.push({
				id: entry.id,
				captureUts: Math.floor(captureUts),
				baseUrl: file.baseUrl,
				video: entry.type === 'VIDEO'
			});
		}
		pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
	} while (pageToken);
	return items;
}

/** The `baseUrl` with size parameters; `-no` drops the play overlay on videos. */
export function thumbnailUrl(baseUrl: string, video: boolean): string {
	return `${baseUrl}=${THUMB_SIZE}${video ? '-no' : ''}`;
}

/** Fetches a 512 px thumbnail; the caller streams the returned (2xx) response body. */
export async function fetchThumbnail(
	token: string,
	baseUrl: string,
	video: boolean,
	fetch: Fetch
): Promise<Response> {
	if (!isGoogleMediaUrl(baseUrl)) throw new GoogleApiError(0, 'Refusing to fetch a thumbnail from outside Google.');
	return call(thumbnailUrl(baseUrl, video), token, fetch);
}
