import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { Crash } from '../src/server/crash.js';
import { START_CHIPS } from '../src/shared/chips.js';
import { BET_TIME, CRASHED_TIME, HISTORY, HOUSE, MAX_BET, MAX_CRASH, MIN_BET, betOk, chanceToReach, crashPoint, crashedBy, multiplierAt, payout, shownMultiplier, timeFor, emptyCrash } from '../src/shared/crash.js';
import { CASINO_ROOM, CRASH_SCREEN, SLOT_MACHINES, SLOT_SIZE, casinoWalkable } from '../src/shared/casino.js';

const A = 'browser:aaaaaaaaaaaaaaaa';
const B = 'browser:bbbbbbbbbbbbbbbb';

// ---- The curve --------------------------------------------------------------------------------------

test('the multiplier starts at 1.00× and climbs, down to the hundredth', () => {
  assert.equal(multiplierAt(0), 1);
  assert.equal(multiplierAt(-500), 1);
  let last = 1;
  for (let ms = 0; ms < 60_000; ms += 137) {
    const m = multiplierAt(ms);
    assert.ok(m >= last, `never goes down (${ms} ms)`);
    assert.equal(Math.round(m * 100) / 100, m, 'two decimals');
    last = m;
  }
  assert.ok(Math.abs(timeFor(2) - 5776) < 5, '2× after about 5.8 s');
  for (const m of [1.01, 1.5, 2, 3.33, 10, 57.12, 100]) assert.equal(multiplierAt(timeFor(m) + 0.5), m, `timeFor(${m}) is when it gets there`);
});

// ---- The crash point --------------------------------------------------------------------------------

test('crash points are between 1.00× and the cap, two decimals, 0.99 / (1 − r)', () => {
  assert.equal(crashPoint(0), 1);
  assert.equal(crashPoint(0.01), 1);
  assert.equal(crashPoint(0.5), 1.98);
  assert.equal(crashPoint(0.9), 9.9);
  assert.equal(crashPoint(0.99), 99);
  assert.equal(crashPoint(0.999), MAX_CRASH, 'capped');
  assert.equal(crashPoint(1 - 2 ** -52), MAX_CRASH);
  // Nonsense in gives an instant crash, never something outside the bounds.
  for (const r of [NaN, -0.1, 1, 2, Infinity]) assert.equal(crashPoint(r), 1);
  for (let i = 0; i <= 1000; i++) {
    const c = crashPoint(i / 1001);
    assert.ok(c >= 1 && c <= MAX_CRASH);
    assert.equal(Math.round(c * 100) / 100, c);
  }
});

test('over many rounds the crash points have the house edge: a cash-out at m pays back 0.99 wherever m is', () => {
  // An even spread of r over [0, 1): the exact distribution, without randomness in the test.
  const N = 200_000;
  const points = Array.from({ length: N }, (_, i) => crashPoint((i + 0.5) / N));
  for (const m of [1.01, 1.5, 2, 5, 10, 50, 100]) {
    const reached = points.filter((c) => c >= m).length / N;
    assert.ok(Math.abs(reached - chanceToReach(m)) < 0.002, `${m}×: reached ${reached}, expected ${chanceToReach(m)}`);
    const back = (reached * payout(1000, m)) / 1000;
    assert.ok(Math.abs(back - HOUSE) < 0.012, `${m}×: ${back} back for every chip`);
  }
  const instant = points.filter((c) => c === 1).length / N;
  assert.ok(Math.abs(instant - (1 - HOUSE / 1.01)) < 0.001, `instant crashes: ${instant}`);
  const median = [...points].sort((a, b) => a - b)[N / 2];
  assert.ok(Math.abs(median - 1.98) < 0.02, `half the rounds crash under 1.98×: ${median}`);
});

