import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { CASINO, CASINO_ELEVATOR, CASINO_SHOP, CHIP_PLATFORM, CRASH_SCREEN, MARKET_SCREEN, PLINKO_MACHINE, TRADING_DESK, casinoFootprints, casinoWalkable, onChipPlatform } from '../src/shared/casino.js';
import { LEDGER_SIZE, PLATFORM_PAY, START_CHIPS, type ChipsEntry } from '../src/shared/chips.js';
import { LEDGER_GAMES } from '../src/shared/housebank.js';
import { Chips } from '../src/server/chips.js';
import { ChipPlatform, PLATFORM_TICK, type PlatformPerson } from '../src/server/platform.js';

const P = CHIP_PLATFORM;
const EVERY = PLATFORM_PAY.every;

// ---- Where it is ------------------------------------------------------------------------------------

test('the chip platform lies clear of everything, with room to walk all round it', () => {
  // Nothing stands on it or within a step of its rim: the tables, Crash, Plinko, the trading desk, the counters, the lounge.
  for (const f of casinoFootprints()) {
    const dx = Math.max(f.minX - P.x, 0, P.x - f.maxX);
    const dz = Math.max(f.minZ - P.z, 0, P.z - f.maxZ);
    assert.ok(Math.hypot(dx, dz) > P.r + 0.7, `${JSON.stringify(f)} is too near the platform`);
  }
  // You can stand anywhere on it, and all round it.
  for (let a = 0; a < 360; a += 15) {
    const c = Math.cos((a * Math.PI) / 180);
    const s = Math.sin((a * Math.PI) / 180);
    for (const r of [0, P.r * 0.5, P.r - 0.05, P.r + 0.6]) assert.ok(casinoWalkable(P.x + c * r, P.z + s * r), `walkable ${r} out at ${a}°`);
  }
  // Off the elevator's landing, away from the shop's door, the Crash screen's wall and the trading desk's front.
  assert.ok(P.z - P.r > CASINO_ELEVATOR.front + 3, 'clear of the landing in front of the elevator');
  assert.ok(Math.hypot(P.x - CASINO_SHOP.door.x, P.z - 13) > 8, 'nowhere near the shop door');
  assert.ok(P.x - P.r > CRASH_SCREEN.x + 10, 'far from the Crash screen');
  assert.ok(Math.hypot(P.x - (TRADING_DESK.x - TRADING_DESK.depth / 2 - 0.9), P.z - TRADING_DESK.z) > TRADING_DESK.reach + P.r + 1, "outside the trading desk's reach");
  assert.ok(P.x - P.r > PLINKO_MACHINE.x + PLINKO_MACHINE.width / 2 + 2, 'east of Plinko');
  assert.ok(P.x + P.r < MARKET_SCREEN.x - 4, 'well out from the east wall');
});

test('onChipPlatform: within its radius only', () => {
  assert.ok(onChipPlatform(P.x, P.z));
  assert.ok(onChipPlatform(P.x + P.r - 0.01, P.z));
  assert.ok(!onChipPlatform(P.x + P.r + 0.01, P.z));
  assert.ok(!onChipPlatform(P.x, P.z - P.r - 0.2));
  assert.ok(!onChipPlatform(NaN, P.z));
});

test('PLATFORM_PAY: 5,000 chips every 3 s, and payouts are no casino game', () => {
  assert.equal(PLATFORM_PAY.chips, 5000);
  assert.equal(PLATFORM_PAY.every, 3000);
  assert.equal(LEDGER_GAMES.platform, undefined, "the house bank's backfill doesn't count it");
});

// ---- The clock ---------------------------------------------------------------------------------------

const on = (chips: string, extra: Partial<PlatformPerson> = {}): PlatformPerson => ({ chips, floor: CASINO, x: P.x + 0.3, z: P.z - 0.2, activeAt: 0, ...extra });
const off = (chips: string, extra: Partial<PlatformPerson> = {}): PlatformPerson => on(chips, { x: P.x + P.r + 1, ...extra });

/** Runs the platform's clock from `from` to `to` (ms) at its usual tick, with `who(now)` there each time, and says who was paid when. */
function run(p: ChipPlatform, from: number, to: number, who: (now: number) => PlatformPerson[]): [number, string][] {
  const out: [number, string][] = [];
  for (let now = from; now <= to; now += PLATFORM_TICK) for (const id of p.tick(now, who(now)).paid) out.push([now, id]);
  return out;
}

test('pays only on the platform, every 3 s, the first 3 s after stepping on', () => {
  const p = new ChipPlatform();
  const paid = run(p, 0, 10_000, (now) => [on('A', { activeAt: now }), off('B', { activeAt: now })]);
  assert.deepEqual(paid, [
    [EVERY, 'A'],
    [2 * EVERY, 'A'],
    [3 * EVERY, 'A'],
  ]);
  assert.equal(p.count, 1);
});

