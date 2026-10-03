// The lounge jukebox: the tunes and radio stations it has and what it's playing, shared by the server (which keeps one
// per floor) and the browser (which synthesizes the tunes, see client/music.ts).

import { notice, type Notice } from './notices.js';

export interface JukeboxTune {
  id: string;
  title: string;
  /** A few words on the card in its list. */
  mood: string;
}

export const JUKEBOX_TUNES: readonly JukeboxTune[] = [
  { id: 'rainy-window', title: 'Rainy Window', mood: 'slow and dreamy' },
  { id: 'coffee-break', title: 'Coffee Break', mood: 'jazzy, easy swing' },
  { id: 'late-commit', title: 'Late Commit', mood: 'minor key, 2 a.m.' },
  { id: 'green-build', title: 'Green Build', mood: 'bright and bouncy' },
];

/** The `track` of a stream someone pasted. */
export const STREAM = 'stream';

export interface RadioStation {
  /** Also the jukebox's `track` while it plays. */
  id: string;
  name: string;
  /** A few words on the card in its list. */
  genre: string;
  /** The channel's colour on ilovemusic.de, for its card (I Love Radio's own is white, so it gets their red). */
  color: string;
  /** The channel's number at I Love Radio, which their now-playing feed goes by. */
  channel: number;
  url: string;
}

/** The streams' own host; their numbering (iloveradioN) isn't the channel numbering. */
const ILR = (n: number) => `https://streams.ilovemusic.de/iloveradio${n}.mp3`;
/** The few channels without an iloveradioN.mp3, as ilovemusic.de's own player plays them. */
const ILM = (mount: string) => `https://play.ilovemusic.de/${mount}/`;

/**
 * Every public I Love Radio channel, as of October 2026: the list, names and colours on
 * https://www.ilovemusic.de/streams, the streams from their player's channel list
 * (https://www.ilovemusic.de/typo3conf/ext/ep_channel/Scripts/listChannels.php) matched to the
 * streams.ilovemusic.de/iloveradioN.mp3 that redirect to the same mount. Hard-coded so the office
 * doesn't lean on their API; the first one is the jukebox's default.
 */
export const RADIO_STATIONS: readonly RadioStation[] = [
  { id: 'iloveradio', name: 'I Love Radio', genre: 'Charts, Dance, Hip Hop & Throwbacks', color: '#e4003b', channel: 1, url: ILR(1) },
  { id: 'ilove2dance', name: 'I Love 2 Dance', genre: 'Club hits, dance classics, DJ sets', color: '#00d5ff', channel: 2, url: ILR(2) },
  { id: 'ilove2000throwbacks', name: 'I Love 2000+ Throwbacks', genre: 'Hits of the 2000s', color: '#b34f4f', channel: 37, url: ILR(37) },
  { id: 'ilove2010throwbacks', name: 'I Love 2010+ Throwbacks', genre: 'Hits of the 2010s', color: '#db377e', channel: 38, url: ILR(38) },
  { id: 'ilovebass', name: 'I Love Bass by HBz', genre: 'Hypertechno, bass & bounce', color: '#1f1f1f', channel: 39, url: ILR(29) },
  { id: 'ilovebiggestpophits', name: 'I Love Biggest Pop Hits', genre: 'The biggest pop stars', color: '#db377e', channel: 16, url: ILR(11) },
  { id: 'ilovebueffelradio', name: 'I Love Büffelradio', genre: 'Schlager & Party', color: '#df2f1d', channel: 225, url: ILM('ilm-buffelradio') },
  { id: 'ilovechillhop', name: 'I Love Chillhop', genre: 'Lofi hip hop & chill beats', color: '#714b85', channel: 20, url: ILR(17) },
  { id: 'ilovechilloutbeats', name: 'I Love Chillout Beats', genre: 'Chillout & downtempo', color: '#714b85', channel: 102, url: ILM('ilm-ichillout_beats') },
  { id: 'ilovedance2026', name: 'I Love Dance 2026', genre: 'The year’s top dance hits', color: '#ff0000', channel: 36, url: ILR(36) },
  { id: 'ilovedancehistory', name: 'I Love Dance History', genre: 'Dancefloor anthems & classics', color: '#00aaff', channel: 26, url: ILR(26) },
  { id: 'ilovedeutschrapbeste', name: 'I Love Deutschrap Beste', genre: 'Deutschrap, nothing but', color: '#6f9e00', channel: 6, url: ILR(6) },
  { id: 'ilovedeutschrapfirst', name: 'I Love Deutschrap First!', genre: 'New Deutschrap', color: '#6f9e00', channel: 104, url: ILR(104) },
  { id: 'ilovegreatesthits', name: 'I Love Greatest Hits', genre: 'Number ones & 2000s pop', color: '#d0d691', channel: 21, url: ILR(16) },
  { id: 'ilovehardstyle', name: 'I Love Hardstyle', genre: 'Hardstyle, Tekk & hard dance', color: '#2d2d38', channel: 31, url: ILR(21) },
  { id: 'ilovehiphop', name: 'I Love Hip Hop', genre: 'Deutschrap × US rap × throwbacks', color: '#4a5746', channel: 4, url: ILR(3) },
  { id: 'ilovehiphop2026', name: 'I Love Hip Hop 2026', genre: 'The year’s top hip hop hits', color: '#ff0000', channel: 35, url: ILR(35) },
  { id: 'ilovehiphophistory', name: 'I Love Hip Hop History', genre: 'Old-school rap throwbacks', color: '#d1b200', channel: 27, url: ILR(27) },
  { id: 'ilovehitquiz', name: 'I Love Hit-Quiz', genre: 'Guess the hit', color: '#e48100', channel: 30, url: ILM('ilm-ihit-quiz/mp3-192') },
  { id: 'ilovehits2026', name: 'I Love Hits 2026', genre: 'The year’s biggest hits', color: '#ff0000', channel: 109, url: ILR(109) },
  { id: 'ilovehitshistory', name: 'I Love Hits History', genre: '90s & 2000s throwbacks', color: '#b34f4f', channel: 15, url: ILR(12) },
  { id: 'ilovekpop', name: 'I Love K-Pop', genre: 'K-pop', color: '#f393d6', channel: 122, url: ILM('ilm-ilovekpop') },
  { id: 'ilovemainstage', name: 'I Love Mainstage', genre: 'Festival tunes & big-room bangers', color: '#85edc0', channel: 32, url: ILR(22) },
  { id: 'ilovemalle', name: 'I Love Malle', genre: 'Nonstop Mallorca party', color: '#b5587f', channel: 25, url: ILR(25) },
  { id: 'ilovemashup', name: 'I Love Mashup', genre: 'Mash-ups & bootlegs', color: '#9900ff', channel: 5, url: ILR(5) },
  { id: 'ilovemusicandchill', name: 'I Love Music & Chill', genre: 'Chilled pop & smooth hip hop', color: '#d086d1', channel: 10, url: ILR(10) },
  { id: 'ilovepartyhard', name: 'I Love Party Hard', genre: 'Party hits & all-time classics', color: '#ff00cc', channel: 18, url: ILR(14) },
  { id: 'iloverock', name: 'I Love Rock Radio', genre: 'Rock & alternative', color: '#adadad', channel: 41, url: ILR(4) },
  { id: 'ilovesugarradio', name: 'I Love Sugar Radio', genre: 'Robin Schulz’s own station', color: '#00f291', channel: 23, url: ILR(18) },
  { id: 'ilovethe90s', name: 'I Love The 90s', genre: '1990 to 2000', color: '#ff00cc', channel: 34, url: ILR(24) },
  { id: 'ilovethebeach', name: 'I Love The Beach', genre: 'Chilled house, afro & deep house', color: '#ffc400', channel: 7, url: ILR(7) },
  { id: 'ilovethesummer', name: 'I Love The Summer', genre: 'Summer hits', color: '#ff7940', channel: 8, url: ILR(8) },
  { id: 'ilovethesun', name: 'I Love The Sun', genre: 'Afrobeats, Latin, Reggaeton', color: '#edd839', channel: 19, url: ILR(15) },
  { id: 'ilovetomorrowland', name: 'I Love Tomorrowland', genre: 'One World Radio', color: '#560f92', channel: 101, url: ILM('ilm-itomorrowland_one_world_radio_germany') },
  { id: 'ilovetop100charts', name: 'I Love Top 100 Charts', genre: 'Top hits Germany', color: '#ff0000', channel: 9, url: ILR(9) },
  { id: 'ilovetrashpop', name: 'I Love Trashpop', genre: 'Party hits & trash pop', color: '#ff00cc', channel: 29, url: ILR(19) },
  { id: 'iloveusonlyrap', name: 'I Love US Only Rap Radio', genre: 'US rap, trap & hip hop', color: '#343857', channel: 17, url: ILR(13) },
  { id: 'iloveworkout', name: 'I Love Workout', genre: 'Nonstop DJ mix for training', color: '#aceb00', channel: 33, url: ILR(23) },
];

