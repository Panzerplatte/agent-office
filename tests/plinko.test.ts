import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { Plinko } from '../src/server/plinko.js';
import { START_CHIPS } from '../src/shared/chips.js';
import { CASINO_ROOM, PLINKO_MACHINE, casinoWalkable } from '../src/shared/casino.js';
import {
  DROP_GAP,
  MAX_BALLS,
  MAX_BET,
  MAX_ROWS,
  MAX_YOURS,
  MIN_BET,
  MIN_ROWS,
  RECENT,
  RISKS,
  ROW_CHOICES,
  betOk,
  dropOk,
  expectedReturn,
  fallMs,
  multipliers,
  pathOk,
  payout,
  slotChance,
  slotOf,
  type PlinkoPath,
} from '../src/shared/plinko.js';

const A = 'browser:aaaaaaaaaaaaaaaa';
const B = 'browser:bbbbbbbbbbbbbbbb';

// ---- The tables --------------------------------------------------------------------------------------

test('there is a board for every rows (8 to 16) and risk, with rows + 1 slots, the same both ways', () => {
  assert.deepEqual(ROW_CHOICES, [8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(RISKS, ['low', 'medium', 'high']);
  for (const rows of ROW_CHOICES) {
    for (const risk of RISKS) {
      const m = multipliers(rows, risk);
      assert.equal(m.length, rows + 1, `${rows} ${risk}`);
      assert.deepEqual([...m].reverse(), [...m], `${rows} ${risk} is symmetrical`);
      // Highest at the edges, going down to the middle.
      for (let k = 1; k <= rows / 2; k++) assert.ok(m[k] <= m[k - 1], `${rows} ${risk}: slot ${k} pays no more than ${k - 1}`);
      assert.ok(m[Math.floor(rows / 2)] < 1, `${rows} ${risk}: the middle pays under 1×`);
      assert.ok(m[0] > 1, `${rows} ${risk}: the edges pay over 1×`);
      for (const x of m) assert.ok(x > 0 && Math.round(x * 100) / 100 === x, `${rows} ${risk}: ${x} is a positive multiplier, two decimals at most`);
    }
  }
  assert.throws(() => multipliers(7, 'low'));
  assert.throws(() => multipliers(17, 'high'));
});

test('every table gives back about 99 % in the long run (the house keeps about 1 %)', () => {
  for (const rows of ROW_CHOICES) {
    for (const risk of RISKS) {
      const back = expectedReturn(rows, risk);
      assert.ok(Math.abs(back - 0.99) < 0.003, `${rows} rows at ${risk} risk: ${(back * 100).toFixed(2)} % back`);
    }
  }
});

test('more risk means bigger edges and a smaller middle', () => {
  for (const rows of ROW_CHOICES) {
    const [low, medium, high] = RISKS.map((r) => multipliers(rows, r));
    assert.ok(low[0] < medium[0] && medium[0] < high[0], `${rows}: the edge`);
    const mid = Math.floor(rows / 2);
    assert.ok(low[mid] >= medium[mid] && medium[mid] >= high[mid], `${rows}: the middle`);
  }
});

test('the slots are as likely as a coin tossed once a row says (binomial), adding up to 1', () => {
  for (const rows of ROW_CHOICES) {
    let sum = 0;
    for (let k = 0; k <= rows; k++) sum += slotChance(rows, k);
    assert.ok(Math.abs(sum - 1) < 1e-12);
    assert.equal(slotChance(rows, 0), 2 ** -rows);
    assert.equal(slotChance(rows, -1), 0);
    assert.equal(slotChance(rows, rows + 1), 0);
  }
  assert.equal(slotChance(8, 4), 70 / 256);
});

test('the expected return worked out by hand matches: 8 rows, low risk', () => {
  const m = multipliers(8, 'low');
  const ways = [1, 8, 28, 56, 70, 56, 28, 8, 1];
  const back = ways.reduce((s, w, k) => s + w * m[k], 0) / 256;
  assert.ok(Math.abs(back - expectedReturn(8, 'low')) < 1e-12);
  assert.ok(Math.abs(back - 0.98984375) < 1e-9);
});

// ---- Payouts and bets --------------------------------------------------------------------------------

test('a ball pays bet × its multiplier, down to the whole chip', () => {
  assert.equal(payout(100, 5.6), 560);
  assert.equal(payout(100, 0.2), 20);
  assert.equal(payout(1, 0.2), 0);
  assert.equal(payout(3, 0.5), 1);
  assert.equal(payout(7, 1.1), 7);
  assert.equal(payout(10_000, 1000), 10_000_000);
  assert.equal(payout(33, 8.1), 267);
  // No floating-point slip: 0.29 × 100 is 29, not 28.999….
  assert.equal(payout(100, 0.29), 29);
  assert.equal(payout(1000, 1.1), 1100);
});

test('bets are whole chips from 1 to 10,000; rows 8 to 16; risk low, medium or high', () => {
  for (const ok of [MIN_BET, 1, 50, 9999, MAX_BET]) assert.ok(betOk(ok), String(ok));
  for (const bad of [0, -1, 0.5, 10_001, NaN, Infinity, '100', null, undefined, 2 ** 53]) assert.ok(!betOk(bad), String(bad));
  assert.ok(dropOk({ bet: 100, rows: 16, risk: 'medium' }));
  assert.ok(dropOk({ bet: 1, rows: MIN_ROWS, risk: 'low' }));
  assert.ok(dropOk({ bet: MAX_BET, rows: MAX_ROWS, risk: 'high' }));
  for (const bad of [
    null,
    'drop',
    { bet: 100, rows: 7, risk: 'low' },
    { bet: 100, rows: 17, risk: 'low' },
    { bet: 100, rows: 12.5, risk: 'low' },
    { bet: 100, rows: '12', risk: 'low' },
    { bet: 100, rows: 12, risk: 'extreme' },
    { bet: 100, rows: 12 },
    { bet: 0, rows: 12, risk: 'low' },
    { bet: 10_001, rows: 12, risk: 'low' },
    { bet: 1.5, rows: 12, risk: 'low' },
  ])
    assert.ok(!dropOk(bad), JSON.stringify(bad));
});

test('a path lands in the slot of how many times it went right', () => {
  assert.equal(slotOf([0, 0, 0, 0, 0, 0, 0, 0]), 0);
  assert.equal(slotOf([1, 1, 1, 1, 1, 1, 1, 1]), 8);
  assert.equal(slotOf([1, 0, 1, 0, 0, 1, 0, 0, 1]), 4);
  assert.ok(pathOk([0, 1, 1, 0, 0, 1, 0, 1], 8));
  assert.ok(!pathOk([0, 1, 2, 0, 0, 1, 0, 1], 8));
  assert.ok(!pathOk([0, 1], 8));
});

test('a ball falls longer the more rows the board has', () => {
  for (const rows of ROW_CHOICES.slice(1)) assert.ok(fallMs(rows) > fallMs(rows - 1));
  assert.ok(fallMs(MIN_ROWS) >= 1000 && fallMs(MAX_ROWS) <= 5000);
});

// ---- The machine -------------------------------------------------------------------------------------

function bank() {
  return new Chips(mkdtempSync(path.join(tmpdir(), 'plinko-')), { saveAfter: 0 });
}

/** A Plinko machine on a fake clock, with paths from `paths` (in turn) or all left. */
function machine(chips = bank(), paths: PlinkoPath[] = []) {
  let now = 1_000_000;
  const p = new Plinko(chips, { now: () => now, path: (rows) => paths.shift() ?? Array(rows).fill(0) });
  return { p, chips, at: () => now, go: (ms: number) => (now += ms) };
}

test('a drop takes the bet there and then, and pays bet × the slot when the ball lands', () => {
  const path: PlinkoPath = [1, 1, 1, 1, 1, 1, 1, 1];
  const { p, chips, go } = machine(bank(), [path]);
  const ball = p.drop('peer-a', A, 'Ann', { bet: 100, rows: 8, risk: 'medium' }, '#ff0000');
  assert.ok(ball);
  assert.equal(ball.slot, 8);
  assert.equal(ball.m, 13);
  assert.equal(ball.won, 1300);
  assert.deepEqual(ball.path, path);
  assert.equal(ball.age, 0);
  assert.equal(ball.name, 'Ann');
  assert.equal(ball.color, '#ff0000');
  assert.equal(ball.peer, 'peer-a');
  assert.ok(!('wallet' in ball), "nobody's wallet goes out");
  assert.equal(chips.balance(A), START_CHIPS - 100, 'the bet is taken on the drop');
  assert.equal(chips.ledger(A)[0].reason, 'plinko.bet');
  // Not paid while it falls.
  go(fallMs(8) - 1);
  assert.deepEqual(p.tick(), []);
  assert.equal(chips.balance(A), START_CHIPS - 100);
  assert.equal(p.state().balls.length, 1);
  assert.equal(p.state().balls[0].age, fallMs(8) - 1, 'a page coming down sees how far it has got');
  go(1);
  const landed = p.tick();
  assert.equal(landed.length, 1);
  assert.equal(landed[0].won, 1300);
  assert.equal(chips.balance(A), START_CHIPS - 100 + 1300);
  assert.equal(chips.ledger(A)[0].reason, 'plinko.win');
  assert.equal(p.state().balls.length, 0);
  assert.equal(p.state().recent[0].m, 13);
  assert.equal(p.nextAt(), Infinity);
});

test('a ball in the middle pays back less than the bet, and a 0-chip payout pays nothing', () => {
  const { p, chips, go } = machine(bank(), [
    [1, 0, 1, 0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1, 0, 1, 0],
  ]);
  chips.award(A, 1, 'test');
  p.drop('x', A, 'Ann', { bet: 1000, rows: 8, risk: 'high' });
  go(DROP_GAP);
  const tiny = p.drop('x', A, 'Ann', { bet: 1, rows: 8, risk: 'high' });
  assert.equal(tiny?.won, 0);
  go(fallMs(8));
  p.tick();
  assert.equal(chips.balance(A), START_CHIPS + 1 - 1000 - 1 + 200);
  assert.equal(chips.ledger(A).filter((e) => e.reason === 'plinko.win').length, 1, 'no ledger line for nothing');
});

test('a drop is turned down for a bad bet, rows or risk, or more than you have', () => {
  const { p, chips } = machine();
  for (const bad of [{ bet: 0, rows: 8, risk: 'low' }, { bet: 10_001, rows: 8, risk: 'low' }, { bet: 10, rows: 20, risk: 'low' }, { bet: 10, rows: 8, risk: 'max' }, null, 'x'])
    assert.equal(p.drop('x', A, 'Ann', bad), null, JSON.stringify(bad));
  assert.equal(p.drop('x', A, 'Ann', { bet: START_CHIPS + 1, rows: 8, risk: 'low' }), null, 'never more than the balance');
  assert.equal(chips.balance(A), START_CHIPS, 'nothing taken');
  assert.equal(p.state().balls.length, 0);
  // All of it is fine.
  assert.ok(p.drop('x', A, 'Ann', { bet: START_CHIPS, rows: 8, risk: 'low' }));
  assert.equal(chips.balance(A), 0);
});

test('high rollers bet up to 10,000 a ball if they have it', () => {
  const chips = bank();
  chips.award(A, 20_000, 'test');
  const { p, go } = machine(chips);
  assert.ok(p.drop('x', A, 'Ann', { bet: MAX_BET, rows: 16, risk: 'high' }));
  go(DROP_GAP);
  assert.equal(p.drop('x', A, 'Ann', { bet: MAX_BET + 1, rows: 16, risk: 'high' }), null);
  assert.equal(chips.balance(A), START_CHIPS + 20_000 - MAX_BET);
});

test('several balls fall at once, each landing in its own time, but not too many and not too fast', () => {
  const chips = bank();
  chips.award(A, 100_000, 'test');
  const { p, go } = machine(chips);
  assert.ok(p.drop('x', A, 'Ann', { bet: 10, rows: 16, risk: 'low' }));
  assert.equal(p.drop('x', A, 'Ann', { bet: 10, rows: 16, risk: 'low' }), null, 'too soon after the last');
  assert.ok(p.drop('y', B, 'Bob', { bet: 10, rows: 8, risk: 'low' }), 'someone else can drop at the same moment');
  go(DROP_GAP);
  for (let i = 1; i < MAX_YOURS; i++) {
    assert.ok(p.drop('x', A, 'Ann', { bet: 10, rows: 16, risk: 'low' }), `ball ${i + 1}`);
    go(DROP_GAP);
  }
  assert.equal(p.drop('x', A, 'Ann', { bet: 10, rows: 16, risk: 'low' }), null, `no more than ${MAX_YOURS} falling`);
  assert.equal(p.state().balls.length, MAX_YOURS + 1);
  // Bob's 8-row ball lands first, Ann's in the order they went.
  assert.equal(p.nextAt(), 1_000_000 + fallMs(8));
  go(fallMs(16));
  const landed = p.tick();
  assert.ok(landed.length >= 2 && landed[0].name === 'Bob');
  // Once some have landed, there's room again.
  assert.ok(p.drop('x', A, 'Ann', { bet: 10, rows: 16, risk: 'low' }));
});

test('the whole machine takes no more than MAX_BALLS at once', () => {
  const chips = bank();
  const { p, go } = machine(chips);
  let n = 0;
  for (let i = 0; i < MAX_BALLS + 10; i++) {
    const id = `browser:${String(i).padStart(16, '0')}`;
    if (p.drop(`p${i}`, id, `P${i}`, { bet: 1, rows: 16, risk: 'low' })) n++;
    go(1);
  }
  assert.equal(n, MAX_BALLS);
});

test('the strip keeps the last RECENT landings, newest first', () => {
  const chips = bank();
  chips.award(A, 100_000, 'test');
  const { p, go } = machine(chips);
  for (let i = 0; i < RECENT + 5; i++) {
    p.drop('x', A, 'Ann', { bet: i + 1, rows: 8, risk: 'low' });
    go(fallMs(8));
    p.tick();
  }
  const recent = p.state().recent;
  assert.equal(recent.length, RECENT);
  assert.equal(recent[0].bet, RECENT + 5);
});

test('balls still falling when the office stops land and are paid', () => {
  const { p, chips } = machine(bank(), [[0, 0, 0, 0, 0, 0, 0, 0]]);
  p.drop('x', A, 'Ann', { bet: 100, rows: 8, risk: 'low' });
  assert.equal(chips.balance(A), START_CHIPS - 100);
  p.close();
  assert.equal(chips.balance(A), START_CHIPS - 100 + 560);
  assert.equal(p.state().balls.length, 0);
});

test('real paths are fair coin tosses: over many balls the slots come out binomial and the return near 99 %', () => {
  const chips = bank();
  chips.award(A, 10_000_000, 'test');
  let now = 0;
  const p = new Plinko(chips, { now: () => now });
  const rows = 12;
  const counts = Array(rows + 1).fill(0);
  const N = 20_000;
  for (let i = 0; i < N; i++) {
    const ball = p.drop('x', A, 'Ann', { bet: 1, rows, risk: 'low' })!;
    assert.ok(pathOk(ball.path, rows));
    assert.equal(ball.slot, slotOf(ball.path));
    counts[ball.slot]++;
    now += fallMs(rows);
    p.tick();
  }
  // The middle slot: C(12, 6) / 4096 ≈ 22.6 %, give or take a few standard deviations.
  const mid = counts[6] / N;
  assert.ok(Math.abs(mid - slotChance(rows, 6)) < 0.015, `middle slot ${mid}`);
  const mean = counts.reduce((s, c, k) => s + c * k, 0) / N;
  assert.ok(Math.abs(mean - rows / 2) < 0.08, `mean slot ${mean}`);
});

// ---- Where it stands --------------------------------------------------------------------------------

test('the machine stands in the main hall, with room to walk up to its front', () => {
  const P = PLINKO_MACHINE;
  assert.ok(P.x > CASINO_ROOM.minX + 4 && P.x < CASINO_ROOM.maxX - 4 && P.z > CASINO_ROOM.minZ + 4 && P.z < CASINO_ROOM.maxZ - 4, 'well off the walls');
  assert.equal(casinoWalkable(P.x, P.z, 0.1), false, "you can't walk through it");
  // It faces north (-z): you play from in front of it.
  assert.ok(casinoWalkable(P.x, P.z - P.depth / 2 - 1.1), 'you can stand in front of it');
});