test('stepping off stops it, and stepping back on starts the 3 s again', () => {
  const p = new ChipPlatform();
  // On for 4 s (one payout), off for 1 s, back on.
  const paid = run(p, 0, 9000, (now) => [now < 4000 || now >= 5000 ? on('A') : off('A')]);
  assert.deepEqual(paid, [
    [EVERY, 'A'],
    [5000 + EVERY, 'A'],
  ]);
  // Off: nobody's on it.
  assert.equal(p.tick(9250, [off('A')]).changed, true);
  assert.equal(p.count, 0);
});

test('disconnecting, riding the elevator, sitting down or going idle stops it', () => {
  const ways: [string, (now: number) => PlatformPerson[]][] = [
    ['disconnect', (now) => (now < 4000 ? [on('A')] : [])],
    ['another floor', (now) => [on('A', now < 4000 ? {} : { floor: 'agent-office' })]],
    ['the roof', (now) => [on('A', now < 4000 ? {} : { floor: '@roof' })]],
    ['sitting', (now) => [on('A', now < 4000 ? {} : { seat: 'casino-sofa-1:0' })]],
    ['idle', () => [on('A', { activeAt: 4000 - PLATFORM_PAY.idle })]],
  ];
  for (const [why, who] of ways) {
    const p = new ChipPlatform();
    assert.deepEqual(run(p, 0, 12_000, who), [[EVERY, 'A']], why);
    assert.equal(p.count, 0, why);
  }
});

test('an office floor at the same spot is not the platform', () => {
  const p = new ChipPlatform();
  assert.deepEqual(run(p, 0, 10_000, () => [on('A', { floor: 'agent-office' }), on('B', { floor: undefined })]), []);
});

test('several people on it are each paid, on their own beat; one person with two pages once', () => {
  const p = new ChipPlatform();
  const paid = run(p, 0, 7000, (now) => [on('A'), on('A', { x: P.x - 0.5 }), ...(now >= 1000 ? [on('B')] : []), ...(now >= 2000 ? [on('C', { z: P.z + 0.8 })] : [])]);
  assert.deepEqual(paid, [
    [3000, 'A'],
    [4000, 'B'],
    [5000, 'C'],
    [6000, 'A'],
    [7000, 'B'],
  ]);
  assert.equal(p.count, 3);
});

test('the count changes as people step on and off (for the glow)', () => {
  const p = new ChipPlatform();
  assert.deepEqual(p.tick(0, [on('A')]), { paid: [], changed: true });
  assert.equal(p.tick(250, [on('A')]).changed, false);
  assert.equal(p.tick(500, [on('A'), on('B')]).changed, true);
  assert.equal(p.count, 2);
  assert.equal(p.tick(750, [on('B')]).changed, true);
  assert.equal(p.tick(1000, []).changed, true);
  assert.equal(p.count, 0);
});

test('a late tick pays once, not a burst', () => {
  const p = new ChipPlatform();
  p.tick(0, [on('A')]);
  assert.deepEqual(p.tick(10_000, [on('A')]).paid, ['A']);
  assert.deepEqual(p.tick(10_250, [on('A')]).paid, []);
  assert.deepEqual(p.tick(13_000, [on('A')]).paid, ['A']);
});

// ---- The ledger ------------------------------------------------------------------------------------

test('payouts go into one running ledger entry, each change still reported as 5,000, quietly', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-office-platform-'));
  const clock = { now: new Date(2026, 9, 7, 12, 0).getTime() };
  const changes: { entry: ChipsEntry; quiet: boolean; balance: number }[] = [];
  const chips = new Chips(dir, { now: () => clock.now, saveAfter: 0, onChange: (_id, state, entry, quiet) => changes.push({ entry: entry!, quiet, balance: state.balance }) });
  const A = 'account:ada';
  chips.award(A, 50, 'roulette.win');
  for (let i = 0; i < 40; i++) {
    clock.now += EVERY;
    assert.equal(chips.platform(A), true);
  }
  assert.equal(chips.balance(A), START_CHIPS + 50 + 40 * 5000);
  const ledger = chips.ledger(A);
  assert.equal(ledger.length, 2, 'not 41 entries');
  assert.deepEqual(ledger[0], { at: clock.now, amount: 40 * 5000, reason: 'platform', balance: START_CHIPS + 50 + 40 * 5000, times: 40 });
  assert.equal(ledger[1].reason, 'roulette.win');
  assert.equal(changes.length, 41);
  for (const c of changes.slice(1)) {
    assert.equal(c.entry.amount, 5000);
    assert.equal(c.entry.reason, 'platform');
    assert.equal(c.quiet, true);
  }
  // Something else in between starts a new one; so does a long while off it.
  chips.bet(A, 10, 'slots.spin');
  clock.now += EVERY;
  chips.platform(A);
  clock.now += 10 * 60_000;
  chips.platform(A);
  assert.deepEqual(
    chips.ledger(A).slice(0, 4).map((e) => [e.reason, e.amount, e.times]),
    [
      ['platform', 5000, undefined],
      ['platform', 5000, undefined],
      ['slots.spin', -10, undefined],
      ['platform', 200_000, 40],
    ],
  );
  assert.ok(chips.ledger(A).length <= LEDGER_SIZE);
  // It's written down, running entry and all.
  chips.flush();
  const again = new Chips(dir, { now: () => clock.now, saveAfter: 0 });
  assert.equal(again.ledger(A)[3].times, 40);
  assert.equal(again.balance(A), chips.balance(A));
  rmSync(dir, { recursive: true });
});

