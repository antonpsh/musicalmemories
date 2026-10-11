/** Search links for a Track on YouTube and Spotify (no API calls; v1 links out only). */

export interface TrackRef {
	title: string;
	artist: string;
}

const query = (track: TrackRef) => encodeURIComponent(`${track.title} ${track.artist}`);

export function youtubeSearchUrl(track: TrackRef): string {
	return `https://www.youtube.com/results?search_query=${query(track)}`;
}

export function spotifySearchUrl(track: TrackRef): string {
	return `https://open.spotify.com/search/${query(track)}`;
}
