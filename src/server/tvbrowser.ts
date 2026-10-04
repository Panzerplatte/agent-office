import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, CDPSession, Page, Request, Route } from 'playwright-core';
import type { ServiceInfo, TvBrowserInput, TvBrowserState, TvBrowserView } from '../shared/protocol.js';
import { notice, type Notice } from '../shared/notices.js';
import { officeHome } from './config.js';

// The lounge TV's browser: a worker's website, opened by the office in a headless Chromium on its
// own machine (where http://localhost:<port> just works, the dev server's HMR included) and streamed
// to everyone on the floor as JPEG frames from the DevTools screencast. Anyone on the floor can
// click, scroll and type on it; it's a shared TV. One Chromium serves every floor (a browser context
// each, so cookies don't mix), launched when the first floor puts something on and closed when the
// last turns it off. Nothing is kept on disk.

export const TV_VIEWS: Record<TvBrowserView, { width: number; height: number }> = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 },
};
/** Frames a second while it's just on the TV, and while someone has it full screen. */
export const TV_FPS = 8;
export const TV_FPS_WATCHED = 15;
const JPEG_QUALITY = 60;
/** With nobody on the floor this long, the TV goes off. */
export const TV_IDLE_MS = 3 * 60_000;
const LOAD_TIMEOUT_MS = 30_000;
/** How often the page's title is looked at (a single-page app changes it without navigating). */
const TITLE_POLL_MS = 2000;
/** The least time between two opens on one floor. */
const OPEN_GAP_MS = 1000;
/** Per person: mouse moves a second, and other input (a burst of BURST, then RATE a second). */
const MOVES_PER_S = 60;
const INPUT_BURST = 40;
const INPUT_RATE = 20;
/** Input waiting for the page beyond this is dropped. */
const MAX_QUEUED = 100;
const MAX_TEXT = 1000;
const MAX_WHEEL = 2000;

export const NO_CHROMIUM =
  "The office has no Chromium for the TV: put a self-contained one in ~/.local/share/agent-office/chromium/ (its binary as chromium/chromium), run `npx playwright-core install chromium` on the office's machine, or set AGENT_OFFICE_CHROMIUM to a Chrome or Chromium binary";
export const BROWSER_STOPPED = "The TV's browser stopped. Put the page on the TV again";
export const PAGE_CRASHED = 'The page crashed. Reload it';

/** Chrome and Chromium where systems usually install them, for when Playwright's own isn't there. */
const SYSTEM_CHROMIUM: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
};

const LAUNCH_ARGS = ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--disable-extensions', '--disable-background-networking'];

/** A self-contained Chromium (with its libraries next to it) in this folder needs no system libraries. */
const OWN_CHROMIUM = path.join('chromium', 'chromium');

/** Why a launch failed, in a line: the browser's own first complaint (e.g. a missing library) when Playwright logged one. */
function whyNot(err: unknown): string {
  const msg = (err as Error).message ?? String(err);
  const said = /\[pid=\d+\]\[err\] (.+)/.exec(msg)?.[1];
  return (said ?? msg.split('\n').find((l) => l.trim()) ?? 'failed').trim().slice(0, 200);
}

/** What launchChromium needs from the machine; tests pass their own. */
export interface ChromiumDeps {
  playwright?: () => Promise<Pick<typeof import('playwright-core'), 'chromium'>>;
  exists?: (path: string) => boolean;
  homedir?: string;
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
}

/**
 * Starts the TV's Chromium, trying in turn: AGENT_OFFICE_CHROMIUM, the office's home/chromium/chromium,
 * ~/.local/share/agent-office/chromium/chromium, Playwright's own, then a system Chrome or Chromium.
 * One that's there but won't start (missing shared libraries, say) is logged and the next one tried.
 */
