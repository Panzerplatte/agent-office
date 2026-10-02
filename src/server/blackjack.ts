import { randomInt } from 'node:crypto';
import { BlackjackGame, MAX_SEATS, betOk, type BjAction, type BjRoundView, type Rand } from '../shared/blackjack.js';
import type { BlackjackSeat, BlackjackState, BlackjackStage } from '../shared/blackjack.js';

/** How long the table takes bets once the first is down (ms); it deals sooner once everyone at it has bet. */
export const BET_TIME = 15_000;
/** How long everyone has to say whether they want insurance (ms). */
export const INSURANCE_TIME = 10_000;
/** How long a player has for each move (ms): then their hand stands. */
export const TURN_TIME = 25_000;
/** Between the dealer's cards (ms), so everyone sees them come one at a time. */
export const DEALER_STEP = 800;
/** How long the results stay up before the next round's bets (ms). */
export const RESULTS_TIME = 6_000;

/**
 * Where the chips come from and go to: the chips bank (see server/chips.ts), by the chips id a seat
 * was taken with. `take` takes a stake (false if they haven't got it: nothing's taken), `give` pays
 * out, stake included.
 */
export interface BlackjackBank {
  balance(key: string): number;
  take(key: string, amount: number, why: string): boolean;
  give(key: string, amount: number, why: string): void;
}

export interface BlackjackOptions {
  /** What the bank's bookings say they were for: `<label>.bet`, `.double`, `.split`, `.insurance`, `.win` (the label "blackjack" by default). */
  label?: string;
  now?: () => number;
  rand?: Rand;
  /** Something changed on its own (a clock ran out, the dealer drew): tell the table's pages. */
  changed?: () => void;
  /** Set its own timers for the clocks (the default); off, `tick()` is called by hand (tests). */
  timers?: boolean;
}

/** A seat, and who it's kept for: `key` says it's the same person back (their account, or their browser). */
interface Seat extends BlackjackSeat {
  key: string;
}

/**
 * A blackjack table: up to MAX_SEATS players against the dealer (the office), with the game (see
 * shared/blackjack.ts) and the clocks round it. Nothing about where it stands: the casino has one,
 * and anything else that wants a table (online blackjack at the PCs) makes its own.
 *
 * Rounds go: bets (once the first one's down, BET_TIME for the others, or straight on once everyone
 * sitting there has bet), the deal (each stake taken through the bank then, so a bet can never be
 * more than you have), insurance under an ace, the players hand by hand (TURN_TIME each move; an away
 * player's hand can be skipped by the others, and stands when the time's up), the dealer card by card,
 * then the results, and each player is paid through the bank, and back to bets.
 *
 * A seat is kept by who someone is (`key`), not their connection: walking off, a reload or a dropped
 * connection only makes them away, and sitting down again puts them back in it, their hands and their
 * bet. Away players aren't dealt into the next round, and lose their seat once they're in none.
 * Leave gives it up at once: their hands stand, and they're still paid what they win.
 */
export class BlackjackTable {
  readonly game: BlackjackGame;
  private seats: Seat[] = [];
  private stage: BlackjackStage = 'idle';
  /** When the stage's clock runs out (ms), if it has one. */
  private deadline: number | null = null;
  private clockLength = 0;
  /** The key of each player in the round, by their seat id: who to pay, even after they've left. */
  private roundKeys = new Map<string, string>();
  private ids = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly label: string;

  constructor(
    private readonly bank: BlackjackBank,
    private readonly opts: BlackjackOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.label = opts.label ?? 'blackjack';
    this.game = new BlackjackGame(opts.rand ?? randomInt);
  }

  /** The table as everyone may see it: no keys, no shoe, the hole card hidden. */
  state(): BlackjackState {
    const seats = this.seats.map(({ key: _, ...s }) => ({ ...s }));
    const round: BjRoundView | null = this.game.view();
    return {
      seats,
      stage: this.stage,
      left: this.deadline === null ? null : Math.max(0, this.deadline - this.now()),
      clock: this.clockLength,
      round,
      shoe: { left: this.game.shoe.length, cut: this.game.cutCard, shuffled: this.game.shuffled && !!round },
    };
  }

