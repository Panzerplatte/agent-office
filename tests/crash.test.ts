import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { Crash } from '../src/server/crash.js';
import { START_CHIPS } from '../src/shared/chips.js';
import { BET_TIME, CRASHED_TIME, CYCLE, HISTORY, HOUSE, MAX_BET, MAX_CRASH, MIN_BET, SERIES_LIMITS, SERIES_MAXES, betOk, chanceToReach, crashPoint, crashedBy, drawSeries, multiplierAt, oddsOk, payout, shownMultiplier, timeFor, emptyCrash, type CrashOdds } from '../src/shared/crash.js';
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
  const pick = (crash as unknown as { pick: (o: CrashOdds) => number }).pick;
  const N = 20_000;
  const points = Array.from({ length: N }, () => pick({ back: HOUSE, max: MAX_CRASH }));
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

// ---- Series of rounds ------------------------------------------------------------------------------

test("a series' odds stay within the limits: about 1 % to the house, capped between 50× and 1000×", () => {
  assert.ok(SERIES_LIMITS.back[0] >= 0.985 && SERIES_LIMITS.back[1] <= 0.995, 'the house keeps about 1 %');
  assert.ok(SERIES_MAXES.every((m) => m >= SERIES_LIMITS.max[0] && m <= SERIES_LIMITS.max[1]));
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 40; j++) {
      const o = drawSeries(i / 40, j / 40);
      assert.ok(oddsOk(o), JSON.stringify(o));
      assert.equal(Math.round(o.back * 1000) / 1000, o.back, 'to the tenth of a percent');
      seen.add(`${o.back}|${o.max}`);
    }
  }
  assert.ok(seen.size > 20, 'series really do differ');
  assert.deepEqual(drawSeries(0, 0), { back: SERIES_LIMITS.back[0], max: SERIES_MAXES[0] });
  assert.deepEqual(drawSeries(1 - 1e-12, 1 - 1e-12), { back: SERIES_LIMITS.back[1], max: SERIES_MAXES.at(-1) });
  for (const r of [NaN, -1, 1, Infinity]) assert.deepEqual(drawSeries(r, 0.5), { back: HOUSE, max: MAX_CRASH }, 'nonsense in: the usual odds');
  // The crypto draws of the real game too.
  const crash = new Crash({ bet: () => true, award: () => true });
  const draw = (crash as unknown as { draw: () => CrashOdds }).draw;
  for (let i = 0; i < 2000; i++) assert.ok(oddsOk(draw()));
});

test("at any series' odds a cash-out gets back about 99 %, and the crash points stay under the cap", () => {
  const N = 100_000;
  for (const odds of [drawSeries(0, 0), drawSeries(0.5, 0.5), drawSeries(0.999, 0.999)]) {
    const points = Array.from({ length: N }, (_, i) => crashPoint((i + 0.5) / N, odds));
    assert.ok(points.every((c) => c >= 1 && c <= odds.max));
    for (const m of [1.01, 2, 10, 40]) {
      const reached = points.filter((c) => c >= m).length / N;
      assert.ok(Math.abs(reached - chanceToReach(m, odds)) < 0.002, `${m}× at ${JSON.stringify(odds)}: ${reached}`);
      const back = (reached * payout(1000, m)) / 1000;
      assert.ok(back > 0.975 && back < 0.995, `${m}× at ${JSON.stringify(odds)}: ${back} back`);
    }
    assert.equal(chanceToReach(odds.max + 1, odds), 0, 'nothing over the cap');
  }
});

// ---- The game ---------------------------------------------------------------------------------------

function game(point = 2) {
  const clock = { now: 1_000_000, point, picks: 0, series: [] as CrashOdds[], picked: [] as CrashOdds[] };
  const changes: { id: string; amount: number; reason: string; quiet: boolean }[] = [];
  const chips = new Chips(mkdtempSync(path.join(tmpdir(), 'agent-office-crash-')), { now: () => clock.now, saveAfter: 0, onChange: (id, _s, e, quiet) => changes.push({ id, amount: e.amount, reason: e.reason, quiet }) });
  const c = new Crash(chips, {
    now: () => clock.now,
    point: (odds) => (clock.picks++, clock.picked.push(odds), clock.point),
    series: () => {
      const o = drawSeries(Math.random(), Math.random());
      clock.series.push(o);
      return o;
    },
  });
  const wait = (ms: number) => {
    clock.now += ms;
    return c.tick();
  };
  /** Through the betting clock: the round's climbing. */
  const start = () => {
    wait(BET_TIME);
    assert.equal(c.state().phase, 'running');
  };
  /** Like the office's timer: straight to the next thing that happens, and that thing. */
  const next = () => {
    clock.now = Math.max(clock.now, c.nextAt());
    assert.ok(c.tick(), 'something happens when nextAt says');
    return c.state();
  };
  /** A whole round, from bets open to bets open for the next. */
  const round = () => {
    assert.equal(c.state().phase, 'betting');
    assert.equal(next().phase, 'running');
    assert.equal(next().phase, 'crashed');
    assert.equal(next().phase, 'betting');
  };
  return { clock, chips, changes, c, wait, start, next, round };
}

test('it runs nonstop: bets open from the start, and rounds go on with nobody betting', () => {
  const { c, clock, wait } = game(2);
  const s = c.state();
  assert.equal(s.phase, 'betting');
  assert.equal(s.left, BET_TIME, 'the first betting window opens as the office starts');
  assert.deepEqual([s.round, s.series, s.of], [1, 1, 1]);
  assert.ok(oddsOk(s.odds));
  for (let r = 1; r <= 5; r++) {
    assert.equal(c.state().of, r);
    assert.ok(!wait(BET_TIME - 1), 'nothing yet');
    assert.ok(wait(1), 'the round starts with no bets');
    assert.equal(c.state().phase, 'running');
    assert.deepEqual(c.state().players, []);
    wait(timeFor(2.01) + 1);
    assert.equal(c.state().phase, 'crashed');
    wait(CRASHED_TIME);
    assert.equal(c.state().phase, 'betting');
  }
  assert.equal(clock.picks, 5);
  assert.deepEqual(c.state().history, [2, 2, 2, 2, 2]);
});

