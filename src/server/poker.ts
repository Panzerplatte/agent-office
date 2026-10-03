import { randomInt } from 'node:crypto';
import {
  BIG_BLIND, BOT_STACK, MAX_BOTS, MAX_BUY_IN, MIN_BUY_IN, MIN_PLAYERS, SEATS, TURN_MS,
  act, bestHand, foldOut, options, potTotal, shuffled, startHand,
  type Card, type Hand, type PokerAction, type PokerSeatView, type PokerState,
} from '../shared/poker.js';

/** What the table needs from the chips bank (server/chips.ts): taking a buy-in, and paying out. */
export interface Bank {
  bet(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
  award(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
}

/** How long the last hand's result stays on the table before the next is dealt (ms). */
export const SHOW_MS = 5000;
/** How long before the first hand once two can play (ms). */
const FIRST_MS = 1500;
/** How long a Dealer-Bot thinks, from..to (ms). */
const BOT_MS = [900, 2400] as const;
/** Someone who's been away this long between hands gets their chips back and their seat freed (ms). */
export const AWAY_MS = 15 * 60_000;

const BOT_NAMES = ['Dealer-Bot Ace', 'Dealer-Bot Chip', 'Dealer-Bot Lucky'];

/**
 * Someone in a seat: who they are (`key`, their account or browser, so a reload or a walk round the
 * room finds them their seat again), their chips id at the bank, and the chips in front of them.
 * `peer` is whoever's sitting there now; none while they're away.
 */
interface Sitter {
  id: string;
  seat: number;
  name: string;
  key: string;
  chips: string;
  peer?: string;
  bot?: boolean;
  /** Chips in front of them between hands (during one, the hand has them). */
  stack: number;
  awaySince?: number;
  /** Standing up when this hand's over: their chips go back then. */
  leaving?: boolean;
  /** Ran out of time on their turn: sitting out until they say they're back (sitting down again). */
  idle?: boolean;
}

/**
 * The casino's poker table: up to SEATS people (and Dealer-Bots) playing no-limit Hold'em, one hand
 * after another. You sit down with a buy-in from your chips, and get what's in front of you back when
 * you stand up. The office shuffles (crypto), deals, and runs every hand (see shared/poker.ts); a page
 * only ever sees its own hole cards, and everyone's that go to a showdown.
 *
 * A seat is kept by who sits in it, not by their connection: walking off, reloading or dropping out
 * only makes you away. Away, you're not dealt in, and if it's your turn the office checks or folds for
 * you at once. Only standing up (Leave, or Esc) gives the seat up.
 */
export class Poker {
  private sitters: Sitter[] = [];
  private hand: Hand | null = null;
  private handNo = 0;
  private button = -1;
  private nextAt = 0;
  /** When whoever's up got the turn, and when a bot who's up will act. */
  private turnAt = 0;
  private botAt = 0;
  private ids = 0;

  constructor(
    private bank: Bank,
    private now = () => Date.now(),
    private rand: (n: number) => number = (n) => randomInt(n),
  ) {}

  /** The table as `peer` (who's `key`) sees it: their own hole cards, and nobody else's until a showdown. */
  state(peer?: string, key?: string): PokerState {
    const h = this.hand;
    const me = peer ? this.sitters.find((s) => s.peer === peer) : undefined;
    const kept = key ? this.sitters.find((s) => !s.bot && s.key === key && !s.leaving) : undefined;
    const seats: (PokerSeatView | null)[] = Array(SEATS).fill(null);
    for (const s of this.sitters) {
      const p = h?.players.find((q) => q.id === s.id);
      const shown = !!p && !!h?.result?.shown[p.id];
      seats[s.seat] = {
        id: s.id,
        name: s.name,
        ...(s.bot ? { bot: true } : {}),
        ...(s.peer ? { peer: s.peer } : {}),
        stack: p ? p.stack : s.stack,
        inHand: !!p,
        bet: p?.bet ?? 0,
        folded: !!p?.folded,
        allIn: !!p?.allIn,
        ...(p?.last ? { last: p.last } : {}),
        ...(p && (s === me || shown) ? { cards: [...p.hole] } : {}),
        ...(!this.playing(s) ? { out: true } : {}),
      };
    }
    const toAct = h && h.toAct >= 0 ? h.players[h.toAct] : null;
    const seatOf = (id: string) => this.sitters.find((s) => s.id === id)?.seat ?? h?.players.find((p) => p.id === id)?.seat ?? -1;
    const r = h?.result;
    return {
      seats,
      hand: this.handNo,
      button: this.button,
      street: h?.street ?? null,
      board: h ? [...h.board] : [],
      pot: h ? potTotal(h) : 0,
      result: r ? {
        pots: r.pots.map((p) => ({ amount: p.amount, winners: p.winners.map(seatOf), ...(p.category ? { category: p.category } : {}) })),
        won: Object.fromEntries(Object.entries(r.won).map(([id, x]) => [seatOf(id), x])),
        shown: Object.fromEntries(Object.entries(r.shown).map(([id, v]) => [seatOf(id), v.category])),
      } : null,
      toAct: toAct ? toAct.seat : -1,
      timeLeft: toAct ? Math.max(0, this.turnAt + TURN_MS - this.now()) : 0,
      currentBet: h?.currentBet ?? 0,
      you: me?.seat ?? -1,
      kept: kept?.seat ?? -1,
      turn: toAct && me && toAct.id === me.id ? { seat: me.seat, ...options(h!, h!.toAct) } : null,
    };
  }

  /** Who's at the table now, for the server to send each their own state. */
  peers(): string[] {
    return this.sitters.flatMap((s) => (s.peer ? [s.peer] : []));
  }

  /**
   * `peer` sits down. If `key` (who they are) has a seat already, they're back in it; otherwise they
   * take `seat` (or the first free one) with `buyIn` chips, which the bank takes from `chips`: not
   * more than they have, and between MIN_BUY_IN and MAX_BUY_IN. Says whether they did.
   */
  sit(peer: string, name: string, key: string, chips: string, buyIn: unknown, seat?: unknown): boolean {
    const here = this.at(peer);
    if (here) {
      // Back from sitting out.
      if (!here.idle) return false;
      delete here.idle;
      this.schedule();
      return true;
    }
    const mine = this.sitters.find((s) => !s.bot && s.key === key);
    if (mine) {
      mine.peer = peer;
      mine.name = name.slice(0, 24);
      delete mine.awaySince;
      delete mine.leaving;
      delete mine.idle;
      this.schedule();
      return true;
    }
    if (typeof buyIn !== 'number' || !Number.isSafeInteger(buyIn) || buyIn < MIN_BUY_IN || buyIn > MAX_BUY_IN) return false;
    const want = typeof seat === 'number' && Number.isInteger(seat) && seat >= 0 && seat < SEATS ? seat : -1;
    const free = want >= 0 && !this.sitters.some((s) => s.seat === want) ? want : this.freeSeat();
    if (free < 0) return false;
    if (!this.bank.bet(chips, buyIn, 'poker.buyin', { quiet: true })) return false;
    this.sitters.push({ id: `p${++this.ids}`, seat: free, name: name.slice(0, 24), key, chips, peer, stack: buyIn });
    this.schedule();
    return true;
  }

  /** `peer` puts more chips in front of them between hands (up to MAX_BUY_IN in all), from the bank. */
  topUp(peer: string, amount: unknown): boolean {
    const s = this.at(peer);
    if (!s || this.inHand(s) || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return false;
    if (s.stack + amount > MAX_BUY_IN) return false;
    if (!this.bank.bet(s.chips, amount, 'poker.buyin', { quiet: true })) return false;
    s.stack += amount;
    this.schedule();
    return true;
  }

  /** `peer` walked off, reloaded or dropped out: they keep their seat, away. Says whether they were sitting. */
  away(peer: string): boolean {
    const s = this.at(peer);
    if (!s) return false;
    delete s.peer;
    s.awaySince = this.now();
    return true;
  }

  /** `peer` stands up: folded out of the hand (all-in, they stay in it), and their chips back once it's over. */
  leave(peer: string): boolean {
    const s = this.at(peer);
    if (!s) return false;
    this.standUp(s);
    return true;
  }

  /** Someone at the table sits a Dealer-Bot down (MAX_BOTS at most), so you can play alone or fill a table. */
  addBot(peer: string): boolean {
    if (!this.at(peer)) return false;
    const bots = this.sitters.filter((s) => s.bot);
    const seat = this.freeSeat();
    if (bots.length >= MAX_BOTS || seat < 0) return false;
    const name = BOT_NAMES.find((n) => !bots.some((b) => b.name === n))!;
    this.sitters.push({ id: `p${++this.ids}`, seat, name, key: `bot:${name}`, chips: '', bot: true, stack: BOT_STACK });
    this.schedule();
    return true;
  }

  /** Someone at the table sends a Dealer-Bot away (`seat`, or the last one that sat down): folded out of the hand it's in. */
  removeBot(peer: string, seat?: unknown): boolean {
    if (!this.at(peer)) return false;
    const bots = this.sitters.filter((s) => s.bot && !s.leaving);
    const b = typeof seat === 'number' ? bots.find((s) => s.seat === seat) : bots[bots.length - 1];
    if (!b) return false;
    this.standUp(b);
    return true;
  }

  /** `peer` acts on their turn. Says whether it counted. */
  act(peer: string, a: unknown): boolean {
    const s = this.at(peer);
    const action = parseAction(a);
    if (!s || !action || !this.hand || !this.upIs(s)) return false;
    return this.play(s.id, action);
  }

  /**
   * Moves the table on: acts for whoever's up when they're away or out of time (check, or fold), lets
   * a Dealer-Bot who's up act, deals the next hand when it's time, and frees the seats of people
   * who've been away too long. Says whether anything changed.
   */
  tick(): boolean {
    const now = this.now();
    let changed = false;
    const h = this.hand;
    if (h && h.toAct >= 0) {
      const id = h.players[h.toAct].id;
      const s = this.sitters.find((x) => x.id === id);
      if (s?.bot) {
        if (now >= this.botAt) changed = this.play(id, botAction(h, h.toAct, this.rand)) || changed;
      } else if (!s?.peer || now >= this.turnAt + TURN_MS) {
        // Out of time (not away): they sit out from the next hand, so the table doesn't wait on them every time.
        if (s?.peer) s.idle = true;
        changed = this.play(id, options(h, h.toAct).check ? { kind: 'check' } : { kind: 'fold' }) || changed;
      }
    }
    for (const s of this.sitters) if (!s.bot && !s.peer && !this.inHand(s) && s.awaySince !== undefined && now - s.awaySince >= AWAY_MS) {
      this.standUp(s);
      changed = true;
    }
    if ((!this.hand || this.hand.toAct < 0) && this.nextAt && now >= this.nextAt) {
      changed = this.deal() || changed;
    }
    return changed;
  }

  /** The office is shutting down: everyone gets back what's in front of them, and what they've put in a hand that's still on. */
  cashOutAll() {
    const h = this.hand;
    for (const s of this.sitters) {
      const p = h && h.toAct >= 0 ? h.players.find((q) => q.id === s.id) : undefined;
      if (p) s.stack = p.stack + p.total;
      this.payBack(s);
    }
    this.sitters = [];
    this.hand = null;
  }

  // ---- Inside -----------------------------------------------------------------------------------------

  private at(peer: string): Sitter | undefined {
    return this.sitters.find((s) => s.peer === peer);
  }

  private freeSeat(): number {
    for (let i = 0; i < SEATS; i++) if (!this.sitters.some((s) => s.seat === i)) return i;
    return -1;
  }

  private inHand(s: Sitter): boolean {
    return !!this.hand && this.hand.toAct >= 0 && this.hand.players.some((p) => p.id === s.id);
  }

  private upIs(s: Sitter): boolean {
    const h = this.hand;
    return !!h && h.toAct >= 0 && h.players[h.toAct].id === s.id;
  }

  /** Dealt into the next hand: has chips, and is a bot or there (not away, not standing up). */
  private playing(s: Sitter): boolean {
    return !s.leaving && !s.idle && (s.bot || !!s.peer) && this.stackOf(s) > 0;
  }

  private stackOf(s: Sitter): number {
    const p = this.hand?.players.find((q) => q.id === s.id);
    return p ? p.stack : s.stack;
  }

  /** Player `id` acts on the hand (or the office for them). */
  private play(id: string, a: PokerAction): boolean {
    return act(this.hand!, id, a) && this.after();
  }

  /** After an action: a new turn's clock, or the hand's over. */
  private after(): boolean {
    const h = this.hand!;
    const now = this.now();
    this.turnAt = now;
    this.botAt = now + BOT_MS[0] + this.rand(BOT_MS[1] - BOT_MS[0]);
    if (h.toAct < 0) this.settle();
    return true;
  }

  private standUp(s: Sitter) {
    delete s.peer;
    const h = this.hand;
    if (this.inHand(s)) {
      const p = h!.players.find((q) => q.id === s.id)!;
      s.leaving = true;
      if (!p.allIn && foldOut(h!, s.id)) this.after();
      return;
    }
    this.payBack(s);
    this.sitters = this.sitters.filter((o) => o !== s);
    this.tidy();
  }

  /** A person's chips go back to them at the bank; a bot's just go. */
  private payBack(s: Sitter) {
    if (!s.bot && s.stack > 0) this.bank.award(s.chips, s.stack, 'poker.cashout');
    s.stack = 0;
  }

  /** The hand's over: everyone's chips back in front of them, the leavers paid out, the next hand on its way. */
  private settle() {
    const h = this.hand!;
    for (const p of h.players) {
      const s = this.sitters.find((x) => x.id === p.id);
      if (s) s.stack = p.stack;
    }
    for (const s of [...this.sitters]) {
      if (s.leaving) {
        this.payBack(s);
        this.sitters = this.sitters.filter((o) => o !== s);
      } else if (s.bot && s.stack === 0) s.stack = BOT_STACK; // a bot that's out buys back in
    }
    this.nextAt = this.now() + SHOW_MS;
    this.tidy();
  }

  /** Nobody left but bots: they go too, and the table's cleared. */
  private tidy() {
    if (!this.sitters.some((s) => !s.bot)) {
      this.sitters = [];
      if (!this.hand || this.hand.toAct < 0) this.hand = null;
    }
    this.schedule();
  }

  /** A hand is due once two can play and someone (a person) is there; not if one's on. */
  private schedule() {
    if (this.hand && this.hand.toAct >= 0) return;
    const ready = this.sitters.filter((s) => this.playing(s)).length >= MIN_PLAYERS && this.sitters.some((s) => !s.bot && s.peer);
    if (!ready) this.nextAt = 0;
    else if (!this.nextAt) this.nextAt = this.now() + (this.hand ? SHOW_MS : FIRST_MS);
  }

  /** Deals the next hand, the button one on from the last, to everyone who's playing. */
  private deal(): boolean {
    this.nextAt = 0;
    const players = this.sitters.filter((s) => this.playing(s)).sort((a, b) => a.seat - b.seat);
    if (players.length < MIN_PLAYERS || !players.some((s) => !s.bot && s.peer)) {
      this.hand = null;
      return true;
    }
    const b = players.findIndex((s) => s.seat > this.button);
    const button = b < 0 ? 0 : b;
    this.button = players[button].seat;
    this.hand = startHand(players.map((s) => ({ id: s.id, seat: s.seat, stack: s.stack })), button, shuffled(this.rand));
    this.handNo++;
    this.after();
    return true;
  }
}

/** A page's action, checked: one of the kinds, and a whole number of chips for a raise. */
export function parseAction(a: unknown): PokerAction | null {
  if (!a || typeof a !== 'object') return null;
  const { kind, to } = a as { kind?: unknown; to?: unknown };
  if (kind === 'fold' || kind === 'check' || kind === 'call' || kind === 'allin') return { kind };
  if (kind === 'raise' && typeof to === 'number' && Number.isSafeInteger(to) && to > 0) return { kind, to };
  return null;
}

// ---- Dealer-Bots ----------------------------------------------------------------------------------------

/**
 * How often `hole` wins (ties count half) against `opponents` random hands on `board` filled out at
 * random, over `runs` deals: a Monte Carlo guess that's good enough for a bot.
 */
export function equity(hole: Card[], board: Card[], opponents: number, runs = 150, rand: (n: number) => number = (n) => Math.floor(Math.random() * n)): number {
  const known = new Set([...hole, ...board]);
  const rest = shuffled(rand).filter((c) => !known.has(c));
  let wins = 0;
  for (let r = 0; r < runs; r++) {
    // A partial shuffle: just the cards this deal needs.
    const need = 5 - board.length + 2 * opponents;
    for (let i = 0; i < need; i++) {
      const j = i + rand(rest.length - i);
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const full = [...board, ...rest.slice(0, 5 - board.length)];
    const mine = bestHand([...hole, ...full]).score;
    let best = 0;
    for (let o = 0; o < opponents; o++) {
      const k = 5 - board.length + 2 * o;
      const v = bestHand([rest[k], rest[k + 1], ...full]).score;
      if (v > best) best = v;
    }
    if (mine > best) wins++;
    else if (mine === best) wins += 0.5;
  }
  return wins / runs;
}

/**
 * What a Dealer-Bot does on its turn: it guesses its chances against everyone still in, then bets or
 * raises a good hand (about two thirds of the pot), calls when the pot's odds are worth it, checks
 * when it's free and otherwise folds, with the odd bluff so it can't be read like a book.
 */
export function botAction(h: Hand, i: number, rand: (n: number) => number = (n) => randomInt(n)): PokerAction {
  const p = h.players[i];
  const o = options(h, i);
  const opponents = h.players.filter((q) => q !== p && !q.folded).length;
  const eq = equity(p.hole, h.board, Math.max(1, opponents), 150, rand);
  const pot = potTotal(h);
  const odds = o.call / (pot + o.call);
  const roll = rand(100);
  // A fair share is 1 in (opponents + 1): it raises with well over that.
  const strong = 0.25 + 0.75 / (opponents + 1);
  const sized = (frac: number) => {
    const base = h.currentBet === 0 ? Math.round(pot * frac) : h.currentBet + Math.round((pot + o.call) * frac);
    return Math.min(o.max, Math.max(o.min, Math.round(base / BIG_BLIND) * BIG_BLIND || o.min));
  };
  const raised = h.street === 'preflop' ? h.currentBet > h.bigBlind : h.currentBet > 0;
  if (o.raise && (eq > strong || (roll < 6 && eq > 0.25 && !raised))) {
    // Don't keep re-raising: facing a raise, a strong but not huge hand just calls.
    if (raised && eq < strong + 0.15) return { kind: 'call' };
    const to = sized(0.5 + rand(40) / 100);
    return to >= o.max ? { kind: 'allin' } : { kind: 'raise', to };
  }
  if (o.check) return { kind: 'check' };
  if (eq > odds + 0.04 || (o.call <= BIG_BLIND && eq > 0.2)) return { kind: 'call' };
  return { kind: 'fold' };
}
