import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips, activeMsg, basketOf, chipsId } from '../src/server/chips.js';
import { CHIPS_TOP, EARN, LEDGER_SIZE, ONLINE_EVERY, START_CHIPS, chipsAmountOk, chipsDay, chipsKeyOk, type ChipsEntry } from '../src/shared/chips.js';
import { HOOP, THREE_POINT, idealSpeed } from '../src/shared/hoop.js';

const MIN = 60_000;
const A = 'account:ada';
const B = 'browser:0123456789abcdef0123';

/** A bank in a fresh folder, on a clock the test moves (`clock.now`), and every change it reported. */
function bank(dir = mkdtempSync(path.join(tmpdir(), 'agent-office-chips-'))) {
  const clock = { now: new Date(2026, 9, 2, 10, 0).getTime() };
  const changes: { id: string; entry: ChipsEntry; quiet: boolean; balance: number }[] = [];
  const chips = new Chips(dir, { now: () => clock.now, saveAfter: 0, onChange: (id, state, entry, quiet) => changes.push({ id, entry, quiet, balance: state.balance }) });
  return { chips, clock, changes, dir };
}

test('someone new starts with START_CHIPS and an empty ledger', () => {
  const { chips, dir } = bank();
  assert.equal(chips.balance(A), START_CHIPS);
  assert.deepEqual(chips.state(A), { balance: START_CHIPS, ledger: [] });
  rmSync(dir, { recursive: true });
});

test('a bet takes the chips off, and is refused (changing nothing) when it is more than the balance', () => {
  const { chips, changes, dir } = bank();
  assert.equal(chips.bet(A, 400, 'roulette.bet'), true);
  assert.equal(chips.balance(A), START_CHIPS - 400);
  assert.equal(chips.bet(A, START_CHIPS, 'roulette.bet'), false);
  assert.equal(chips.balance(A), START_CHIPS - 400);
  // All of it is fine, though.
  assert.equal(chips.bet(A, START_CHIPS - 400, 'slots.spin', { quiet: true }), true);
  assert.equal(chips.balance(A), 0);
  assert.equal(chips.bet(A, 1, 'slots.spin'), false);
  assert.deepEqual(
    changes.map((c) => [c.id, c.entry.amount, c.entry.reason, c.quiet, c.balance]),
    [
      [A, -400, 'roulette.bet', false, 600],
      [A, -600, 'slots.spin', true, 0],
    ],
  );
  rmSync(dir, { recursive: true });
});

test('bets and payouts only take positive whole amounts, and a bad one changes nothing', () => {
  const { chips, changes, dir } = bank();
  for (const bad of [0, -5, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '10' as unknown as number]) {
    assert.equal(chips.bet(A, bad, 'x'), false, `bet ${bad}`);
    assert.equal(chips.award(A, bad, 'x'), false, `award ${bad}`);
  }
  assert.equal(chips.balance(A), START_CHIPS);
  assert.equal(changes.length, 0);
  // Nor for someone the office doesn't make.
  assert.equal(chips.award('nobody', 5, 'x'), false);
  assert.equal(chipsAmountOk(1), true);
  assert.equal(chipsAmountOk(0), false);
  rmSync(dir, { recursive: true });
});

test('a payout adds to the balance, and the ledger keeps the latest LEDGER_SIZE, newest first', () => {
  const { chips, clock, dir } = bank();
  assert.equal(chips.award(A, 250, 'blackjack.win'), true);
  assert.equal(chips.balance(A), START_CHIPS + 250);
  for (let i = 0; i < LEDGER_SIZE + 5; i++) {
    clock.now += 1000;
    chips.award(A, 1, `n${i}`);
  }
  const ledger = chips.ledger(A);
  assert.equal(ledger.length, LEDGER_SIZE);
  assert.equal(ledger[0].reason, `n${LEDGER_SIZE + 4}`);
  assert.equal(ledger[0].balance, chips.balance(A));
  assert.ok(ledger[0].at > ledger[1].at);
  rmSync(dir, { recursive: true });
});