export async function launchChromium(env: NodeJS.ProcessEnv = process.env, deps: ChromiumDeps = {}): Promise<Browser> {
  const exists = deps.exists ?? existsSync;
  const log = deps.log ?? ((line: string) => console.error(`agent-office: ${line}`));
  const home = deps.homedir ?? os.homedir();
  let pw: Pick<typeof import('playwright-core'), 'chromium'>;
  try {
    pw = await (deps.playwright ?? (() => import('playwright-core')))();
  } catch {
    throw new Error("The office can't open web pages on the TV: the playwright-core package isn't installed");
  }
  const tried: string[] = [];
  /** Launches the Chromium at `executablePath` (Playwright's own without one); undefined when it won't start. */
  const attempt = async (executablePath?: string): Promise<Browser | undefined> => {
    try {
      return await pw.chromium.launch({ executablePath, args: LAUNCH_ARGS });
    } catch (err) {
      // Playwright's headless shell just isn't installed: nothing to report.
      if (!executablePath && /Executable doesn't exist|playwright.* install/i.test((err as Error).message)) return undefined;
      const why = whyNot(err);
      tried.push(`${executablePath ?? "Playwright's Chromium"}: ${why}`);
      log(`the TV's Chromium ${executablePath ?? "(Playwright's)"} didn't start: ${why}`);
      return undefined;
    }
  };
  const own = env.AGENT_OFFICE_CHROMIUM;
  if (own && !exists(own)) {
    tried.push(`AGENT_OFFICE_CHROMIUM is set to ${own}, which doesn't exist`);
    log(tried.at(-1)!);
  }
  const ownFirst = [own, path.join(officeHome(env), OWN_CHROMIUM), path.join(home, '.local', 'share', 'agent-office', OWN_CHROMIUM)];
  for (const p of new Set(ownFirst)) {
    const b = p && exists(p) ? await attempt(p) : undefined;
    if (b) return b;
  }
  const shell = await attempt();
  if (shell) return shell;
  // Playwright's full Chromium without its headless shell, or a system one.
  for (const p of new Set([pw.chromium.executablePath(), ...(SYSTEM_CHROMIUM[deps.platform ?? process.platform] ?? [])])) {
    const b = p && exists(p) ? await attempt(p) : undefined;
    if (b) return b;
  }
  throw new Error(tried.length ? `${NO_CHROMIUM}. Tried: ${tried.join('; ')}` : NO_CHROMIUM);
}

/** The one Chromium every floor's TV shares: launched for the first user, closed after the last. */
export class TvBrowsers {
  private browser?: Promise<Browser>;
  private users = new Set<object>();

  constructor(private launch: () => Promise<Browser> = launchChromium) {}

  /** A fresh browser context for `user`, launching the browser if it isn't running. */
  async context(user: object, options: Parameters<Browser['newContext']>[0]): Promise<BrowserContext> {
    this.users.add(user);
    let launching = this.browser;
    if (!launching) {
      launching = this.launch().then((b) => {
        b.on('disconnected', () => {
          if (this.browser === launching) this.browser = undefined;
        });
        return b;
      });
      this.browser = launching;
      // A failed launch is tried again by the next open.
      launching.catch(() => {
        if (this.browser === launching) this.browser = undefined;
      });
    }
    const browser = await launching;
    return browser.newContext(options);
  }

  /** `user` is done with it: the last one out closes the browser. */
  release(user: object) {
    this.users.delete(user);
    if (this.users.size || !this.browser) return;
    const closing = this.browser;
    this.browser = undefined;
    closing.then((b) => b.close()).catch(() => {});
  }

  get running(): boolean {
    return !!this.browser;
  }

  shutdown() {
    this.users.clear();
    const closing = this.browser;
    this.browser = undefined;
    closing?.then((b) => b.close()).catch(() => {});
  }
}

/** A frame for the floor: a base64 JPEG of w×h pixels. */
export interface TvFrame {
  data: string;
  w: number;
  h: number;
}

/** What the TV needs from its floor. */
export interface TvDeps {
  /** How many people are on the floor. */
  people(): number;
  /** Whether anyone on the floor has the TV open full screen. */
  watching(): boolean;
  /** The worker service on this port, when it's one of this floor's. */
  service(port: number): ServiceInfo | undefined;
  state(state: TvBrowserState | null): void;
  frame(frame: TvFrame): void;
  toast(text: Notice): void;
}

/** Whether `url` is the TV's own site, http://localhost:<port> (or 127.0.0.1). */
export function sameSite(url: string, port: number): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && Number(u.port || 80) === port;
  } catch {
    return false;
  }
}

/** The pixel size of a JPEG (base64), from its start-of-frame marker. */
export function jpegSize(b64: string): { w: number; h: number } | undefined {
  const buf = Buffer.from(b64.slice(0, 64 * 1024), 'base64');
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return undefined;
    const marker = buf[i + 1];
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return undefined;
}

const clamp01 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
const clampAbs = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(-max, v)) : 0);
const BUTTONS = ['left', 'middle', 'right'] as const;
const MODIFIERS: [number, string][] = [
  [1, 'Alt'],
  [2, 'Control'],
  [4, 'Meta'],
  [8, 'Shift'],
];

/** One person's allowance for input on the TV. */
interface Allowance {
  movedAt: number;
  tokens: number;
  at: number;
}

