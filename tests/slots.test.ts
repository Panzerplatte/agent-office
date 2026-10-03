import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BETS,
  JACKPOT_SEED,
  JACKPOT_SHARE,
  LINES,
  MAX_BET,
  REELS,
  SPIN_MS,
  baseReturn,
  evaluate,
  isBet,
  jackpotChance,
  jackpotWin,
  linePays,
  returnToPlayer,
  symbolAt,
  windowAt,
  type SlotSymbol,
} from '../src/shared/slots.js';
import { KEEP_MS, Slots, type SlotsBank } from '../src/server/slots.js';

/** Where reel `r` has to stop for `sym` to be on the middle row. */
const stopFor = (r: number, sym: SlotSymbol) => REELS[r].indexOf(sym);

/** A bank with `start` chips each, recording every bet and payout. */
function bank(start = 1000) {
  const balances = new Map<string, number>();
  const log: string[] = [];
  const b: SlotsBank & { balance(id: string): number; log: string[] } = {
    log,
    balance: (id) => balances.get(id) ?? start,
    bet(id, amount, reason) {
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > b.balance(id)) return false;
      balances.set(id, b.balance(id) - amount);
      log.push(`${reason} ${amount}`);
      return true;
    },
    award(id, amount, reason) {
      if (!Number.isSafeInteger(amount) || amount <= 0) return false;
      balances.set(id, b.balance(id) + amount);
      log.push(`${reason} ${amount}`);
      return true;
    },
  };
  return b;
}

/** A bank of six machines with a clock you move by hand, reels that stop where `stops` says, and payouts at once. */
function casino(opts: { stops?: number[][]; start?: number } = {}) {
  let t = 1_000_000;
  const queue = [...(opts.stops ?? [])];
  let current: number[] = [];
  let reel = 0;
  const b = bank(opts.start);
  const s = new Slots(6, b, {
    now: () => t,
    random: (n) => {
      if (reel === 0) current = queue.shift() ?? [0, 0, 0];
      const v = current[reel] % n;
      reel = (reel + 1) % 3;
      return v;
    },
    later: (fn) => fn(),
  });
  return { s, b, tick: (ms: number) => (t += ms) };
}

// ---- The maths ----------------------------------------------------------------------------------------

test('the return to player is about 95 %, worked out exactly over every stop', () => {
  const base = baseReturn();
  const rtp = returnToPlayer();
  assert.ok(base > 0.9 && base < 0.95, `base game ${base}`);
  assert.ok(rtp >= 0.94 && rtp <= 0.96, `RTP ${rtp}`);
  assert.equal(rtp, base + JACKPOT_SHARE);
  // A jackpot now and then, but not every evening: once in a few thousand spins.
  const perSpin = jackpotChance() * LINES.length;
  assert.ok(perSpin > 1 / 10_000 && perSpin < 1 / 1000, `jackpot every ${1 / perSpin} spins`);
});

test('every line sees each stop equally often, so five lines return what one does', () => {
  // Every way the reels can stop, every line, at a bet of 5 (1 a line): the same as baseReturn.
  let won = 0;
  let spins = 0;
  for (let a = 0; a < REELS[0].length; a++)
    for (let b = 0; b < REELS[1].length; b++)
      for (let c = 0; c < REELS[2].length; c++) {
        won += evaluate([a, b, c], 5).win;
        spins++;
      }
  assert.ok(Math.abs(won / (spins * 5) - baseReturn()) < 1e-12);
});

test('a simulation with the real random reels lands near the worked-out return', () => {
  const b = bank(1e12);
  let t = 0;
  const s = new Slots(1, b, { now: () => t, later: (fn) => fn() });
  const n = 200_000;
  s.join('p', 0, 'P', 'k');
  let won = 0;
  for (let i = 0; i < n; i++) {
    t += SPIN_MS;
    assert.ok(s.spin('p', 5));
    const spin = s.state().machines[0].spin!;
    won += spin.win - spin.jackpot;
  }
  // The base game's standard deviation is about 2.7 bets a spin: 200k spins pin it to within ~2 %.
  assert.ok(Math.abs(won / (n * 5) - baseReturn()) < 0.03, `${won / (n * 5)}`);
});

