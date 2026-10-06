// Crash, on the big screen on the casino's west wall. The office runs every round (see
// server/crash.ts): bets go down while a clock counts down, then a multiplier climbs from 1.00×,
// faster and faster, until it crashes at a point the office picked with a cryptographic random
// source when the round began (and tells nobody until it's happened). Cash out before that and you
// win your bet × the multiplier you got out at; still in when it crashes, and the bet's lost.
// Everyone in the casino sees the same curve, the same crash and who got out where. It runs nonstop,
// in series of 25 rounds, each series with odds of its own. Here are the rules: the curve, the crash
// point's odds, the series, what a cash-out pays, and what a round looks like.

// ---- The curve --------------------------------------------------------------------------------------

/** How fast the multiplier climbs: e^(GROWTH · ms) since the round began, 2× after about 5.8 s, 10× after 19 s, 100× after 38 s. */
export const GROWTH = 0.00012;

/** The multiplier `ms` into a round, down to the hundredth (what the screen shows, and what a cash-out then pays): 1.00 at the start. */
export function multiplierAt(ms: number): number {
  return Math.floor(100 * Math.exp(GROWTH * Math.max(0, ms)) + 1e-9) / 100;
}

/** How long into a round (ms) the multiplier gets to `m`: the inverse of multiplierAt. */
export function timeFor(m: number): number {
  return Math.max(0, Math.log(Math.max(1, m)) / GROWTH);
}

// ---- The crash point --------------------------------------------------------------------------------

/** What every round returns in the long run, wherever you cash out, at the usual odds: the house keeps 1 %. */
export const HOUSE = 0.99;
/** The highest a round can go at the usual odds: at this the multiplier crashes whatever. */
export const MAX_CRASH = 100;

/**
 * The odds of a series of rounds (see CYCLE): what comes back in the long run (`back`, so the house
 * keeps 1 − back) and the highest a round can go (`max`). Every series draws its own (see
 * drawSeries), within SERIES_LIMITS.
 */
export interface CrashOdds {
  back: number;
  max: number;
}

/**
 * Where a round crashes, from `r`, a uniform random number in [0, 1): back / (1 − r), down to the
 * hundredth, between 1.00 (an instant crash, about 2 rounds in 100, when nobody gets out) and `max`.
 * It gets to at least `m` (any m from 1.01 up to `max`) with a chance of back / m, so cashing out at m
 * pays m × that in the long run: `back` of the bet, wherever you get out. This 1 / m shape is the only
 * one that's the same deal at every cash-out point, so a series changes `back` and `max`, not the shape.
 */
export function crashPoint(r: number, odds: CrashOdds = { back: HOUSE, max: MAX_CRASH }): number {
  if (!(r >= 0 && r < 1)) return 1;
  const m = Math.floor((100 * odds.back) / (1 - r) + 1e-9) / 100;
  return Math.min(odds.max, Math.max(1, m));
}

/**
 * Whether a round that crashes at `crash` has crashed `ms` into it: the multiplier's gone past the
 * crash point (it shows it, and a cash-out at it pays, right up to it), or straight away at 1.00.
 */
export function crashedBy(crash: number, ms: number): boolean {
  return crash <= 1 || multiplierAt(ms) > crash;
}

/** The chance a round gets to at least `m` before it crashes (so a cash-out at `m` can happen). */
export function chanceToReach(m: number, odds: CrashOdds = { back: HOUSE, max: MAX_CRASH }): number {
  if (m <= 1) return 1;
  if (m > odds.max) return 0;
  return Math.min(1, odds.back / m);
}

// ---- Series of rounds -------------------------------------------------------------------------------

/** Rounds in a series: after the last one the game starts over (round 1, no history) with new odds. */
export const CYCLE = 25;

/**
 * What a series' odds can be: the house keeps between 0.8 and 1.2 % (so about 1 %, and the chance of an
 * instant crash at 1.00× is between about 1.8 and 2.2 in 100), and a round goes up to between 50×
 * and 1000×.
 */
export const SERIES_LIMITS = { back: [0.988, 0.992], max: [50, 1000] } as const;