test('balances, ledgers and what was earned today survive a restart, written whole', () => {
  const { chips, clock, dir } = bank();
  chips.award(A, 77, 'poker.pot');
  chips.bet(B, 100, 'roulette.bet');
  chips.earn(A, 'dartsWin');
  chips.once('pr:f1:12');
  chips.flush();
  const saved = JSON.parse(readFileSync(path.join(dir, 'chips.json'), 'utf8'));
  assert.equal(saved.wallets[A].balance, START_CHIPS + 77 + EARN.dartsWin.chips);

  const again = new Chips(dir, { now: () => clock.now, saveAfter: 0 });
  assert.equal(again.balance(A), START_CHIPS + 77 + EARN.dartsWin.chips);
  assert.equal(again.balance(B), START_CHIPS - 100);
  assert.deepEqual(again.ledger(A).map((e) => e.reason), ['dartsWin', 'poker.pot']);
  // The cooldown and the one-off are remembered too.
  assert.equal(again.earn(A, 'dartsWin'), 0);
  assert.equal(again.once('pr:f1:12'), false);
  rmSync(dir, { recursive: true });
});

test('changes are written a moment later, gathered into one write', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-chips-'));
  const chips = new Chips(dir, { saveAfter: 20 });
  chips.award(A, 5, 'a');
  chips.award(A, 5, 'b');
  assert.throws(() => readFileSync(path.join(dir, 'chips.json')));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'chips.json'), 'utf8')).wallets[A].balance, START_CHIPS + 10);
  rmSync(dir, { recursive: true });
});

