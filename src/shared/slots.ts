// The slot machines in the casino: three reels, three rows showing, five pay lines, and a small
// progressive jackpot that every machine shares and every bet grows. The office spins (see
// server/slots.ts) and pays out in chips; this is the machine itself: its reels, its paytable and
// what a spin pays, for the office to work it out and the page to show it.

// ---- The reels --------------------------------------------------------------------------------------

export type SlotSymbol = 'cherry' | 'lemon' | 'orange' | 'bell' | 'bar' | 'seven' | 'star';

/** How each symbol is drawn on the reels and in the paytable (BAR is a word, the rest emoji). */
export const SYMBOL_GLYPH: Record<SlotSymbol, string> = {
  cherry: '🍒',
  lemon: '🍋',
  orange: '🍊',
  bell: '🔔',
  bar: 'BAR',
  seven: '7',
  star: '⭐',
};

/** The symbols, cheapest first. */
export const SYMBOLS: readonly SlotSymbol[] = ['cherry', 'lemon', 'orange', 'bell', 'bar', 'seven', 'star'];

const strip = (s: string): SlotSymbol[] =>
  s.split(' ').map((c) => ({ C: 'cherry', L: 'lemon', O: 'orange', B: 'bell', R: 'bar', S: 'seven', J: 'star' })[c] as SlotSymbol);

/**
 * The three reels, each a loop of 27 symbols, top to bottom: the left one has more cherries, the
 * right one more lemons, and each one star and two sevens. Spread out so no two of a kind sit next
 * to each other where it can be helped.
 */
export const REELS: readonly (readonly SlotSymbol[])[] = [
  strip('C L O B C R L O C S L B O C L R C O B L J C O S L B R'),
  strip('L O C B L R O C L S O B C L O R C B L O J C L S O B R'),
  strip('L O C B L R O L C S O B L O C R L B O L J C O S L B R'),
];

/** Symbols each reel shows: the one on the middle row, and one above and below it. */
export const ROWS = 3;

/**
 * The pay lines, each the row (0 top, 1 middle, 2 bottom) it takes on each reel: the middle row, the
 * top, the bottom, and the two diagonals (a V and a Λ).
 */
export const LINES: readonly (readonly number[])[] = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];

/** The symbol at `i` on reel `r` (any whole number: the reel is a loop). */
export function symbolAt(r: number, i: number): SlotSymbol {
  const reel = REELS[r];
  return reel[((i % reel.length) + reel.length) % reel.length];
}

/** What the machine shows with each reel stopped at `stops` (the middle row's index): [reel][row]. */
export function windowAt(stops: readonly number[]): SlotSymbol[][] {
  return stops.map((s, r) => [symbolAt(r, s - 1), symbolAt(r, s), symbolAt(r, s + 1)]);
}

// ---- The paytable -----------------------------------------------------------------------------------

/** Three of a kind on a line, times the line's bet. Three stars is the jackpot (see jackpotWin). */
export const PAY_THREE: Record<Exclude<SlotSymbol, 'star'>, number> = {
  cherry: 10,
  lemon: 10,
  orange: 15,
  bell: 35,
  bar: 50,
  seven: 150,
};
/** Cherries from the left of a line, short of three: one pays the line's bet back, two five times it. */
export const PAY_CHERRY = [0, 1, 5] as const;

/** What a line with these three symbols (left to right) pays, times its bet; 'jackpot' for three stars. */
export function linePays(s: readonly SlotSymbol[]): number | 'jackpot' {
  const [a, b, c] = s;
  if (a === b && b === c) return a === 'star' ? 'jackpot' : PAY_THREE[a];
  if (a !== 'cherry') return 0;
  return PAY_CHERRY[b === 'cherry' ? 2 : 1];
}

// ---- Bets and the jackpot ---------------------------------------------------------------------------

/** What a spin can cost, in chips: always all five lines, a fifth of it on each. */
export const BETS = [5, 10, 25, 50, 100, 250, 500, 1000] as const;
export type SlotBet = (typeof BETS)[number];
export const MAX_BET: SlotBet = BETS[BETS.length - 1];

export function isBet(v: unknown): v is SlotBet {
  return typeof v === 'number' && (BETS as readonly number[]).includes(v);
}

/**
 * What the jackpot starts at, and goes back to once it's won: five times the biggest bet, so a win at
 * 100 a spin is still worth at least 500 now that the top bet is 1,000 (see jackpotWin).
 */