/** The caps a series can have (between the limits, as round numbers), one of which it draws evenly in log steps. */
export const SERIES_MAXES = [50, 75, 100, 150, 200, 250, 500, 750, 1000] as const;

/**
 * A series' odds, from `r1` and `r2`, uniform random numbers in [0, 1): what comes back, to the tenth
 * of a percent, and the cap, both always within SERIES_LIMITS (nonsense in gives the usual odds).
 */
export function drawSeries(r1: number, r2: number): CrashOdds {
  if (!(r1 >= 0 && r1 < 1 && r2 >= 0 && r2 < 1)) return { back: HOUSE, max: MAX_CRASH };
  const [lo, hi] = SERIES_LIMITS.back;
  const steps = Math.round((hi - lo) * 1000);
  const back = Math.round((lo + Math.floor(r1 * (steps + 1)) / 1000) * 1000) / 1000;
  return { back, max: SERIES_MAXES[Math.floor(r2 * SERIES_MAXES.length)] };
}

/** Whether `o` is within SERIES_LIMITS. */
export function oddsOk(o: CrashOdds): boolean {
  return o.back >= SERIES_LIMITS.back[0] && o.back <= SERIES_LIMITS.back[1] && o.max >= SERIES_LIMITS.max[0] && o.max <= SERIES_LIMITS.max[1];
}

// ---- Bets and payouts -------------------------------------------------------------------------------

/** The least and the most one person can bet on a round (high-roller stakes, see #82), never more than they have. */
export const MIN_BET = 1;
export const MAX_BET = 10_000;
/** The amounts the panel offers to click, smallest first. */
export const BET_CHOICES = [10, 50, 100, 500, 1000, 5000, 10_000] as const;

/** Whether `amount` can be bet on a round: a whole number of chips within the limits. */
export function betOk(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= MIN_BET && amount <= MAX_BET;
}

/** What a bet of `bet` brings back cashed out at `m`: the stake and its winnings, down to the whole chip. */
export function payout(bet: number, m: number): number {
  return Math.floor((bet * Math.round(m * 100)) / 100);
}

/** A multiplier the way the screen writes it: "2.37×". */
export function multText(m: number): string {
  return `${m.toFixed(2)}×`;
}

// ---- A round ----------------------------------------------------------------------------------------

/**
 * Where the round is: bets going down while the clock counts down (`betting`), the multiplier
 * climbing (`running`: cash out now), and the crash (`crashed`), shown a while before bets open for
 * the next. It never stops: the next round's clock starts after every crash, bets or not.
 */
export type CrashPhase = 'betting' | 'running' | 'crashed';

/** How long bets are taken for before every round (ms). */
export const BET_TIME = 10_000;
/** How long the crash stays up before bets open for the next round (ms). */
export const CRASHED_TIME = 4_000;
/** Crash points the screen keeps, newest first: the whole series. */
export const HISTORY = CYCLE;
/** How many people can be in one round. */
export const MAX_PLAYERS = 24;

/**
 * Someone in the round: their name and colour, how much they bet, and once they've cashed out, at
 * what (`out`) for how much (`won`). `peer` is the page that last bet or looked (so a page knows its
 * own); it's never anyone's wallet.
 */
export interface CrashPlayer {
  id: string;
  name: string;
  color?: string;
  peer?: string;
  bet: number;
  out?: number;
  won?: number;
  /** Where the bet cashes out by itself (the office does it, at exactly this), if it was set. */
  auto?: number;
}

/**
 * The round, as every page in the casino sees it. `left` is how long the betting clock (or the crash
 * on the screen) has to go, `elapsed` how long the multiplier's been climbing (ms), both as of when
 * the office sent it; a page works out the multiplier from there with multiplierAt. `crash` is where
 * it crashed, only once it has: until then nobody but the office knows. `round` counts every round
 * since the office started; `series` is which series of CYCLE rounds this is, `of` which round of it
 * (1 to CYCLE), and `odds` the series' odds (not its crash points: those are only told one by one,
 * as they happen). `history` is this series' crash points so far, newest first.
 */
