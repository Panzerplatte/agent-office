import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { Crash } from '../src/server/crash.js';
import { START_CHIPS } from '../src/shared/chips.js';
import { AUTO_MAX, AUTO_MIN, MAX_BET, MAX_PLAYERS, autoBetOk, autoStop, nextAutoBet, payout, targetOk, timeFor, type CrashAutoBet, type CrashAutoState } from '../src/shared/crash.js';

const A = 'browser:aaaaaaaaaaaaaaaa';
const B = 'browser:bbbbbbbbbbbbbbbb';

/** A Crash game on a test clock, with crash points from `points` in turn (the last one over and over). */
function game(...points: number[]) {
  const clock = { now: 1_000_000 };
  const queue = [...points];
  const chips = new Chips(mkdtempSync(path.join(tmpdir(), 'agent-office-crash-auto-')), { now: () => clock.now, saveAfter: 0 });
  const told: { wallet: string; auto: CrashAutoState }[] = [];
  const c = new Crash(chips, {
    now: () => clock.now,
    point: () => (queue.length > 1 ? queue.shift()! : queue[0]),
    series: () => ({ back: 0.99, max: 1000 }),
    onAuto: (wallet, auto) => told.push({ wallet, auto }),
  });
  /** Like the office's timer: straight to the next thing that happens, and that thing. */
  const next = () => {
    clock.now = Math.max(clock.now, c.nextAt());
    c.tick();
    return c.state();
  };
  /** On to the next betting window (through the round that's on, if any). */
  const toBetting = () => {
    do next();
    while (c.state().phase !== 'betting');
  };
  /** Through a whole round, from bets open to bets open for the next. */
  const round = () => {
    assert.equal(c.state().phase, 'betting');
    toBetting();
  };
  return { clock, chips, c, told, next, toBetting, round };
}

// ---- The rules --------------------------------------------------------------------------------------

test('an auto cash-out target is a multiplier to the hundredth, from 1.01× to 1000×', () => {
  for (const m of [AUTO_MIN, 1.5, 2, 3.33, 100, AUTO_MAX]) assert.ok(targetOk(m), String(m));
  for (const m of [1, 0.5, 1.001, 2.345, AUTO_MAX + 0.01, NaN, Infinity, '2', null]) assert.ok(!targetOk(m), String(m));
});

test('the next auto-bet: back to the base, or raised by the percentage, rounded up', () => {
  const s: CrashAutoBet = { base: 10, onLoss: 100, onWin: 0 };
  assert.equal(nextAutoBet(s, 10, false), 20, 'doubled after a loss');
  assert.equal(nextAutoBet(s, 40, false), 80);
  assert.equal(nextAutoBet(s, 80, true), 10, 'back to the base after a win');
  const w: CrashAutoBet = { base: 100, onLoss: 0, onWin: 50 };
  assert.equal(nextAutoBet(w, 100, true), 150, 'up by half after a win');
  assert.equal(nextAutoBet(w, 150, true), 225);
  assert.equal(nextAutoBet(w, 225, false), 100, 'back to the base after a loss');
  assert.equal(nextAutoBet({ base: 1, onLoss: 10, onWin: 0 }, 1, false), 2, 'a raise is always at least a chip');
  assert.equal(nextAutoBet({ base: 10, onLoss: 10, onWin: 0 }, 10, false), 11, 'no rounding up a whole result');
});

test('the stops: rounds, the profit goal and the loss limit, each only if set', () => {
  const s: CrashAutoBet = { base: 10, onLoss: 0, onWin: 0, rounds: 5, profit: 100, loss: 50 };
  assert.equal(autoStop(s, 4, 99), null);
  assert.equal(autoStop(s, 5, 0), 'rounds');
  assert.equal(autoStop(s, 1, 100), 'profit');
  assert.equal(autoStop(s, 1, -49), null);
  assert.equal(autoStop(s, 1, -50), 'loss');
  assert.equal(autoStop({ base: 10, onLoss: 0, onWin: 0 }, 9999, -1e9), null, 'none set: it runs on');
});