test('the paytable: three of a kind, cherries from the left, stars for the jackpot', () => {
  assert.equal(linePays(['seven', 'seven', 'seven']), 150);
  assert.equal(linePays(['bar', 'bar', 'bar']), 50);
  assert.equal(linePays(['bell', 'bell', 'bell']), 35);
  assert.equal(linePays(['cherry', 'cherry', 'cherry']), 10);
  assert.equal(linePays(['cherry', 'cherry', 'lemon']), 5);
  assert.equal(linePays(['cherry', 'lemon', 'cherry']), 1);
  assert.equal(linePays(['lemon', 'cherry', 'cherry']), 0);
  assert.equal(linePays(['seven', 'seven', 'bar']), 0);
  assert.equal(linePays(['star', 'star', 'star']), 'jackpot');
  assert.equal(linePays(['star', 'star', 'seven']), 0);
});

test('the window and the lines', () => {
  const stops = [3, 10, 26];
  const w = windowAt(stops);
  for (let r = 0; r < 3; r++) assert.deepEqual(w[r], [symbolAt(r, stops[r] - 1), symbolAt(r, stops[r]), symbolAt(r, stops[r] + 1)]);
  // The reels go round: the one above the first is the last.
  assert.equal(symbolAt(0, -1), REELS[0][REELS[0].length - 1]);
  assert.equal(symbolAt(2, 27), REELS[2][0]);
  // Sevens on the middle row: the middle line pays 150 times its bet, a fifth of the spin's.
  const sevens = evaluate([stopFor(0, 'seven'), stopFor(1, 'seven'), stopFor(2, 'seven')], 25);
  assert.ok(sevens.lines.some((l) => l.line === 0 && l.win === 150 * 5));
  // Each reel has just the one star, so three stars come on one line at a time.
  const stars = evaluate([stopFor(0, 'star'), stopFor(1, 'star'), stopFor(2, 'star')], 100);
  assert.equal(stars.jackpot, true);
  assert.deepEqual(stars.lines.find((l) => l.jackpot), { line: 0, win: 0, jackpot: true });
});

test('every bet splits evenly over the lines, and the jackpot pays a share as big as the bet', () => {
  for (const b of BETS) assert.equal(b % LINES.length, 0);
  assert.equal(jackpotWin(1000, MAX_BET), 1000);
  assert.equal(jackpotWin(1000, 50), 500);
  assert.equal(jackpotWin(1001, 5), 50);
  assert.ok(isBet(25));
  for (const v of [0, 7, -5, 1000, '25', NaN, null, undefined, 25.5]) assert.equal(isBet(v), false, String(v));
});

// ---- The machines --------------------------------------------------------------------------------------

test('one person a machine; a machine kept for someone who walked off, until they leave or it times out', () => {
  const { s, tick } = casino();
  assert.ok(s.join('a', 0, 'Ann', 'key-a'));
  assert.equal(s.join('b', 0, 'Bob', 'key-b'), false);
  assert.ok(s.join('b', 1, 'Bob', 'key-b'));
  assert.deepEqual(s.state().machines[0].seat, { name: 'Ann', peer: 'a' });
  // Ann walks off (or reloads): her machine's kept for her, and nobody else gets it.
  assert.ok(s.away('a'));
  assert.deepEqual(s.state().machines[0].seat, { name: 'Ann' });
  assert.equal(s.join('c', 0, 'Cy', 'key-c'), false);
  // Back, as a new connection, she has it again.
  assert.ok(s.join('a2', 0, 'Ann', 'key-a'));
  assert.equal(s.state().machines[0].seat?.peer, 'a2');
  // Away too long, it's anyone's.
  s.away('a2');
  tick(KEEP_MS);
  assert.equal(s.state().machines[0].seat, null);
  assert.ok(s.join('c', 0, 'Cy', 'key-c'));
  // Leaving on purpose frees it at once.
  assert.ok(s.left('c'));
  assert.ok(s.join('d', 0, 'Di', 'key-d'));
  // Moving to another machine lets go of the first.
  assert.ok(s.join('d', 2, 'Di', 'key-d'));
  assert.equal(s.state().machines[0].seat, null);
});

test('joins that make no sense are refused', () => {
  const { s } = casino();
  for (const m of [-1, 6, 1.5, '0', null, undefined, NaN]) assert.equal(s.join('a', m, 'A', 'k'), false, String(m));
  assert.equal(s.join('a', 0, 'A', ''), false);
  assert.equal(s.away('nobody'), false);
  assert.equal(s.left('nobody'), false);
});

