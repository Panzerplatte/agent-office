import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { Market } from '../src/server/market.js';
import { START_CHIPS } from '../src/shared/chips.js';
import { CASINO_ROOM, MARKET_SCREEN, TRADING_DESK, casinoFootprints, casinoWalkable } from '../src/shared/casino.js';
import {
  BASE_PRICE,
  HISTORY,
  LEVERAGES,
  MAX_LEVERAGE,
  MAX_OPEN,
  MAX_PRICE,
  MAX_STAKE,
  MIN_PRICE,
  MIN_STAKE,
  PHASE_TICKS,
  RECENT,
  SPREAD,
  autoClose,
  entryPrice,
  leverageOk,
  liquidated,
  liquidationPrice,
  modelOk,
  openingFee,
  orderOk,
  payout,
  profit,
  stakeOk,
  startModel,
  step,
  trendOf,
  value,
  type MarketModel,
  type MarketPosition,
  type Trend,
} from '../src/shared/market.js';

const A = 'browser:aaaaaaaaaaaaaaaa';
const B = 'browser:bbbbbbbbbbbbbbbb';

function run(seed: number, ticks: number): MarketModel[] {
  const out: MarketModel[] = [];
  let m = startModel(seed);
  for (let i = 0; i < ticks; i++) out.push((m = step(m)));
  return out;
}

function bank(): Chips {
  return new Chips(mkdtempSync(path.join(tmpdir(), 'market-')), { saveAfter: 0 });
}

/** A position opened at exactly `entry` (no spread), for the P/L sums. */
function pos(side: 'long' | 'short', lev: number, stake = 1000, entry = 100): MarketPosition {
  return { id: 1, side, lev, stake, entry, at: 0 };
}

// ---- The price -------------------------------------------------------------------------------------

test('the price stays positive and within its bounds, over many seeds and a long run', () => {
  for (const seed of [1, 2, 3, 42, 0xdeadbeef]) {
    let lo = Infinity;
    let hi = -Infinity;
    let m = startModel(seed);
    for (let i = 0; i < 200_000; i++) {
      m = step(m);
      assert.ok(Number.isFinite(m.price) && m.price > 0, `price ${m.price}`);
      lo = Math.min(lo, m.price);
      hi = Math.max(hi, m.price);
    }
    assert.ok(lo >= MIN_PRICE && hi <= MAX_PRICE, `seed ${seed}: ${lo}..${hi}`);
    assert.ok(modelOk(m));
  }
});

test('the price is drawn back towards its base: far off it, new phases lean the other way', () => {
  // Over a long run most of the time is spent within a factor of 4 of the base, not stuck at a wall.
  const ms = run(7, 300_000);
  const near = ms.filter((m) => m.price > BASE_PRICE / 4 && m.price < BASE_PRICE * 4).length;
  assert.ok(near / ms.length > 0.8, `near the base ${near / ms.length}`);
});

test('the same seed makes the same chart; another seed another', () => {
  const a = run(1234, 2000).map((m) => m.price);
  const b = run(1234, 2000).map((m) => m.price);
  const c = run(1235, 2000).map((m) => m.price);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  // And a model carried on from the middle (as after a restart) goes on just the same.
  const half = run(1234, 1000)[999];
  let m = structuredClone(half);
  for (let i = 1000; i < 2000; i++) m = step(m);
  assert.equal(m.price, a[1999]);
});

test('trends change now and then: up, down and sideways phases of random length and strength', () => {
  const ms = run(99, 50_000);
  const kinds = new Set<Trend>();
  const lengths: number[] = [];
  const drifts = new Set<number>();
  let len = 0;
  for (let i = 1; i < ms.length; i++) {
    len++;
    if (ms[i].phase.left > ms[i - 1].phase.left) {
      kinds.add(ms[i].phase.kind);
      drifts.add(ms[i].phase.drift);
      lengths.push(len);
      len = 0;
    }
  }
  assert.deepEqual([...kinds].sort(), ['down', 'flat', 'up']);
  assert.ok(lengths.length > 100, `${lengths.length} phases`);
  assert.ok(Math.min(...lengths) >= PHASE_TICKS[0] && Math.max(...lengths) <= PHASE_TICKS[1] + 1, `${Math.min(...lengths)}..${Math.max(...lengths)}`);
  assert.ok(new Set(lengths).size > 20, 'lengths vary');
  assert.ok(drifts.size > 50, 'strengths vary');
  // An up phase goes up on the whole, a down phase down.
  const moved: Record<Trend, number[]> = { up: [], down: [], flat: [] };
  for (let i = 1; i < ms.length; i++) moved[ms[i].phase.kind].push(Math.log(ms[i].price / ms[i - 1].price));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean(moved.up) > 0 && mean(moved.down) < 0, `${mean(moved.up)} ${mean(moved.down)}`);
});

