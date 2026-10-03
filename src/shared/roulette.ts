// Roulette at the casino's roulette table: European, with a single zero. The office runs the table
// (see server/roulette.ts): it takes the bets, says "rien ne va plus", picks the number with a proper
// random source and pays out through the chips; every page in the casino sees the same wheel spin
// and the ball drop into the same pocket. Here are the rules: the wheel, every spot on the layout you
// can put chips on, what each pays, and what a round looks like.

import { RED_NUMBERS, WHEEL_ORDER, rouletteColor } from './casino.js';

// ---- The wheel --------------------------------------------------------------------------------------

/** The pockets round the wheel, clockwise seen from above from the zero (the casino's wheel, see shared/casino.ts). */
export const WHEEL = WHEEL_ORDER;

/** How many pockets: 0 to 36. */
export const POCKETS = WHEEL.length;

/** The red numbers; the rest of 1–36 are black, and 0 is green. */
export const REDS = RED_NUMBERS;

export type PocketColor = ReturnType<typeof rouletteColor>;

export const colorOf = rouletteColor;

/** Whether `n` is a number on the wheel: a whole number from 0 to 36. */
export function isPocket(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < POCKETS;
}

// ---- The layout -------------------------------------------------------------------------------------

/**
 * The kinds of bet. Inside bets: one number (`straight`), two side by side (`split`, the zero with 1,
 * 2 or 3 too), a row of three across the layout (`street`, and the zero's trios 0-1-2 and 0-2-3), four
 * in a square (`corner`, and the zero's "first four" 0-1-2-3) and two streets side by side (`line`,
 * six numbers). Outside bets: a dozen (1–12, 13–24, 25–36), a column, red or black, odd or even, and
 * low (1–18) or high (19–36). The zero loses every outside bet.
 */
export type BetKind = 'straight' | 'split' | 'street' | 'corner' | 'line' | 'dozen' | 'column' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high';

/** What a winning bet pays, to one (the stake comes back on top): 36 ÷ the numbers it covers, less one. */
export const PAYS: Readonly<Record<BetKind, number>> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  line: 5,
  dozen: 2,
  column: 2,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
};

/**
 * A spot on the layout chips can go on: its id (what the pages and the office call it), what kind of
 * bet it is, and the numbers it wins on. An inside bet's id is its kind and its numbers, lowest
 * first ("straight:17", "split:17-20", "corner:0-1-2-3"); a dozen's or column's is its kind and which
 * one, 1 to 3 ("dozen:2", "column:3"; column 1 is 1, 4, 7 … 34); the even-money bets are just their
 * kind ("red", "odd", "low").
 */
export interface Spot {
  id: string;
  kind: BetKind;
  numbers: readonly number[];
}

/**
 * On the layout the numbers run in twelve rows of three ("streets", 1-2-3 up to 34-35-36), across
 * three columns; the zero sits at the head, over the first street. `col` is which column (0 holds 1,
 * 4, 7 …), `street` which street (0 is 1-2-3).
 */
export const colOf = (n: number) => (n - 1) % 3;
export const streetOf = (n: number) => Math.floor((n - 1) / 3);

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function inside(kind: BetKind, numbers: number[]): Spot {
  const sorted = [...numbers].sort((a, b) => a - b);
  return { id: `${kind}:${sorted.join('-')}`, kind, numbers: sorted };
}

function buildSpots(): Spot[] {
  const spots: Spot[] = [];
  for (let n = 0; n <= 36; n++) spots.push(inside('straight', [n]));
  // Splits: across a street, and along a column; and the zero with each number of the first street.
  for (let n = 1; n <= 36; n++) {
    if (colOf(n) < 2) spots.push(inside('split', [n, n + 1]));
    if (n + 3 <= 36) spots.push(inside('split', [n, n + 3]));
  }
  for (const n of [1, 2, 3]) spots.push(inside('split', [0, n]));
  for (let s = 0; s < 12; s++) spots.push(inside('street', range(3 * s + 1, 3 * s + 3)));
  spots.push(inside('street', [0, 1, 2]), inside('street', [0, 2, 3]));
  for (let n = 1; n <= 32; n++) if (colOf(n) < 2) spots.push(inside('corner', [n, n + 1, n + 3, n + 4]));
  spots.push(inside('corner', [0, 1, 2, 3]));
  for (let s = 0; s < 11; s++) spots.push(inside('line', range(3 * s + 1, 3 * s + 6)));
  for (let d = 1; d <= 3; d++) spots.push({ id: `dozen:${d}`, kind: 'dozen', numbers: range(12 * d - 11, 12 * d) });
  for (let c = 1; c <= 3; c++) spots.push({ id: `column:${c}`, kind: 'column', numbers: range(1, 36).filter((n) => colOf(n) === c - 1) });
  const all = range(1, 36);
  spots.push(
    { id: 'red', kind: 'red', numbers: all.filter((n) => REDS.has(n)) },
    { id: 'black', kind: 'black', numbers: all.filter((n) => !REDS.has(n)) },
    { id: 'odd', kind: 'odd', numbers: all.filter((n) => n % 2 === 1) },
    { id: 'even', kind: 'even', numbers: all.filter((n) => n % 2 === 0) },
    { id: 'low', kind: 'low', numbers: range(1, 18) },
    { id: 'high', kind: 'high', numbers: range(19, 36) },
  );
  return spots;
}

