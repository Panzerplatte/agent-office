import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { notice, type Notice } from '../shared/notices.js';
import type { ServiceInfo, WorkerInfo } from '../shared/protocol.js';
import { isAsleep, isBusy } from '../shared/status.js';

// "🚀 Live gehen": a website a Claude worker built (with the webseite skill) goes into the floor's
// demo gallery on Render. The office doesn't publish anything itself: it asks the worker whose
// service it is to do it (commit, push, merge), and the gallery's address is a per-floor setting.

/** Exactly what the worker is told: the webseite skill's last step starts from these words. */
export const GO_LIVE_PROMPT = 'Live gehen: veröffentliche die Webseite in der Demo-Galerie.';

/** One press per service this often: the worker is busy publishing for a while anyway. */
export const GO_LIVE_GAP_MS = 2 * 60_000;

const URL_MAX = 2048;

/** A Demo-Galerie address as typed: https only, no login in it. '' (or blanks) takes it off. */
export function checkGalleryUrl(raw: unknown): { url: string | null } | { error: Notice } {
  if (typeof raw !== 'string') return { error: notice('gallery.notLink') };
  const s = raw.trim();
  if (!s) return { url: null };
  if (s.length > URL_MAX) return { error: notice('gallery.notLink') };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: notice('gallery.notLink') };
  }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return { error: notice('gallery.notHttps') };
  return { url: u.href };
}

interface Saved {
  url: string;
  by?: string;
  at?: number;
}

/**
 * The floor's Demo-Galerie: the public Render address its websites go live under, set from the
 * floor menu or ⚙️ Settings and kept in .agent-office/demogallery.json.
 */
export class DemoGallery {
  private s: Saved | null = null;
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'demogallery.json');
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const u = checkGalleryUrl(s.url);
      if ('url' in u && u.url) this.s = { url: u.url, ...(typeof s.by === 'string' ? { by: s.by } : {}), ...(typeof s.at === 'number' ? { at: s.at } : {}) };
    } catch {
      // never set
    }
  }

  get url(): string | null {
    return this.s?.url ?? null;
  }

  /** The new address (null: none), whether it changed, or why it can't be one. */
  set(raw: unknown, by: string): { url: string | null; changed: boolean } | { error: Notice } {
    const u = checkGalleryUrl(raw);
    if ('error' in u) return u;
    if (u.url === this.url) return { url: u.url, changed: false };
    this.s = u.url ? { url: u.url, by, at: Date.now() } : null;
    try {
      writeFileSync(this.file, JSON.stringify(this.s ?? { url: '' }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
    return { url: u.url, changed: true };
  }
}

export interface GoLiveDeps {
  /** The worker service on this port, when it's one of this floor's (from the services board). */
  service(port: number): ServiceInfo | undefined;
  worker(id: string): WorkerInfo | undefined;
  /** Types the prompt into the worker's terminal; says why not. */
  prompt(id: string, text: string, by: string): string | undefined;
}

/** Who's putting what live, for the floor's toast. */
export interface GoneLive {
  worker: WorkerInfo;
  service: string;
}

/** The 🚀 Live gehen button of one floor: finds the service's worker and prompts it, at most once per GO_LIVE_GAP_MS. */
export class GoLive {
  private last = new Map<string, number>();

  constructor(private readonly deps: GoLiveDeps) {}

  go(port: unknown, by: string, now = Date.now()): GoneLive | { error: Notice } {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return { error: notice('tv.notService', { port: String(port) }) };
    const svc = this.deps.service(port);
    const w = svc && this.deps.worker(svc.workerId);
    if (!svc || !w) return { error: notice('tv.notService', { port }) };
    const service = svc.title || `:${port}`;
    if (w.kind !== 'agent' || w.provider !== 'claude') return { error: notice('golive.notClaude', { name: w.name }) };
    if (isAsleep(w.status)) return { error: notice('golive.asleep', { name: w.name }) };
    if (isBusy(w.status)) return { error: notice('golive.busy', { name: w.name }) };
    const key = `${svc.workerId}:${port}`;
    const at = this.last.get(key);
    if (at !== undefined && now - at < GO_LIVE_GAP_MS) return { error: notice('golive.again', { service, s: Math.ceil((GO_LIVE_GAP_MS - (now - at)) / 1000) }) };
    const err = this.deps.prompt(w.id, GO_LIVE_PROMPT, by);
    if (err) return { error: notice('golive.asleep', { name: w.name }) };
    this.last.set(key, now);
    return { worker: w, service };
  }
}