test('now and then the price jumps', () => {
  const ms = run(5, 20_000);
  const jumps = ms.slice(1).filter((m, i) => Math.abs(Math.log(m.price / ms[i].price)) > 0.012 + 3 * 0.0045);
  assert.ok(jumps.length > 20, `${jumps.length} jumps`);
});

test('trendOf reads the chart: up, down or flat over the last minute', () => {
  assert.equal(trendOf([100, 101]), 'up');
  assert.equal(trendOf([100, 99]), 'down');
  assert.equal(trendOf([100, 100.1]), 'flat');
  assert.equal(trendOf([]), 'flat');
});

// ---- Profit and loss ---------------------------------------------------------------------------------

test('P/L is stake × leverage × the price change, for long and short at every leverage', () => {
  assert.deepEqual(LEVERAGES, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const lev of LEVERAGES) {
    for (const change of [-0.05, -0.01, 0, 0.02, 0.08]) {
      const price = 100 * (1 + change);
      const long = profit(pos('long', lev), price);
      const short = profit(pos('short', lev), price);
      assert.ok(Math.abs(long - 1000 * lev * change) < 1e-6, `long ${lev}× ${change}: ${long}`);
      assert.ok(Math.abs(short + 1000 * lev * change) < 1e-6, `short ${lev}× ${change}: ${short}`);
      // What closing pays: the stake and that, down to the chip, and never under 0.
      assert.equal(payout(pos('long', lev), price), Math.max(0, Math.floor(1000 + 1000 * lev * change + 1e-9)));
    }
  }
  // +2 % at 10× doubles a fifth of the stake: 1000 → 1200.
  assert.equal(payout(pos('long', 10), 102), 1200);
  assert.equal(payout(pos('short', 10), 98), 1200);
});

test('a loss never goes past the stake', () => {
  for (const lev of LEVERAGES) {
    // Past the liquidation price (at 1× a Long only gets there at 0, and the price never does).
    const far = lev === 1 ? 0 : liquidationPrice(pos('long', lev)) - 5;
    assert.equal(value(pos('long', lev), far), 0);
    assert.equal(payout(pos('long', lev), far), 0);
    assert.equal(value(pos('short', lev), 10_000), 0);
    assert.ok(payout(pos('long', lev), MIN_PRICE) >= 0);
  }
});

test('liquidation: exactly at −100 % of the stake, not a hair before', () => {
  for (const lev of LEVERAGES) {
    for (const side of ['long', 'short'] as const) {
      const p = pos(side, lev);
      const liq = liquidationPrice(p);
      assert.ok(Math.abs(liq - (side === 'long' ? 100 * (1 - 1 / lev) : 100 * (1 + 1 / lev))) < 1e-9);
      assert.equal(liquidated(p, liq), true, `${side} ${lev}× at ${liq}`);
      assert.equal(autoClose(p, liq), 'liquidated');
      const before = side === 'long' ? liq + 0.01 : liq - 0.01;
      assert.equal(liquidated(p, before), false, `${side} ${lev}× at ${before}`);
      assert.equal(autoClose(p, before), null);
    }
  }
  // −10 % at 10×.
  assert.ok(Math.abs(liquidationPrice(pos('long', 10)) - 90) < 1e-9);
  assert.ok(Math.abs(liquidationPrice(pos('short', 10)) - 110) < 1e-9);
});