test("a connection's own id (a page with no key) is never saved", () => {
  const { chips, dir } = bank();
  chips.award('conn:abc', 5, 'x');
  chips.award(A, 5, 'x');
  chips.flush();
  const saved = JSON.parse(readFileSync(path.join(dir, 'chips.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.wallets), [A]);
  rmSync(dir, { recursive: true });
});

test('a broken chips file is never written over', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-chips-'));
  const file = path.join(dir, 'chips.json');
  writeFileSync(file, '{ not json');
  const err = console.error;
  console.error = () => {};
  try {
    const chips = new Chips(dir, { saveAfter: 0 });
    chips.award(A, 5, 'x');
    chips.flush();
  } finally {
    console.error = err;
  }
  assert.equal(readFileSync(file, 'utf8'), '{ not json');
  rmSync(dir, { recursive: true });
});

test('earning waits out its cooldown', () => {
  const { chips, clock, dir } = bank();
  assert.equal(chips.earn(A, 'basket'), EARN.basket.chips);
  clock.now += EARN.basket.cooldown - 1;
  assert.equal(chips.earn(A, 'basket'), 0);
  clock.now += 1;
  assert.equal(chips.earn(A, 'basket'), EARN.basket.chips);
  // Each person has their own.
  assert.equal(chips.earn(B, 'basket'), EARN.basket.chips);
  rmSync(dir, { recursive: true });
});

test("earning stops at the day's cap (paying what's left under it) and starts again the next day", () => {
  const { chips, clock, dir } = bank();
  const { chips: each, perDay, cooldown } = EARN.golfClose;
  let total = 0;
  for (let i = 0; i < 20; i++) {
    total += chips.earn(A, 'golfClose');
    clock.now += cooldown;
  }
  assert.equal(total, perDay);
  assert.ok(perDay % each === 0);
  // A cap that isn't a multiple: the last one pays the rest.
  const { chips: three, perDay: threeCap } = EARN.three;
  let t3 = 0;
  for (let i = 0; i < 20; i++) {
    t3 += chips.earn(B, 'three');
    clock.now += EARN.three.cooldown;
  }
  assert.equal(t3, threeCap);
  assert.ok(three > 0);
  // Tomorrow.
  clock.now = new Date(2026, 9, 3, 9, 0).getTime();
  assert.equal(chips.earn(A, 'golfClose'), each);
  rmSync(dir, { recursive: true });
});

test('the daily bonus pays once a day', () => {
  const { chips, clock, dir } = bank();
  assert.equal(chips.earn(A, 'daily'), EARN.daily.chips);
  clock.now += 3 * 60 * MIN;
  assert.equal(chips.earn(A, 'daily'), 0);
  clock.now = new Date(2026, 9, 3, 0, 1).getTime();
  assert.equal(chips.earn(A, 'daily'), EARN.daily.chips);
  assert.equal(chipsDay(clock.now), '2026-10-03');
  rmSync(dir, { recursive: true });
});

test('being active pays every ONLINE_EVERY minutes, once per person however many pages, up to its cap', () => {
  const { chips, clock, dir } = bank();
  for (let i = 0; i < ONLINE_EVERY - 1; i++) chips.minute([A, A]);
  assert.equal(chips.balance(A), START_CHIPS);
  chips.minute([A, A, A]);
  assert.equal(chips.balance(A), START_CHIPS + EARN.online.chips);
  for (let i = 0; i < 24 * 60; i++) {
    clock.now += MIN / 100; // still the same day
    chips.minute([A]);
  }
  assert.equal(chips.balance(A), START_CHIPS + EARN.online.perDay);
  rmSync(dir, { recursive: true });
});

test('playing alone pays less than beating others, and a win pays more than a near miss', () => {
  assert.ok(EARN.dartsSolo.chips < EARN.dartsWin.chips);
  assert.ok(EARN.poolSolo.chips < EARN.poolWin.chips);
  assert.ok(EARN.golfClose.chips < EARN.golfHole.chips);
  assert.ok(EARN.basket.chips < EARN.three.chips);
  for (const [kind, e] of Object.entries(EARN) as [string, { chips: number; perDay?: number }][]) {
    assert.ok(Number.isInteger(e.chips) && e.chips > 0, kind);
    assert.ok(e.perDay && e.perDay >= e.chips, `${kind} is capped per day`);
  }
});

test('once is true only the first time', () => {
  const { chips, dir } = bank();
  assert.equal(chips.once('pr:f:1'), true);
  assert.equal(chips.once('pr:f:1'), false);
  assert.equal(chips.once('pr:f:2'), true);
  rmSync(dir, { recursive: true });
});

test('the leaderboard ranks everyone by balance (online or not), by their names, at most CHIPS_TOP of them', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-chips-'));
  const online = new Set<string>([B]);
  // An account goes by its name as it is now; anyone else by what they were last called.
  const chips = new Chips(dir, { saveAfter: 0, nameOf: (id) => (id === A ? 'Ada Lovelace' : undefined), online: (id) => online.has(id) });
  chips.seen(A, { name: 'Ada', color: '#ff0000' });
  chips.seen(B, { name: 'Bob', color: '#00ff00' });
  chips.seen('browser:nameless0000000000');
  chips.award(B, 500, 'slots.win');
  chips.bet(A, 300, 'roulette.bet');
  for (let i = 0; i < 12; i++) chips.seen(`browser:extra${String(i).padStart(16, '0')}`, { name: `Extra ${String(i).padStart(2, '0')}` });
  const top = chips.top();
  assert.equal(top.length, CHIPS_TOP);
  assert.deepEqual(top[0], { id: B, name: 'Bob', chips: START_CHIPS + 500, color: '#00ff00', online: true });
  // The same balance: by name. Ada (700) is below all the extras (1000), so she's off the board; nobody nameless is on it.
  assert.deepEqual(top.slice(1).map((r) => r.name), ['Extra 00', 'Extra 01', 'Extra 02', 'Extra 03', 'Extra 04', 'Extra 05', 'Extra 06', 'Extra 07', 'Extra 08']);
  assert.deepEqual(chips.top(20).at(-1), { id: A, name: 'Ada Lovelace', chips: START_CHIPS - 300, color: '#ff0000' });
  assert.ok(!chips.top(50).some((r) => r.id === 'browser:nameless0000000000'));
  // Names and colours are kept, for when they're away after a restart.
  chips.flush();
  const again = new Chips(dir, { saveAfter: 0 });
  assert.deepEqual(again.top()[0], { id: B, name: 'Bob', chips: START_CHIPS + 500, color: '#00ff00' });
  rmSync(dir, { recursive: true });
});

test('the leaderboard is sent once for a burst of changes, and only when it is different', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-chips-'));
  const sent: string[][] = [];
  const online = new Set<string>();
  const chips = new Chips(dir, { saveAfter: 0, topAfter: 20, online: (id) => online.has(id), onTop: (top) => sent.push(top.map((r) => `${r.name}:${r.chips}${r.online ? '*' : ''}`)) });
  const settle = () => new Promise((r) => setTimeout(r, 40));
  chips.seen(A, { name: 'Ada' });
  chips.seen(B, { name: 'Bob' });
  chips.award(A, 10, 'slots.win');
  chips.award(B, 50, 'slots.win');
  await settle();
  assert.deepEqual(sent, [['Bob:1050', 'Ada:1010']]);
  // A bet and a payout that cancel out: nothing to send.
  chips.bet(A, 5, 'roulette.bet');
  chips.award(A, 5, 'roulette.win');
  await settle();
  assert.equal(sent.length, 1);
  // The order changes.
  chips.award(A, 100, 'poker.win');
  await settle();
  assert.deepEqual(sent.at(-1), ['Ada:1110', 'Bob:1050']);
  // Bob comes online: a check shows it.
  online.add(B);
  chips.topCheck();
  await settle();
  assert.deepEqual(sent.at(-1), ['Ada:1110', 'Bob:1050*']);
  // Someone with no chips moving outside it: a change, but not to the top, and only the top is compared.
  for (let i = 0; i < 12; i++) chips.seen(`browser:extra${String(i).padStart(16, '0')}`, { name: `Extra ${i}` });
  await settle();
  const n = sent.length;
  chips.bet('browser:extra0000000000000009', 1, 'slots.spin'); // "Extra 9" sorts last of them, off the board
  await settle();
  assert.equal(sent.length, n);
  chips.flush();
  rmSync(dir, { recursive: true });
});

