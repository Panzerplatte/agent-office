import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser } from 'playwright-core';
import { NO_CHROMIUM, TV_IDLE_MS, TvBrowser, TvBrowsers, jpegSize, launchChromium, sameSite, type TvDeps, type TvFrame } from '../src/server/tvbrowser.js';
import type { ServiceInfo, TvBrowserState } from '../src/shared/protocol.js';
import type { Notice } from '../src/shared/notices.js';

type Handler = (...args: any[]) => unknown;

/** A stand-in for Playwright's page, context and browser that records what the TV does with them. */
function fakeBrowser() {
  const calls: string[] = [];
  const on = (handlers: Map<string, Handler[]>) => (event: string, fn: Handler) => {
    handlers.set(event, [...(handlers.get(event) ?? []), fn]);
  };
  const pageHandlers = new Map<string, Handler[]>();
  const contextHandlers = new Map<string, Handler[]>();
  const mainFrame = { url: () => page.url, page: () => page };
  const page: any = {
    url: 'about:blank',
    mainFrame: () => mainFrame,
    on: on(pageHandlers),
    goto: async (url: string) => {
      calls.push(`goto ${url}`);
      page.url = url;
      for (const fn of pageHandlers.get('framenavigated') ?? []) fn(mainFrame);
      for (const fn of pageHandlers.get('load') ?? []) fn();
    },
    title: async () => page.titleText ?? 'Fake site',
    goBack: async () => calls.push('back'),
    goForward: async () => calls.push('forward'),
    reload: async () => calls.push('reload'),
    setViewportSize: async (s: { width: number; height: number }) => calls.push(`viewport ${s.width}x${s.height}`),
    mouse: {
      move: async (x: number, y: number) => calls.push(`move ${x},${y}`),
      down: async (o: { button: string }) => calls.push(`down ${o.button}`),
      up: async (o: { button: string }) => calls.push(`up ${o.button}`),
      click: async (x: number, y: number, o: { button: string }) => calls.push(`click ${x},${y} ${o.button}`),
      wheel: async (dx: number, dy: number) => calls.push(`wheel ${dx},${dy}`),
    },
    keyboard: {
      down: async (k: string) => calls.push(`keydown ${k}`),
      up: async (k: string) => calls.push(`keyup ${k}`),
      insertText: async (t: string) => calls.push(`text ${t}`),
    },
  };
  const cdpHandlers = new Map<string, Handler[]>();
  const cdp = { on: on(cdpHandlers), send: async (m: string) => void calls.push(`cdp ${m}`) };
  let route: Handler | undefined;
  let closed = false;
  const context: any = {
    newPage: async () => page,
    route: async (_glob: string, fn: Handler) => void (route = fn),
    on: on(contextHandlers),
    newCDPSession: async () => cdp,
    close: async () => {
      closed = true;
      calls.push('context.close');
    },
  };
  let launches = 0;
  let browserClosed = 0;
  const browser = {
    on: () => {},
    newContext: async () => context,
    close: async () => void browserClosed++,
  } as unknown as Browser;
  return {
    calls,
    page,
    mainFrame,
    browsers: new TvBrowsers(async () => {
      launches++;
      return browser;
    }),
    route: (...args: unknown[]) => route!(...args),
    frame: (data: string) => {
      for (const fn of cdpHandlers.get('Page.screencastFrame') ?? []) fn({ data, sessionId: 1, metadata: {} });
    },
    get closed() {
      return closed;
    },
    get launches() {
      return launches;
    },
    get browserClosed() {
      return browserClosed;
    },
  };
}

const SVC: ServiceInfo = { port: 5173, workerId: 'w1', host: '127.0.0.1', pid: 1, command: 'vite', since: 0, title: 'Bäckerei Huber' };

function tvWith(fake: ReturnType<typeof fakeBrowser>, people = 1) {
  const states: (TvBrowserState | null)[] = [];
  const frames: TvFrame[] = [];
  const toasts: Notice[] = [];
  const room = { people, watching: false };
  const deps: TvDeps = {
    people: () => room.people,
    watching: () => room.watching,
    service: (port) => (port === SVC.port ? SVC : undefined),
    state: (s) => states.push(s),
    frame: (f) => frames.push(f),
    toast: (t) => toasts.push(t),
  };
  return { tv: new TvBrowser(fake.browsers, deps), states, frames, toasts, room };
}