test('the real crash points look like the curve too (crypto random)', () => {
  const crash = new Crash({ bet: () => true, award: () => true });
  const pick = (crash as unknown as { pick: () => number }).pick;
  const N = 20_000;
  const points = Array.from({ length: N }, pick);
  assert.ok(points.every((c) => c >= 1 && c <= MAX_CRASH));
  const twice = points.filter((c) => c >= 2).length / N;
  assert.ok(Math.abs(twice - HOUSE / 2) < 0.025, `2× or more: ${twice}`);
});

test('a round has crashed once the multiplier has gone past its point, or straight away at 1.00×', () => {
  assert.ok(crashedBy(1, 0));
  assert.ok(!crashedBy(2, 0));
  assert.ok(!crashedBy(2, timeFor(2) + 1), 'at 2.00× you can still get out');
  assert.ok(crashedBy(2, timeFor(2.01) + 1));
});

// ---- Bets and payouts -------------------------------------------------------------------------------

test('payouts are bet × the multiplier, down to the whole chip', () => {
  assert.equal(payout(100, 1), 100);
  assert.equal(payout(100, 2.37), 237);
  assert.equal(payout(7, 1.5), 10);
  assert.equal(payout(10_000, 100), 1_000_000);
  assert.equal(payout(3, 1.01), 3);
  assert.equal(payout(1, 1.99), 1);
  // No float drift: 1.15 × 100 is 115, not 114.99999.
  assert.equal(payout(100, 1.15), 115);
  assert.equal(payout(10_000, 1.13), 11_300);
});

test('a bet is a whole number from 1 to 10,000', () => {
  for (const n of [MIN_BET, 5, 999, MAX_BET]) assert.ok(betOk(n));
  for (const n of [0, -5, 1.5, MAX_BET + 1, NaN, Infinity, '100', null, undefined]) assert.ok(!betOk(n), String(n));
});

test('the screen extrapolates from what the office sent', () => {
  const s = { ...emptyCrash(), phase: 'running' as const, elapsed: 5000 };
  assert.equal(shownMultiplier(s, 0), multiplierAt(5000));
  assert.equal(shownMultiplier(s, 1000), multiplierAt(6000));
  assert.equal(shownMultiplier({ ...s, phase: 'crashed', crash: 3.21 }, 9999), 3.21);
  assert.equal(shownMultiplier({ ...s, phase: 'betting' }, 1000), 1);
});

// ---- The game ---------------------------------------------------------------------------------------

function game(point = 2) {
  const clock = { now: 1_000_000, point, picks: 0 };
  const changes: { id: string; amount: number; reason: string; quiet: boolean }[] = [];
  const chips = new Chips(mkdtempSync(path.join(tmpdir(), 'agent-office-crash-')), { now: () => clock.now, saveAfter: 0, onChange: (id, _s, e, quiet) => changes.push({ id, amount: e.amount, reason: e.reason, quiet }) });
  const c = new Crash(chips, { now: () => clock.now, point: () => (clock.picks++, clock.point) });
  const wait = (ms: number) => {
    clock.now += ms;
    return c.tick();
  };
  /** Through the betting clock: the round's climbing. */
  const start = () => {
    wait(BET_TIME);
    assert.equal(c.state().phase, 'running');
  };
  return { clock, chips, changes, c, wait, start };
}

test('the first bet starts the clock; bets come off the balance, quietly', () => {
  const { c, chips, changes, wait } = game();
  assert.equal(c.state().phase, 'idle');
  assert.ok(c.bet('p1', A, 'Ann', 100, '#ff0000'));
  const s = c.state();
  assert.equal(s.phase, 'betting');
  assert.equal(s.left, BET_TIME);
  assert.equal(s.round, 1);
  assert.deepEqual(s.players, [{ id: s.players[0].id, name: 'Ann', color: '#ff0000', peer: 'p1', bet: 100 }]);
  assert.equal(chips.balance(A), START_CHIPS - 100);
  assert.deepEqual(changes, [{ id: A, amount: -100, reason: 'crash.bet', quiet: true }]);
  assert.ok(!JSON.stringify(s).includes(A), 'nobody sees anyone\'s wallet');
  wait(3000);
  assert.equal(c.state().left, BET_TIME - 3000);
  assert.ok(c.bet('p2', B, 'Bob', 50));
  assert.equal(c.state().players.length, 2);
});

