// The house bank (Hausbank): the casino's own chips. Every stake a player loses in the casino goes
// in, in full (a partial loss, like Plinko's 0.5×, puts in what wasn't paid back); wins are paid out
// as ever and never taken from it, so it only grows, and it has no upper limit. Only its owner (an
// account, set with `agent-office accounts bank-owner` or in 🔑 Accounts) can take chips out, onto
// their own balance. The office keeps it (see server/housebank.ts); everyone sees its total on the
// chip board over the cashier.

/** Where chips in the house bank came from: a casino game (or the trading table). */
export type HouseGame = 'crash' | 'plinko' | 'roulette' | 'slots' | 'blackjack' | 'trading' | 'poker';
export const HOUSE_GAMES: readonly HouseGame[] = ['crash', 'plinko', 'roulette', 'slots', 'blackjack', 'trading', 'poker'];

/**
 * How much of a lost stake goes into the house bank, per game: all of it, except poker, where the
 * pots go from player to player (until there's a rake). All in one place, to tune.
 */
export const HOUSE_SHARE: Record<HouseGame, number> = {
  crash: 1,
  plinko: 1,
  roulette: 1,
  slots: 1,
  /** The casino's table and online blackjack at the PCs. */
  blackjack: 1,
  /** The trading table (#100): liquidated or lost stakes, and its opening fee. */
  trading: 1,
  poker: 0,
};

/**
 * Which game a chips ledger reason ("roulette.bet", "onlineblackjack.win", …) belongs to, by what's
 * before its dot: for counting what the casino won before the bank existed (see server/housebank.ts).
 * Crash isn't here: its all-time totals (crash-stats.json) count it instead.
 */
export const LEDGER_GAMES: Record<string, HouseGame> = {
  plinko: 'plinko',
  roulette: 'roulette',
  slots: 'slots',
  blackjack: 'blackjack',
  onlineblackjack: 'blackjack',
  market: 'trading',
};

/** How many withdrawals the bank's log keeps, newest first. */
export const HOUSE_LOG = 30;

/** A withdrawal from the house bank: when, how many whole chips, and by whom (their name). */
export interface HouseWithdrawal {
  at: number;
  /** Whole chips, as a decimal string (it can be more than a JS number holds exactly). */
  amount: string;
  by: string;
}

/**
 * The house bank as a page sees it. Amounts are whole chips as decimal strings: there's no upper
 * limit. `owner` and the log are only on the owner's own page.
 */
export interface HouseBankState {
  total: string;
  /** You're the owner: you may withdraw. */
  owner?: boolean;
  /** What each game has put in, all-time (owner only). */
  games?: Partial<Record<HouseGame, string>>;
  /** Withdrawals, newest first (owner only). */
  withdrawals?: HouseWithdrawal[];
}

/** A whole-chips decimal string with thousands separators, in `locale` ("123,456" / "123.456"). */
export function formatChips(s: string, locale = 'en-US'): string {
  try {
    return BigInt(s).toLocaleString(locale);
  } catch {
    return s;
  }
}
