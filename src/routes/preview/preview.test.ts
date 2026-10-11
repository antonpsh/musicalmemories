import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server.ts';

const PREVIEW = 'https://cdnt-preview.dzcdn.net/x.mp3';

function call(query: string, fetch: typeof globalThis.fetch) {
	const url = new URL(`http://localhost:3000/preview?${query}`);
	return GET({ url, fetch } as unknown as Parameters<typeof GET>[0]) as Promise<Response>;
}

const deezer = (body: unknown) => vi.fn(async () => Response.json(body)) as unknown as typeof globalThis.fetch;

describe('GET /preview', () => {
	it('returns the preview URL, not cached', async () => {
		const response = await call(
			'artist=Daft%20Punk&title=One%20More%20Time',
			deezer({ data: [{ title: 'One More Time', preview: PREVIEW, link: 'https://www.deezer.com/track/1', artist: { name: 'Daft Punk' } }] })
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ url: PREVIEW, link: 'https://www.deezer.com/track/1' });
	});

	it('400 without artist or title', async () => {
		const fetch = deezer({ data: [] });
		expect((await call('artist=A', fetch)).status).toBe(400);
		expect((await call('title=B', fetch)).status).toBe(400);
		expect((await call('artist=%20%20&title=B', fetch)).status).toBe(400);
		expect((await call(`artist=A&title=${'x'.repeat(301)}`, fetch)).status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('404 when Deezer has no matching preview', async () => {
		expect((await call('artist=A&title=B', deezer({ data: [] }))).status).toBe(404);
	});

	it('502 with the message when Deezer fails', async () => {
		const response = await call('artist=A&title=B', deezer({ error: { message: 'Quota limit exceeded' } }));
		expect(response.status).toBe(502);
		expect((await response.json()).error).toContain('Quota limit exceeded');
		const down = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;
		expect((await call('artist=A&title=B', down)).status).toBe(502);
	});
});