test('a spin takes the bet, grows the jackpot and pays what it won', () => {
  const sevens = [stopFor(0, 'seven'), stopFor(1, 'seven'), stopFor(2, 'seven')];
  const { s, b, tick } = casino({ stops: [sevens] });
  s.join('a', 0, 'Ann', 'k');
  assert.ok(s.spin('a', 25));
  const spin = s.state().machines[0].spin!;
  assert.deepEqual(spin.stops, sevens);
  assert.equal(spin.bet, 25);
  assert.equal(spin.name, 'Ann');
  assert.equal(spin.win, evaluate(sevens, 25).win);
  assert.ok(spin.win >= 150 * 5);
  assert.deepEqual(b.log, ['slots.bet 25', `slots.win ${spin.win}`]);
  assert.equal(b.balance('k'), 1000 - 25 + spin.win);
  assert.equal(s.state().jackpot, Math.floor(JACKPOT_SEED + 25 * JACKPOT_SHARE));
  // Not again before the reels have stopped.
  assert.equal(s.spin('a', 25), false);
  tick(SPIN_MS);
  assert.ok(s.spin('a', 25));
  assert.equal(s.state().machines[0].spin!.n, spin.n + 1);
});

test('spins that are not allowed: no machine, a bet not on it, more than you have', () => {
  const { s, b, tick } = casino({ start: 30 });
  assert.equal(s.spin('a', 5), false);
  s.join('a', 0, 'Ann', 'k');
  for (const bet of [0, 3, -5, 1e9, '5', NaN, null, 5.5]) assert.equal(s.spin('a', bet), false, String(bet));
  assert.equal(s.spin('a', 50), false);
  assert.equal(b.balance('k'), 30);
  assert.ok(s.spin('a', 25));
  tick(SPIN_MS);
  // Away from it, no spinning it.
  s.away('a');
  assert.equal(s.spin('a', 5), false);
});

test('the jackpot: won by three stars, a share by the bet, back to its seed at least, and shared by every machine', () => {
  const stars = [stopFor(0, 'star'), stopFor(1, 'star'), stopFor(2, 'star')];
  const { s, b, tick } = casino({ stops: [[1, 1, 1], [1, 1, 1], stars, stars] });
  s.join('a', 0, 'Ann', 'ka');
  s.join('b', 3, 'Bob', 'kb');
  assert.ok(s.spin('a', 100));
  assert.ok(s.spin('b', 100));
  const pot = JACKPOT_SEED + 200 * JACKPOT_SHARE;
  assert.equal(s.state().jackpot, Math.floor(pot));
  tick(SPIN_MS);
  // Bob hits it at half the biggest bet: half the pot.
  assert.ok(s.spin('b', 50));
  const won = jackpotWin(pot + 50 * JACKPOT_SHARE, 50);
  const spin = s.state().machines[3].spin!;
  assert.equal(spin.jackpot, won);
  // The other lines pay as well (cherries under the stars).
  assert.equal(spin.win, won + evaluate(stars, 50).win);
  assert.ok(b.log.includes(`slots.jackpot ${spin.win}`));
  assert.deepEqual({ ...s.state().last, at: 0 }, { name: 'Bob', amount: won, machine: 3, at: 0 });
  assert.equal(s.state().jackpot, JACKPOT_SEED);
  // Ann hits it at the biggest bet: all of it.
  tick(SPIN_MS);
  assert.ok(s.spin('a', 100));
  assert.equal(s.state().machines[0].spin!.jackpot, Math.floor(JACKPOT_SEED + 100 * JACKPOT_SHARE));
});

test('winnings wait for the reels, and are paid when the office stops; the jackpot is kept across restarts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'slots-'));
  try {
    const sevens = [stopFor(0, 'seven'), stopFor(1, 'seven'), stopFor(2, 'seven')];
    const b = bank();
    const waiting: (() => void)[] = [];
    let r = 0;
    const s = new Slots(6, b, { dataDir: dir, random: () => sevens[r++ % 3], later: (fn) => waiting.push(fn) });
    s.join('a', 0, 'Ann', 'k');
    assert.ok(s.spin('a', 100));
    assert.deepEqual(b.log, ['slots.bet 100']);
    s.flush();
    assert.equal(b.log.length, 2);
    // The timer firing later doesn't pay it twice.
    for (const fn of waiting) fn();
    assert.equal(b.log.length, 2);
    const again = new Slots(6, bank(), { dataDir: dir });
    assert.equal(again.state().jackpot, Math.floor(JACKPOT_SEED + 100 * JACKPOT_SHARE));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