const settle = () => new Promise((r) => setImmediate(r));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('only a worker service on this floor goes on the TV', () => {
  const fake = fakeBrowser();
  const { tv, states, toasts } = tvWith(fake);
  assert.equal(tv.open(0, 'Ada')?.key, 'tv.notService');
  assert.equal(tv.open(70000, 'Ada')?.key, 'tv.notService');
  assert.equal(tv.open(5.5, 'Ada')?.key, 'tv.notService');
  assert.equal(tv.open(8080, 'Ada')?.key, 'tv.notService');
  assert.equal(states.length, 0);
  assert.equal(fake.launches, 0);

  assert.equal(tv.open(5173, 'Ada'), undefined);
  assert.deepEqual(states[0], { port: 5173, url: 'http://localhost:5173/', title: 'Bäckerei Huber', by: 'Ada', width: 1280, height: 720, loading: true });
  assert.equal(toasts[0].key, 'tv.showing');
  assert.equal(toasts[0].text, '📺 Ada is showing Bäckerei Huber on the TV');
  tv.close();
});

test('the TV says when the page loaded, its title, and when it went off', async () => {
  const fake = fakeBrowser();
  const { tv, states } = tvWith(fake);
  tv.open(5173, 'Ada');
  await until(() => fake.calls.includes('goto http://localhost:5173/'));
  await until(() => states.at(-1)?.title === 'Fake site');
  assert.equal(states.at(-1)?.loading, false);
  assert.ok(fake.calls.includes('cdp Page.startScreencast'), 'casting with someone on the floor');

  fake.page.url = 'http://localhost:5173/about';
  fake.page.titleText = 'Über uns';
  await fake.page.goto('http://localhost:5173/about');
  await until(() => states.at(-1)?.title === 'Über uns');
  assert.equal(states.at(-1)?.url, 'http://localhost:5173/about');

  tv.close();
  assert.equal(states.at(-1), null);
  assert.equal(tv.state(), null);
  await settle();
  assert.ok(fake.closed);
  assert.equal(fake.browserClosed, 1, 'the last TV off closes the browser');
});

test('the TV only goes to its own site', async () => {
  assert.ok(sameSite('http://localhost:5173/a?b', 5173));
  assert.ok(sameSite('http://127.0.0.1:5173/', 5173));
  assert.ok(!sameSite('http://localhost:5174/', 5173));
  assert.ok(!sameSite('https://localhost:5173/', 5173));
  assert.ok(!sameSite('https://example.com/', 5173));
  assert.ok(!sameSite('file:///etc/passwd', 5173));
  assert.ok(!sameSite('http://169.254.169.254/', 5173));

  const fake = fakeBrowser();
  const { tv } = tvWith(fake);
  tv.open(5173, 'Ada');
  await until(() => fake.calls.includes('goto http://localhost:5173/'));
  const subFrame = { page: () => fake.page };
  const popupFrame = { page: () => ({}) };
  const request = (url: string, nav: boolean, frame: unknown) => ({ url: () => url, isNavigationRequest: () => nav, frame: () => frame });
  const outcome = async (url: string, nav: boolean, frame: unknown) => {
    let result = '';
    await fake.route({ abort: async () => void (result = 'abort'), continue: async () => void (result = 'continue') }, request(url, nav, frame));
    return result;
  };
  assert.equal(await outcome('http://localhost:5173/kontakt', true, fake.mainFrame), 'continue');
  assert.equal(await outcome('https://evil.example/', true, fake.mainFrame), 'abort');
  assert.equal(await outcome('http://localhost:22/', true, fake.mainFrame), 'abort');
  // Fonts and pictures from elsewhere still load, and embeds in frames are fine.
  assert.equal(await outcome('https://fonts.googleapis.com/css2?family=Inter', false, fake.mainFrame), 'continue');
  assert.equal(await outcome('https://www.youtube.com/embed/x', true, subFrame), 'continue');
  // A popup is stopped, and the site's own address opens in the TV's page instead.
  assert.equal(await outcome('http://localhost:5173/impressum', true, popupFrame), 'abort');
  await until(() => fake.calls.includes('goto http://localhost:5173/impressum'));
  assert.equal(await outcome('https://elsewhere.example/', true, popupFrame), 'abort');
  await settle();
  assert.ok(!fake.calls.includes('goto https://elsewhere.example/'));
  tv.close();
});

