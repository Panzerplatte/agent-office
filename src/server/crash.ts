import { randomBytes } from 'node:crypto';
import { BET_TIME, CRASHED_TIME, HISTORY, MAX_PLAYERS, betOk, crashPoint, crashedBy, multiplierAt, payout, type CrashPhase, type CrashPlayer, type CrashState } from '../shared/crash.js';

/** What the game needs of the chips bank (server/chips.ts): taking a stake, and paying out. */
export interface CrashBank {
  bet(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
  award(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
}

export interface CrashOptions {
  now?: () => number;
  /** Where the next round crashes: from a cryptographically random number unless a test says otherwise. */
  point?: () => number;
}

/** In someone's round: whose wallet the bet came out of (and the winnings go back into). */
interface Player extends CrashPlayer {
  wallet: string;
}

/** A uniform random number in [0, 1), from 52 cryptographically random bits. */
function random(): number {
  const b = randomBytes(7);
  // 52 bits: six whole bytes and the top half of the seventh.
  return (b.readUIntBE(0, 6) * 16 + (b[6] >> 4)) / 2 ** 52;
}

/**
 * The casino's Crash game, one for the whole building. The office runs every round: it takes each
 * bet (through the chips bank, which won't take more than you have), counts the betting clock down,
 * picks where the round crashes when it starts (and keeps it to itself), and pays every cash-out
 * there and then at the multiplier the office's own clock says. Pages only say "bet this" and "cash
 * me out"; when they arrive is what counts, so a cash-out that gets here after the crash gets nothing.
 *
 * Bets are someone's (`wallet`), not their page's: a reload or walking off doesn't lose a bet, and
 * any page of theirs in the casino can cash it out.
 */
export class Crash {
  private phase: CrashPhase = 'idle';
  /** When the betting clock (or the crash on the screen) runs out, and when the multiplier started climbing (ms). */
  private endsAt = 0;
  private startedAt = 0;
  private round = 0;
  /** Where this round crashes: picked as it starts, only told once it has. */
  private point = 1;
  private players: Player[] = [];
  private history: number[] = [];
  private ids = 0;
  private now: () => number;
  private pick: () => number;

  constructor(
    private readonly bank: CrashBank,
    opts: CrashOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.pick = opts.point ?? (() => crashPoint(random()));
  }

  /** The round as it is now, for every page in the casino: nobody's wallet, and never the crash point before the crash. */
  state(): CrashState {
    const now = this.now();
    return structuredClone({
      phase: this.phase,
      left: this.phase === 'betting' || this.phase === 'crashed' ? Math.max(0, this.endsAt - now) : 0,
      elapsed: this.phase === 'running' ? Math.max(0, now - this.startedAt) : 0,
      round: this.round,
      crash: this.phase === 'crashed' ? this.point : null,
      players: this.players.map(({ wallet: _, ...p }) => p),
      history: this.history,
    });
  }

  /** The multiplier right now, on the office's clock (1 unless it's climbing). */
  multiplier(): number {
    return this.phase === 'running' ? multiplierAt(this.now() - this.startedAt) : 1;
  }

  /**
   * `wallet` (on page `peer`, called `name`) bets `amount` on the next round: only while bets are
   * taken (no round climbing or just crashed), once a round, a whole number within the limits (up to
   * MAX_BET), and only chips they have: the bank takes them there and then. The first bet starts the
   * clock. Says whether it went down.
   */
  bet(peer: string, wallet: string, name: string, amount: unknown, color?: string): boolean {
    if (!betOk(amount)) return false;
    if (this.phase !== 'idle' && this.phase !== 'betting') return false;
    if (this.phase === 'betting' && this.now() >= this.endsAt) return false;
    if (this.players.some((p) => p.wallet === wallet) || this.players.length >= MAX_PLAYERS) return false;
    if (!this.bank.bet(wallet, amount, 'crash.bet', { quiet: true })) return false;
    this.players.push({ id: `c${++this.ids}`, name: name.slice(0, 24), ...(color ? { color } : {}), peer, bet: amount, wallet });
    if (this.phase === 'idle') {
      this.phase = 'betting';
      this.endsAt = this.now() + BET_TIME;
      this.round++;
    }
    return true;
  }

  /** `wallet` takes their bet back while the clock's still counting down. Says whether they had one. */
  cancel(wallet: string): boolean {
    if (this.phase !== 'betting' || this.now() >= this.endsAt) return false;
    const p = this.players.find((o) => o.wallet === wallet);
    if (!p) return false;
    this.players = this.players.filter((o) => o !== p);
    this.bank.award(wallet, p.bet, 'crash.refund', { quiet: true });
    // The last bet taken back: no round after all.
    if (!this.players.length) this.phase = 'idle';
    return true;
  }

  /**
   * `wallet` cashes out: only while the multiplier's climbing, before it's gone past the crash point
   * (as of now, by the office's clock), once. Pays bet × the multiplier now. Says what it paid, or 0.
   */
  cashOut(wallet: string, peer?: string): number {
    if (this.phase !== 'running') return 0;
    const ms = this.now() - this.startedAt;
    if (crashedBy(this.point, ms)) return 0;
    const p = this.players.find((o) => o.wallet === wallet);
    if (!p || p.out !== undefined) return 0;
    const m = multiplierAt(ms);
    const won = payout(p.bet, m);
    p.out = m;
    p.won = won;
    if (peer) p.peer = peer;
    this.bank.award(wallet, won, 'crash.win', { quiet: true });
    return won;
  }

  /** `peer` is a page of `wallet`'s (it opened the panel): their entry in the round is marked as theirs. Says whether there was one. */
  look(peer: string, wallet: string): boolean {
    const p = this.players.find((o) => o.wallet === wallet);
    if (!p || p.peer === peer) return false;
    p.peer = peer;
    return true;
  }

  /**
   * The clock: when the betting time's up the round starts (and its crash point's picked), when the
   * multiplier's gone past it the round crashes (whoever's still in loses their bet), and a while
   * after that the screen's cleared for the next. Says whether anything changed.
   */
  tick(): boolean {
    const now = this.now();
    if (this.phase === 'betting' && now >= this.endsAt) {
      this.phase = 'running';
      this.startedAt = now;
      this.point = this.pick();
      // An instant crash happens there and then.
      if (crashedBy(this.point, 0)) this.crashed(now);
      return true;
    }
    if (this.phase === 'running' && crashedBy(this.point, now - this.startedAt)) {
      this.crashed(now);
      return true;
    }
    if (this.phase === 'crashed' && now >= this.endsAt) {
      this.phase = 'idle';
      this.players = [];
      return true;
    }
    return false;
  }

  /** The office is shutting down: bets of a round that hasn't crashed, and not cashed out, go back to whoever made them. */
  close() {
    if (this.phase === 'betting' || this.phase === 'running') {
      for (const p of this.players) if (p.out === undefined) this.bank.award(p.wallet, p.bet, 'crash.refund', { quiet: true });
    }
    this.players = [];
    this.phase = 'idle';
  }

  private crashed(now: number) {
    this.phase = 'crashed';
    this.endsAt = now + CRASHED_TIME;
    this.history = [this.point, ...this.history].slice(0, HISTORY);
  }
}
