import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { CASINO, CASINO_SEATING } from '../src/shared/casino.js';
import { DRINKS, ROOF, drinkAt } from '../src/shared/rooftop.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOF_AT = { roof: true, casino: false };
const CASINO_AT = { roof: false, casino: true };
const FLOOR_AT = { roof: false, casino: false };

test('every drink on the roof is poured at the casino bar too, and the casino has its own', () => {
  for (const d of DRINKS) assert.equal(drinkAt(d.id, CASINO_AT), d.id, d.id);
  const own = DRINKS.filter((d) => d.casino).map((d) => d.id);
  assert.deepEqual(own, ['croupier', 'highroller']);
  // The roof's list is as it was, the casino's after it.
  assert.deepEqual(DRINKS.filter((d) => !d.casino).map((d) => d.id), ['beer', 'wine', 'martini', 'maitai', 'shot', 'mojito', 'water']);
  for (const d of DRINKS) assert.equal(drinkAt(d.id, ROOF_AT), d.casino ? undefined : d.id, d.id);
  assert.equal(DRINKS.find((d) => d.id === 'croupier')!.strength > 0, true);
});

test('there is no bar on a project floor, and nothing but a drink is poured', () => {
  for (const d of DRINKS) assert.equal(drinkAt(d.id, FLOOR_AT), undefined);
  for (const v of [null, undefined, '', 'coffee', 'BEER', 7, { id: 'beer' }]) {
    assert.equal(drinkAt(v, CASINO_AT), undefined);
    assert.equal(drinkAt(v, ROOF_AT), undefined);
  }
});

test("the casino bar's stools order a drink, like the roof's", () => {
  const stools = CASINO_SEATING.filter((s) => s.kind === 'barStool');
  assert.equal(stools.length, 5);
  for (const s of stools) assert.equal(s.bar, true, s.id);
});

// ---- The real server: a drink stays at the bar it came from -----------------------------------------------------------

const bundled = existsSync(path.join(ROOT, 'dist/public/index.html')) || existsSync(path.join(ROOT, 'public/index.html'));

interface Bot {
  ws: WebSocket;
  id: string;
  /** Every message so far. */
  seen: any[];
  send(msg: object): void;
  /** The next message (from now on, or already seen after `from`) that `match` says yes to. */
  next(match: (m: any) => boolean, from?: number): Promise<any>;
}

async function bot(base: string, cookie: string, name: string): Promise<Bot> {
  const chips = Buffer.from(name.padEnd(16, '_')).toString('hex');
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?name=${name}&chips=${chips}`, { headers: { cookie, origin: base } });
  const seen: any[] = [];
  const waiters: { match: (m: any) => boolean; done: (m: any) => void }[] = [];
  ws.on('message', (data) => {
    const m = JSON.parse(String(data));
    seen.push(m);
    for (const w of [...waiters]) if (w.match(m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.done(m);
    }
  });
  const b: Bot = {
    ws,
    id: '',
    seen,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: (match, from) =>
      new Promise((done, fail) => {
        const old = from === undefined ? undefined : seen.slice(from).find(match);
        if (old) return done(old);
        const timer = setTimeout(() => fail(new Error(`${name}: timed out`)), 8000);
        waiters.push({ match, done: (m) => (clearTimeout(timer), done(m)) });
      }),
  };
  b.id = (await b.next((m) => m.t === 'welcome', 0)).you;
  return b;
}

/** A port nobody's listening on. */
function freePort(): Promise<number> {
  return new Promise((done) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => done(port));
    });
  });
}

/** Rides the elevator to `floor`, and waits till they're there. */
async function go(b: Bot, floor: string) {
  const from = b.seen.length;
  b.send({ t: 'floor.go', floor });
  await b.next((m) => m.t === 'floor.enter' && m.floor === floor, from);
}

test('the server lets you hold a drink in the casino, and you put it down when you leave', { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'casino-bar-'));
  const floorDir = path.join(scratch, 'floor');
  mkdirSync(floorDir);
  writeFileSync(path.join(floorDir, 'README.md'), 'hi\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: floorDir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'init');
  const env = { home: process.env.AGENT_OFFICE_HOME, open: process.env.AGENT_OFFICE_NO_OPEN };
  process.env.AGENT_OFFICE_HOME = path.join(scratch, 'home');
  process.env.AGENT_OFFICE_NO_OPEN = '1';
  const { loadConfig } = await import('../src/server/config.js');
  const { startServer } = await import('../src/server/server.js');
  const office = await startServer(loadConfig([floorDir, '--port', String(await freePort()), '--password', 'dev', '--no-open']));
  const bots: Bot[] = [];
  try {
    const base = `http://127.0.0.1:${(office.server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: 'dev' }) });
    assert.equal(login.ok, true, `login: ${login.status}`);
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const ada = await bot(base, cookie, 'Ada');
    const bob = await bot(base, cookie, 'Bob');
    bots.push(ada, bob);
    const projectFloor = office.floors()[0].id;
    await go(bob, CASINO);
    await go(ada, CASINO);
    const adaId = ada.id;

    // A croupier's special at the casino bar: Bob sees it in Ada's hand.
    let from = bob.seen.length;
    ada.send({ t: 'act', drink: 'croupier' });
    assert.equal((await bob.next((m) => m.t === 'peer.act' && m.id === adaId, from)).drink, 'croupier');
    from = bob.seen.length;
    ada.send({ t: 'act', drink: 'beer' });
    assert.equal((await bob.next((m) => m.t === 'peer.act' && m.id === adaId, from)).drink, 'beer');

    // Up to her floor: the glass stays down here, and she can't pick one up on a project floor.
    await go(bob, projectFloor);
    from = bob.seen.length;
    await go(ada, projectFloor);
    const there = await bob.next((m) => m.t === 'peer.update' && m.peer?.id === adaId && m.peer.floor === projectFloor, from);
    assert.equal(there.peer.drink, undefined);
    from = bob.seen.length;
    ada.send({ t: 'act', drink: 'martini' });
    ada.send({ t: 'act', golf: true });
    // The golf club comes through; the martini never did (it'd have come first).
    const next = await bob.next((m) => m.t === 'peer.act' && m.id === adaId, from);
    assert.equal(next.drink, undefined);
    assert.equal(next.golf, true);
    ada.send({ t: 'act', golf: false });

    // On the roof, the usual drinks but not the casino's own.
    await go(bob, ROOF);
    await go(ada, ROOF);
    from = bob.seen.length;
    ada.send({ t: 'act', drink: 'highroller' });
    ada.send({ t: 'act', drink: 'mojito' });
    assert.equal((await bob.next((m) => m.t === 'peer.act' && m.id === adaId, from)).drink, 'mojito');
  } finally {
    for (const b of bots) b.ws.close();
    await office.shutdown();
    if (env.home === undefined) delete process.env.AGENT_OFFICE_HOME;
    else process.env.AGENT_OFFICE_HOME = env.home;
    if (env.open === undefined) delete process.env.AGENT_OFFICE_NO_OPEN;
    else process.env.AGENT_OFFICE_NO_OPEN = env.open;
    rmSync(scratch, { recursive: true, force: true });
  }
});