test('bet validation: the limits, the balance, once a round, only while bets are open', () => {
  const { c, chips, start, wait } = game(5);
  for (const n of [0, -1, 2.5, MAX_BET + 1, '10', null]) assert.ok(!c.bet('p1', A, 'Ann', n), `${n} is no bet`);
  assert.ok(!c.bet('p1', A, 'Ann', START_CHIPS + 1), 'not more than you have');
  assert.equal(chips.balance(A), START_CHIPS);
  assert.equal(c.state().phase, 'idle', 'a bet that was refused starts nothing');
  // Up to 10,000, if you have it.
  chips.award(A, 20_000, 'test');
  assert.ok(c.bet('p1', A, 'Ann', MAX_BET));
  assert.ok(!c.bet('p1', A, 'Ann', 10), 'once a round');
  assert.ok(!c.bet('p9', A, 'Ann', 10), 'once a round from any of your pages');
  start();
  assert.ok(!c.bet('p2', B, 'Bob', 10), 'not while it climbs');
  wait(timeFor(5.01) + 10);
  assert.equal(c.state().phase, 'crashed');
  assert.ok(!c.bet('p2', B, 'Bob', 10), 'not on the crashed round');
  wait(CRASHED_TIME);
  assert.equal(c.state().phase, 'idle');
  assert.deepEqual(c.state().players, []);
  assert.ok(c.bet('p2', B, 'Bob', 10), 'the next round');
  assert.equal(c.state().round, 2);
});

test('a bet can be taken back while the clock counts down, not after', () => {
  const { c, chips, wait, start } = game();
  assert.ok(c.bet('p1', A, 'Ann', 100));
  assert.ok(c.cancel(A));
  assert.equal(chips.balance(A), START_CHIPS);
  assert.equal(c.state().phase, 'idle', 'nobody left in: no round');
  assert.ok(!c.cancel(A));
  assert.ok(c.bet('p1', A, 'Ann', 100));
  assert.ok(c.bet('p2', B, 'Bob', 100));
  assert.ok(c.cancel(B));
  assert.equal(c.state().phase, 'betting');
  start();
  assert.ok(!c.cancel(A));
  wait(500);
  assert.equal(chips.balance(A), START_CHIPS - 100);
});

test('cash out pays bet × the multiplier on the office\'s clock, once', () => {
  const { c, chips, changes, wait, start } = game(3);
  c.bet('p1', A, 'Ann', 200);
  c.bet('p2', B, 'Bob', 100);
  assert.equal(c.cashOut(A), 0, 'not before it starts');
  start();
  wait(timeFor(1.5) + 1);
  assert.equal(c.multiplier(), 1.5);
  assert.equal(c.cashOut(A, 'p1b'), 300);
  assert.equal(chips.balance(A), START_CHIPS - 200 + 300);
  assert.deepEqual(changes.at(-1), { id: A, amount: 300, reason: 'crash.win', quiet: true });
  assert.equal(c.cashOut(A), 0, 'only once');
  assert.equal(chips.balance(A), START_CHIPS + 100);
  assert.equal(c.cashOut('browser:nobodynobodynobody'), 0, 'not without a bet');
  const ann = c.state().players.find((p) => p.name === 'Ann')!;
  assert.equal(ann.out, 1.5);
  assert.equal(ann.won, 300);
  assert.equal(ann.peer, 'p1b', 'the page that cashed out is theirs');
  // Right at the crash point you can still get out.
  wait(timeFor(3) - timeFor(1.5));
  assert.equal(c.multiplier(), 3);
  assert.equal(c.cashOut(B), 300);
});