/** Every spot on the layout, by its id: anything else isn't a bet. */
export const SPOTS: ReadonlyMap<string, Spot> = new Map(buildSpots().map((s) => [s.id, s]));

/** The spot with id `id`, if it's one on the layout. */
export function spotOf(id: unknown): Spot | undefined {
  return typeof id === 'string' && id.length <= 24 ? SPOTS.get(id) : undefined;
}

/** The id of the inside bet of `kind` on `numbers` (in any order), if there's one on the layout. */
export function insideSpot(kind: BetKind, numbers: readonly number[]): Spot | undefined {
  return SPOTS.get(`${kind}:${[...numbers].sort((a, b) => a - b).join('-')}`);
}

/**
 * The layout as it's drawn (on the table's felt, and on the betting panel): the numbers in three rows
 * across twelve streets, 3, 6 … 36 along the top and 1, 4 … 34 along the bottom, the zero at the left.
 * In the numbers' own units — `u` across (0 to 12, a street each), `v` down (0 to 3, a row each) — the
 * number under (u, v).
 */
export function numberAt(street: number, row: number): number {
  return 3 * street + 3 - row;
}

/** Where a chip is on its number's square, at most, to count as on the line next to it (a fraction of the square). */
export const EDGE = 0.25;

/**
 * The inside bet a chip at (u, v) on the numbers is (see numberAt): in the middle of a square it's
 * that number, on the line between two a split, where four meet a corner. On the bottom edge it's the
 * street (or, where two streets meet, the six line), and on the zero's edge the split with the zero
 * (or a trio, or the first four in the corner). Off the numbers, nothing.
 */
export function spotAt(u: number, v: number): Spot | undefined {
  if (!(u >= 0 && u < 12 && v >= 0 && v < 3)) return undefined;
  const s = Math.floor(u);
  const r = Math.floor(v);
  const fu = u - s;
  const fv = v - r;
  const n = numberAt(s, r);
  // Which line it's on: the one to the left or right of the square, above or below it.
  let dx = fu < EDGE ? -1 : fu > 1 - EDGE ? 1 : 0;
  let dy = fv < EDGE ? -1 : fv > 1 - EDGE ? 1 : 0;
  if (s === 11 && dx === 1) dx = 0;
  if (r === 0 && dy === -1) dy = 0;
  if (r === 2 && dy === 1) {
    // The bottom edge: the street, or a six line where two meet; by the zero, the first four.
    if (dx === 0) return insideSpot('street', [n, n + 1, n + 2]);
    if (s === 0 && dx === -1) return SPOTS.get('corner:0-1-2-3');
    const first = dx === 1 ? n : n - 3;
    return insideSpot('line', range(first, first + 5));
  }
  const m = n - dy;
  if (s === 0 && dx === -1) return dy === 0 ? insideSpot('split', [0, n]) : insideSpot('street', [0, n, m]);
  if (dx === 0 && dy === 0) return insideSpot('straight', [n]);
  if (dx === 0) return insideSpot('split', [n, m]);
  if (dy === 0) return insideSpot('split', [n, n + 3 * dx]);
  return insideSpot('corner', [n, m, n + 3 * dx, m + 3 * dx]);
}

/**
 * Where a chip on `spot` sits on the layout, in the numbers' units (see spotAt): in the middle of its
 * number, on its line, or at its corner. Outside bets and the zero are drawn off the numbers, by the
 * pages themselves: null.
 */
export function spotPlace(spot: Spot): { u: number; v: number } | null {
  const ns = spot.numbers;
  const at = (n: number) => ({ u: streetOf(n) + 0.5, v: 2 - colOf(n) + 0.5 });
  const mid = (ps: { u: number; v: number }[]) => ({ u: ps.reduce((a, p) => a + p.u, 0) / ps.length, v: ps.reduce((a, p) => a + p.v, 0) / ps.length });
  switch (spot.kind) {
    case 'straight':
      return ns[0] === 0 ? null : at(ns[0]);
    case 'split':
      return ns[0] === 0 ? { u: 0, v: at(ns[1]).v } : mid(ns.map(at));
    case 'street':
      if (ns[0] === 0) return { u: 0, v: ns[2] === 2 ? 2 : 1 };
      return { u: streetOf(ns[0]) + 0.5, v: 3 };
    case 'corner':
      return ns[0] === 0 ? { u: 0, v: 3 } : mid(ns.map(at));
    case 'line':
      return { u: streetOf(ns[0]) + 1, v: 3 };
    default:
      return null;
  }
}

