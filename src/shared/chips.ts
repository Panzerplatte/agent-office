// Chips: the casino's play money. Everyone has a balance (kept by the office, see server/chips.ts),
// earns chips by doing things round the office (the EARN table below) and spends them in the casino.
// They can never be bought, and they're worth nothing outside the office.

/** What a new person starts with. */
export const START_CHIPS = 1000;

/** How many of your latest changes the office keeps (and the HUD shows), newest first. */
export const LEDGER_SIZE = 30;

const MIN = 60_000;

/**
 * One way to earn chips: `chips` each time, at most every `cooldown` ms, and at most `perDay` chips
 * from it in a day (the office's day, from midnight on its clock). A time that would go over the cap
 * pays what's left under it. With `streakMax`, a streak of them in a row pays `chips` × the streak
 * (1st, 2nd, 3rd … in a row), the streak counting up to `streakMax` at most.
 */
export interface Earning {
  chips: number;
  cooldown?: number;
  perDay?: number;
  streakMax?: number;
}

/**
 * Everything that pays chips, in one place to tune. Beating other people pays more than playing on
 * your own, which pays little (it's the easiest to farm), and everything is capped per day.
 */
export const EARN = {
  /** Your first visit of the day. */
  daily: { chips: 100, perDay: 100 },
  /** Being about: every ONLINE_EVERY minutes you're active (moving, using things, typing). */
  online: { chips: 5, perDay: 100 },
  /**
   * A basket at the hoop on your floor, and one from behind the three-point line: each one pays its
   * chips × your streak of baskets in a row (see STREAK_PAUSE), so the 3rd basket in a row pays 15.
   */
  basket: { chips: 5, cooldown: 1500, perDay: 500, streakMax: 10 },
  three: { chips: 15, cooldown: 1500, perDay: 500, streakMax: 10 },
  /** Darts: winning a game against others, and finishing one on your own. */
  dartsWin: { chips: 60, cooldown: 2 * MIN, perDay: 360 },
  dartsSolo: { chips: 10, cooldown: 5 * MIN, perDay: 30 },
  /** Pool: winning a game against others (each of the winning side), and clearing the rack on your own. */
  poolWin: { chips: 80, cooldown: 2 * MIN, perDay: 400 },
  poolSolo: { chips: 15, cooldown: 5 * MIN, perDay: 45 },
  /** Golf off the balcony: a hole in one, and a ball that stops close to the pin (within GOLF_CLOSE m). */
  golfHole: { chips: 150, cooldown: MIN, perDay: 450 },
  golfClose: { chips: 10, cooldown: 30_000, perDay: 50 },
  /** A pull request merged: for whoever queued the task, or hired the worker, it came from. */
  merged: { chips: 200, perDay: 1000 },
} satisfies Record<string, Earning>;

export type EarnKind = keyof typeof EARN;

/** Minutes of being active for each `online` payout, and how long after the last thing you did you still count as active. */
export const ONLINE_EVERY = 10;
export const ACTIVE_FOR = 5 * MIN;

/**
 * Chip credit at the bank (the cashier at the chip board): one of CREDIT_AMOUNTS (CREDIT_MAX at most)
 * on your balance, as a debt. It's paid back two ways: project work (minutes you're active in the
 * office while a task or worker of yours, queued or hired by you, is running, and CREDIT_MERGED
 * minutes for each merged pull request of yours), CREDIT_PAYOFF minutes of it paying off a whole
 * CREDIT_MAX (so CREDIT_PER_MINUTE a minute, and a smaller credit goes faster); and chips won at
 * the office's mini games (CREDIT_GAMES), which go to the debt until it's paid. The next credit is
 * there once the last one is paid back in full.
 */
export const CREDIT_AMOUNTS = [500, 1000, 2500, 5000, 10_000] as const;
export const CREDIT_MAX = 10_000;
export const CREDIT_PAYOFF = 4 * 60;
export const CREDIT_PER_MINUTE = CREDIT_MAX / CREDIT_PAYOFF;
export const CREDIT_MERGED = 30;
export const CREDIT_GAMES: readonly EarnKind[] = ['basket', 'three', 'dartsWin', 'dartsSolo', 'poolWin', 'poolSolo', 'golfHole', 'golfClose'];

/** Whether `n` is a credit the bank gives (one of CREDIT_AMOUNTS). */
export function creditAmountOk(n: unknown): n is number {
  return typeof n === 'number' && (CREDIT_AMOUNTS as readonly number[]).includes(n) && n <= CREDIT_MAX;
}

/** Your credit at the bank, as the page sees it: what you took, and how much of it is still owed (whole chips). */
export interface CreditState {
  amount: number;
  owed: number;
}

/** Minutes of project work that pay off `owed` chips of a credit. */
export function creditWork(owed: number): number {
  return Math.ceil(owed / CREDIT_PER_MINUTE);
}

/** Minutes of work as "1 h 20 min" (the same in English and German). */
export function workTime(min: number): string {
  const m = Math.max(0, Math.ceil(min));
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`;
}

/** A streak of baskets ends with a shot of yours that misses, leaving the floor, or this long (ms) without a basket. */
export const STREAK_PAUSE = 2 * MIN;

/** How near the pin (m) a golf ball has to stop to pay `golfClose`. */
export const GOLF_CLOSE = 3;

/**
 * Why a balance changed: an EarnKind for chips earned round the office, or whatever a casino game
 * calls its bets and payouts ("roulette.bet", "slots.win", …). The page says it in your language when
 * it knows it (see the client's chips strings), and shows it as it is when it doesn't.
 */
export type ChipsReason = string;

/** One change to a balance: when, by how much (less than 0 for a bet), why, and the balance after it. */
export interface ChipsEntry {
  at: number;
  amount: number;
  reason: ChipsReason;
  balance: number;
  /** For a basket that's one of a streak: how many in a row it makes (2 and up). */
  streak?: number;
}

/** Your chips as the page sees them: the balance and your latest changes, newest first. */
export interface ChipsState {
  balance: number;
  ledger: ChipsEntry[];
  /** Your credit at the bank while you still owe on it (none: you can take one). */
  credit?: CreditState;
}

/** How many people the casino's chips board (and the HUD's chips window) ranks. */
export const CHIPS_TOP = 10;

/** One place on the chips leaderboard: who (their name and colour, never their id), and what they have. */
export interface ChipsTopRow {
  name: string;
  chips: number;
  color?: string;
  /** In the office right now (on any floor). */
  online?: boolean;
  /** It's you (only on your own page's copy). */
  you?: boolean;
}

/** A positive whole number of chips, small enough to add up exactly: the only kind of amount a bet or payout takes. */
export function chipsAmountOk(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
}

/** A browser's own chips key, as a page sends it (see the client's chips.ts): letters, digits, - and _. */
export function chipsKeyOk(k: unknown): k is string {
  return typeof k === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(k);
}

/** The office's day for `at` (ms), as YYYY-MM-DD on its own clock: daily caps and the login bonus start again each one. */
export function chipsDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
