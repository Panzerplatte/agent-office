// Crash, on the big screen on the casino's west wall. The office runs every round (see
// server/crash.ts): bets go down while a clock counts down, then a multiplier climbs from 1.00×,
// faster and faster, until it crashes at a point the office picked with a cryptographic random
// source when the round began (and tells nobody until it's happened). Cash out before that and you
// win your bet × the multiplier you got out at; still in when it crashes, and the bet's lost.
// Everyone in the casino sees the same curve, the same crash and who got out where. Here are the
// rules: the curve, the crash point's odds, what a cash-out pays, and what a round looks like.

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

/** What every round returns in the long run, wherever you cash out: the house keeps 1 %. */
export const HOUSE = 0.99;
/** The highest a round can go: at this the multiplier crashes whatever. */
export const MAX_CRASH = 100;

/**
 * Where a round crashes, from `r`, a uniform random number in [0, 1): 0.99 / (1 − r), down to the
 * hundredth, between 1.00 (an instant crash, about 2 rounds in 100, when nobody gets out) and
 * MAX_CRASH. It gets to at least `m` (any m from 1.01 up to MAX_CRASH) with a chance of 0.99 / m, so
 * cashing out at m pays m × that in the long run: 0.99 of the bet, wherever you get out.
 */
export function crashPoint(r: number): number {
  if (!(r >= 0 && r < 1)) return 1;
  const m = Math.floor((100 * HOUSE) / (1 - r) + 1e-9) / 100;
  return Math.min(MAX_CRASH, Math.max(1, m));
}

/**
 * Whether a round that crashes at `crash` has crashed `ms` into it: the multiplier's gone past the
 * crash point (it shows it, and a cash-out at it pays, right up to it), or straight away at 1.00.
 */
export function crashedBy(crash: number, ms: number): boolean {
  return crash <= 1 || multiplierAt(ms) > crash;
}

/** The chance a round gets to at least `m` before it crashes (so a cash-out at `m` can happen). */
export function chanceToReach(m: number): number {
  if (m <= 1) return 1;
  if (m > MAX_CRASH) return 0;
  return Math.min(1, HOUSE / m);
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
 * Where the round is: nobody's bet yet (`idle`), bets going down while the clock counts down
 * (`betting`, from the first bet), the multiplier climbing (`running`: cash out now), and the crash
 * (`crashed`), shown a while before the next round can start.
 */
export type CrashPhase = 'idle' | 'betting' | 'running' | 'crashed';

/** How long bets are taken for, from the first bet down (ms). */
export const BET_TIME = 10_000;
/** How long the crash stays up before the next round can start (ms). */
export const CRASHED_TIME = 4_000;
/** Crash points the screen keeps, newest first. */
export const HISTORY = 12;
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
}

/**
 * The round, as every page in the casino sees it. `left` is how long the betting clock (or the crash
 * on the screen) has to go, `elapsed` how long the multiplier's been climbing (ms), both as of when
 * the office sent it; a page works out the multiplier from there with multiplierAt. `crash` is where
 * it crashed, only once it has: until then nobody but the office knows.
 */
export interface CrashState {
  phase: CrashPhase;
  left: number;
  elapsed: number;
  round: number;
  crash: number | null;
  players: CrashPlayer[];
  history: number[];
}

export function emptyCrash(): CrashState {
  return { phase: 'idle', left: 0, elapsed: 0, round: 0, crash: null, players: [], history: [] };
}

/** The multiplier on the screen `since` ms after `s` arrived: climbing while it's running, the crash point once crashed, else 1. */
export function shownMultiplier(s: CrashState, since: number): number {
  if (s.phase === 'crashed' && s.crash !== null) return s.crash;
  if (s.phase !== 'running') return 1;
  return multiplierAt(s.elapsed + Math.max(0, since));
}