test('mouse and keyboard land where they were aimed, in order', async () => {
  const fake = fakeBrowser();
  const { tv } = tvWith(fake);
  tv.open(5173, 'Ada');
  await until(() => fake.calls.includes('goto http://localhost:5173/'));
  fake.calls.length = 0;
  tv.input('a', { kind: 'click', x: 0.5, y: 0.25 });
  tv.input('a', { kind: 'down', x: 0, y: 1, button: 2 });
  tv.input('a', { kind: 'up', x: 2, y: -1, button: 2 });
  tv.input('a', { kind: 'wheel', x: 0.5, y: 0.5, dy: 120 });
  tv.input('a', { kind: 'wheel', dy: 1e9 });
  tv.input('a', { kind: 'key', key: 'a', mods: 2 | 8 });
  tv.input('a', { kind: 'key', key: '+' });
  // The viewer's keyup echo, and a modifier on its own: nothing.
  tv.input('a', { kind: 'key', key: '+', dx: 0 });
  tv.input('a', { kind: 'key', key: 'Shift', mods: 8 });
  tv.input('a', { kind: 'text', text: 'Grüß Gott' });
  tv.input('a', { kind: 'key' });
  await until(() => fake.calls.includes('text Grüß Gott'));
  assert.deepEqual(fake.calls, [
    'click 640,180 left',
    'move 0,720',
    'down right',
    'move 1280,0',
    'up right',
    'move 640,360',
    'wheel 0,120',
    'wheel 0,2000',
    'keydown Control',
    'keydown Shift',
    'keydown a',
    'keyup a',
    'keyup Shift',
    'keyup Control',
    'keydown +',
    'keyup +',
    'text Grüß Gott',
  ]);

  // Mobile: the same spot on a narrower page.
  tv.setView('mobile');
  assert.equal(tv.state()?.width, 390);
  await until(() => fake.calls.includes('viewport 390x844'));
  fake.calls.length = 0;
  tv.input('b', { kind: 'click', x: 0.5, y: 0.5 });
  await until(() => fake.calls.some((c) => c.startsWith('click')));
  assert.deepEqual(
    fake.calls.filter((c) => !c.startsWith('cdp')),
    ['click 195,422 left'],
  );
  tv.close();
});

test('input is rate limited per person', async () => {
  const fake = fakeBrowser();
  const { tv } = tvWith(fake);
  tv.open(5173, 'Ada');
  await until(() => fake.calls.includes('goto http://localhost:5173/'));
  fake.calls.length = 0;
  const now = Date.now();
  for (let i = 0; i < 100; i++) tv.input('a', { kind: 'click', x: 0, y: 0 }, now);
  for (let i = 0; i < 10; i++) tv.input('a', { kind: 'move', x: 0, y: 0 }, now + i);
  tv.input('b', { kind: 'click', x: 1, y: 1 }, now);
  await settle();
  await until(() => fake.calls.length >= 42);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fake.calls.filter((c) => c === 'click 0,0 left').length, 40, 'a burst of 40, then the rest dropped');
  assert.equal(fake.calls.filter((c) => c.startsWith('move')).length, 1, 'one move per 1/60 s');
  assert.equal(fake.calls.filter((c) => c === 'click 1280,720 left').length, 1, 'someone else still gets through');
  tv.close();
});