// ---- In the running office ------------------------------------------------------------------------

const bundled = ['public', 'dist/public'].some((d) => existsSync(path.join(import.meta.dirname, '..', d, 'index.html')));

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  await new Promise((r) => srv.close(r));
  return port;
}

interface Person {
  msgs: any[];
  send(msg: object): void;
  next(t: string, ok?: (m: any) => boolean, ms?: number): Promise<any>;
  close(): void;
}

test(
  'the chip platform in the running office: pays whoever the office sees on it, stops when they step off or leave',
  { skip: !bundled && 'needs the client bundle (npm run build)' },
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'platform-office-'));
    process.env.AGENT_OFFICE_HOME = path.join(root, 'home');
    const project = path.join(root, 'project');
    mkdirSync(project);
    execFileSync('git', ['init', '-q'], { cwd: project });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: project });
    const { loadConfig } = await import('../src/server/config.js');
    const { startServer } = await import('../src/server/server.js');
    const port = await freePort();
    const office = await startServer(loadConfig([project, '--port', String(port), '--password', 'dev', '--no-open']));
    const origin = `http://127.0.0.1:${port}`;
    const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password: 'dev' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const people: Person[] = [];
    const join = async (name: string, floor?: string): Promise<Person> => {
      const chips = Buffer.from(name.padEnd(16, '_')).toString('hex');
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&chips=${chips}${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`, { headers: { cookie, origin } });
      const msgs: any[] = [];
      const waiting: (() => void)[] = [];
      ws.on('message', (d) => {
        msgs.push(JSON.parse(String(d)));
        for (const w of waiting.splice(0)) w();
      });
      let seen = 0;
      const p: Person = {
        msgs,
        send: (msg) => ws.send(JSON.stringify(msg)),
        next: (t, ok = () => true, ms = 5000) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${name} never got ${t}`)), ms);
            const look = () => {
              for (; seen < msgs.length; seen++) {
                if (msgs[seen].t === t && ok(msgs[seen])) {
                  clearTimeout(timer);
                  return resolve(msgs[seen++]);
                }
              }
              waiting.push(look);
            };
            look();
          }),
        close: () => ws.close(),
      };
      people.push(p);
      return p;
    };
    const moveTo = (p: Person, x: number, z: number) => p.send({ t: 'move', x, y: 0, z, rotY: 0, moving: true });
    const platformPay = (p: Person) => p.msgs.filter((m) => m.t === 'chips' && m.change?.reason === 'platform');
    try {
      const ann = await join('Ann');
      const bob = await join('Bob', CASINO);
      const cid = await join('Cid', CASINO);
      await ann.next('welcome');
      assert.equal((await bob.next('welcome')).platform, 0);
      await cid.next('welcome');

      // Ann stands at the same spot upstairs, Cid next to the platform, Bob on it.
      moveTo(ann, P.x, P.z);
      moveTo(cid, P.x + P.r + 0.8, P.z);
      moveTo(bob, P.x + 0.2, P.z + 0.3);
      assert.equal((await cid.next('platform')).on, 1, 'it lights up for everyone down there');
      const first = await bob.next('chips', (m) => m.change?.reason === 'platform', EVERY + 2000);
      assert.equal(first.change.amount, 5000);
      assert.equal(first.quiet, true);
      assert.equal(first.chips.ledger[0].reason, 'platform');
      const second = await bob.next('chips', (m) => m.change?.reason === 'platform', EVERY + 2000);
      assert.ok(second.change.at - first.change.at >= EVERY - PLATFORM_TICK && second.change.at - first.change.at <= EVERY + PLATFORM_TICK * 2, 'every 3 s');
      assert.equal(second.chips.balance, first.chips.balance + 5000);
      assert.equal(second.chips.ledger[0].times, 2, 'one running entry');
      assert.deepEqual(platformPay(ann), []);
      assert.deepEqual(platformPay(cid), []);
      assert.ok(!ann.msgs.some((m) => m.t === 'platform'), 'upstairs hears nothing of it');

      // Cid steps on too: both are paid.
      moveTo(cid, P.x - 0.4, P.z);
      assert.equal((await bob.next('platform')).on, 2);
      await cid.next('chips', (m) => m.change?.reason === 'platform', EVERY + 2000);

      // Bob steps off: his payouts stop.
      moveTo(bob, P.x + P.r + 1.5, P.z);
      assert.equal((await cid.next('platform')).on, 1);
      const bobPaid = platformPay(bob).length;
      // Cid leaves the office: nobody's on it any more.
      cid.close();
      await bob.next('platform', (m) => m.on === 0);
      await new Promise((r) => setTimeout(r, EVERY + 500));
      assert.equal(platformPay(bob).length, bobPaid, 'nothing more for Bob off it');
    } finally {
      for (const p of people) p.close();
      office.shutdown();
    }
  },
);