/** The TV in one floor's lounge. */
export class TvBrowser {
  private cur: TvBrowserState | null = null;
  private view: TvBrowserView = 'desktop';
  private context?: BrowserContext;
  private page?: Page;
  private cdp?: CDPSession;
  /** Bumped by every open and close, so a slow open that's been overtaken drops what it made. */
  private gen = 0;
  private openedAt = 0;
  private casting = false;
  private latest?: TvFrame;
  private sentAt = 0;
  private frameTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private titleTimer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  private allowances = new Map<string, Allowance>();

  constructor(
    private browsers: TvBrowsers,
    private deps: TvDeps,
  ) {}

  state(): TvBrowserState | null {
    return this.cur;
  }

  /** The last frame, for someone who just walked in. */
  frame(): TvFrame | undefined {
    return this.cur ? this.latest : undefined;
  }

  /** Puts `port`'s website on the TV; an error to tell `by` when it isn't one of this floor's services. */
  open(port: number, by: string, now = Date.now()): Notice | undefined {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return notice('tv.notService', { port: String(port) });
    const svc = this.deps.service(port);
    if (!svc) return notice('tv.notService', { port });
    if (now - this.openedAt < OPEN_GAP_MS) return undefined;
    this.openedAt = now;
    // Another site on: the browser stays up for it.
    this.teardown(false);
    const gen = ++this.gen;
    const { width, height } = TV_VIEWS[this.view];
    const url = `http://localhost:${port}/`;
    const title = svc.title || `localhost:${port}`;
    this.cur = { port, url, title, by, width, height, loading: true };
    this.emit();
    this.deps.toast(notice('tv.showing', { name: by, title }));
    void this.start(gen, port, url);
    this.peopleChanged();
    return undefined;
  }

  /** Turns the TV off. */
  close() {
    if (!this.cur && !this.context) return;
    this.gen++;
    this.teardown();
    this.cur = null;
    this.latest = undefined;
    this.emit();
  }

  nav(action: 'back' | 'forward' | 'reload') {
    const page = this.page;
    if (!page) return;
    const opts = { waitUntil: 'commit' as const, timeout: LOAD_TIMEOUT_MS };
    const go = action === 'back' ? page.goBack(opts) : action === 'forward' ? page.goForward(opts) : page.reload(opts);
    go.catch(() => {});
  }

  setView(mode: TvBrowserView) {
    if (!TV_VIEWS[mode] || mode === this.view) return;
    this.view = mode;
    if (!this.cur) return;
    const { width, height } = TV_VIEWS[mode];
    Object.assign(this.cur, { width, height });
    this.emit();
    const page = this.page;
    if (!page) return;
    void page
      .setViewportSize({ width, height })
      .then(async () => {
        // The screencast's size goes with the viewport.
        if (!this.casting) return;
        await this.stopCast();
        await this.startCast();
      })
      .catch(() => {});
  }

  /** Someone came onto the floor or left it: the screencast runs only while someone's there, and the TV goes off a while after the last leaves. */
  peopleChanged() {
    const here = this.deps.people() > 0;
    if (here || !this.cur) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (!this.cur) return;
    if (here) {
      void this.startCast();
    } else if (!this.idleTimer) {
      // Already counting down stays counting down: this is called for every floor whenever anyone moves.
      void this.stopCast();
      this.idleTimer = setTimeout(() => this.close(), TV_IDLE_MS);
      this.idleTimer.unref?.();
    }
  }

  /** Someone opened the TV full screen or closed it: the next frame comes at the new pace. */
  watchChanged() {
    if (this.frameTimer && this.latest) {
      clearTimeout(this.frameTimer);
      this.frameTimer = undefined;
      this.flush();
    }
  }