test('take-profit and stop-loss close at their share of the stake', () => {
  const p = { ...pos('long', 5), tp: 50, sl: 20 };
  // +10 % at 5× is +50 % of the stake; −4 % is −20 %.
  assert.equal(autoClose(p, 109.9), null);
  assert.equal(autoClose(p, 110), 'tp');
  assert.equal(autoClose(p, 96.1), null);
  assert.equal(autoClose(p, 96), 'sl');
  const s = { ...pos('short', 2), tp: 10 };
  assert.equal(autoClose(s, 95), 'tp');
});

test('the spread: you open a little worse than the price shown, the house’s small edge', () => {
  assert.ok(Math.abs(entryPrice(100, 'long') - 100 * (1 + SPREAD)) < 1e-9);
  assert.ok(Math.abs(entryPrice(100, 'short') - 100 * (1 - SPREAD)) < 1e-9);
  // Closing straight away loses about stake × leverage × SPREAD.
  for (const lev of LEVERAGES) {
    const fee = openingFee(1000, lev, 'long');
    assert.ok(fee > 0 && Math.abs(fee - 1000 * lev * SPREAD) < 1000 * lev * SPREAD * 0.01, `${lev}×: ${fee}`);
    const p = { ...pos('long', lev), entry: entryPrice(100, 'long') };
    assert.ok(Math.abs(1000 - value(p, 100) - fee) < 1e-9);
  }
});

// ---- Orders ------------------------------------------------------------------------------------------

test('stake, leverage and order validation', () => {
  assert.ok(stakeOk(MIN_STAKE) && stakeOk(MAX_STAKE) && stakeOk(500));
  for (const bad of [0, -5, MAX_STAKE + 1, 1.5, NaN, '100', null]) assert.equal(stakeOk(bad), false, String(bad));
  assert.ok(leverageOk(1) && leverageOk(MAX_LEVERAGE));
  for (const bad of [0, 11, 2.5, '3']) assert.equal(leverageOk(bad), false, String(bad));
  assert.deepEqual(orderOk({ stake: 100, side: 'long', lev: 3 }), { stake: 100, side: 'long', lev: 3 });
  assert.deepEqual(orderOk({ stake: 100, side: 'short', lev: 10, tp: 50, sl: 20, junk: 1 }), { stake: 100, side: 'short', lev: 10, tp: 50, sl: 20 });
  assert.equal(orderOk({ stake: 100, side: 'up', lev: 3 }), null);
  assert.equal(orderOk({ stake: 100, side: 'long', lev: 3, sl: 100 }), null);
  assert.equal(orderOk({ stake: 100, side: 'long', lev: 3, tp: 0 }), null);
  assert.equal(orderOk({ stake: 20_000, side: 'long', lev: 3 }), null);
  assert.equal(orderOk(null), null);
});

// ---- The desk ----------------------------------------------------------------------------------------

test('opening takes the stake (never more than you have), closing pays the value through the chips', () => {
  const chips = bank();
  chips.award(A, 50_000, 'test');
  const m = new Market(chips, { seed: 1 });
  const start = chips.balance(A);
  assert.equal(m.open(A, 'Ann', { stake: 0, side: 'long', lev: 2 }), null);
  assert.equal(m.open(A, 'Ann', { stake: MAX_STAKE + 1, side: 'long', lev: 2 }), null);
  assert.equal(m.open(A, 'Ann', { stake: 100, side: 'long', lev: 11 }), null);
  assert.equal(chips.balance(A), start);
  const p = m.open(A, 'Ann', { stake: 1000, side: 'long', lev: 4 })!;
  assert.ok(p);
  assert.equal(chips.balance(A), start - 1000);
  assert.ok(Math.abs(p.entry - m.price * (1 + SPREAD)) < 1e-9);
  assert.deepEqual(m.positions(A), [p]);
  assert.deepEqual(m.positions(B), []);
  assert.equal(m.state().longs, 1);
  // Somebody else can't close it.
  assert.equal(m.close(B, p.id), null);
  for (let i = 0; i < 5; i++) m.tick();
  const price = m.price;
  const closed = m.close(A, p.id)!;
  assert.equal(closed.close.why, 'close');
  assert.equal(closed.close.won, payout(p, price));
  assert.equal(chips.balance(A), start - 1000 + payout(p, price));
  assert.deepEqual(m.positions(A), []);
  assert.equal(m.state().recent[0].name, 'Ann');
  // Closed once is closed.
  assert.equal(m.close(A, p.id), null);
});