export interface CrashState {
  phase: CrashPhase;
  left: number;
  elapsed: number;
  round: number;
  series: number;
  of: number;
  odds: CrashOdds;
  crash: number | null;
  players: CrashPlayer[];
  history: number[];
}

export function emptyCrash(): CrashState {
  return { phase: 'betting', left: 0, elapsed: 0, round: 0, series: 0, of: 0, odds: { back: HOUSE, max: MAX_CRASH }, crash: null, players: [], history: [] };
}

/** The multiplier on the screen `since` ms after `s` arrived: climbing while it's running, the crash point once crashed, else 1. */
export function shownMultiplier(s: CrashState, since: number): number {
  if (s.phase === 'crashed' && s.crash !== null) return s.crash;
  if (s.phase !== 'running') return 1;
  return multiplierAt(s.elapsed + Math.max(0, since));
}

// ---- The scoreboard ---------------------------------------------------------------------------------

/** How many places each of the scoreboard's two rankings has. */
export const CRASH_TOP = 10;

/**
 * One person's Crash, all-time (see server/crashstats.ts): every chip they've bet (`wagered`), what
 * that's come to (`net`: what cash-outs paid back, less every stake, so a loss takes it down), how
 * many rounds they've played, and their biggest single win (`best`: what it made over the stake, at
 * what multiplier).
 */
export interface CrashTotals {
  wagered: number;
  net: number;
  rounds: number;
  best?: { won: number; m: number };
}

export function emptyTotals(): CrashTotals {
  return { wagered: 0, net: 0, rounds: 0 };
}

/** A bet of `bet` went down: it counts towards what they've wagered (and the round's lost until it's cashed out). */
export function addWager(t: CrashTotals, bet: number): CrashTotals {
  return { ...t, wagered: t.wagered + bet };
}

/** A bet of `bet` was taken back (or given back when the office stopped): it was never wagered after all. */
export function takeWager(t: CrashTotals, bet: number): CrashTotals {
  return { ...t, wagered: Math.max(0, t.wagered - bet) };
}

/**
 * A bet of `bet` settled: cashed out at `m` for `won` (the stake and its winnings), or lost in the
 * crash (`won` 0). The difference goes on `net`, and a bigger win than ever before is their `best`.
 */
export function settle(t: CrashTotals, bet: number, won: number, m: number): CrashTotals {
  const profit = won - bet;
  const best = profit > 0 && (!t.best || profit > t.best.won) ? { won: profit, m } : t.best;
  return { ...t, net: t.net + profit, rounds: t.rounds + 1, ...(best ? { best } : {}) };
}

/** A place on the scoreboard: who (their name and colour, never their id) and their totals; `you` only on your own page's copy. */
export interface CrashBoardRow extends CrashTotals {
  name: string;
  color?: string;
  you?: boolean;
}

/** The scoreboard by the Crash screen: the most wagered and the most won, CRASH_TOP each, most first. */
export interface CrashBoard {
  wagered: CrashBoardRow[];
  won: CrashBoardRow[];
}

export function emptyCrashBoard(): CrashBoard {
  return { wagered: [], won: [] };
}

/**
 * The two rankings from everyone's totals: the most wagered (anyone who's bet), and the most won
 * (only who's up overall: net above 0). Of two the same, the one with more rounds, then by name.
 */
export function crashRanking<R extends CrashBoardRow>(rows: readonly R[], top = CRASH_TOP): { wagered: R[]; won: R[] } {
  const tie = (a: R, b: R) => b.rounds - a.rounds || a.name.localeCompare(b.name);
  return {
    wagered: rows.filter((r) => r.wagered > 0).sort((a, b) => b.wagered - a.wagered || tie(a, b)).slice(0, top),
    won: rows.filter((r) => r.net > 0).sort((a, b) => b.net - a.net || tie(a, b)).slice(0, top),
  };
}

// ---- Auto cash-out and auto-bet ---------------------------------------------------------------------

/** The lowest and highest multiplier a bet can be cashed out at by itself (the highest any series goes). */
export const AUTO_MIN = 1.01;
export const AUTO_MAX = SERIES_LIMITS.max[1];