/** What a jukebox that has never been played is set to (still off until someone turns it on). */
export const JUKEBOX_DEFAULT = RADIO_STATIONS[0].id;

/** Where the stations' now-playing comes from: every channel's artist, title and cover, open to any page. */
export const RADIO_NOW_PLAYING = 'https://ilovemusic.de/typo3conf/ext/ep_channel/Scripts/playlist.php';

export interface JukeboxState {
  on: boolean;
  /** One of JUKEBOX_TUNES, one of RADIO_STATIONS, or STREAM for `url`. It stays put while the jukebox is off, to turn back on. */
  track: string;
  /** Internet radio or an audio file someone pasted. */
  url?: string;
  /** Who last put something on, or turned it off. */
  by?: string;
  /** When the track started, on the office's clock (see the 'pong' message), so everyone hears the same bar. */
  startedAt: number;
  /** How far into the track it was when this was sent, in ms, for until the clocks are compared. */
  elapsed: number;
}

export const tuneById = (id: string): JukeboxTune | undefined => JUKEBOX_TUNES.find((t) => t.id === id);
export const stationById = (id: string): RadioStation | undefined => RADIO_STATIONS.find((r) => r.id === id);

/** What the browser streams for this track: a station's stream, the pasted link, or nothing for a tune. */
export function streamUrl(s: Pick<JukeboxState, 'track' | 'url'>): string | undefined {
  return s.track === STREAM ? s.url : stationById(s.track)?.url;
}

/** What's on, for the hint bar and the jukebox's own display: a tune's title, a station's name, or where the stream comes from. */
export function trackTitle(s: Pick<JukeboxState, 'track' | 'url'>): string {
  const station = stationById(s.track);
  if (station) return station.name;
  if (s.track !== STREAM) return tuneById(s.track)?.title ?? 'A tune';
  try {
    const u = new URL(s.url ?? '');
    const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return file ? `${u.hostname} · ${file}` : u.hostname;
  } catch {
    return 'A stream';
  }
}

export function checkStreamUrl(raw: unknown): { url: string } | { error: Notice } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: notice('jukebox.noLink') };
  if (s.length > 2048) return { error: notice('jukebox.longLink') };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: notice('jukebox.notLink') };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: notice('jukebox.notHttp') };
  return { url: u.href };
}