test('auto-bet settings are checked', () => {
  assert.deepEqual(autoBetOk({ base: 10, onLoss: 100, onWin: 0, target: 2, rounds: 3 }), { base: 10, onLoss: 100, onWin: 0, target: 2, rounds: 3 });
  assert.deepEqual(autoBetOk({ base: 10, onLoss: 0, onWin: 0, extra: 'x' }), { base: 10, onLoss: 0, onWin: 0 }, 'only the fields it knows');
  for (const bad of [null, 'x', {}, { base: 0, onLoss: 0, onWin: 0 }, { base: MAX_BET + 1, onLoss: 0, onWin: 0 }, { base: 10, onLoss: -1, onWin: 0 }, { base: 10, onLoss: 1.5, onWin: 0 }, { base: 10, onLoss: 0, onWin: 0, target: 1 }, { base: 10, onLoss: 0, onWin: 0, rounds: 0 }, { base: 10, onLoss: 0, onWin: 0, loss: -5 }])
    assert.equal(autoBetOk(bad), null, JSON.stringify(bad));
});

// ---- Auto cash-out ----------------------------------------------------------------------------------

test('an auto cash-out pays at exactly the target, on the office clock, however late the tick', () => {
  const { c, chips, clock, next } = game(5);
  assert.ok(c.bet('p1', A, 'Ann', 100, undefined, 2));
  assert.equal(c.state().players[0].auto, 2, 'the target goes with the bet');
  assert.equal(next().phase, 'running');
  // The office wakes up for it, just as the multiplier gets there.
  const at = c.nextAt();
  assert.ok(at < clock.now + timeFor(5), 'before the crash');
  assert.equal(next().players[0].out, 2);
  assert.equal(c.state().players[0].won, payout(100, 2));
  assert.equal(chips.balance(A), START_CHIPS - 100 + 200);
  // A late clock (the tick comes when it's at 3×) still pays 2×, exactly.
  const late = game(5);
  assert.ok(late.c.bet('p1', A, 'Ann', 100, undefined, 2));
  late.next();
  late.clock.now += timeFor(3);
  assert.ok(late.c.tick());
  assert.deepEqual([late.c.state().players[0].out, late.c.state().players[0].won], [2, 200]);
});

test('a target the round crashes below is never paid: the bet is lost', () => {
  const { c, chips, next } = game(1.99);
  assert.ok(c.bet('p1', A, 'Ann', 100, undefined, 2));
  assert.equal(next().phase, 'running');
  const s = next();
  assert.equal(s.phase, 'crashed', 'straight to the crash: no wake-up for a target it never gets to');
  assert.equal(s.players[0].out, undefined);
  assert.equal(chips.balance(A), START_CHIPS - 100);
  // A target exactly at the crash point is paid (it gets there before it crashes).
  const at = game(2);
  assert.ok(at.c.bet('p1', A, 'Ann', 100, undefined, 2));
  at.next();
  at.clock.now += timeFor(10); // nobody ticked till well after the crash
  at.c.tick();
  assert.equal(at.c.state().phase, 'crashed');
  assert.equal(at.c.state().players[0].out, 2);
  // And an instant crash pays nobody.
  const instant = game(1);
  assert.ok(instant.c.bet('p1', A, 'Ann', 100, undefined, AUTO_MIN));
  assert.equal(instant.next().phase, 'crashed');
  assert.equal(instant.c.state().players[0].out, undefined);
});

test('a manual cash-out before the target still works, once; after the target it pays the target', () => {
  const { c, clock, next } = game(10);
  assert.ok(c.bet('p1', A, 'Ann', 100, undefined, 5));
  assert.ok(c.bet('p2', B, 'Bob', 100, undefined, 3));
  next();
  clock.now += timeFor(1.5);
  assert.equal(c.cashOut(A), 150, 'by hand at 1.5×');
  assert.equal(c.state().players[0].out, 1.5);
  // Bob's tick never came; his cash-out at 4× gets his target, 3×.
  clock.now += timeFor(4) - timeFor(1.5);
  assert.equal(c.cashOut(B), 300);
  assert.equal(c.state().players[1].out, 3);
  assert.equal(c.cashOut(A), 0, 'once');
});

