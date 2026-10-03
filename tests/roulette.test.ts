import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { AWAY_KEEP, Roulette } from '../src/server/roulette.js';
import { START_CHIPS } from '../src/shared/chips.js';
import { BET_TIME, MAX_SEATS, MAX_SPOT, MAX_TOTAL, RESULT_TIME, SPIN_TIME, PAYS, POCKETS, REDS, SPOTS, WHEEL, amountOk, colorOf, insideSpot, isPocket, numberAt, payout, settle, spotAt, spotOf, spotPlace, staked, type BetKind } from '../src/shared/roulette.js';

const spot = (id: string) => {
  const s = spotOf(id);
  assert.ok(s, `${id} is a spot`);
  return s;
};

// ---- The wheel --------------------------------------------------------------------------------------

test('a European wheel: every number from 0 to 36 once, 18 red and 18 black', () => {
  assert.equal(POCKETS, 37);
  assert.deepEqual([...WHEEL].sort((a, b) => a - b), Array.from({ length: 37 }, (_, i) => i));
  assert.equal(REDS.size, 18);
  assert.equal(colorOf(0), 'green');
  assert.equal(colorOf(1), 'red');
  assert.equal(colorOf(2), 'black');
  assert.equal(colorOf(36), 'red');
  // Round the wheel the colours alternate.
  for (let i = 1; i < WHEEL.length - 1; i++) assert.notEqual(colorOf(WHEEL[i]), colorOf(WHEEL[i + 1]));
});

test('only whole numbers 0–36 are pockets', () => {
  for (const n of [0, 17, 36]) assert.ok(isPocket(n));
  for (const n of [-1, 37, 1.5, NaN, '3', null]) assert.ok(!isPocket(n));
});

// ---- The layout -------------------------------------------------------------------------------------

test('the layout has every bet a European table does, and no other', () => {
  const count = (k: BetKind) => [...SPOTS.values()].filter((s) => s.kind === k).length;
  assert.equal(count('straight'), 37);
  assert.equal(count('split'), 57 + 3, '57 between numbers, and 0-1, 0-2, 0-3');
  assert.equal(count('street'), 12 + 2, 'twelve streets, and the trios 0-1-2, 0-2-3');
  assert.equal(count('corner'), 22 + 1, '22 squares, and the first four');
  assert.equal(count('line'), 11);
  assert.equal(count('dozen'), 3);
  assert.equal(count('column'), 3);
  for (const k of ['red', 'black', 'odd', 'even', 'low', 'high'] as const) assert.equal(count(k), 1);
  // Every spot's numbers fit what it pays: 36 ÷ how many it covers, less one.
  for (const s of SPOTS.values()) {
    const n = s.kind === 'corner' && s.numbers.length === 4 ? 4 : s.numbers.length;
    assert.equal(PAYS[s.kind], 36 / n - 1, s.id);
  }
});

test('inside bets are only on numbers next to each other on the layout', () => {
  assert.ok(insideSpot('split', [17, 20]), 'along a column');
  assert.ok(insideSpot('split', [17, 18]), 'across a street');
  assert.ok(insideSpot('split', [2, 0]), 'with the zero, any order');
  assert.equal(insideSpot('split', [18, 19]), undefined, 'not round the end of a street');
  assert.equal(insideSpot('split', [3, 0])?.id, 'split:0-3');
  assert.equal(insideSpot('split', [1, 3]), undefined);
  assert.equal(insideSpot('split', [0, 4]), undefined);
  assert.deepEqual(spot('street:13-14-15').numbers, [13, 14, 15]);
  assert.equal(spotOf('street:14-15-16'), undefined);
  assert.deepEqual(spot('corner:17-18-20-21').numbers, [17, 18, 20, 21]);
  assert.equal(spotOf('corner:18-19-21-22'), undefined, 'not across the end of a street');
  assert.equal(spotOf('corner:34-35-37-38'), undefined);
  assert.ok(spotOf('corner:0-1-2-3'));
  assert.deepEqual(spot('line:31-32-33-34-35-36').numbers, [31, 32, 33, 34, 35, 36]);
  assert.equal(spotOf('line:34-35-36-37-38-39'), undefined);
});