test('a cash-out that arrives after the crash point pays nothing, ticked or not', () => {
  const { c, chips, clock, wait, start } = game(2);
  c.bet('p1', A, 'Ann', 100);
  c.bet('p2', B, 'Bob', 100);
  start();
  assert.equal(c.state().crash, null, 'the crash point is never sent before the crash');
  // Just past 2.00×, and the clock hasn't ticked the crash over yet.
  clock.now += timeFor(2.01) + 1;
  assert.equal(c.state().phase, 'running');
  assert.equal(c.cashOut(A), 0);
  assert.equal(chips.balance(A), START_CHIPS - 100);
  wait(0);
  const s = c.state();
  assert.equal(s.phase, 'crashed');
  assert.equal(s.crash, 2);
  assert.deepEqual(s.history, [2]);
  assert.equal(c.cashOut(B), 0);
  assert.equal(chips.balance(B), START_CHIPS - 100, 'still in when it crashed: the bet is lost');
});

test('an instant crash at 1.00×: nobody gets out', () => {
  const { c, chips, wait } = game(1);
  c.bet('p1', A, 'Ann', 100);
  wait(BET_TIME);
  assert.equal(c.state().phase, 'crashed');
  assert.equal(c.state().crash, 1);
  assert.equal(c.cashOut(A), 0);
  assert.equal(chips.balance(A), START_CHIPS - 100);
});

test('the crash point is picked when the round starts, not before', () => {
  const { c, clock, wait } = game(4);
  c.bet('p1', A, 'Ann', 100);
  wait(BET_TIME - 1);
  assert.equal(clock.picks, 0);
  wait(1);
  assert.equal(clock.picks, 1);
  for (let ms = 0; ms < timeFor(4); ms += 500) {
    wait(500);
    const s = c.state();
    if (s.phase === 'running') {
      assert.equal(s.crash, null);
      assert.ok(s.elapsed > 0);
    }
  }
});

test('the history keeps the last crash points, newest first', () => {
  const { c, clock, wait } = game();
  for (let i = 0; i < HISTORY + 3; i++) {
    clock.point = 1 + i / 100;
    c.bet('p1', A, 'Ann', 1);
    wait(BET_TIME);
    wait(timeFor(clock.point + 0.01) + 60);
    assert.equal(c.state().phase, 'crashed');
    wait(CRASHED_TIME);
  }
  const h = c.state().history;
  assert.equal(h.length, HISTORY);
  assert.equal(h[0], 1 + (HISTORY + 2) / 100);
});

test('look marks the page as theirs; close gives back bets not cashed out', () => {
  const { c, chips, start, wait } = game(10);
  c.bet('p1', A, 'Ann', 100);
  c.bet('p2', B, 'Bob', 100);
  assert.ok(c.look('p1-reloaded', A));
  assert.ok(!c.look('p1-reloaded', A));
  assert.equal(c.state().players[0].peer, 'p1-reloaded');
  start();
  wait(timeFor(2) + 1);
  c.cashOut(A);
  c.close();
  assert.equal(chips.balance(A), START_CHIPS + 100, 'cashed out: keeps the win, no refund on top');
  assert.equal(chips.balance(B), START_CHIPS, 'still in: the bet comes back');
  assert.equal(c.state().phase, 'idle');
});

// ---- The screen on the wall ---------------------------------------------------------------------------

test('the Crash screen hangs on the west wall, south of the slots, with room to stand in front of it', () => {
  const S = CRASH_SCREEN;
  assert.ok(Math.abs(S.x - CASINO_ROOM.minX) < 0.2, 'on the west wall');
  const lastSlot = Math.max(...SLOT_MACHINES.map((m) => m.z + SLOT_SIZE.width / 2));
  assert.ok(S.z - S.width / 2 > lastSlot + 1, 'clear of the slot machines');
  assert.ok(S.z + S.width / 2 < CASINO_ROOM.maxZ - 1, "clear of the corner's palm");
  assert.ok(S.y + S.height / 2 < CASINO_ROOM.height - 0.3, 'under the ceiling');
  assert.ok(casinoWalkable(S.x + 2.5, S.z), 'you can walk up to it');
});