export const JACKPOT_SEED = 5 * MAX_BET;
/** How much of every bet goes into the jackpot. */
export const JACKPOT_SHARE = 0.025;

/**
 * What three stars win at `bet`: the whole jackpot at the biggest bet, and a share of it as big as the
 * bet's share of that otherwise (half the bet, half the pot); what's left stays in it for the next.
 */
export function jackpotWin(pot: number, bet: number): number {
  return Math.floor((pot * Math.min(bet, MAX_BET)) / MAX_BET);
}

// ---- A spin -----------------------------------------------------------------------------------------

/** A line that paid: which of LINES, and what it won (chips; the jackpot not included). */
export interface LineWin {
  line: number;
  win: number;
  /** Three stars on it. */
  jackpot?: boolean;
}

/** What a spin with the reels stopped at `stops` pays at `bet`: each winning line, and all of it, the jackpot aside. */
export function evaluate(stops: readonly number[], bet: number): { lines: LineWin[]; win: number; jackpot: boolean } {
  const w = windowAt(stops);
  const lineBet = bet / LINES.length;
  const lines: LineWin[] = [];
  let jackpot = false;
  LINES.forEach((rows, line) => {
    const pays = linePays(rows.map((row, r) => w[r][row]));
    if (pays === 'jackpot') {
      jackpot = true;
      lines.push({ line, win: 0, jackpot: true });
    } else if (pays > 0) lines.push({ line, win: pays * lineBet });
  });
  return { lines, win: lines.reduce((a, l) => a + l.win, 0), jackpot };
}

/**
 * What the machine gives back on average for every chip bet, the jackpot aside, worked out exactly
 * over every way the reels can stop. Every line sees each stop of each reel equally often, so it's
 * what one line pays on average, over its bet.
 */
export function baseReturn(): number {
  let total = 0;
  for (const a of REELS[0]) for (const b of REELS[1]) for (const c of REELS[2]) {
    const p = linePays([a, b, c]);
    if (p !== 'jackpot') total += p;
  }
  return total / (REELS[0].length * REELS[1].length * REELS[2].length);
}

/** The chance a line comes up three stars. */
export function jackpotChance(): number {
  const stars = REELS.map((r) => r.filter((s) => s === 'star').length / r.length);
  return stars[0] * stars[1] * stars[2];
}

/**
 * The whole return to player: the base game plus the jackpot, which in the long run pays back all
 * that goes into it.
 */
export function returnToPlayer(): number {
  return baseReturn() + JACKPOT_SHARE;
}

// ---- In the casino ----------------------------------------------------------------------------------

/** Who's at a machine: their name, and the PeerInfo id of whoever's there now; none while they're away (it's kept for them a while). */
export interface SlotSeat {
  name: string;
  peer?: string;
}

/** A spin, as everyone sees it: the reels stop one after the other at `stops`, then what it won lights up. */
export interface SlotSpin {
  /** Counts up with every spin on the machine, so a page knows a new one when it sees it. */
  n: number;
  stops: number[];
  bet: SlotBet;
  /** All it won, in chips, the jackpot included. */
  win: number;
  lines: LineWin[];
  /** What the jackpot paid, if it came up (0 otherwise). */
  jackpot: number;
  /** Who spun it. */
  name: string;
}

/** A machine in the casino: who's at it (if anyone), and its last spin (still showing on its reels). */
export interface SlotMachineState {
  seat: SlotSeat | null;
  spin: SlotSpin | null;
}

/** The last jackpot that came up, for the casino's big screen. */
export interface JackpotHit {
  name: string;
  amount: number;
  machine: number;
  at: number;
}

/** Every machine in the casino (in the order of the floor's layout), and the jackpot they share. */
export interface SlotsState {
  machines: SlotMachineState[];
  /** The jackpot, in whole chips. */
  jackpot: number;
  last: JackpotHit | null;
}

export function emptySlots(count = 0): SlotsState {
  return { machines: Array.from({ length: count }, () => ({ seat: null, spin: null })), jackpot: JACKPOT_SEED, last: null };
}

/** How long the reels spin for, from the pull to the last one stopping (ms): the first stops at REEL_STOP[0], and so on. */
export const REEL_STOP = [1100, 1600, 2100] as const;
export const SPIN_MS = REEL_STOP[REEL_STOP.length - 1];
