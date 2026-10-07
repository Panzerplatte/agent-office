// The trading desk, against the casino's east wall: one fictional stock, AGNT, whose price the office
// runs nonstop (see server/market.ts), a tick a second, whether anyone's watching or not, and the
// same for everyone. Players open positions on it with chips: Long (it'll go up) or Short (it'll go
// down), with leverage from 1× to 10×, and close them whenever they like. Here are the rules: how the
// price moves, what a position makes or loses, when it's liquidated, and what an order may be.

// ---- The price -------------------------------------------------------------------------------------

/** The stock's ticker, on the screen and the panel. */
export const SYMBOL = 'AGNT';
/** Where the price starts, and what it's drawn back towards when it's wandered far off. */
export const BASE_PRICE = 100;
/** The price never goes below or above these: it bounces off them. */
export const MIN_PRICE = 5;
export const MAX_PRICE = 2000;
/** How often the price moves (ms). */
export const TICK_MS = 1000;
/** How many ticks the chart keeps: the last 5 minutes. */
export const HISTORY = 300;

/** Which way a trend phase leans: up, down, or sideways. */
export type Trend = 'up' | 'down' | 'flat';
export const TRENDS: readonly Trend[] = ['up', 'down', 'flat'];

/**
 * A trend phase: which way it leans (`kind`), how far a tick drifts that way on average (`drift`, a
 * log return), how wild a tick is (`vol`, its standard deviation), and how many ticks it has left.
 * The office never tells anyone the phase: the chart shows it, as charts do, after the fact.
 */
export interface TrendPhase {
  kind: Trend;
  drift: number;
  vol: number;
  left: number;
}

/** How long a phase lasts (ticks): 20 seconds to 3 minutes. */
export const PHASE_TICKS = [20, 180] as const;
/** How far a trending tick drifts (a log return): 0.6 % to 3 % a minute. */
export const PHASE_DRIFT = [0.0001, 0.0005] as const;
/** How wild a tick is (the standard deviation of its log return): about 1 % to 3.5 % a minute. */
export const PHASE_VOL = [0.0012, 0.0045] as const;
/** How often a tick jumps (about every 3 minutes), and how far (either way). */
export const JUMP_CHANCE = 0.006;
export const JUMP_SIZE = [0.012, 0.045] as const;
/** Beyond this factor off BASE_PRICE, new phases lean back towards it. */
export const STRETCH = 2.5;

/**
 * The whole of the price model, all the office needs to go on from where it was (and saves): the
 * price, its random generator's state (`seed`), how many ticks it's run (`n`), and the phase.
 */
export interface MarketModel {
  price: number;
  seed: number;
  n: number;
  phase: TrendPhase;
}

