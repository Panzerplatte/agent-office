import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChipsEntry } from '../shared/chips.js';
import { HOUSE_GAMES, HOUSE_LOG, HOUSE_SHARE, LEDGER_GAMES, type HouseBankState, type HouseGame, type HouseWithdrawal } from '../shared/housebank.js';

/** How long after a change the file is written, gathering a burst of bets into one write (ms). */
const SAVE_AFTER = 1000;

/** What the house bank needs of the chips bank (server/chips.ts): someone's balance, and paying them. */
export interface HouseBankChips {
  balance(id: string): number;
  award(id: string, amount: number, reason: string): boolean;
}

/**
 * What a casino game tells the house bank: a bet settled and the player lost `chips` of it (the whole
 * stake, or what a partial win didn't pay back). Nothing for a win or a push.
 */
export interface HouseTally {
  lost(game: HouseGame, chips: number): void;
}

/** What the casino won before the bank existed, as far as the office still knows it (see backfill). */
export interface HouseHistory {
  /** Everyone's chips ledger (their latest changes only: older ones aren't kept). */
  ledgers: Iterable<ChipsEntry[]>;
  /** Everyone's all-time Crash result (crash-stats.json): what they've won (more than 0) or lost (less) on it. */
  crashNets: Iterable<number>;
}

export interface HouseBankOptions {
  now?: () => number;
  /** The bank changed (a deposit or a withdrawal). */
  onChange?: () => void;
  /** How long after a change it's written to disk (ms); tests pass 0 and call flush. */
  saveAfter?: number;
}

interface Saved {
  /** Whole chips, as decimal strings. */
  total: string;
  games: Partial<Record<HouseGame, string>>;
  withdrawals: HouseWithdrawal[];
  /** What the one-off backfill counted per game (see backfill); missing until it's run. */
  backfill?: Partial<Record<HouseGame, string>>;
}

/** Why a withdrawal didn't happen: not a whole positive amount, or more than the bank (or the player's balance) holds. */
export type WithdrawError = 'amount' | 'balance';

/**
 * The casino's house bank, in .agent-office/housebank.json: every stake a player loses (see
 * shared/housebank.ts), kept as a BigInt, so it never runs out of room. Wins aren't taken from it,
 * so it never goes below 0. Any player may take chips out, onto their own balance, and everyone sees
 * the log of who took how much.
 */
export class HouseBank implements HouseTally {
  private total = 0n;
  private games = new Map<HouseGame, bigint>();
  private withdrawals: HouseWithdrawal[] = [];
  private backfilled: Partial<Record<HouseGame, string>> | undefined;
  /** Less than a chip each game has put in so far (kept while the office runs). */
  private carry = new Map<HouseGame, number>();
  private file: string;
  private now: () => number;
  private onChange: HouseBankOptions['onChange'];
  private saveAfter: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The file is there but couldn't be read: never write over it. */
  private unreadable = false;

  constructor(
    dataDir: string,
    private readonly chips: HouseBankChips,
    opts: HouseBankOptions = {},
  ) {
    this.file = path.join(dataDir, 'housebank.json');
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.saveAfter = opts.saveAfter ?? SAVE_AFTER;
    this.load();
  }

  /** What's in the bank, in chips. */
  get chipsTotal(): bigint {
    return this.total;
  }

  /** What `game` has put in, all-time, in chips. */
  from(game: HouseGame): bigint {
    return this.games.get(game) ?? 0n;
  }

  /** A player lost `chips` at `game`: its share of them (all, but none for poker, see HOUSE_SHARE) goes in. */
  lost(game: HouseGame, chips: number) {
    if (this.put(game, chips)) this.changed();
  }

  /** Whether the one-off backfill has run (see backfill). */
  get backfillDone(): boolean {
    return !!this.backfilled;
  }

  /**
   * Once ever (the bank remembers it ran): what the casino won before the bank existed, as far as the
   * office still knows it. Crash from everyone's all-time Crash totals (a player who's lost on it
   * overall lost that much to the house); the other games from what's left of everyone's chips ledger
   * (their latest changes only), per person and game, what they staked less what came back, when it's
   * more than 0. Says what it counted per game, or null if it had run before.
   */
  backfill(history: HouseHistory): Partial<Record<HouseGame, bigint>> | null {
    if (this.backfilled) return null;
    const counted: Partial<Record<HouseGame, bigint>> = {};
    const add = (game: HouseGame, chips: number) => {
      const v = this.put(game, chips);
      if (v) counted[game] = (counted[game] ?? 0n) + v;
    };
    for (const net of history.crashNets) if (net < 0) add('crash', -net);
    for (const ledger of history.ledgers) {
      const net = new Map<HouseGame, number>();
      for (const e of ledger) {
        const game = LEDGER_GAMES[e.reason.split('.')[0]];
        if (game && Number.isSafeInteger(e.amount)) net.set(game, (net.get(game) ?? 0) - e.amount);
      }
      for (const [game, chips] of net) if (chips > 0) add(game, chips);
    }
    this.backfilled = Object.fromEntries(HOUSE_GAMES.map((g) => [g, (counted[g] ?? 0n).toString()]));
    this.changed();
    return counted;
  }