test('frames go out paced, stop with nobody on the floor, and the TV goes off a while later', async () => {
  const fake = fakeBrowser();
  const { tv, frames, states, room } = tvWith(fake);
  tv.open(5173, 'Ada');
  await until(() => fake.calls.includes('cdp Page.startScreencast'));
  fake.frame('AAAA');
  fake.frame('BBBB');
  assert.equal(frames.length, 1, 'the second waits its turn');
  assert.deepEqual(frames[0], { data: 'AAAA', w: 1280, h: 720 });
  await until(() => frames.length === 2);
  assert.equal(frames[1].data, 'BBBB', 'then the newest goes out');
  assert.equal(tv.frame()?.data, 'BBBB', 'kept for whoever walks in');

  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    room.people = 0;
    tv.peopleChanged();
    await settle();
    assert.ok(fake.calls.includes('cdp Page.stopScreencast'));
    mock.timers.tick(TV_IDLE_MS - 2000);
    // Someone moved elsewhere in the building: the clock keeps running.
    tv.peopleChanged();
    mock.timers.tick(1000);
    assert.notEqual(tv.state(), null);
    // Someone came and went: the clock starts again.
    room.people = 1;
    tv.peopleChanged();
    room.people = 0;
    tv.peopleChanged();
    mock.timers.tick(TV_IDLE_MS - 1000);
    assert.notEqual(tv.state(), null);
    mock.timers.tick(1000);
    assert.equal(tv.state(), null);
    assert.equal(states.at(-1), null);
  } finally {
    mock.timers.reset();
  }
  await settle();
  assert.ok(fake.closed);
  assert.equal(fake.browserClosed, 1);
});

test('no Chromium: the TV says how to get one', async () => {
  const browsers = new TvBrowsers(async () => {
    throw new Error(NO_CHROMIUM);
  });
  const states: (TvBrowserState | null)[] = [];
  const tv = new TvBrowser(browsers, {
    people: () => 1,
    watching: () => false,
    service: () => SVC,
    state: (s) => states.push(s),
    frame: () => {},
    toast: () => {},
  });
  tv.open(5173, 'Ada');
  await until(() => !!states.at(-1)?.error);
  assert.match(states.at(-1)!.error!, /npx playwright-core install chromium/);
  assert.equal(states.at(-1)!.loading, false);
  assert.equal(browsers.running, false, 'the next open tries again');
});

/** A Playwright whose launch fails for the paths in `broken` (and for its own shell unless `shell`). */
function fakePlaywright(broken: string[], shell = false) {
  const launched: (string | undefined)[] = [];
  const pw = {
    chromium: {
      executablePath: () => '/pw/chrome',
      launch: async (o?: { executablePath?: string }) => {
        const p = o?.executablePath;
        launched.push(p);
        if (!p && !shell) throw new Error("browserType.launch: Executable doesn't exist at /pw/headless_shell");
        if (p && broken.includes(p)) throw new Error(`browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n\n<launched> pid=7\n[pid=7][err] ${p}: error while loading shared libraries: libatk-1.0.so.0\nCall log:`);
        return { path: p ?? 'shell' } as unknown as Browser;
      },
    },
  } as unknown as Pick<typeof import('playwright-core'), 'chromium'>;
  return { pw, launched };
}

const HOME_CHROMIUM = '/office/chromium/chromium';
const SHARE_CHROMIUM = '/home/me/.local/share/agent-office/chromium/chromium';

test('launchChromium looks in order: env, the office home, ~/.local/share, Playwright, the system', async () => {
  const everything = new Set(['/own/chrome', HOME_CHROMIUM, SHARE_CHROMIUM, '/pw/chrome', '/usr/bin/chromium']);
  const env = { AGENT_OFFICE_CHROMIUM: '/own/chrome', AGENT_OFFICE_HOME: '/office' };
  const order: (string | undefined)[] = [];
  // Each step down, the one before it is taken away.
  for (const gone of ['/own/chrome', HOME_CHROMIUM, SHARE_CHROMIUM, 'shell', '/pw/chrome', '/usr/bin/chromium']) {
    const { pw } = fakePlaywright([], !order.includes('shell'));
    const there = (p: string) => everything.has(p) && !order.includes(p);
    const b = (await launchChromium(env, { playwright: async () => pw, exists: there, homedir: '/home/me', platform: 'linux', log: () => {} }).catch(
      () => undefined,
    )) as unknown as { path: string } | undefined;
    order.push(b?.path);
    assert.equal(b?.path, gone);
  }
  const { pw } = fakePlaywright([]);
  await assert.rejects(launchChromium({}, { playwright: async () => pw, exists: () => false, homedir: '/home/me', platform: 'linux', log: () => {} }), (err: Error) => {
    assert.equal(err.message, NO_CHROMIUM);
    assert.match(err.message, /~\/\.local\/share\/agent-office\/chromium/);
    return true;
  });
});