  /** Stops the clocks: the table's going away. */
  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * `peer` sits down (`key`: who they are): back in their seat if they have one, under `peer` now;
   * otherwise at `at` if that's free (or the first free seat). Not if the table's full, or they're
   * sitting already. Says whether anything changed.
   */
  join(peer: string, name: string, key: string, at?: unknown): boolean {
    const mine = this.seats.find((s) => s.key === key);
    if (mine) {
      if (mine.peer === peer) return false;
      mine.peer = peer;
      mine.name = name.slice(0, 24);
      return true;
    }
    if (this.at(peer) || this.seats.length >= MAX_SEATS) return false;
    const taken = new Set(this.seats.map((s) => s.seat));
    const wanted = typeof at === 'number' && Number.isInteger(at) && at >= 0 && at < MAX_SEATS && !taken.has(at) ? at : undefined;
    const seat = wanted ?? [...Array(MAX_SEATS).keys()].find((i) => !taken.has(i))!;
    this.seats.push({ seat, id: `b${++this.ids}`, name: name.slice(0, 24), peer, key, bet: 0 });
    this.seats.sort((a, b) => a.seat - b.seat);
    return true;
  }

  /** `peer` stepped away (walked off, left the floor, lost the connection): kept, away, while they're in a round or have a bet down; otherwise gone. */
  away(peer: string): boolean {
    const s = this.at(peer);
    if (!s) return false;
    delete s.peer;
    this.tidy();
    this.maybeDeal();
    return true;
  }

  /** `peer` gets up for good: their bet back off the table, their hands in a round stand (and are still paid). */
  left(peer: string): boolean {
    const s = this.at(peer);
    if (!s) return false;
    this.seats = this.seats.filter((o) => o !== s);
    if (this.game.running) {
      this.game.leave(s.id);
      this.afterMove();
    }
    this.tidy();
    this.maybeDeal();
    return true;
  }

  /**
   * `peer` puts `amount` down for the next round (0 takes their bet back): only while bets are open,
   * and not more than they have. The first bet starts the clock; everyone having bet deals at once.
   */
  bet(peer: string, amount: unknown): boolean {
    const s = this.at(peer);
    if (!s || (this.stage !== 'idle' && this.stage !== 'betting')) return false;
    if (amount === 0) {
      if (!s.bet) return false;
      s.bet = 0;
      if (!this.seats.some((o) => o.bet)) this.setStage('idle');
      return true;
    }
    if (!betOk(amount) || this.bank.balance(s.key) < amount) return false;
    s.bet = amount;
    s.last = amount;
    if (this.stage === 'idle') this.setStage('betting', BET_TIME);
    this.maybeDeal();
    return true;
  }

  /** `peer` deals now, without waiting out the clock: only with a bet of their own down. */
  deal(peer: string): boolean {
    const s = this.at(peer);
    if (!s || this.stage !== 'betting' || !s.bet) return false;
    return this.startRound();
  }

  /** `peer` hits, stands, doubles or splits on their hand that's up; a double or split only if they've the chips for it. */
  act(peer: string, action: unknown): boolean {
    const s = this.at(peer);
    if (!s || this.stage !== 'playing' || (action !== 'hit' && action !== 'stand' && action !== 'double' && action !== 'split')) return false;
    const a = action as BjAction;
    if (!this.game.actions(s.id).includes(a)) return false;
    const cost = this.game.cost(s.id, a);
    if (cost && !this.bank.take(s.key, cost, `${this.label}.${a}`)) return false;
    this.game.act(s.id, a);
    this.afterMove();
    return true;
  }

  /** `peer` takes insurance (half their stake, if they have it) or doesn't. */
  insure(peer: string, take: unknown): boolean {
    const s = this.at(peer);
    if (!s || this.stage !== 'insurance' || typeof take !== 'boolean') return false;
    const cost = this.game.cost(s.id, 'insurance');
    const p = this.game.player(s.id);
    if (!p || p.insurance !== null) return false;
    const yes = take && cost > 0 && this.bank.take(s.key, cost, `${this.label}.insurance`);
    this.game.insure(s.id, yes);
    this.afterMove();
    return true;
  }