export function wins(spot: Spot, n: number): boolean {
  return spot.numbers.includes(n);
}

/** What `amount` on `spot` brings back if the ball lands on `n`: the stake and its winnings, or nothing. */
export function payout(spot: Spot, amount: number, n: number): number {
  return wins(spot, n) ? amount * (PAYS[spot.kind] + 1) : 0;
}

// ---- Chips and limits -------------------------------------------------------------------------------

/** The chips you can put down, smallest first: each click on the layout puts one of these there. */
export const DENOMINATIONS = [1, 5, 25, 100, 500] as const;

/** The table's limits: the least that can go on a spot, the most on any one spot, and the most one player can have down in a round. */
export const MIN_BET = 1;
export const MAX_SPOT = 1000;
export const MAX_TOTAL = 5000;

/** Whether `amount` is something that can go on a spot: a whole number of chips, within the table's limits. */
export function amountOk(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount >= MIN_BET && amount <= MAX_SPOT;
}

// ---- The players ------------------------------------------------------------------------------------

/**
 * Each player's colour, for their chips on the layout (at a real table every player has chips of their
 * own colour, so everyone knows whose are whose), in this order: each new player getting the first
 * one nobody has.
 */
export const ROULETTE_COLORS = ['#e8433f', '#2f7de1', '#2fbf71', '#f2c230', '#a35de0', '#f08a3c'] as const;

/** Places at the table. */
export const MAX_SEATS = ROULETTE_COLORS.length;

/**
 * Someone's place at the table: its id (the same while they come and go), their name and colour.
 * `peer` is who's sitting there now; none while they're away (walked off, reloading, disconnected),
 * keeping the place and any chips they have on the layout.
 */
export interface RouletteSeat {
  id: string;
  name: string;
  color: string;
  peer?: string;
}

/** Chips on the layout: whose (a seat's id), on what spot, how many. */
export interface RouletteBet {
  seat: string;
  spot: string;
  amount: number;
}

// ---- A round ----------------------------------------------------------------------------------------

/**
 * Where the round is: nobody's bet yet (`idle`), bets being taken while the clock runs down
 * (`betting`, from the first chip down), the ball going round with no more bets ("rien ne va plus":
 * `spinning`), and the ball in its pocket, the winning chips paid and lit up (`result`), before the
 * layout's cleared for the next.
 */
export type RoulettePhase = 'idle' | 'betting' | 'spinning' | 'result';

/** How long bets are taken for, from the first chip down (ms). */
export const BET_TIME = 20_000;
/** How long the wheel spins, from "rien ne va plus" to the ball dropping into its pocket (ms). */
export const SPIN_TIME = 9_000;
/** How long the result stays up, the winning chips lit, before the layout's cleared (ms). */
export const RESULT_TIME = 7_000;
/** Numbers the board by the wheel keeps, newest first. */
export const HISTORY = 15;

/** What one seat got back on a spin: what they had down, what came back (stakes and winnings). */
export interface RouletteWin {
  seat: string;
  staked: number;
  paid: number;
}

/**
 * The table, as every page in the casino sees it. `left` is how long the phase has to go (ms) when the
 * office sent it; `round` counts the spins, so a page knows a new one from the same one sent again.
 * While spinning and after, `number` is where the ball lands (the office picks it at "rien ne va
 * plus", when no more bets can go down). `wins` is each player's take, once it's paid.
 */
export interface RouletteState {
  seats: RouletteSeat[];
  phase: RoulettePhase;
  left: number;
  round: number;
  bets: RouletteBet[];
  number: number | null;
  wins: RouletteWin[];
  history: number[];
}

export function emptyRoulette(): RouletteState {
  return { seats: [], phase: 'idle', left: 0, round: 0, bets: [], number: null, wins: [], history: [] };
}

/** What a seat has down on the layout. */
export function staked(bets: readonly RouletteBet[], seat: string): number {
  return bets.reduce((sum, b) => (b.seat === seat ? sum + b.amount : sum), 0);
}

/** What each seat gets back when the ball lands on `n`: one entry per seat with chips down. */
export function settle(bets: readonly RouletteBet[], n: number): RouletteWin[] {
  const by = new Map<string, RouletteWin>();
  for (const b of bets) {
    const spot = SPOTS.get(b.spot);
    if (!spot) continue;
    const w = by.get(b.seat) ?? { seat: b.seat, staked: 0, paid: 0 };
    w.staked += b.amount;
    w.paid += payout(spot, b.amount, n);
    by.set(b.seat, w);
  }
  return [...by.values()];
}