/** Whether `m` can be an auto cash-out target: a multiplier to the hundredth, from AUTO_MIN up to AUTO_MAX. */
export function targetOk(m: unknown): m is number {
  return typeof m === 'number' && Number.isFinite(m) && m >= AUTO_MIN && m <= AUTO_MAX && Math.abs(Math.round(m * 100) - m * 100) < 1e-6;
}

/** The most a win or a loss can raise the next auto-bet by (%), and the most rounds a stop can be set at. */
export const AUTO_RAISE_MAX = 1000;
export const AUTO_ROUNDS_MAX = 10_000;

/**
 * Auto-bet ("Auto-Start"): the office bets `base` in every betting window, round after round, cashed
 * out at `target` (if set; otherwise it's up to you, every round). After a loss the next bet is the
 * last one raised by `onLoss` % (0: back to `base`), after a win by `onWin` %. It stops by itself after
 * `rounds` rounds, once it's `profit` up, or `loss` down (each one only if set), and whenever the
 * next bet won't fit (more than you have, or than MAX_BET).
 */
export interface CrashAutoBet {
  base: number;
  target?: number;
  onLoss: number;
  onWin: number;
  rounds?: number;
  profit?: number;
  loss?: number;
}

/** Why an auto-bet stopped: you stopped it (or took the bet back), a stop condition, the next bet didn't fit, the round was full, or you left the casino. */
export type CrashAutoStop = 'user' | 'rounds' | 'profit' | 'loss' | 'balance' | 'limit' | 'full' | 'left';

/** An auto-bet as its owner's pages see it: the settings, how far it's got (rounds settled, profit so far), the next bet, and if it's over, why. */
export interface CrashAutoState {
  on: boolean;
  settings: CrashAutoBet;
  rounds: number;
  profit: number;
  next: number;
  stopped?: CrashAutoStop;
}

const whole = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= lo && n <= hi;

/** Auto-bet settings from a page, checked: null unless every field's within bounds (an optional one can be left out). */
export function autoBetOk(v: unknown): CrashAutoBet | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!betOk(o.base) || !whole(o.onLoss, 0, AUTO_RAISE_MAX) || !whole(o.onWin, 0, AUTO_RAISE_MAX)) return null;
  if (o.target !== undefined && !targetOk(o.target)) return null;
  if (o.rounds !== undefined && !whole(o.rounds, 1, AUTO_ROUNDS_MAX)) return null;
  for (const k of ['profit', 'loss'] as const) if (o[k] !== undefined && !whole(o[k], 1, Number.MAX_SAFE_INTEGER)) return null;
  const s: CrashAutoBet = { base: o.base, onLoss: o.onLoss, onWin: o.onWin };
  if (o.target !== undefined) s.target = o.target as number;
  if (o.rounds !== undefined) s.rounds = o.rounds as number;
  if (o.profit !== undefined) s.profit = o.profit as number;
  if (o.loss !== undefined) s.loss = o.loss as number;
  return s;
}

/**
 * The auto-bet's next bet, after a round it bet `last` in and won (or lost): raised by the setting's
 * percentage, rounded up to the whole chip (so a raise is always at least 1), or back to the base.
 * It can come out over MAX_BET: then the auto-bet stops (see autoStop).
 */
export function nextAutoBet(s: CrashAutoBet, last: number, won: boolean): number {
  const pct = won ? s.onWin : s.onLoss;
  if (!pct) return s.base;
  return Math.ceil((last * (100 + pct)) / 100 - 1e-9);
}

/** Whether an auto-bet `rounds` rounds and `profit` chips in has hit one of its stops, and which. */
export function autoStop(s: CrashAutoBet, rounds: number, profit: number): 'rounds' | 'profit' | 'loss' | null {
  if (s.profit !== undefined && profit >= s.profit) return 'profit';
  if (s.loss !== undefined && -profit >= s.loss) return 'loss';
  if (s.rounds !== undefined && rounds >= s.rounds) return 'rounds';
  return null;
}