  /** `chips` (their game's share of them) into the bank: says how many went in. */
  private put(game: HouseGame, chips: number): bigint {
    const share = HOUSE_SHARE[game];
    if (!share || !(chips > 0) || !Number.isFinite(chips)) return 0n;
    // Fractions of a chip (the trading table's fee on a small stake) add up until they make whole ones.
    const exact = chips * share + (this.carry.get(game) ?? 0);
    const whole = Math.floor(exact + 1e-9);
    this.carry.set(game, Math.max(0, exact - whole));
    const v = BigInt(whole);
    if (v <= 0n) return 0n;
    this.total += v;
    this.games.set(game, this.from(game) + v);
    return v;
  }

  /**
   * A player (their chips `wallet`, see server/chips.ts, called `name`) takes `amount` whole chips
   * out ('all': everything there is), onto their own balance with "housebank" in their ledger. An
   * amount that isn't a whole positive number, or more than the bank holds, changes nothing and says
   * why; else how many chips it paid. It checks and takes in one go, so two withdrawals at once can't
   * take out more than there is. A balance can't go past what a JS number holds exactly, so 'all'
   * stops there.
   */
  withdraw(wallet: string, name: string, amount: unknown): WithdrawError | bigint {
    const room = BigInt(Number.MAX_SAFE_INTEGER - this.chips.balance(wallet));
    let want: bigint;
    if (amount === 'all') {
      want = this.chipsTotal < room ? this.chipsTotal : room;
      if (want <= 0n) return 'balance';
    } else if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0) want = BigInt(amount);
    else if (typeof amount === 'string' && /^[1-9][0-9]{0,30}$/.test(amount)) want = BigInt(amount);
    else return 'amount';
    if (want > this.chipsTotal || want > room) return 'balance';
    if (!this.chips.award(wallet, Number(want), 'housebank')) return 'amount';
    this.total -= want;
    this.withdrawals.unshift({ at: this.now(), amount: want.toString(), by: name.slice(0, 24) });
    if (this.withdrawals.length > HOUSE_LOG) this.withdrawals.length = HOUSE_LOG;
    this.changed();
    return want;
  }

  /** The bank as every page sees it: the total, what each game put in, and the log of withdrawals. */
  state(): HouseBankState {
    const games: Partial<Record<HouseGame, string>> = {};
    for (const g of HOUSE_GAMES) if (this.from(g) > 0n) games[g] = this.from(g).toString();
    return { total: this.chipsTotal.toString(), games, withdrawals: this.withdrawals.map((w) => ({ ...w })) };
  }

  /** Writes any change not on disk yet, now (the office is stopping). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }

  private changed() {
    this.dirty();
    this.onChange?.();
  }

  private dirty() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, this.saveAfter);
    this.timer.unref?.();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      this.total = chipsOf(saved.total);
      for (const g of HOUSE_GAMES) {
        const v = chipsOf(saved.games?.[g]);
        if (v > 0n) this.games.set(g, v);
      }
      if (saved.backfill && typeof saved.backfill === 'object') this.backfilled = Object.fromEntries(HOUSE_GAMES.map((g) => [g, chipsOf(saved.backfill?.[g]).toString()]));
      this.withdrawals = Array.isArray(saved.withdrawals)
        ? saved.withdrawals.filter((w) => w && Number.isFinite(w.at) && typeof w.amount === 'string' && /^[0-9]+$/.test(w.amount) && typeof w.by === 'string').slice(0, HOUSE_LOG)
        : [];
    } catch (err) {
      this.unreadable = true;
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message} — the house bank won't be saved until it's fixed or moved`);
    }
  }

  private save() {
    if (this.unreadable) return;
    const games: Partial<Record<HouseGame, string>> = {};
    for (const [g, v] of this.games) games[g] = v.toString();
    const data: Saved = { total: this.total.toString(), games, withdrawals: this.withdrawals, ...(this.backfilled ? { backfill: this.backfilled } : {}) };
    // Written whole and renamed into place, so a crash mid-write never leaves half a file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}

/** A saved amount of chips: a decimal string of digits, else nothing. */
function chipsOf(v: unknown): bigint {
  return typeof v === 'string' && /^[0-9]{1,200}$/.test(v) ? BigInt(v) : 0n;
}