test("a stake can't be more than the balance", () => {
  const chips = bank();
  const m = new Market(chips, { seed: 1 });
  assert.equal(chips.balance(B), START_CHIPS);
  assert.equal(m.open(B, 'Bob', { stake: START_CHIPS + 1, side: 'short', lev: 1 }), null);
  assert.ok(m.open(B, 'Bob', { stake: START_CHIPS, side: 'short', lev: 1 }));
  assert.equal(chips.balance(B), 0);
  assert.equal(m.open(B, 'Bob', { stake: 1, side: 'short', lev: 1 }), null);
});

test('no more than MAX_OPEN positions at once', () => {
  const chips = bank();
  chips.award(A, 50_000, 'test');
  const m = new Market(chips, { seed: 1 });
  for (let i = 0; i < MAX_OPEN; i++) assert.ok(m.open(A, 'Ann', { stake: 10, side: 'long', lev: 1 }));
  assert.equal(m.open(A, 'Ann', { stake: 10, side: 'long', lev: 1 }), null);
});

test('the office liquidates on its own tick, at 0, and pays take-profits while you are away', () => {
  const chips = bank();
  chips.award(A, 50_000, 'test');
  const m = new Market(chips, { seed: 77 });
  const start = chips.balance(A);
  const up = m.open(A, 'Ann', { stake: 1000, side: 'long', lev: 10 })!;
  const down = m.open(A, 'Ann', { stake: 1000, side: 'short', lev: 10 })!;
  // One of them goes within a 10 % move, whichever way it goes first.
  const closed = [];
  for (let i = 0; i < 100_000 && closed.length < 2; i++) closed.push(...m.tick());
  assert.equal(closed.length, 2);
  const first = closed[0];
  assert.equal(first.close.why, 'liquidated');
  assert.equal(first.close.won, 0);
  const liqAt = liquidationPrice(first.position);
  assert.ok(first.position.side === 'long' ? first.close.price <= liqAt : first.close.price >= liqAt);
  // The other ran on until it was liquidated too (no take-profit): both stakes are gone, no more.
  assert.ok(closed.every((c) => c.close.why === 'liquidated'));
  assert.deepEqual(new Set(closed.map((c) => c.position.id)), new Set([up.id, down.id]));
  assert.equal(chips.balance(A), start - 2000);

  // A take-profit pays by itself.
  const tp = m.open(A, 'Ann', { stake: 1000, side: 'long', lev: 10, tp: 5 })!;
  const sl = m.open(A, 'Ann', { stake: 1000, side: 'short', lev: 10, sl: 5 })!;
  const done = [];
  for (let i = 0; i < 100_000 && done.length < 2; i++) done.push(...m.tick());
  const why = Object.fromEntries(done.map((c) => [c.position.id, c.close]));
  assert.ok(['tp', 'liquidated'].includes(why[tp.id].why));
  assert.ok(['sl', 'liquidated'].includes(why[sl.id].why));
  for (const c of done) if (c.close.why !== 'liquidated') assert.equal(c.close.won, payout(c.position, c.close.price));
});

test('the chart keeps the last HISTORY prices and the strip the last RECENT closes', () => {
  const chips = bank();
  chips.award(A, 50_000, 'test');
  const m = new Market(chips, { seed: 3 });
  for (let i = 0; i < HISTORY + 50; i++) m.tick();
  assert.equal(m.state().history.length, HISTORY);
  assert.equal(m.state().history.at(-1), m.price);
  for (let i = 0; i < RECENT + 3; i++) {
    const p = m.open(A, 'Ann', { stake: 10, side: 'long', lev: 1 })!;
    m.close(A, p.id);
  }
  assert.equal(m.state().recent.length, RECENT);
});

