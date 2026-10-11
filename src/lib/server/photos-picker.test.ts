import { describe, expect, it, vi } from 'vitest';
import {
	createSession,
	deleteSession,
	fetchThumbnail,
	getSession,
	GoogleApiError,
	GoogleAuthError,
	listMediaItems,
	parseCreateTime,
	parseDuration
} from './photos-picker.ts';

type Call = [string, RequestInit];

function stub(...responses: Response[]) {
	const queue = [...responses];
	return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
		const next = queue.shift();
		if (!next) throw new Error('unexpected fetch');
		return next;
	});
}

const session = (extra: Record<string, unknown> = {}) => ({
	id: 'sess-1',
	pickerUri: 'https://photos.google.com/picker/abc',
	pollingConfig: { pollInterval: '5s', timeoutIn: '1799.5s' },
	...extra
});

describe('parseDuration', () => {
	it.each([
		['5s', 5000],
		['1.5s', 1500],
		['0s', 0],
		['1799.123456789s', 1799123]
	])('%s → %d ms', (input, ms) => expect(parseDuration(input)).toBe(ms));

	it.each([undefined, '', '5', '-1s', '5m', 5])('rejects %s', (input) => expect(parseDuration(input)).toBeNull());
});

describe('parseCreateTime', () => {
	it('floors fractional seconds', () => {
		expect(parseCreateTime('2015-01-01T13:00:00.999999999Z')).toBe(Date.UTC(2015, 0, 1, 13) / 1000);
		expect(parseCreateTime('2015-01-01T13:00:00Z')).toBe(Date.UTC(2015, 0, 1, 13) / 1000);
	});

	it('applies offsets', () => {
		expect(parseCreateTime('2015-01-01T14:00:00+01:00')).toBe(Date.UTC(2015, 0, 1, 13) / 1000);
	});

	it.each(['', 'yesterday', '2015-01-01', null])('rejects %s', (input) => expect(parseCreateTime(input)).toBeNull());
});

describe('sessions', () => {
	it('creates a session for up to 20 items with the Bearer token', async () => {
		const fetch = stub(Response.json(session()));
		const result = await createSession('tok', fetch);

		expect(result).toEqual({
			id: 'sess-1',
			pickerUri: 'https://photos.google.com/picker/abc',
			mediaItemsSet: false,
			pollInterval: 5000,
			timeoutIn: 1799500
		});
		const [url, init] = fetch.mock.calls[0] as Call;
		expect(url).toBe('https://photospicker.googleapis.com/v1/sessions');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
		expect(JSON.parse(init.body as string)).toEqual({ pickingConfig: { maxItemCount: '20' } });
	});

	it('gets a session and reads mediaItemsSet', async () => {
		const fetch = stub(Response.json(session({ mediaItemsSet: true })));
		expect((await getSession('tok', 'sess-1', fetch)).mediaItemsSet).toBe(true);
		expect(fetch.mock.calls[0][0]).toBe('https://photospicker.googleapis.com/v1/sessions/sess-1');
	});

	it('accepts a polled session without pickerUri but requires it on create', async () => {
		const bare = () => Response.json({ id: 'sess-1', mediaItemsSet: true });
		expect((await getSession('tok', 'sess-1', stub(bare()))).mediaItemsSet).toBe(true);
		await expect(createSession('tok', stub(bare()))).rejects.toThrow('unexpected session');
	});

	it('deletes a session', async () => {
		const fetch = stub(new Response('{}'));
		await deleteSession('tok', 'sess-1', fetch);
		const [url, init] = fetch.mock.calls[0] as Call;
		expect(url).toBe('https://photospicker.googleapis.com/v1/sessions/sess-1');
		expect(init.method).toBe('DELETE');
	});

	it('throws GoogleAuthError on 401', async () => {
		await expect(getSession('tok', 's', stub(new Response('', { status: 401 })))).rejects.toThrow(GoogleAuthError);
	});

	it("throws GoogleApiError with Google's message otherwise", async () => {
		const fetch = stub(
			Response.json({ error: { code: 400, message: 'Precondition check failed.', status: 'FAILED_PRECONDITION' } }, { status: 400 })
		);
		const failure = getSession('tok', 's', fetch);
		await expect(failure).rejects.toThrow(GoogleApiError);
		await expect(failure).rejects.toThrow('Precondition check failed.');
	});

	it('throws GoogleApiError when unreachable', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		await expect(createSession('tok', fetch)).rejects.toMatchObject({ name: 'GoogleApiError', status: 0 });
	});
});

