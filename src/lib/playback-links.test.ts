import { describe, expect, it } from 'vitest';
import { spotifySearchUrl, youtubeSearchUrl } from './playback-links.ts';

describe('playback links', () => {
	it('builds search URLs from "title artist"', () => {
		const track = { title: 'Wonderwall', artist: 'Oasis' };
		expect(youtubeSearchUrl(track)).toBe('https://www.youtube.com/results?search_query=Wonderwall%20Oasis');
		expect(spotifySearchUrl(track)).toBe('https://open.spotify.com/search/Wonderwall%20Oasis');
	});

	it('URL-encodes special characters', () => {
		const track = { title: "Don't Stop / Live", artist: 'AC/DC' };
		const q = encodeURIComponent("Don't Stop / Live AC/DC");
		expect(q).not.toContain('/');
		expect(youtubeSearchUrl(track)).toBe(`https://www.youtube.com/results?search_query=${q}`);
		expect(spotifySearchUrl(track)).toBe(`https://open.spotify.com/search/${q}`);
		expect(new URL(youtubeSearchUrl(track)).searchParams.get('search_query')).toBe("Don't Stop / Live AC/DC");
		expect(decodeURIComponent(new URL(spotifySearchUrl(track)).pathname.split('/')[2])).toBe(
			"Don't Stop / Live AC/DC"
		);
		expect(youtubeSearchUrl({ title: 'A & B?', artist: '#1 <x>' })).toBe(
			'https://www.youtube.com/results?search_query=A%20%26%20B%3F%20%231%20%3Cx%3E'
		);
	});
});