test("who someone is to the bank: their account, else their browser's key, else the connection", () => {
  assert.equal(chipsId('u1', 'whatever', 'c1'), 'account:u1');
  assert.equal(chipsId(undefined, '0123456789abcdef', 'c1'), 'browser:0123456789abcdef');
  assert.equal(chipsId(undefined, 'short', 'c1'), 'conn:c1');
  assert.equal(chipsId(undefined, null, 'c1'), 'conn:c1');
  assert.equal(chipsKeyOk('a'.repeat(32)), true);
  assert.equal(chipsKeyOk('../../etc/passwd'), false);
});

test('a throw at the rim goes in, and counts three from behind the line; a wild one misses', () => {
  const shoot = (dist: number) => {
    const from = { x: HOOP.rim.x + dist, y: 1.9, z: HOOP.rim.z };
    const pitch = (55 * Math.PI) / 180;
    const v = idealSpeed(from, pitch)!;
    return basketOf({ ...from, vx: -v * Math.cos(pitch), vy: v * Math.sin(pitch), vz: 0 });
  };
  assert.equal(shoot(3)?.kind, 'basket');
  assert.equal(shoot(THREE_POINT + 0.5)?.kind, 'three');
  assert.ok(shoot(3)!.after > 0);
  assert.equal(basketOf({ x: HOOP.rim.x + 3, y: 1.9, z: HOOP.rim.z, vx: 0, vy: 5, vz: 3 }), null);
});

test('only what a person does counts as being active, not what a page sends by itself', () => {
  assert.equal(activeMsg({ t: 'move', moving: true }), true);
  assert.equal(activeMsg({ t: 'move', moving: false }), false);
  assert.equal(activeMsg({ t: 'ping' }), false);
  assert.equal(activeMsg({ t: 'darts.throw' }), true);
  assert.equal(activeMsg({ t: 'term.input' }), true);
  assert.equal(activeMsg({ t: 'worker.attach' }), false);
});