  /** Mouse or keyboard from `from` (a connection), within their allowance. */
  input(from: string, msg: TvBrowserInput, now = Date.now()) {
    const page = this.page;
    if (!page || !this.cur || !this.allowed(from, msg.kind, now)) return;
    if (this.queued >= MAX_QUEUED) return;
    const { width, height } = this.cur;
    const x = clamp01(msg.x) * width;
    const y = clamp01(msg.y) * height;
    const button = BUTTONS[msg.button ?? 0] ?? 'left';
    const mods = MODIFIERS.filter(([bit]) => ((msg.mods ?? 0) & bit) !== 0).map(([, name]) => name);
    let op: (() => Promise<void>) | undefined;
    switch (msg.kind) {
      case 'move':
        op = () => page.mouse.move(x, y);
        break;
      case 'down':
        op = async () => {
          await page.mouse.move(x, y);
          await page.mouse.down({ button });
        };
        break;
      case 'up':
        op = async () => {
          await page.mouse.move(x, y);
          await page.mouse.up({ button });
        };
        break;
      case 'click':
        op = () => page.mouse.click(x, y, { button });
        break;
      case 'wheel': {
        const dx = clampAbs(msg.dx, MAX_WHEEL);
        const dy = clampAbs(msg.dy, MAX_WHEEL);
        op = async () => {
          if (msg.x !== undefined && msg.y !== undefined) await page.mouse.move(x, y);
          await page.mouse.wheel(dx, dy);
        };
        break;
      }
      case 'key': {
        const key = typeof msg.key === 'string' ? msg.key.slice(0, 32) : '';
        // A key with dx set is the viewer's keyup (client/ui/tvbrowser.ts): the whole press went on keydown.
        // A modifier on its own does nothing; it comes along in mods with the key it goes with.
        if (!key || msg.dx !== undefined || MODIFIERS.some(([, name]) => name === key)) return;
        // Down and up by hand rather than press(), which would read "+" as a chord.
        op = async () => {
          for (const m of mods) await page.keyboard.down(m);
          try {
            await page.keyboard.down(key);
            await page.keyboard.up(key);
          } finally {
            for (const m of mods.reverse()) await page.keyboard.up(m);
          }
        };
        break;
      }
      case 'text': {
        const text = typeof msg.text === 'string' ? msg.text.slice(0, MAX_TEXT) : '';
        if (!text) return;
        op = () => page.keyboard.insertText(text);
        break;
      }
      default:
        return;
    }
    this.queued++;
    // In order, one after the other; a key Playwright doesn't know is just dropped.
    this.queue = this.queue.then(op).catch(() => {}).finally(() => this.queued--);
  }

  /** Whether `from` may send this now: moves at MOVES_PER_S, the rest from a bucket. */
  private allowed(from: string, kind: TvBrowserInput['kind'], now: number): boolean {
    let a = this.allowances.get(from);
    if (!a) {
      a = { movedAt: 0, tokens: INPUT_BURST, at: now };
      this.allowances.set(from, a);
      if (this.allowances.size > 64) this.allowances.delete(this.allowances.keys().next().value!);
    }
    if (kind === 'move') {
      if (now - a.movedAt < 1000 / MOVES_PER_S) return false;
      a.movedAt = now;
      return true;
    }
    a.tokens = Math.min(INPUT_BURST, a.tokens + ((now - a.at) / 1000) * INPUT_RATE);
    a.at = now;
    if (a.tokens < 1) return false;
    a.tokens--;
    return true;
  }

  shutdown() {
    this.close();
  }

  // --- The page --------------------------------------------------------------------------------