test('a bad target means no bet', () => {
  const { c } = game(2);
  for (const t of [1, 0, 2.005, 5000, 'x']) assert.ok(!c.bet('p1', A, 'Ann', 100, undefined, t));
  assert.ok(c.bet('p1', A, 'Ann', 100, undefined, null), 'null: no target');
  assert.equal(c.state().players[0].auto, undefined);
});

// ---- Auto-bet ---------------------------------------------------------------------------------------

test('auto-bet bets every window: doubled after each loss, back to the base after a win', () => {
  // Crash points: lose (1.5 under the 2× target), lose, win, lose.
  const { c, chips, told, round } = game(1.5, 1.5, 4, 1.5);
  chips.award(A, 10_000, 'crash.win');
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 10, target: 2, onLoss: 100, onWin: 0 }));
  const bets: number[] = [];
  for (let r = 0; r < 4; r++) {
    const me = c.state().players.find((p) => p.name === 'Ann')!;
    assert.equal(me.auto, 2, 'the target goes with every bet');
    bets.push(me.bet);
    round();
  }
  assert.deepEqual(bets, [10, 20, 40, 10]);
  const last = c.autoState(A)!;
  assert.ok(last.on);
  assert.equal(last.rounds, 4);
  assert.equal(last.profit, -10 - 20 + 40 - 10);
  assert.equal(last.next, 20);
  assert.ok(told.every((t) => t.wallet === A) && told.length > 0, 'its owner hears how it goes');
});

test('auto-bet raises after a win by the percentage, and resets after a loss', () => {
  const { c, chips, round } = game(3, 3, 1.2, 3);
  chips.award(A, 10_000, 'crash.win');
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 100, target: 2, onLoss: 0, onWin: 50 }));
  const bets: number[] = [];
  for (let r = 0; r < 4; r++) {
    bets.push(c.state().players[0].bet);
    round();
  }
  assert.deepEqual(bets, [100, 150, 225, 100]);
});

test('auto-bet stops after n rounds', () => {
  const { c, round } = game(3);
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 10, target: 2, onLoss: 0, onWin: 0, rounds: 3 }));
  for (let r = 0; r < 3; r++) {
    assert.equal(c.state().players.length, 1);
    round();
  }
  assert.deepEqual(c.state().players, [], 'no fourth bet');
  assert.deepEqual([c.autoState(A)!.on, c.autoState(A)!.stopped, c.autoState(A)!.rounds], [false, 'rounds', 3]);
});

test('auto-bet stops at the profit goal and at the loss limit', () => {
  const up = game(3);
  assert.ok(up.c.startAuto('p1', A, 'Ann', { base: 10, target: 2, onLoss: 0, onWin: 0, profit: 25 }));
  for (let r = 0; r < 3; r++) up.round();
  assert.deepEqual([up.c.autoState(A)!.stopped, up.c.autoState(A)!.profit], ['profit', 30]);
  assert.deepEqual(up.c.state().players, []);

  const down = game(1.5);
  assert.ok(down.c.startAuto('p1', A, 'Ann', { base: 10, target: 2, onLoss: 0, onWin: 0, loss: 30 }));
  for (let r = 0; r < 3; r++) down.round();
  assert.deepEqual([down.c.autoState(A)!.stopped, down.c.autoState(A)!.profit], ['loss', -30]);
  assert.deepEqual(down.c.state().players, []);
  assert.equal(down.chips.balance(A), START_CHIPS - 30);
});

test('auto-bet never bets more than you have: it stops and says so', () => {
  // 1000 chips: 100, 200, 400 lost (700), the next 800 is more than the 300 left.
  const { c, chips, round } = game(1.5);
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 100, target: 2, onLoss: 100, onWin: 0 }));
  for (let r = 0; r < 3; r++) round();
  assert.deepEqual(c.state().players, []);
  const s = c.autoState(A)!;
  assert.deepEqual([s.on, s.stopped, s.next], [false, 'balance', 800]);
  assert.equal(chips.balance(A), START_CHIPS - 700, 'nothing taken for the bet that did not fit');
  // Starting with more than you have stops it at once.
  const poor = game(2);
  assert.ok(poor.c.startAuto('p1', A, 'Ann', { base: START_CHIPS + 1, onLoss: 0, onWin: 0 }));
  assert.equal(poor.c.autoState(A)!.stopped, 'balance');
});