test('after a restart the price, the chart and open positions go on from where they were', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'market-file-'));
  const chips = bank();
  chips.award(A, 50_000, 'test');
  const m1 = new Market(chips, { dataDir: dir, seed: 11 });
  for (let i = 0; i < 40; i++) m1.tick();
  const p = m1.open(A, 'Ann', { stake: 500, side: 'short', lev: 2, tp: 100 })!;
  m1.flush();
  const before = m1.state();
  const model = m1.snapshot();

  const m2 = new Market(chips, { dataDir: dir, seed: 999 });
  assert.equal(m2.price, before.price);
  assert.deepEqual(m2.state().history, before.history);
  assert.deepEqual(m2.positions(A), [p]);
  // It goes on exactly as it would have.
  m2.tick();
  assert.equal(m2.price, step(model).price);
  // And new positions don't reuse an id.
  const q = m2.open(A, 'Ann', { stake: 10, side: 'long', lev: 1 })!;
  assert.ok(q.id > p.id);
  m2.flush();
});

test('the price runs nonstop: every tick moves the model on, whether anyone trades or not', () => {
  const m = new Market(bank(), { seed: 5 });
  const n = m.n;
  for (let i = 0; i < 10; i++) m.tick();
  assert.equal(m.n, n + 10);
});

// ---- Where it stands --------------------------------------------------------------------------------

test('the desk and its screen are on the east wall, clear of everything else, with room to stand at it', () => {
  const D = TRADING_DESK;
  const S = MARKET_SCREEN;
  assert.ok(S.x > CASINO_ROOM.maxX - 0.2, 'the screen is on the east wall');
  assert.ok(S.z - S.width / 2 > CASINO_ROOM.minZ + 2 && S.z + S.width / 2 < 1, 'between the cashier and the bar');
  assert.equal(casinoWalkable(D.x, D.z, 0.1), false, "you can't walk through the desk");
  assert.ok(casinoWalkable(D.x - D.depth / 2 - 0.9, D.z), 'you can stand in front of it');
  // Its footprint overlaps nobody else's.
  const all = casinoFootprints();
  const desk = all.find((f) => f.minX === D.x - D.depth / 2 && f.minZ === D.z - D.length / 2)!;
  assert.ok(desk);
  for (const f of all) {
    if (f === desk) continue;
    const overlap = f.minX < desk.maxX && f.maxX > desk.minX && f.minZ < desk.maxZ && f.maxZ > desk.minZ;
    assert.equal(overlap, false, JSON.stringify(f));
  }
  // There's a way round it: you can walk between it and the wall.
  assert.ok(casinoWalkable(D.x + D.depth / 2 + 0.6, D.z), 'behind the desk');
});

test('onLost hears what a losing close or a liquidation lost, and nothing for a win; onFee the fee on every open', () => {
  const chips = bank();
  chips.award(A, 50_000, 'test');
  const lost: [string, number][] = [];
  const fees: number[] = [];
  const m = new Market(chips, { seed: 21, onLost: (w, n) => lost.push([w, n]), onFee: (_w, f) => fees.push(f) });
  // Closed straight away: the spread makes it a small loss.
  const p = m.open(A, 'Ann', { stake: 1000, side: 'long', lev: 10 })!;
  assert.ok(Math.abs(fees[0] - openingFee(1000, 10, 'long')) < 1e-9);
  const c = m.close(A, p.id)!;
  assert.ok(c.close.won < 1000);
  assert.deepEqual(lost, [[A, 1000 - c.close.won]]);
  // Liquidated: the whole stake.
  lost.length = 0;
  const q = m.open(A, 'Ann', { stake: 700, side: 'short', lev: 10 })!;
  const r = m.open(A, 'Ann', { stake: 300, side: 'long', lev: 10, tp: 5 })!;
  const closed = [];
  for (let i = 0; i < 100_000 && closed.length < 2; i++) closed.push(...m.tick());
  for (const x of closed) {
    const heard = lost.filter(([, n]) => n === x.position.stake - x.close.won);
    if (x.close.won >= x.position.stake) assert.ok(x.position.id === r.id, 'a win');
    else assert.equal(heard.length, 1);
  }
  const liq = closed.find((x) => x.close.why === 'liquidated');
  assert.ok(liq, 'one was liquidated');
  assert.ok(lost.some(([w, n]) => w === A && n === liq.position.stake));
  // A win (the take-profit) told it nothing.
  const win = closed.find((x) => x.close.won >= x.position.stake);
  assert.ok(win, 'one won');
  assert.equal(lost.length, closed.length - 1);
  assert.ok(q && r);
});
