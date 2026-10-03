import { randomInt } from 'node:crypto';
import { BET_TIME, HISTORY, MAX_SEATS, MAX_SPOT, MAX_TOTAL, POCKETS, RESULT_TIME, ROULETTE_COLORS, SPIN_TIME, amountOk, settle, spotOf, staked, type RouletteBet, type RoulettePhase, type RouletteSeat, type RouletteState, type RouletteWin } from '../shared/roulette.js';

/** What the table needs of the chips bank (server/chips.ts): taking a stake, and paying out. */
export interface RouletteBank {
  bet(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
  award(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
}

export interface RouletteOptions {
  now?: () => number;
  /** The winning number, 0–36: a cryptographically random one unless a test says otherwise. */
  spin?: () => number;
}

/** How long a place is kept for someone who's away with no chips on the layout (ms). */
export const AWAY_KEEP = 3 * 60_000;
/** How many times one person can put chips down or pick them up in a burst (a rebet puts several down at once), and how fast that comes back (per second). */
const BURST = 24;
const REFILL = 8;

/** A place at the table, and who it's kept for: `wallet` is who they are to the chips bank (their account, or their browser). */
interface Seat extends RouletteSeat {
  wallet: string;
  /** When they went away (ms), while they're away. */
  awayAt?: number;
}

/** Chips on the layout, and whose wallet they came out of (and any winnings go back into). */
interface Bet extends RouletteBet {
  wallet: string;
}

/**
 * The casino's roulette table, one for the whole building. The office runs every round: it takes the
 * bets (each one through the chips bank, which won't take more than you have), closes them when the
 * clock runs out, picks the number with a cryptographic random source, and pays the winners through
 * the bank again. Pages only say where they want chips; the office checks every spot and amount.
 *
 * Everyone's place is kept by who they are (`wallet`), not by their connection: someone who walks off,
 * reloads or drops out is only away, their chips stay on the layout and win or lose like anyone's,
 * and sitting down again puts them back in their place and colour. Only leaving takes them off the
 * table (with their chips, while bets are still being taken).
 */
export class Roulette {
  private seats: Seat[] = [];
  private bets: Bet[] = [];
  private phase: RoulettePhase = 'idle';
  private endsAt = 0;
  private round = 0;
  private number: number | null = null;
  private wins: RouletteWin[] = [];
  private history: number[] = [];
  private ids = 0;
  private bucket = new Map<string, { tokens: number; at: number }>();
  private now: () => number;
  private spin: () => number;

  constructor(
    private readonly bank: RouletteBank,
    opts: RouletteOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.spin = opts.spin ?? (() => randomInt(POCKETS));
  }

  /** The table as it is now, for every page in the casino: nobody's wallet, and how long the phase has to go. */
  state(): RouletteState {
    return structuredClone({
      seats: this.seats.map(({ wallet: _w, awayAt: _a, ...s }) => s),
      phase: this.phase,
      left: this.phase === 'idle' ? 0 : Math.max(0, this.endsAt - this.now()),
      round: this.round,
      bets: this.bets.map(({ wallet: _, ...b }) => b),
      number: this.phase === 'spinning' || this.phase === 'result' ? this.number : null,
      wins: this.wins,
      history: this.history,
    });
  }

  /**
   * `peer` sits down at the table: back in their place if `wallet` has one (kept while they were
   * away), else a new one in the first colour nobody has. Not if they're at it already, or it's full.
   * Says whether anything changed.
   */
  join(peer: string, name: string, wallet: string): boolean {
    if (this.at(peer)) return false;
    const mine = this.seats.find((s) => s.wallet === wallet);
    if (mine) {
      // On another page of theirs too: this one has it now.
      mine.peer = peer;
      mine.name = name.slice(0, 24);
      delete mine.awayAt;
      return true;
    }
    if (this.seats.length >= MAX_SEATS) return false;
    const color = ROULETTE_COLORS.find((c) => !this.seats.some((s) => s.color === c))!;
    this.seats.push({ id: `r${++this.ids}`, name: name.slice(0, 24), color, peer, wallet });
    return true;
  }

  /** `peer` got up (walked off, left the casino or the office): their place and chips stay, away. Says whether they were at the table. */
  away(peer: string): boolean {
    this.bucket.delete(peer);
    const s = this.at(peer);
    if (!s) return false;
    delete s.peer;
    s.awayAt = this.now();
    return true;
  }

  /**
   * `peer` leaves the table on purpose. While bets are still being taken their chips come back to
   * them; once the wheel's spinning they stay down, and anything they win is still paid to them.
   * Says whether they were at the table.
   */
  left(peer: string): boolean {
    this.bucket.delete(peer);
    const s = this.at(peer);
    if (!s) return false;
    if (this.phase === 'idle' || this.phase === 'betting') this.refund(s);
    this.seats = this.seats.filter((o) => o !== s);
    return true;
  }

  /**
   * `peer` puts `amount` chips on `spot` (a Spot id from shared/roulette.ts). Only while bets are
   * taken, on a real spot, a whole number within the table's limits (MAX_SPOT on a spot, MAX_TOTAL in
   * a round), and only chips they have: the bank takes them there and then. The first chips down
   * start the clock. Says whether they went down.
   */
  bet(peer: string, spot: unknown, amount: unknown): boolean {
    const s = this.at(peer);
    const sp = spotOf(spot);
    if (!s || !sp || !amountOk(amount) || (this.phase !== 'idle' && this.phase !== 'betting')) return false;
    if (this.phase === 'betting' && this.now() >= this.endsAt) return false;
    const there = this.bets.find((b) => b.seat === s.id && b.spot === sp.id);
    if ((there?.amount ?? 0) + amount > MAX_SPOT || staked(this.bets, s.id) + amount > MAX_TOTAL) return false;
    if (this.tooSoon(peer)) return false;
    if (!this.bank.bet(s.wallet, amount, 'roulette.bet', { quiet: true })) return false;
    if (there) there.amount += amount;
    else this.bets.push({ seat: s.id, spot: sp.id, amount, wallet: s.wallet });
    if (this.phase === 'idle') {
      this.phase = 'betting';
      this.endsAt = this.now() + BET_TIME;
      this.round++;
      this.wins = [];
      this.number = null;
    }
    return true;
  }

  /** `peer` picks their chips up off `spot` (or off the whole layout, with none), back into their balance: only while bets are taken. Says whether there were any. */
  unbet(peer: string, spot?: unknown): boolean {
    const s = this.at(peer);
    if (!s || this.phase !== 'betting' || this.now() >= this.endsAt) return false;
    if (spot !== undefined && !spotOf(spot)) return false;
    if (this.tooSoon(peer)) return false;
    return this.refund(s, spot as string | undefined);
  }

  /**
   * The clock: bets close when the betting time's up ("rien ne va plus") and the number's picked;
   * once the ball's had time to land, the winners are paid; a while after, the layout's cleared for
   * the next round. Places kept too long for people who are away with nothing down are let go. Says
   * whether anything changed.
   */
  tick(): boolean {
    const now = this.now();
    let changed = false;
    if (this.phase === 'betting' && now >= this.endsAt) {
      changed = true;
      if (this.bets.length === 0) this.phase = 'idle';
      else {
        this.phase = 'spinning';
        this.number = this.spin();
        this.endsAt = now + SPIN_TIME;
      }
    } else if (this.phase === 'spinning' && now >= this.endsAt) {
      changed = true;
      const n = this.number!;
      this.wins = settle(this.bets, n);
      // Paid to whose chips they were, whether they're still at the table or not.
      const wallets = new Map<string, number>();
      for (const b of this.bets) {
        const spot = spotOf(b.spot)!;
        if (spot.numbers.includes(n)) wallets.set(b.wallet, (wallets.get(b.wallet) ?? 0) + this.paid(b, n));
      }
      for (const [wallet, paid] of wallets) this.bank.award(wallet, paid, 'roulette.win');
      this.history = [n, ...this.history].slice(0, HISTORY);
      this.phase = 'result';
      this.endsAt = now + RESULT_TIME;
    } else if (this.phase === 'result' && now >= this.endsAt) {
      changed = true;
      this.phase = 'idle';
      this.bets = [];
      this.wins = [];
      this.number = null;
    }
    const before = this.seats.length;
    this.seats = this.seats.filter((s) => s.peer || now - (s.awayAt ?? now) < AWAY_KEEP || this.bets.some((b) => b.seat === s.id));
    return changed || this.seats.length !== before;
  }

  /** The office is shutting down: chips on the layout of a round that hasn't been paid yet go back to whoever put them there. */
  close() {
    if (this.phase === 'betting' || this.phase === 'spinning') {
      const back = new Map<string, number>();
      for (const b of this.bets) back.set(b.wallet, (back.get(b.wallet) ?? 0) + b.amount);
      for (const [wallet, amount] of back) this.bank.award(wallet, amount, 'roulette.refund', { quiet: true });
    }
    this.bets = [];
    this.phase = 'idle';
  }

  private paid(b: Bet, n: number): number {
    return settle([b], n)[0]?.paid ?? 0;
  }

  /** Gives `s` back their chips on `spot` (or on the whole layout): says whether there were any. */
  private refund(s: Seat, spot?: string): boolean {
    const mine = this.bets.filter((b) => b.seat === s.id && (spot === undefined || b.spot === spot));
    if (!mine.length) return false;
    this.bets = this.bets.filter((b) => !mine.includes(b));
    const amount = mine.reduce((sum, b) => sum + b.amount, 0);
    this.bank.award(s.wallet, amount, 'roulette.refund', { quiet: true });
    return true;
  }

  private at(peer: string): Seat | undefined {
    return this.seats.find((s) => s.peer === peer);
  }

  /** Whether `peer` has been putting chips down (or picking them up) faster than anyone clicks. */
  private tooSoon(peer: string): boolean {
    const now = this.now();
    const b = this.bucket.get(peer) ?? { tokens: BURST, at: now };
    b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * REFILL);
    b.at = now;
    this.bucket.set(peer, b);
    if (b.tokens < 1) return true;
    b.tokens--;
    return false;
  }
}