  private async start(gen: number, port: number, url: string) {
    let context: BrowserContext;
    try {
      context = await this.browsers.context(this, {
        viewport: TV_VIEWS[this.view],
        deviceScaleFactor: 1,
        acceptDownloads: false,
        // A service worker's requests would get round the route below.
        serviceWorkers: 'block',
      });
    } catch (err) {
      if (gen !== this.gen) return;
      this.browsers.release(this);
      return this.fail((err as Error).message || NO_CHROMIUM);
    }
    if (gen !== this.gen) {
      void context.close().catch(() => {});
      return;
    }
    this.context = context;
    try {
      const page = await context.newPage();
      if (gen !== this.gen) return;
      this.page = page;
      await context.route('**/*', (route, request) => this.route(route, request, port));
      // Popups and new tabs: closed, and their address (if it's the site's own) opened in the TV's page.
      context.on('page', (p) => {
        if (p !== this.page) void p.close().catch(() => {});
      });
      page.on('dialog', (d) => void (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
      page.on('download', (d) => void d.cancel().catch(() => {}));
      page.on('framenavigated', (f) => {
        if (gen !== this.gen || f !== page.mainFrame()) return;
        this.update({ url: f.url(), loading: true });
      });
      page.on('domcontentloaded', () => void this.lookAtTitle(gen));
      page.on('load', () => {
        if (gen !== this.gen) return;
        this.update({ loading: false, error: undefined });
        void this.lookAtTitle(gen);
      });
      page.on('crash', () => {
        if (gen === this.gen) this.update({ loading: false, error: PAGE_CRASHED });
      });
      context.on('close', () => {
        // Not by us: the browser went away under it.
        if (gen !== this.gen) return;
        this.forget();
        this.fail(BROWSER_STOPPED);
      });
      const cdp = await context.newCDPSession(page);
      if (gen !== this.gen) return;
      this.cdp = cdp;
      cdp.on('Page.screencastFrame', (f) => {
        void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
        if (gen !== this.gen || !this.cur) return;
        const size = jpegSize(f.data) ?? { w: this.cur.width, h: this.cur.height };
        this.latest = { data: f.data, ...size };
        this.flush();
      });
      this.titleTimer = setInterval(() => void this.lookAtTitle(gen), TITLE_POLL_MS);
      this.titleTimer.unref?.();
      if (this.deps.people() > 0) void this.startCast();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
      } catch (err) {
        if (gen !== this.gen) return;
        const why = ((err as Error).message || '').split('\n')[0].replace(/^page\.goto:\s*/, '');
        this.update({ loading: false, error: `Couldn't load localhost:${port}: ${why}` });
      }
    } catch (err) {
      if (gen !== this.gen) return;
      console.error('agent-office: the TV browser failed:', err);
      this.gen++;
      this.teardown();
      this.fail(((err as Error).message || '').split('\n')[0] || BROWSER_STOPPED);
    }
  }

  /** Only the site itself in the TV's page; anything else that would take it elsewhere is stopped. */
  private async route(route: Route, request: Request, port: number) {
    const url = request.url();
    try {
      if (request.isNavigationRequest()) {
        let frame: ReturnType<Request['frame']> | undefined;
        try {
          frame = request.frame();
        } catch {
          frame = undefined;
        }
        const page = this.page;
        if (!frame || frame.page() !== page) {
          // A popup or a new tab: the site's own address opens in the TV's page instead.
          await route.abort('blockedbyclient');
          if (page && sameSite(url, port)) void page.goto(url, { waitUntil: 'commit' }).catch(() => {});
          return;
        }
        if (frame === page.mainFrame() ? !sameSite(url, port) : !/^https?:/.test(url)) return await route.abort('blockedbyclient');
      } else if (!/^(https?|data|blob):/.test(url)) {
        return await route.abort('blockedbyclient');
      }
      await route.continue();
    } catch {
      // The page went away while the request was waiting.
    }
  }

  private async lookAtTitle(gen: number) {
    const page = this.page;
    if (!page || gen !== this.gen) return;
    try {
      const title = (await page.title()).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (gen === this.gen && this.cur && title) this.update({ title });
    } catch {
      // Mid-navigation; the next look gets it.
    }
  }

  private async startCast() {
    const cdp = this.cdp;
    if (this.casting || !cdp || !this.cur) return;
    this.casting = true;
    const { width, height } = this.cur;
    try {
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: JPEG_QUALITY, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    } catch {
      this.casting = false;
    }
  }

  private async stopCast() {
    clearTimeout(this.frameTimer);
    this.frameTimer = undefined;
    if (!this.casting) return;
    this.casting = false;
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
  }

  /** Sends the newest frame, no faster than the pace (a frame that comes too soon waits for its turn). */
  private flush() {
    if (this.frameTimer || !this.latest) return;
    const gap = 1000 / (this.deps.watching() ? TV_FPS_WATCHED : TV_FPS);
    const wait = this.sentAt + gap - Date.now();
    if (wait > 0) {
      this.frameTimer = setTimeout(() => {
        this.frameTimer = undefined;
        this.flush();
      }, wait);
      return;
    }
    this.sentAt = Date.now();
    if (this.casting && this.latest) this.deps.frame(this.latest);
  }

  private update(patch: Partial<TvBrowserState>) {
    if (!this.cur) return;
    let changed = false;
    for (const [k, v] of Object.entries(patch) as [keyof TvBrowserState, unknown][]) {
      if (this.cur[k] === v) continue;
      changed = true;
      if (v === undefined) delete this.cur[k];
      else Object.assign(this.cur, { [k]: v });
    }
    if (changed) this.emit();
  }

  private fail(error: string) {
    this.update({ loading: false, error });
  }

  private emit() {
    this.deps.state(this.cur ? { ...this.cur } : null);
  }

  /** Lets go of the page and the browser context (without closing them: they're already gone). */
  private forget(release = true) {
    clearInterval(this.titleTimer);
    this.titleTimer = undefined;
    clearTimeout(this.frameTimer);
    this.frameTimer = undefined;
    this.casting = false;
    this.context = undefined;
    this.page = undefined;
    this.cdp = undefined;
    if (release) this.browsers.release(this);
  }

  private teardown(release = true) {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const context = this.context;
    this.forget(release);
    this.allowances.clear();
    if (context) void context.close().catch(() => {});
  }
}