/** A little random generator (mulberry32): the next uniform number in [0, 1) from `seed`, and the next seed. */
export function random(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** Draws from `seed` as the model goes: uniform numbers, and normal ones (Box–Muller). */
class Draw {
  constructor(public seed: number) {}
  next(): number {
    const [r, s] = random(this.seed);
    this.seed = s;
    return r;
  }
  between([lo, hi]: readonly [number, number]): number {
    return lo + this.next() * (hi - lo);
  }
  normal(): number {
    const u = Math.max(1e-12, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
}

/** The chances of a new phase going up, down or sideways at `price`: even near the base, leaning back towards it far off. */
export function trendOdds(price: number): Record<Trend, number> {
  if (price > BASE_PRICE * STRETCH) return { up: 0.15, down: 0.6, flat: 0.25 };
  if (price < BASE_PRICE / STRETCH) return { up: 0.6, down: 0.15, flat: 0.25 };
  return { up: 0.35, down: 0.35, flat: 0.3 };
}

function drawPhase(d: Draw, price: number): TrendPhase {
  const odds = trendOdds(price);
  const r = d.next();
  const kind: Trend = r < odds.up ? 'up' : r < odds.up + odds.down ? 'down' : 'flat';
  const left = Math.floor(d.between([PHASE_TICKS[0], PHASE_TICKS[1] + 1]));
  const strength = d.between(PHASE_DRIFT);
  const drift = kind === 'up' ? strength : kind === 'down' ? -strength : 0;
  // Sideways is calmer; a trend can be anything.
  const vol = d.between(PHASE_VOL) * (kind === 'flat' ? 0.7 : 1);
  return { kind, drift, vol, left };
}

/** A price as the office keeps it: to the cent. */
export function cents(p: number): number {
  return Math.round(p * 100) / 100;
}

/** A model just started from `seed`: at the base price, with a phase drawn. */
export function startModel(seed: number): MarketModel {
  const d = new Draw(seed >>> 0);
  const phase = drawPhase(d, BASE_PRICE);
  return { price: BASE_PRICE, seed: d.seed, n: 0, phase };
}

/**
 * The model one tick on. The price takes a step in log terms: the phase's drift, less vol² / 2 (so
 * on its own it's a fair game, neither way favoured beyond the trend), plus a normal random step of
 * the phase's size, and now and then a jump. It bounces off MIN_PRICE and MAX_PRICE, so it stays
 * positive and bounded whatever happens. When a phase runs out, the next is drawn: a new direction,
 * length, strength and wildness. Everything comes from `seed`, so the same seed makes the same chart.
 */
export function step(m: MarketModel): MarketModel {
  const d = new Draw(m.seed);
  let phase = m.phase.left > 0 ? m.phase : drawPhase(d, m.price);
  let r = phase.drift - (phase.vol * phase.vol) / 2 + phase.vol * d.normal();
  if (d.next() < JUMP_CHANCE) r += (d.next() < 0.5 ? -1 : 1) * d.between(JUMP_SIZE);
  const lo = Math.log(MIN_PRICE);
  const hi = Math.log(MAX_PRICE);
  let lp = Math.log(m.price) + r;
  if (lp > hi) lp = 2 * hi - lp;
  if (lp < lo) lp = 2 * lo - lp;
  const price = Math.min(MAX_PRICE, Math.max(MIN_PRICE, cents(Math.exp(lp))));
  phase = { ...phase, left: phase.left - 1 };
  return { price, seed: d.seed, n: m.n + 1, phase };
}

/** Whether `m` (from disk) is a model the office can go on from. */
export function modelOk(m: unknown): m is MarketModel {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  const p = o.phase as Record<string, unknown> | undefined;
  return (
    typeof o.price === 'number' &&
    o.price >= MIN_PRICE &&
    o.price <= MAX_PRICE &&
    Number.isInteger(o.seed) &&
    Number.isSafeInteger(o.n) &&
    !!p &&
    (TRENDS as readonly unknown[]).includes(p.kind) &&
    typeof p.drift === 'number' &&
    Number.isFinite(p.drift) &&
    typeof p.vol === 'number' &&
    Number.isFinite(p.vol) &&
    Number.isInteger(p.left)
  );
}

// ---- Positions -------------------------------------------------------------------------------------

/** Long bets on it going up, Short on it going down. */
export type Side = 'long' | 'short';
export const SIDES: readonly Side[] = ['long', 'short'];

/** The least and most one position can be opened with (high-roller stakes, see #82), never more than you have. */
export const MIN_STAKE = 1;
export const MAX_STAKE = 10_000;
/** The amounts the panel offers to click, smallest first. */
export const STAKE_CHOICES = [10, 50, 100, 500, 1000, 5000, 10_000] as const;
/** Leverage: from 1× (the stake moves with the price) to 10× (ten times as fast, both ways). */
export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 10;
export const LEVERAGES: readonly number[] = Array.from({ length: MAX_LEVERAGE - MIN_LEVERAGE + 1 }, (_, i) => MIN_LEVERAGE + i);
/**
 * The house's edge: you open at a price this much worse than the one shown (Long a little above it,
 * Short a little under), and close at the price shown. 0.1 %, so 1 % of the stake at 10×.
 */
export const SPREAD = 0.001;
/** How many positions one person can have open at once, and how many there can be altogether. */
export const MAX_OPEN = 10;
export const MAX_POSITIONS = 2000;
/** Take-profit and stop-loss, as a percentage of the stake: up to +1000 %, and down to −99 % (−100 % is liquidation). */
export const TP_MAX = 1000;
export const SL_MAX = 99;

/** What a page asks for to open a position: the stake, which way, the leverage, and its take-profit and stop-loss (% of the stake) if wanted. */
export interface MarketOrder {
  stake: number;
  side: Side;
  lev: number;
  tp?: number;
  sl?: number;
}

/** An open position, as its owner sees it: what it was opened with, at what price (`entry`, the spread in it) and when. */
export interface MarketPosition {
  id: number;
  side: Side;
  lev: number;
  stake: number;
  entry: number;
  at: number;
  tp?: number;
  sl?: number;
}

export function stakeOk(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= MIN_STAKE && n <= MAX_STAKE;
}

export function leverageOk(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_LEVERAGE && n <= MAX_LEVERAGE;
}

export function sideOk(s: unknown): s is Side {
  return s === 'long' || s === 'short';
}

const whole = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

/** An order from a page, checked: null unless the stake, side and leverage are within bounds, and the take-profit and stop-loss too if set. */
export function orderOk(v: unknown): MarketOrder | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!stakeOk(o.stake) || !sideOk(o.side) || !leverageOk(o.lev)) return null;
  const tp = o.tp ?? undefined;
  const sl = o.sl ?? undefined;
  if (tp !== undefined && !whole(tp, 1, TP_MAX)) return null;
  if (sl !== undefined && !whole(sl, 1, SL_MAX)) return null;
  return { stake: o.stake, side: o.side, lev: o.lev, ...(tp !== undefined ? { tp } : {}), ...(sl !== undefined ? { sl } : {}) };
}

/** The price a position opens at, `price` showing: the spread against you. */
export function entryPrice(price: number, side: Side): number {
  return side === 'long' ? price * (1 + SPREAD) : price * (1 - SPREAD);
}

/**
 * The house's edge on a trade, in chips: what opening `stake` at `lev` costs through the spread, the
 * position's loss the moment it opens (stake × leverage × SPREAD / (1 ± SPREAD)). The one place the
 * fee's worked out; the server takes it in Market.open (see its `onFee`).
 */
export function openingFee(stake: number, lev: number, side: Side): number {
  return -profit({ side, lev, stake, entry: entryPrice(1, side) }, 1);
}

/** What a position has made (or lost, under 0) at `price`: stake × leverage × the price's change since it opened, Short the other way round. Not floored at −stake: see value. */
export function profit(p: Pick<MarketPosition, 'side' | 'lev' | 'stake' | 'entry'>, price: number): number {
  const change = (price - p.entry) / p.entry;
  return p.stake * p.lev * (p.side === 'long' ? change : -change);
}

/** What a position's worth at `price`: the stake and what it's made, never less than 0 (never more than the stake can be lost). */
export function value(p: Pick<MarketPosition, 'side' | 'lev' | 'stake' | 'entry'>, price: number): number {
  return Math.max(0, p.stake + profit(p, price));
}

/** What closing it at `price` pays: its value down to the whole chip. */
export function payout(p: Pick<MarketPosition, 'side' | 'lev' | 'stake' | 'entry'>, price: number): number {
  return Math.floor(value(p, price) + 1e-9);
}

/** Where it's liquidated: the price at which it's lost the whole stake (Long 1/leverage under the entry, Short over it). */
export function liquidationPrice(p: Pick<MarketPosition, 'side' | 'lev' | 'entry'>): number {
  return p.side === 'long' ? p.entry * (1 - 1 / p.lev) : p.entry * (1 + 1 / p.lev);
}

/** Whether it's lost the whole stake at `price`: right at the liquidation price, or past it. */
export function liquidated(p: Pick<MarketPosition, 'side' | 'lev' | 'stake' | 'entry'>, price: number): boolean {
  return p.stake + profit(p, price) <= p.stake * 1e-9;
}

/** Why a position closed: you closed it, its take-profit or stop-loss did, or it was liquidated. */
export type CloseWhy = 'close' | 'tp' | 'sl' | 'liquidated';

/** Whether it closes by itself at `price`: liquidated, or hit its take-profit or stop-loss; null if it stays open. */
export function autoClose(p: MarketPosition, price: number): Exclude<CloseWhy, 'close'> | null {
  if (liquidated(p, price)) return 'liquidated';
  const made = profit(p, price);
  if (p.tp !== undefined && made >= (p.stake * p.tp) / 100 - 1e-9) return 'tp';
  if (p.sl !== undefined && made <= (-p.stake * p.sl) / 100 + 1e-9) return 'sl';
  return null;
}

/** A position that's closed, for the screen's strip of the latest: who, what it was, what it paid back, and why it closed. */
export interface MarketClose {
  name: string;
  color?: string;
  side: Side;
  lev: number;
  stake: number;
  won: number;
  price: number;
  why: CloseWhy;
}

/** How many closes the screen remembers. */
export const RECENT = 8;

/**
 * The desk as every page in the casino sees it: the stock, its price and tick count, the chart (the
 * last HISTORY prices, oldest first, one a tick), the latest closes, newest first, and how many
 * positions are open each way. Nobody's positions but your own (see `market.mine`).
 */
export interface MarketState {
  symbol: string;
  price: number;
  n: number;
  history: number[];
  recent: MarketClose[];
  longs: number;
  shorts: number;
}

export function emptyMarket(): MarketState {
  return { symbol: SYMBOL, price: BASE_PRICE, n: 0, history: [], recent: [], longs: 0, shorts: 0 };
}

/** How much the price has changed over the last `ticks` (a minute), or as far back as the chart goes: 0.012 is +1.2 %. */
export function changeOf(history: readonly number[], ticks = 60): number {
  if (history.length < 2) return 0;
  const last = history[history.length - 1];
  const before = history[Math.max(0, history.length - 1 - ticks)];
  return (last - before) / before;
}

/** How the chart's going: up or down over the last minute (by more than 0.2 %), else flat. */
export function trendOf(history: readonly number[], ticks = 60): Trend {
  const change = changeOf(history, ticks);
  return change > 0.002 ? 'up' : change < -0.002 ? 'down' : 'flat';
}

/** A price as the screen writes it: "104.37". */
export function priceText(p: number): string {
  return p.toFixed(2);
}

/** A change as a percentage with its sign: "+1.25 %", "−0.40 %". */
export function pctText(x: number): string {
  const v = (x * 100).toFixed(2);
  return `${x >= 0 ? '+' : '−'}${v.replace('-', '')} %`;
}
