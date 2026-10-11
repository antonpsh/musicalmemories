import { describe, expect, it, vi } from 'vitest';
import { DeezerError, findPreview, isDeezerMediaUrl, normalize } from './deezer.ts';

const PREVIEW = 'https://cdnt-preview.dzcdn.net/api/1/1/a/b/c.mp3?hdnea=exp=1~hmac=x';

function track(artist: string, title: string, preview = PREVIEW) {
	return { title, title_short: title, link: 'https://www.deezer.com/track/1', preview, artist: { name: artist } };
}

const stub = (body: unknown, status = 200) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(body, { status }));

describe('normalize', () => {
	it('drops case, accents, brackets, suffixes and punctuation', () => {
		expect(normalize('Beyoncé')).toBe('beyonce');
		expect(normalize('Something (Remastered 2009)')).toBe('something');
		expect(normalize('Song - Live at Wembley')).toBe('song');
		expect(normalize("Don't Stop / Live")).toBe('dontstoplive');
		expect(normalize('AC/DC')).toBe('acdc');
	});
});

describe('isDeezerMediaUrl', () => {
	it('accepts only https dzcdn.net hosts', () => {
		expect(isDeezerMediaUrl(PREVIEW)).toBe(true);
		expect(isDeezerMediaUrl('http://cdnt-preview.dzcdn.net/x.mp3')).toBe(false);
		expect(isDeezerMediaUrl('https://evil.example/dzcdn.net/x.mp3')).toBe(false);
		expect(isDeezerMediaUrl('')).toBe(false);
	});
});

describe('findPreview', () => {
	it('searches "artist title" and returns the matching preview', async () => {
		const fetch = stub({ data: [track('Daft Punk', 'One More Time')] });
		const preview = await findPreview({ artist: 'Daft Punk', title: 'One More Time' }, fetch);
		expect(preview).toEqual({ url: PREVIEW, link: 'https://www.deezer.com/track/1' });
		const url = new URL(fetch.mock.calls[0][0] as URL);
		expect(url.origin + url.pathname).toBe('https://api.deezer.com/search');
		expect(url.searchParams.get('q')).toBe('Daft Punk One More Time');
	});

	it('skips results whose artist or title differ', async () => {
		const wanted = 'https://cdnt-preview.dzcdn.net/wanted.mp3';
		const fetch = stub({
			data: [
				track('Tribute Band', 'One More Time', 'https://cdnt-preview.dzcdn.net/tribute.mp3'),
				track('Daft Punk', 'One More Time Cover', 'https://cdnt-preview.dzcdn.net/cover.mp3'),
				track('daft punk', 'One More Time (Radio Edit)', wanted)
			]
		});
		expect((await findPreview({ artist: 'Daft Punk', title: 'One More Time' }, fetch))?.url).toBe(wanted);
		expect(new URL(fetch.mock.calls[0][0] as URL).searchParams.get('limit')).toBe('10');
	});

	it('drops a link outside deezer.com', async () => {
		const entry = { ...track('A', 'B'), link: 'https://evil.example/' };
		expect((await findPreview({ artist: 'A', title: 'B' }, stub({ data: [entry] })))?.link).toBe('');
	});

	it('does not search when artist or title normalize to nothing', async () => {
		const fetch = stub({ data: [] });
		expect(await findPreview({ artist: 'A', title: '()' }, fetch)).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('returns null when nothing matches or the preview is missing', async () => {
		expect(await findPreview({ artist: 'A', title: 'B' }, stub({ data: [track('X', 'Y')] }))).toBeNull();
		expect(await findPreview({ artist: 'A', title: 'B' }, stub({ data: [track('A', 'B', '')] }))).toBeNull();
		expect(await findPreview({ artist: 'A', title: 'B' }, stub({ data: [] }))).toBeNull();
	});

	it('rejects previews outside Deezer CDN', async () => {
		expect(await findPreview({ artist: 'A', title: 'B' }, stub({ data: [track('A', 'B', 'https://evil.example/x.mp3')] }))).toBeNull();
	});

	it('throws DeezerError on API errors, HTTP errors and network failures', async () => {
		await expect(findPreview({ artist: 'A', title: 'B' }, stub({ error: { message: 'Quota limit exceeded', code: 4 } }))).rejects.toThrow('Quota limit exceeded');
		await expect(findPreview({ artist: 'A', title: 'B' }, stub({}, 500))).rejects.toMatchObject({ name: 'DeezerError', status: 500 });
		const html = vi.fn(async () => new Response('<html>'));
		await expect(findPreview({ artist: 'A', title: 'B' }, html)).rejects.toThrow('Deezer returned an unexpected response.');
		const down = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		await expect(findPreview({ artist: 'A', title: 'B' }, down)).rejects.toMatchObject({ status: 0, message: 'Could not reach Deezer: fetch failed' });
	});
});