test('after every crash (and the crash on the screen) there are exactly 10 s to bet', () => {
  const { c, clock, wait, next } = game(3);
  for (let r = 0; r < 3; r++) {
    while (c.state().phase !== 'crashed') next();
    wait(CRASHED_TIME - 1);
    assert.equal(c.state().phase, 'crashed');
    assert.ok(!c.bet('p1', A, 'Ann', 10), 'no bets on the crashed round');
    wait(1);
    const s = c.state();
    assert.equal(s.phase, 'betting');
    assert.equal(s.left, BET_TIME);
    assert.deepEqual(s.players, [], 'last round\'s players are cleared');
    assert.equal(c.nextAt(), clock.now + BET_TIME);
    wait(BET_TIME - 1);
    assert.ok(c.bet('p1', A, 'Ann', 10), 'in the last moment of the window');
    wait(1);
    assert.equal(c.state().phase, 'running');
    assert.ok(!c.bet('p2', B, 'Bob', 10), 'closed');
    wait(Math.ceil(timeFor(3.01)) + 1);
  }
});

test('nextAt is when the next thing happens: the timer never needs to tick in between', () => {
  for (const point of [1, 1.01, 1.5, 2, 7.77, 100]) {
    const { c, clock } = game(point);
    clock.now = c.nextAt();
    c.tick();
    if (point === 1) assert.equal(c.state().phase, 'crashed', 'an instant crash at once');
    else {
      assert.equal(c.state().phase, 'running');
      const at = c.nextAt();
      clock.now = at - 2;
      assert.ok(!c.tick(), `still climbing just before nextAt at ${point}×`);
      clock.now = at;
      assert.ok(c.tick());
      assert.equal(c.state().phase, 'crashed');
      assert.equal(c.state().crash, point);
    }
  }
});

test('after 25 rounds it all starts over: round 1, no history, new odds', () => {
  const { c, clock, round } = game(1.5);
  for (let r = 1; r <= CYCLE; r++) {
    assert.equal(c.state().of, r);
    assert.equal(c.state().series, 1);
    assert.equal(c.state().history.length, r - 1);
    round();
  }
  const s = c.state();
  assert.deepEqual([s.round, s.series, s.of], [CYCLE + 1, 2, 1]);
  assert.deepEqual(s.history, [], 'history cleared');
  assert.equal(clock.series.length, 2, 'new odds drawn for the new series');
  assert.deepEqual(s.odds, clock.series[1]);
  assert.ok(oddsOk(s.odds));
  // Every crash point of a series was drawn at that series' odds.
  assert.equal(clock.picked.length, CYCLE);
  assert.ok(clock.picked.every((o) => o === clock.series[0]));
  round();
  assert.equal(clock.picked.at(-1), clock.series[1]);
  assert.deepEqual(c.state().history, [1.5]);
  assert.equal(c.state().of, 2);
  // And the next series after 25 more.
  for (let r = 2; r <= CYCLE; r++) round();
  assert.deepEqual([c.state().series, c.state().of, c.state().history.length], [3, 1, 0]);
});

test("the 25th round's crash is shown before the new series starts, and a late joiner sees where it is", () => {
  const { c, next, round } = game(4);
  for (let r = 1; r < CYCLE; r++) round();
  next();
  next();
  const crashed = c.state();
  assert.equal(crashed.phase, 'crashed');
  assert.equal(crashed.of, CYCLE);
  assert.equal(crashed.history.length, CYCLE, 'the whole series up to its last crash');
  assert.equal(crashed.crash, 4);
  next();
  assert.equal(c.state().of, 1);
  // Mid-round, everything a page needs is in the state, and never the crash point.
  next();
  const s = c.state();
  assert.equal(s.phase, 'running');
  assert.equal(s.crash, null);
  assert.ok(!JSON.stringify(s).includes('"point"'));
});

test('bets come off the balance, quietly, and the round goes on', () => {
  const { c, chips, changes, wait } = game();
  assert.ok(c.bet('p1', A, 'Ann', 100, '#ff0000'));
  const s = c.state();
  assert.equal(s.phase, 'betting');
  assert.equal(s.left, BET_TIME, 'a bet doesn\'t touch the clock');
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
  assert.deepEqual(c.state().players, []);
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
  assert.equal(c.state().phase, 'betting');
  assert.deepEqual(c.state().players, []);
  assert.ok(c.bet('p2', B, 'Bob', 10), 'the next round');
  assert.equal(c.state().round, 2);
});

test('a bet can be taken back while the clock counts down, not after', () => {
  const { c, chips, wait, start } = game();
  assert.ok(c.bet('p1', A, 'Ann', 100));
  assert.ok(c.cancel(A));
  assert.equal(chips.balance(A), START_CHIPS);
  assert.equal(c.state().phase, 'betting', 'the clock runs on with nobody in');
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

test('the history keeps the series\' crash points, newest first', () => {
  const { c, clock, round } = game();
  for (let i = 1; i <= 7; i++) {
    clock.point = 1 + i / 100;
    round();
  }
  const h = c.state().history;
  assert.equal(HISTORY, CYCLE);
  assert.deepEqual(h, [1.07, 1.06, 1.05, 1.04, 1.03, 1.02, 1.01]);
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
  assert.deepEqual(c.state().players, []);
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