  /** Someone at the table skips the hand that's up, whose player is away: it stands. */
  skip(peer: string): boolean {
    if (!this.at(peer) || this.stage !== 'playing') return false;
    const up = this.game.up();
    if (!up || this.seats.find((s) => s.id === up.player.id)?.peer) return false;
    this.game.standUp();
    this.afterMove();
    return true;
  }

  /** The clocks: called when one runs out (by its own timer, or by hand). Says whether anything changed. */
  tick(): boolean {
    if (this.deadline === null || this.now() < this.deadline) return false;
    switch (this.stage) {
      case 'betting':
        if (!this.startRound()) {
          for (const s of this.seats) s.bet = 0;
          this.setStage('idle');
          this.tidy();
        }
        return true;
      case 'insurance':
        this.game.closeInsurance();
        this.afterMove();
        return true;
      case 'playing':
        this.game.standUp();
        this.afterMove();
        return true;
      case 'dealer':
        this.game.dealerStep();
        this.afterMove();
        return true;
      case 'done':
        this.game.round = null;
        this.roundKeys.clear();
        this.setStage('idle');
        this.tidy();
        return true;
      default:
        this.deadline = null;
        return false;
    }
  }

  /** The seat `peer` sits in. */
  private at(peer: string): Seat | undefined {
    return this.seats.find((s) => s.peer === peer);
  }

  /** Bets are open and everyone sitting there (and here) has bet: deal. */
  private maybeDeal() {
    if (this.stage !== 'betting') return;
    const here = this.seats.filter((s) => s.peer);
    if (here.length && here.every((s) => s.bet)) this.startRound();
  }

  /**
   * Deals to everyone here with a bet down, taking each stake through the bank (anyone who can't pay
   * it any more sits this one out). Says whether a round started.
   */
  private startRound(): boolean {
    const entries = [];
    for (const s of this.seats) {
      if (s.peer && s.bet && this.bank.take(s.key, s.bet, `${this.label}.bet`)) {
        entries.push({ seat: s.seat, id: s.id, name: s.name, bet: s.bet });
        this.roundKeys.set(s.id, s.key);
      }
      s.bet = 0;
    }
    if (!this.game.deal(entries)) {
      this.roundKeys.clear();
      return false;
    }
    this.afterMove();
    this.tidy();
    return true;
  }

  /** After anything happened in the round: on to the stage it's at now, with its clock; and once it's over, everyone's paid. */
  private afterMove() {
    const r = this.game.round;
    if (!r) return;
    if (r.phase === 'insurance') this.setStage('insurance', INSURANCE_TIME, this.stage === 'insurance');
    else if (r.phase === 'playing') this.setStage('playing', TURN_TIME);
    else if (r.phase === 'dealer') this.setStage('dealer', DEALER_STEP);
    else if (this.stage !== 'done') {
      for (const p of r.players) {
        const key = this.roundKeys.get(p.id);
        if (key && p.paid) this.bank.give(key, p.paid, `${this.label}.win`);
      }
      this.setStage('done', RESULTS_TIME);
    }
  }

  /** On to `stage`, with a clock of `ms` (none without), unless `keep` says the clock running now goes on. */
  private setStage(stage: BlackjackStage, ms?: number, keep = false) {
    this.stage = stage;
    if (!keep) {
      this.deadline = ms === undefined ? null : this.now() + ms;
      this.clockLength = ms ?? 0;
    }
    this.arm();
  }

  private arm() {
    if (this.opts.timers === false) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.deadline === null) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (this.tick()) this.opts.changed?.();
        else this.arm();
      },
      Math.max(0, this.deadline - this.now()) + 5,
    );
    this.timer.unref?.();
  }

  /** Away seats are only kept while they're in the round, or have a bet down for the next one. */
  private tidy() {
    const playing = new Set(this.game.running || this.stage === 'done' ? this.game.round!.players.map((p) => p.id) : []);
    this.seats = this.seats.filter((s) => s.peer || playing.has(s.id) || (s.bet && this.stage === 'betting'));
    if (this.stage === 'betting' && !this.seats.some((s) => s.bet)) this.setStage('idle');
  }
}