test('auto-bet never bets more than MAX_BET: it stops as soon as the next bet would be over it', () => {
  const { c, chips, round } = game(1.5);
  chips.award(A, 100_000, 'crash.win');
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 4000, target: 2, onLoss: 100, onWin: 0 }));
  round(); // 4000 lost: next 8000
  assert.equal(c.state().players[0].bet, 8000);
  round(); // 8000 lost: next 16 000, over the limit
  assert.deepEqual(c.state().players, []);
  assert.deepEqual([c.autoState(A)!.stopped, c.autoState(A)!.next], ['limit', 16_000]);
});

test('auto-bet stops when the round is full', () => {
  const { c, chips, toBetting } = game(2);
  toBetting(); // past the first window: the auto-bet's first bet waits for the next
  assert.equal(c.state().phase, 'betting');
  for (let i = 0; i < MAX_PLAYERS; i++) assert.ok(c.bet(`p${i}`, `browser:${String(i).padStart(16, 'x')}`, `P${i}`, 1));
  assert.ok(c.startAuto('pa', A, 'Ann', { base: 10, onLoss: 0, onWin: 0 }));
  assert.equal(c.autoState(A)!.stopped, 'full');
});

test('auto-bet without a target: you cash out by hand, and it counts', () => {
  const { c, clock, next, toBetting } = game(5);
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 10, onLoss: 0, onWin: 100 }));
  next();
  clock.now += timeFor(1.5);
  assert.equal(c.cashOut(A), 15);
  toBetting();
  assert.equal(c.state().players[0].bet, 20, 'doubled after the win');
  assert.equal(c.autoState(A)!.profit, 5);
});

test('stopping the auto-bet, or taking its bet back, stops it; a bet already down stays in', () => {
  const { c, chips, round, next } = game(3);
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 10, target: 2, onLoss: 0, onWin: 0 }));
  assert.ok(c.cancel(A), 'its bet taken back');
  assert.equal(c.autoState(A)!.stopped, 'user');
  assert.equal(chips.balance(A), START_CHIPS);
  round();
  assert.deepEqual(c.state().players, []);

  assert.ok(c.startAuto('p1', A, 'Ann', { base: 10, target: 2, onLoss: 0, onWin: 0 }));
  next(); // running
  assert.ok(c.stopAuto(A, 'left'));
  assert.ok(!c.stopAuto(A), 'already stopped');
  next(); // its bet still cashes out at 2×
  assert.equal(c.state().players[0].out, 2);
  assert.equal(c.autoState(A)!.rounds, 0, 'a stopped auto-bet counts nothing more');
});

test('auto-bet started while the round climbs bets from the next window; a manual bet is not its own', () => {
  const { c, next, toBetting } = game(3);
  assert.ok(c.bet('p1', A, 'Ann', 50));
  next(); // running
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 10, target: 2, onLoss: 100, onWin: 0 }));
  assert.equal(c.state().players[0].bet, 50);
  toBetting();
  const s = c.autoState(A)!;
  assert.deepEqual([s.rounds, s.profit, s.next], [0, 0, 10], 'the manual bet that crashed did not count');
  assert.equal(c.state().players[0].bet, 10);
  assert.ok(!c.startAuto('p1', A, 'Ann', { base: 0, onLoss: 0, onWin: 0 }), 'bad settings');
  assert.ok(c.autoState(A)!.on, 'and the one running is kept');
});

test('close stops every auto-bet and gives back its bets', () => {
  const { c, chips } = game(2);
  assert.ok(c.startAuto('p1', A, 'Ann', { base: 10, onLoss: 0, onWin: 0 }));
  assert.equal(chips.balance(A), START_CHIPS - 10);
  c.close();
  assert.equal(chips.balance(A), START_CHIPS);
  assert.equal(c.autoState(A)!.on, false);
});