describe('listMediaItems', () => {
	const item = (id: string, createTime: string, type = 'PHOTO') => ({
		id,
		createTime,
		type,
		mediaFile: { baseUrl: `https://lh3.googleusercontent.com/${id}`, mimeType: 'image/jpeg' }
	});

	it('follows every page and maps items', async () => {
		const fetch = stub(
			Response.json({ mediaItems: [item('a', '2015-01-01T13:00:00.5Z')], nextPageToken: 'p2' }),
			Response.json({ mediaItems: [item('b', '2014-06-01T08:00:00Z', 'VIDEO')] })
		);
		const items = await listMediaItems('tok', 'sess-1', fetch);

		expect(items).toEqual([
			{ id: 'a', captureUts: Date.UTC(2015, 0, 1, 13) / 1000, baseUrl: 'https://lh3.googleusercontent.com/a', video: false },
			{ id: 'b', captureUts: Date.UTC(2014, 5, 1, 8) / 1000, baseUrl: 'https://lh3.googleusercontent.com/b', video: true }
		]);
		const first = new URL(fetch.mock.calls[0][0] as string);
		expect(first.origin + first.pathname).toBe('https://photospicker.googleapis.com/v1/mediaItems');
		expect(first.searchParams.get('sessionId')).toBe('sess-1');
		expect(first.searchParams.get('pageSize')).toBe('100');
		expect(first.searchParams.has('pageToken')).toBe(false);
		expect(new URL(fetch.mock.calls[1][0] as string).searchParams.get('pageToken')).toBe('p2');
	});

	it('returns [] for an empty listing', async () => {
		expect(await listMediaItems('tok', 's', stub(Response.json({})))).toEqual([]);
	});

	it.each([
		'https://evil.example/a',
		'http://lh3.googleusercontent.com/a',
		'https://googleusercontent.com.evil.example/a',
		'https://googleusercontent.com/a'
	])('rejects an item whose baseUrl is %s', async (baseUrl) => {
		const fetch = stub(
			Response.json({ mediaItems: [{ id: 'x', createTime: '2015-01-01T00:00:00Z', mediaFile: { baseUrl } }] })
		);
		await expect(listMediaItems('tok', 's', fetch)).rejects.toThrow(GoogleApiError);
	});

	it('rejects an item without createTime', async () => {
		const fetch = stub(Response.json({ mediaItems: [{ id: 'x', mediaFile: { baseUrl: 'https://x' } }] }));
		await expect(listMediaItems('tok', 's', fetch)).rejects.toThrow(GoogleApiError);
	});
});

describe('fetchThumbnail', () => {
	it('requests 512 px with the Bearer token', async () => {
		const fetch = stub(new Response('img'));
		await fetchThumbnail('tok', 'https://lh3.googleusercontent.com/x', false, fetch);
		const [url, init] = fetch.mock.calls[0] as Call;
		expect(url).toBe('https://lh3.googleusercontent.com/x=w512-h512');
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
	});

	it('drops the play overlay for videos', async () => {
		const fetch = stub(new Response('img'));
		await fetchThumbnail('tok', 'https://lh3.googleusercontent.com/x', true, fetch);
		expect(fetch.mock.calls[0][0]).toBe('https://lh3.googleusercontent.com/x=w512-h512-no');
	});

	it('never sends the token outside googleusercontent.com', async () => {
		const fetch = stub(new Response('img'));
		await expect(fetchThumbnail('tok', 'https://evil.example/x', false, fetch)).rejects.toThrow(GoogleApiError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('throws on a non-2xx answer', async () => {
		await expect(fetchThumbnail('tok', 'https://lh3.googleusercontent.com/x', false, stub(new Response('', { status: 403 })))).rejects.toThrow(
			GoogleApiError
		);
	});
});