test('outside bets cover what they should, and never the zero', () => {
  assert.deepEqual(spot('dozen:2').numbers, [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.deepEqual(spot('column:1').numbers, [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
  assert.deepEqual(spot('column:3').numbers.slice(0, 3), [3, 6, 9]);
  assert.deepEqual(spot('low').numbers.length, 18);
  for (const id of ['dozen:1', 'dozen:2', 'dozen:3', 'column:1', 'column:2', 'column:3', 'red', 'black', 'odd', 'even', 'low', 'high']) assert.ok(!spot(id).numbers.includes(0), id);
  assert.ok(spot('red').numbers.every((n) => colorOf(n) === 'red'));
  assert.ok(spot('black').numbers.every((n) => colorOf(n) === 'black'));
  assert.ok(spot('even').numbers.every((n) => n % 2 === 0));
  assert.ok(spot('high').numbers.every((n) => n >= 19));
});

test('anything that is not a spot on the layout is not a bet', () => {
  for (const id of ['straight:37', 'straight:-1', 'straight:01', 'dozen:4', 'column:0', 'green', 'RED', '', 'x'.repeat(100), 17, null, undefined, {}, ['red']]) assert.equal(spotOf(id), undefined, String(id));
});

// ---- Payouts ----------------------------------------------------------------------------------------

test('standard payouts: the stake back and the winnings on top', () => {
  assert.equal(payout(spot('straight:17'), 10, 17), 360, '35 to 1');
  assert.equal(payout(spot('straight:0'), 10, 0), 360);
  assert.equal(payout(spot('split:17-20'), 10, 20), 180, '17 to 1');
  assert.equal(payout(spot('street:13-14-15'), 10, 14), 120, '11 to 1');
  assert.equal(payout(spot('street:0-1-2'), 10, 0), 120);
  assert.equal(payout(spot('corner:17-18-20-21'), 10, 21), 90, '8 to 1');
  assert.equal(payout(spot('corner:0-1-2-3'), 10, 3), 90);
  assert.equal(payout(spot('line:1-2-3-4-5-6'), 10, 6), 60, '5 to 1');
  assert.equal(payout(spot('dozen:3'), 10, 36), 30, '2 to 1');
  assert.equal(payout(spot('column:2'), 10, 5), 30);
  for (const [id, n] of [['red', 1], ['black', 2], ['odd', 35], ['even', 36], ['low', 18], ['high', 19]] as const) assert.equal(payout(spot(id), 10, n), 20, `${id} even money`);
});

test('losing bets bring nothing back, and the zero loses every outside bet', () => {
  assert.equal(payout(spot('straight:17'), 10, 18), 0);
  assert.equal(payout(spot('red'), 10, 2), 0);
  for (const id of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen:1', 'column:1']) assert.equal(payout(spot(id), 10, 0), 0, id);
});

test('every bet loses 1/37 of its stake on average, the house edge of a single zero', () => {
  for (const s of SPOTS.values()) {
    let back = 0;
    for (let n = 0; n < 37; n++) back += payout(s, 37, n);
    assert.equal(back, 36 * 37, s.id);
  }
});

test('settling a spin adds up each player’s chips', () => {
  const bets = [
    { seat: 'a', spot: 'straight:7', amount: 5 },
    { seat: 'a', spot: 'red', amount: 20 },
    { seat: 'b', spot: 'black', amount: 50 },
    { seat: 'b', spot: 'split:7-8', amount: 10 },
  ];
  assert.equal(staked(bets, 'a'), 25);
  assert.deepEqual(settle(bets, 7), [
    { seat: 'a', staked: 25, paid: 5 * 36 + 40 },
    { seat: 'b', staked: 60, paid: 180 },
  ]);
  assert.deepEqual(settle(bets, 0), [
    { seat: 'a', staked: 25, paid: 0 },
    { seat: 'b', staked: 60, paid: 0 },
  ]);
});

test('an amount is a whole number of chips within the table limits', () => {
  for (const a of [1, 5, 1000]) assert.ok(amountOk(a));
  for (const a of [0, -5, 1.5, 1001, NaN, Infinity, '5', null]) assert.ok(!amountOk(a), String(a));
});

// ---- Where chips go on the layout -------------------------------------------------------------------

test('a chip on the layout is the bet of the square, line or corner it is on', () => {
  const at = (u: number, v: number) => spotAt(u, v)?.id;
  // The top row is 3, 6 … 36; the bottom 1, 4 … 34.
  assert.equal(numberAt(0, 0), 3);
  assert.equal(numberAt(11, 2), 34);
  assert.equal(at(5.5, 1.5), 'straight:17');
  assert.equal(at(5.5, 1.05), 'split:17-18', 'the line above');
  assert.equal(at(5.5, 1.95), 'split:16-17', 'the line below');
  assert.equal(at(5.95, 1.5), 'split:17-20', 'the line to the right');
  assert.equal(at(5.05, 1.5), 'split:14-17', 'the line to the left');
  assert.equal(at(5.95, 1.05), 'corner:17-18-20-21');
  assert.equal(at(5.05, 1.95), 'corner:13-14-16-17');
  assert.equal(at(5.5, 2.9), 'street:16-17-18', 'the bottom edge');
  assert.equal(at(5.95, 2.9), 'line:16-17-18-19-20-21', 'where two streets meet on it');
  assert.equal(at(0.05, 2.9), 'corner:0-1-2-3', 'the first four, by the zero');
  assert.equal(at(0.05, 1.5), 'split:0-2', 'next to the zero');
  assert.equal(at(0.05, 1.05), 'street:0-2-3', 'a trio');
  assert.equal(at(0.05, 1.95), 'street:0-1-2');
  assert.equal(at(5.5, 0.05), 'straight:18', 'nothing above the top row');
  assert.equal(at(11.95, 1.5), 'straight:35', 'nothing past 36');
  assert.equal(at(12, 1), undefined);
  assert.equal(at(-0.1, 1), undefined);
  assert.equal(at(NaN, 1), undefined);
});

test('every inside bet has a place on the layout that is that bet again', () => {
  for (const s of SPOTS.values()) {
    if (s.kind !== 'straight' && s.kind !== 'split' && s.kind !== 'street' && s.kind !== 'corner' && s.kind !== 'line') continue;
    const p = spotPlace(s);
    if (s.id === 'straight:0') {
      assert.equal(p, null);
      continue;
    }
    assert.ok(p, s.id);
    // Nudged just onto the numbers (lines on an edge are drawn on it).
    const u = Math.min(Math.max(p.u, 0.02), 11.98);
    const v = Math.min(Math.max(p.v, 0.02), 2.98);
    assert.equal(spotAt(u, v)?.id, s.id);
  }
});

// ---- The table, run by the office -------------------------------------------------------------------

/** A table with a real chips bank, a clock the test moves, and the number the next spin lands on. */
function table() {
  const clock = { now: 1_000_000, next: 17, spins: 0 };
  const changes: { id: string; amount: number; reason: string; quiet: boolean }[] = [];
  const chips = new Chips(mkdtempSync(path.join(tmpdir(), 'agent-office-roulette-')), { now: () => clock.now, saveAfter: 0, onChange: (id, _s, e, quiet) => changes.push({ id, amount: e.amount, reason: e.reason, quiet }) });
  const r = new Roulette(chips, { now: () => clock.now, spin: () => (clock.spins++, clock.next) });
  /** Moves the clock on `ms` and lets the table catch up. */
  const wait = (ms: number) => {
    clock.now += ms;
    r.tick();
  };
  return { r, chips, clock, changes, wait };
}

test('a round: the first chips start the clock, then no more bets, the spin, the payout and a clear layout', () => {
  const { r, chips, clock, changes, wait } = table();
  assert.ok(r.join('p1', 'Ada', 'account:ada'));
  assert.equal(r.state().phase, 'idle');
  assert.ok(r.bet('p1', 'straight:17', 10));
  let s = r.state();
  assert.equal(s.phase, 'betting');
  assert.equal(s.left, BET_TIME);
  assert.equal(s.round, 1);
  assert.equal(s.number, null, 'nothing picked while bets are taken');
  wait(100);
  assert.ok(r.bet('p1', 'red', 20));
  assert.equal(chips.balance('account:ada'), START_CHIPS - 30);
  assert.ok(changes.every((c) => c.reason === 'roulette.bet' && c.quiet), 'bets are quiet');
  wait(BET_TIME);
  s = r.state();
  assert.equal(s.phase, 'spinning');
  assert.equal(s.number, 17);
  assert.equal(clock.spins, 1);
  assert.ok(!r.bet('p1', 'red', 5), 'rien ne va plus');
  assert.ok(!r.unbet('p1'), 'and none picked up');
  assert.equal(chips.balance('account:ada'), START_CHIPS - 30, 'not paid before the ball lands');
  wait(SPIN_TIME);
  s = r.state();
  assert.equal(s.phase, 'result');
  assert.deepEqual(s.wins, [{ seat: s.seats[0].id, staked: 30, paid: 360 }], '17 is black: the red loses');
  assert.equal(chips.balance('account:ada'), START_CHIPS - 30 + 360);
  assert.deepEqual(changes.at(-1), { id: 'account:ada', amount: 360, reason: 'roulette.win', quiet: false });
  assert.deepEqual(s.history, [17]);
  wait(RESULT_TIME);
  s = r.state();
  assert.equal(s.phase, 'idle');
  assert.deepEqual(s.bets, []);
  assert.deepEqual(s.history, [17], 'the board keeps the number');
});

test('several people bet on the same spin, each paid what they won', () => {
  const { r, chips, clock, wait } = table();
  clock.next = 0;
  r.join('p1', 'Ada', 'account:ada');
  r.join('p2', 'Bo', 'browser:bo');
  assert.ok(r.bet('p1', 'corner:0-1-2-3', 50));
  assert.ok(r.bet('p2', 'straight:0', 5));
  assert.ok(r.bet('p2', 'red', 100));
  const [a, b] = r.state().seats;
  assert.notEqual(a.color, b.color);
  assert.deepEqual(r.state().bets.map((x) => x.seat), [a.id, b.id, b.id]);
  wait(BET_TIME);
  wait(SPIN_TIME);
  assert.equal(chips.balance('account:ada'), START_CHIPS - 50 + 450);
  assert.equal(chips.balance('browser:bo'), START_CHIPS - 105 + 180, 'the zero: red loses');
});

test('a bet never goes over your balance, or the table limits, and only real spots and amounts count', () => {
  const { r, chips } = table();
  r.join('p1', 'Ada', 'account:ada');
  assert.ok(!r.bet('p1', 'straight:17', START_CHIPS + 1), 'more than you have');
  assert.ok(!r.bet('nobody', 'red', 5), 'not at the table');
  for (const spot of ['straight:37', 'split:1-3', 'green', 7, null, undefined]) assert.ok(!r.bet('p1', spot, 5), String(spot));
  for (const amount of [0, -5, 2.5, NaN, '5', MAX_SPOT + 1]) assert.ok(!r.bet('p1', 'red', amount), String(amount));
  assert.equal(chips.balance('account:ada'), START_CHIPS, 'nothing taken');
  assert.equal(r.state().phase, 'idle', 'and nothing started');
  chips.award('account:ada', 10_000, 'test');
  assert.ok(r.bet('p1', 'red', MAX_SPOT));
  assert.ok(!r.bet('p1', 'red', 1), 'over the most on one spot');
  for (const spot of ['black', 'odd', 'even', 'low']) assert.ok(r.bet('p1', spot, MAX_SPOT));
  assert.equal(MAX_TOTAL, 5 * MAX_SPOT);
  assert.ok(!r.bet('p1', 'high', 1), 'over the most in a round');
  // Spent down to nothing: the bank says no.
  const { r: r2, chips: c2 } = table();
  r2.join('p', 'Cy', 'browser:cy');
  c2.bet('browser:cy', START_CHIPS - 3, 'test');
  assert.ok(r2.bet('p', 'red', 3));
  assert.equal(c2.balance('browser:cy'), 0);
  assert.ok(!r2.bet('p', 'black', 1));
});

test('chips picked up go back to your balance; leaving takes them with you while bets are open', () => {
  const { r, chips, wait } = table();
  r.join('p1', 'Ada', 'account:ada');
  r.bet('p1', 'red', 40);
  wait(100);
  r.bet('p1', 'straight:5', 10);
  wait(100);
  assert.ok(r.unbet('p1', 'red'));
  assert.equal(chips.balance('account:ada'), START_CHIPS - 10);
  wait(100);
  assert.ok(!r.unbet('p1', 'red'), 'nothing left there');
  assert.ok(!r.unbet('p1', 'nonsense'));
  wait(100);
  assert.ok(r.left('p1'));
  assert.equal(chips.balance('account:ada'), START_CHIPS);
  assert.deepEqual(r.state().bets, []);
  assert.deepEqual(r.state().seats, []);
  // With nothing down when the clock runs out, there's no spin.
  wait(BET_TIME);
  assert.equal(r.state().phase, 'idle');
});

test('away keeps your place, colour and chips; sitting down again puts you back in it; winnings are paid even while away', () => {
  const { r, chips, wait } = table();
  r.join('p1', 'Ada', 'account:ada');
  r.join('p2', 'Bo', 'browser:bo');
  const color = r.state().seats[0].color;
  r.bet('p1', 'straight:17', 10);
  assert.ok(r.away('p1'));
  assert.equal(r.state().seats[0].peer, undefined);
  assert.ok(!r.bet('p1', 'red', 5), 'the old connection is not at the table');
  wait(BET_TIME);
  wait(SPIN_TIME);
  assert.equal(chips.balance('account:ada'), START_CHIPS - 10 + 360);
  // Back on a new connection (a reload): the same place.
  assert.ok(r.join('p9', 'Ada', 'account:ada'));
  assert.equal(r.state().seats.length, 2);
  assert.equal(r.state().seats[0].color, color);
  assert.equal(r.state().seats[0].peer, 'p9');
  assert.ok(!r.join('p9', 'Ada', 'account:ada'), 'already at it');
});

test('a place kept for someone away with nothing down is let go after a while', () => {
  const { r, wait } = table();
  r.join('p1', 'Ada', 'account:ada');
  r.away('p1');
  wait(AWAY_KEEP - 1000);
  assert.equal(r.state().seats.length, 1);
  wait(2000);
  assert.equal(r.state().seats.length, 0);
});

test('chips go down as fast as anyone clicks, and no faster', () => {
  const { r, wait } = table();
  r.join('p1', 'Ada', 'account:ada');
  let ok = 0;
  for (let i = 0; i < 40; i++) if (r.bet('p1', 'red', 1)) ok++;
  assert.equal(ok, 24, 'a burst, like a rebet');
  wait(1000);
  for (let i = 0; i < 40; i++) if (r.bet('p1', 'red', 1)) ok++;
  assert.equal(ok, 32, 'then eight a second');
});

test('the table seats six, in six colours', () => {
  const { r } = table();
  for (let i = 0; i < MAX_SEATS; i++) assert.ok(r.join(`p${i}`, `P${i}`, `browser:${i}`));
  assert.ok(!r.join('px', 'Late', 'browser:x'));
  assert.equal(new Set(r.state().seats.map((s) => s.color)).size, MAX_SEATS);
  assert.ok(r.left('p2'));
  assert.ok(r.join('px', 'Late', 'browser:x'));
});

test('the state never shows anyone’s wallet, nor the number before bets close', () => {
  const { r } = table();
  r.join('p1', 'Ada', 'account:ada');
  r.bet('p1', 'red', 5);
  const json = JSON.stringify(r.state());
  assert.ok(!json.includes('account:ada'));
  assert.equal(r.state().number, null);
});

test('shutting down mid-round gives everyone their chips back', () => {
  const { r, chips, wait } = table();
  r.join('p1', 'Ada', 'account:ada');
  r.bet('p1', 'red', 50);
  wait(BET_TIME);
  assert.equal(r.state().phase, 'spinning');
  r.close();
  assert.equal(chips.balance('account:ada'), START_CHIPS);
});

test('the real wheel picks every number, with crypto', () => {
  const chips = new Chips(mkdtempSync(path.join(tmpdir(), 'agent-office-roulette-')), { saveAfter: 0 });
  let now = 0;
  const r = new Roulette(chips, { now: () => now });
  r.join('p', 'Ada', 'account:ada');
  const seen = new Set<number>();
  for (let i = 0; i < 600; i++) {
    chips.award('account:ada', 1, 'test');
    now += 100;
    r.bet('p', 'red', 1);
    now += BET_TIME;
    r.tick();
    seen.add(r.state().number!);
    now += SPIN_TIME;
    r.tick();
    now += RESULT_TIME;
    r.tick();
  }
  assert.equal(seen.size, 37);
  assert.ok([...seen].every((n) => isPocket(n)));
});