test("launchChromium tries the next one when a Chromium won't start, and says what it tried", async () => {
  const { pw, launched } = fakePlaywright([HOME_CHROMIUM, SHARE_CHROMIUM]);
  const logs: string[] = [];
  const there = new Set([HOME_CHROMIUM, SHARE_CHROMIUM, '/usr/bin/google-chrome']);
  const deps = { playwright: async () => pw, exists: (p: string) => there.has(p), homedir: '/home/me', platform: 'linux' as const, log: (l: string) => logs.push(l) };
  const b = (await launchChromium({ AGENT_OFFICE_HOME: '/office' }, deps)) as unknown as { path: string };
  assert.equal(b.path, '/usr/bin/google-chrome');
  assert.deepEqual(launched, [HOME_CHROMIUM, SHARE_CHROMIUM, undefined, '/usr/bin/google-chrome']);
  assert.equal(logs.length, 2);
  assert.equal(logs[0], `the TV's Chromium ${HOME_CHROMIUM} didn't start: ${HOME_CHROMIUM}: error while loading shared libraries: libatk-1.0.so.0`);

  // Nothing starts: the error lists each one and why.
  there.delete('/usr/bin/google-chrome');
  await assert.rejects(launchChromium({ AGENT_OFFICE_HOME: '/office', AGENT_OFFICE_CHROMIUM: '/nope' }, deps), (err: Error) => {
    assert.ok(err.message.startsWith(`${NO_CHROMIUM}. Tried: `));
    assert.match(err.message, /AGENT_OFFICE_CHROMIUM is set to \/nope, which doesn't exist/);
    assert.ok(err.message.includes(`${HOME_CHROMIUM}: ${HOME_CHROMIUM}: error while loading shared libraries: libatk-1.0.so.0`));
    assert.ok(err.message.includes(`${SHARE_CHROMIUM}: ${SHARE_CHROMIUM}: error while loading shared libraries`));
    assert.doesNotMatch(err.message, /headless_shell/, "a missing Playwright shell isn't a failure");
    return true;
  });
});

test('a JPEG says its size', () => {
  // SOI, an APP0 segment, then SOF0 with height 240 and width 320.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xf0, 0x01, 0x40, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(jpegSize(jpeg.toString('base64')), { w: 320, h: 240 });
  assert.equal(jpegSize('notajpeg'), undefined);
});

// The real thing, when this machine has a Chromium: a site on a port, on the TV, changing.
test('a real Chromium streams a site and its changes', { timeout: 60_000 }, async (t) => {
  let browser: Browser;
  try {
    browser = await launchChromium();
  } catch (err) {
    return t.skip(`no Chromium here: ${(err as Error).message.slice(0, 80)}`);
  }
  await browser.close();
  let version = 1;
  const server = http.createServer((req, res) => {
    if (req.url === '/v') return res.end(String(version));
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Testseite</title><body style="margin:0;font:120px sans-serif">
      <div id=v>v1</div><script>setInterval(async () => { const v = await (await fetch('/v')).text();
      const el = document.getElementById('v'); el.textContent = 'v' + v; document.body.style.background = v === '1' ? '#fff' : '#c00'; }, 100)</script>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const browsers = new TvBrowsers();
  const states: (TvBrowserState | null)[] = [];
  const frames: TvFrame[] = [];
  const tv = new TvBrowser(browsers, {
    people: () => 1,
    watching: () => true,
    service: (p) => (p === port ? { ...SVC, port } : undefined),
    state: (s) => states.push(s),
    frame: (f) => frames.push(f),
    toast: () => {},
  });
  try {
    tv.open(port, 'Ada');
    await until(() => states.at(-1)?.title === 'Testseite' && frames.length > 0, 30_000);
    assert.equal(states.at(-1)?.error, undefined);
    assert.deepEqual({ w: frames.at(-1)!.w, h: frames.at(-1)!.h }, { w: 1280, h: 720 });
    const before = frames.at(-1)!.data;
    version = 2;
    await until(() => frames.at(-1)!.data !== before, 15_000);
  } finally {
    tv.close();
    browsers.shutdown();
    server.close();
  }
});
