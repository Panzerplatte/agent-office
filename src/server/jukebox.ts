import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JUKEBOX_DEFAULT, JUKEBOX_TUNES, RADIO_STATIONS, STREAM, checkStreamUrl, stationById, trackTitle, tuneById, type JukeboxState } from '../shared/jukebox.js';
import { notice, type Notice } from '../shared/notices.js';

/** A tune or a station the jukebox has. */
const isTrack = (id: string) => !!tuneById(id) || !!stationById(id);

interface Saved {
  on: boolean;
  track: string;
  url?: string;
  by?: string;
  /** When the track started, on this machine's clock. */
  startedAt: number;
}

/**
 * The lounge jukebox on one floor, saved in .agent-office/jukebox.json (the casino's, in the office's
 * own data dir as casino-jukebox.json). It only says what's on and since when; every browser plays it
 * for itself, from the same point.
 */
export class Jukebox {
  private s: Saved = { on: false, track: JUKEBOX_DEFAULT, startedAt: Date.now() };
  private file: string;

  constructor(dataDir: string, file = 'jukebox.json') {
    this.file = path.join(dataDir, file);
    this.load();
  }

  state(): JukeboxState {
    const { on, track, url, by, startedAt } = this.s;
    return { on, track, ...(url && track === STREAM ? { url } : {}), ...(by ? { by } : {}), startedAt, elapsed: Math.max(0, Date.now() - startedAt) };
  }

  /** What's on, for toasts: “Rainy Window”, “I Love Hip Hop”, or where a stream comes from. */
  title(): string {
    return trackTitle(this.s);
  }

  /** Puts on a tune, a station (only one of RADIO_STATIONS, not any link), a stream, or (with neither) whatever it had. Says whether anything changed, or why it can't. */
  play(input: { track?: unknown; url?: unknown }, by: string): { changed: boolean } | { error: string | Notice } {
    if (input.url !== undefined && input.url !== '') {
      const u = checkStreamUrl(input.url);
      if ('error' in u) return u;
      this.set({ on: true, track: STREAM, url: u.url, by });
    } else if (input.track !== undefined) {
      if (typeof input.track !== 'string' || !isTrack(input.track)) return { error: notice('jukebox.noSuchTune') };
      this.set({ on: true, track: input.track, by });
    } else {
      if (this.s.on) return { changed: false };
      this.set({ ...this.s, on: true, by });
    }
    return { changed: true };
  }

  /** On to the next tune, or from a station to the next station; from a stream, back to the first tune. */
  skip(by: string) {
    const list: readonly { id: string }[] = stationById(this.s.track) ? RADIO_STATIONS : JUKEBOX_TUNES;
    const i = list.findIndex((t) => t.id === this.s.track);
    this.set({ on: true, track: list[(i + 1) % list.length].id, by });
  }

  /** Whether what's on is internet radio (a station or a pasted stream) rather than a tune. */
  radio(): boolean {
    return this.s.track === STREAM || !!stationById(this.s.track);
  }

  stop(by: string): boolean {
    if (!this.s.on) return false;
    this.s = { ...this.s, on: false, by };
    this.save();
    return true;
  }

  private set(s: Omit<Saved, 'startedAt'>) {
    this.s = { ...s, startedAt: Date.now() };
    this.save();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const url = s.track === STREAM ? checkStreamUrl(s.url) : undefined;
      if (s.track === STREAM ? !url || 'error' in url : typeof s.track !== 'string' || !isTrack(s.track)) return;
      this.s = {
        on: s.on === true,
        track: s.track!,
        ...(url && 'url' in url ? { url: url.url } : {}),
        ...(typeof s.by === 'string' ? { by: s.by.slice(0, 24) } : {}),
        startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : Date.now(),
      };
    } catch {
      // a broken file just means a quiet lounge
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
