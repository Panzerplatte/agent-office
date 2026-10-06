// Blackjack: the rules, and a round of it against the dealer (the office). Nothing in here knows about
// a table, a floor, a timer or chips: the office keeps a BlackjackGame per table (see
// server/blackjack.ts), takes the stakes before it calls an action that costs some, and pays out what
// the round says once it's over. Six decks, the dealer stands on soft 17, blackjack pays 3:2, double on
// any first two cards (after a split too), split once, insurance when the dealer shows an ace.

// ---- Cards ------------------------------------------------------------------------------------------

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
/** A card as two letters, its rank and its suit: "AS" the ace of spades, "TH" the ten of hearts. */
export type Card = `${Rank}${Suit}`;

export const rankOf = (c: Card) => c[0] as Rank;
export const suitOf = (c: Card) => c[1] as Suit;

export function isCard(c: unknown): c is Card {
  return typeof c === 'string' && c.length === 2 && (RANKS as readonly string[]).includes(c[0]) && (SUITS as readonly string[]).includes(c[1]);
}

/** One 52-card deck, in order. */
export function deck(): Card[] {
  return SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}` as Card));
}

/** A whole number from 0 up to (not including) `n`. The office uses crypto's randomInt. */
export type Rand = (n: number) => number;

/** Shuffles `cards` in place (Fisher–Yates). */
export function shuffle<T>(cards: T[], rand: Rand): T[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// ---- Hands ------------------------------------------------------------------------------------------

/** What a card counts for: 2–9 their number, ten and the faces 10, an ace 1 (or 11, see handValue). */
export function cardValue(c: Card): number {
  const r = rankOf(c);
  return r === 'A' ? 1 : r === 'T' || r === 'J' || r === 'Q' || r === 'K' ? 10 : Number(r);
}

/** A hand's total, with one ace counted as 11 if that doesn't take it over 21 (then it's `soft`). */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let ace = false;
  for (const c of cards) {
    total += cardValue(c);
    if (rankOf(c) === 'A') ace = true;
  }
  return ace && total + 10 <= 21 ? { total: total + 10, soft: true } : { total, soft: false };
}

export const total = (cards: readonly Card[]) => handValue(cards).total;

/** Two cards making 21: an ace and a ten or face. (A split hand's 21 isn't one; see BjHand.split.) */
export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && total(cards) === 21;
}

export const busted = (cards: readonly Card[]) => total(cards) > 21;

/** The dealer draws to 16 and stands on every 17, a soft one too. */
export function dealerHits(cards: readonly Card[]): boolean {
  return total(cards) < 17;
}

// ---- The rules --------------------------------------------------------------------------------------

/** Decks in the shoe. */
export const DECKS = 6;
/** The cut card: once fewer than this many cards are left, the shoe's shuffled before the next round (a quarter of it). */
export const CUT_CARD = Math.round((DECKS * 52) / 4);
/** Players at a table, at most. */
export const MAX_SEATS = 5;
/** The smallest and biggest bet on one hand, in chips. */
export const MIN_BET = 5;
export const MAX_BET = 10_000;

/** Whether `bet` is a bet the table takes (a whole number of chips, MIN_BET to MAX_BET). */
export function betOk(bet: unknown): bet is number {
  return typeof bet === 'number' && Number.isInteger(bet) && bet >= MIN_BET && bet <= MAX_BET;
}

/**
 * How a hand came out: `blackjack` (won 3:2), `win` (1:1), `push` (stake back), `lose`, or `bust` (over
 * 21: lost, whatever the dealer does).
 */
export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

/**
 * Everything a hand that came out `outcome` gives back for a stake of `bet`, stake included: 2.5× for a
 * blackjack (3:2, rounded down to a whole chip), 2× for a win, the stake for a push, nothing otherwise.
 */
export function payout(outcome: Outcome, bet: number): number {
  return outcome === 'blackjack' ? bet + Math.floor((bet * 3) / 2) : outcome === 'win' ? 2 * bet : outcome === 'push' ? bet : 0;
}

/** How `cards` (a player's hand; `split` if it came from a split) does against the dealer's `dealer`. */
export function outcome(cards: readonly Card[], split: boolean, dealer: readonly Card[]): Outcome {
  if (busted(cards)) return 'bust';
  const bj = !split && isBlackjack(cards);
  const dealerBj = isBlackjack(dealer);
  if (bj) return dealerBj ? 'push' : 'blackjack';
  if (dealerBj || busted(dealer)) return dealerBj ? 'lose' : 'win';
  const me = total(cards);
  const them = total(dealer);
  return me > them ? 'win' : me < them ? 'lose' : 'push';
}

// ---- A round ----------------------------------------------------------------------------------------

/** One of a player's hands: its cards, its stake (doubled if it was), and, once the round's over, how it came out and what it paid. */
export interface BjHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  /** It's one of the two from a split: 21 on two cards isn't a blackjack. */
  split: boolean;
  /** Stood, bust, 21, doubled, or a split ace: no more cards. */
  done: boolean;
  outcome?: Outcome;
  paid?: number;
}

/**
 * Someone playing in a round: at seat `seat` (0 … MAX_SEATS-1), `id` (who the table knows them as,
 * the same all the time they sit there) and their hands (one, or two after a split). `insurance` is
 * what they put on it (0 for none); null while the dealer's ace waits for them to say.
 * `paid` is everything the round gives them back, once it's over (hands and insurance).
 */
export interface BjPlayer {
  seat: number;
  id: string;
  name: string;
  hands: BjHand[];
  insurance: number | null;
  insurancePaid?: number;
  paid?: number;
}

/**
 * Where a round is: `insurance` (the dealer shows an ace, and players say whether they want insurance),
 * `playing` (hand by hand, seat by seat), `dealer` (the hole card's turned over and the dealer draws,
 * one card at a time; see dealerStep) and `done` (settled: every hand has its outcome and pay).
 */
export type BjPhase = 'insurance' | 'playing' | 'dealer' | 'done';

export interface BjRound {
  players: BjPlayer[];
  /** The dealer's cards: the first one face up, the second (the hole card) face down until `hole` is false. */
  dealer: Card[];
  hole: boolean;
  phase: BjPhase;
  /** Whose hand's up while `playing`: indices into `players` and their `hands`. */
  turn: { player: number; hand: number } | null;
}

/** A round as everyone may see it: the hole card (while it's face down) is null. */
export interface BjRoundView extends Omit<BjRound, 'dealer'> {
  dealer: (Card | null)[];
}

export type BjAction = 'hit' | 'stand' | 'double' | 'split';

/** What `id` may do in round `r` now: only on their turn, and only what the hand allows (double on two cards, split two of the same value, once). */
export function allowed(r: BjRound | BjRoundView, id: string): BjAction[] {
  if (r.phase !== 'playing' || !r.turn) return [];
  const p = r.players[r.turn.player];
  if (p?.id !== id) return [];
  const c = p.hands[r.turn.hand].cards;
  const out: BjAction[] = ['hit', 'stand'];
  if (c.length === 2) out.push('double');
  if (c.length === 2 && p.hands.length === 1 && cardValue(c[0]) === cardValue(c[1])) out.push('split');
  return out;
}

/** A player's stake for the round they're dealt into. */
export interface BjEntry {
  seat: number;
  id: string;
  name: string;
  bet: number;
}

/**
 * A blackjack game: the shoe and the round on the table. Pure: no timers, no money. `deal` starts a
 * round with the stakes the table's already taken; every action that costs more (double, split,
 * insurance) says what it costs first (`cost`), so the table can take that before it calls it.
 * Once the round's `done`, each player's `paid` is what to give them back.
 */
export class BlackjackGame {
  shoe: Card[] = [];
  /** The shoe was shuffled for the round now on the table. */
  shuffled = false;
  round: BjRound | null = null;

  constructor(
    private readonly rand: Rand,
    readonly decks = DECKS,
    readonly cutCard = CUT_CARD,
  ) {
    this.newShoe();
  }

  /** A fresh shoe of `decks` decks, shuffled. */
  newShoe() {
    this.shoe = shuffle(Array.from({ length: this.decks }, deck).flat(), this.rand);
    this.shuffled = true;
  }

  /** The next card off the shoe (a fresh shoe if it's ever run out mid-round, which a cut card a quarter in all but rules out). */
  draw(): Card {
    if (this.shoe.length === 0) this.newShoe();
    return this.shoe.pop()!;
  }

  /** Whether the next round's dealt from a fresh shoe: the cut card's come out. */
  get atCut(): boolean {
    return this.shoe.length < this.cutCard;
  }

  /** Whether a round is on (dealt and not settled yet). */
  get running(): boolean {
    return !!this.round && this.round.phase !== 'done';
  }

  /**
   * Deals a new round to `entries` (at most one per seat, in seat order whatever order they're in):
   * a card each and one up for the dealer, then a second each and the hole card. A blackjack's done at
   * once. With an ace up it's on to insurance; otherwise the dealer peeks under a ten, and with a
   * blackjack there the round's over before anyone plays. Null with nobody to deal to, or one still on.
   */
  deal(entries: readonly BjEntry[]): BjRound | null {
    if (this.running) return null;
    const seen = new Set<number>();
    const ids = new Set<string>();
    const players: BjPlayer[] = [...entries]
      .filter((e) => e.bet > 0 && e.seat >= 0 && e.seat < MAX_SEATS && !seen.has(e.seat) && !ids.has(e.id) && seen.add(e.seat) && ids.add(e.id))
      .sort((a, b) => a.seat - b.seat)
      .map((e) => ({ seat: e.seat, id: e.id, name: e.name, hands: [{ cards: [], bet: e.bet, doubled: false, split: false, done: false }], insurance: null }));
    if (players.length === 0) return null;
    this.shuffled = false;
    if (this.atCut) this.newShoe();
    const dealer: Card[] = [];
    for (let i = 0; i < 2; i++) {
      for (const p of players) p.hands[0].cards.push(this.draw());
      dealer.push(this.draw());
    }
    for (const p of players) if (isBlackjack(p.hands[0].cards)) p.hands[0].done = true;
    this.round = { players, dealer, hole: true, phase: 'playing', turn: null };
    if (rankOf(dealer[0]) === 'A') this.round.phase = 'insurance';
    else this.afterPeek();
    return this.round;
  }

  /** The player `id` in the round, and where they are in it. */
  player(id: string): BjPlayer | undefined {
    return this.round?.players.find((p) => p.id === id);
  }

  /** The hand that's up, and whose it is. */
  up(): { player: BjPlayer; hand: BjHand } | null {
    const r = this.round;
    if (!r || r.phase !== 'playing' || !r.turn) return null;
    const player = r.players[r.turn.player];
    return { player, hand: player.hands[r.turn.hand] };
  }

  /** What `id` may do now (see allowed). */
  actions(id: string): BjAction[] {
    return this.round ? allowed(this.round, id) : [];
  }

  /** What more `action` (or insurance) would cost `id` now, in chips: a double or split another stake, insurance half one. 0 if it's free (or not allowed). */
  cost(id: string, action: BjAction | 'insurance'): number {
    if (action === 'insurance') {
      const p = this.player(id);
      return this.round?.phase === 'insurance' && p && p.insurance === null ? Math.floor(p.hands[0].bet / 2) : 0;
    }
    if (action !== 'double' && action !== 'split') return 0;
    return this.actions(id).includes(action) ? this.up()!.hand.bet : 0;
  }

  /**
   * `id` does `action` on the hand that's up: hit (a card; over 21 it's bust, and on 21 it stands),
   * stand, double (twice the stake, one card, done) or split (two hands of one card each, a card on
   * each; split aces get just that one). Says whether they could; the table takes what it costs first.
   */
  act(id: string, action: BjAction): boolean {
    if (!this.actions(id).includes(action)) return false;
    const { player, hand } = this.up()!;
    if (action === 'hit') {
      hand.cards.push(this.draw());
      if (total(hand.cards) >= 21) hand.done = true;
    } else if (action === 'stand') hand.done = true;
    else if (action === 'double') {
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(this.draw());
      hand.done = true;
    } else {
      const aces = rankOf(hand.cards[0]) === 'A';
      const second: BjHand = { cards: [hand.cards.pop()!], bet: hand.bet, doubled: false, split: true, done: false };
      hand.split = true;
      player.hands.push(second);
      for (const h of player.hands) {
        h.cards.push(this.draw());
        if (aces || total(h.cards) === 21) h.done = true;
      }
    }
    this.advance();
    return true;
  }

  /** The hand that's up stands, whoever's it is: its player's away and their time's up, or they left. Says whether there was one. */
  standUp(): boolean {
    const up = this.up();
    if (!up) return false;
    up.hand.done = true;
    this.advance();
    return true;
  }

  /** `id` leaves mid-round: all their hands stand where they are (and are paid as they come out). */
  leave(id: string) {
    const p = this.player(id);
    if (!p || !this.running) return;
    for (const h of p.hands) h.done = true;
    if (p.insurance === null) p.insurance = 0;
    if (this.round!.phase === 'insurance') this.maybeInsured();
    else if (this.round!.phase === 'playing') this.advance();
  }

  /** `id` takes insurance (its cost, `cost(id, 'insurance')`, already taken) or not. Once everyone's said, the dealer peeks. */
  insure(id: string, take: boolean): boolean {
    const p = this.player(id);
    if (this.round?.phase !== 'insurance' || !p || p.insurance !== null) return false;
    p.insurance = take ? Math.floor(p.hands[0].bet / 2) : 0;
    this.maybeInsured();
    return true;
  }

  /** Time's up for insurance: whoever hasn't said has none, and the dealer peeks. */
  closeInsurance() {
    const r = this.round;
    if (r?.phase !== 'insurance') return;
    for (const p of r.players) if (p.insurance === null) p.insurance = 0;
    this.afterPeek();
  }

  /**
   * The dealer's next move, once the players are done: turns the hole card over (first), then draws
   * one card at a time to 17 (only while someone's still in it: not if every hand's bust or a
   * blackjack), and then settles the round. Says what it did ('done' once it's settled).
   */
  dealerStep(): 'reveal' | 'draw' | 'done' | null {
    const r = this.round;
    if (r?.phase !== 'dealer') return null;
    if (r.hole) {
      r.hole = false;
      return 'reveal';
    }
    const live = r.players.some((p) => p.hands.some((h) => !busted(h.cards) && !(isBlackjack(h.cards) && !h.split)));
    if (live && dealerHits(r.dealer)) {
      r.dealer.push(this.draw());
      return 'draw';
    }
    this.settle();
    return 'done';
  }

  /** Plays the dealer out at once (no one watching it card by card). */
  dealerPlay() {
    while (this.round?.phase === 'dealer') this.dealerStep();
  }

  /** The round as everyone at the table may see it (the hole card hidden while it's face down). */
  view(): BjRoundView | null {
    const r = this.round;
    if (!r) return null;
    const v = structuredClone(r) as BjRoundView;
    if (r.hole) v.dealer = [r.dealer[0], ...r.dealer.slice(1).map(() => null)];
    return v;
  }

  /** Once everyone's said about insurance: the dealer peeks. */
  private maybeInsured() {
    if (this.round!.players.every((p) => p.insurance !== null)) this.afterPeek();
  }

  /** The dealer looks at the hole card (under an ace or a ten): a blackjack there ends the round now; otherwise it's on to the players. */
  private afterPeek() {
    const r = this.round!;
    if (isBlackjack(r.dealer)) {
      r.hole = false;
      this.settle();
      return;
    }
    r.phase = 'playing';
    r.turn = { player: 0, hand: 0 };
    this.advance();
  }

  /** On to the next hand that isn't done (this one, if it isn't); with none, the dealer's turn. */
  private advance() {
    const r = this.round!;
    if (r.phase !== 'playing') return;
    let { player, hand } = r.turn ?? { player: 0, hand: 0 };
    while (player < r.players.length) {
      const hands = r.players[player].hands;
      while (hand < hands.length) {
        if (!hands[hand].done) {
          r.turn = { player, hand };
          return;
        }
        hand++;
      }
      player++;
      hand = 0;
    }
    r.turn = null;
    r.phase = 'dealer';
  }

  /** Every hand's outcome and pay, insurance's too (2:1 if the dealer had blackjack), and each player's total. */
  private settle() {
    const r = this.round!;
    const dealerBj = isBlackjack(r.dealer);
    for (const p of r.players) {
      let paid = 0;
      for (const h of p.hands) {
        h.done = true;
        h.outcome = outcome(h.cards, h.split, r.dealer);
        h.paid = payout(h.outcome, h.bet);
        paid += h.paid;
      }
      p.insurance ??= 0;
      p.insurancePaid = dealerBj ? p.insurance * 3 : 0;
      p.paid = paid + p.insurancePaid;
    }
    r.turn = null;
    r.phase = 'done';
  }
}

/** Everything `p` put on the table this round: their hands' stakes (doubles and splits included) and insurance. */
export function staked(p: BjPlayer): number {
  return p.hands.reduce((s, h) => s + h.bet, 0) + (p.insurance ?? 0);
}

// ---- At a table -------------------------------------------------------------------------------------

/**
 * Someone's seat at a table: which of the MAX_SEATS places (`seat`, 0 on the dealer's left), its id
 * (the same while they come and go, and their id in the round), their name, and what they've put down
 * for the next round (`bet`, 0 for nothing yet; `last` what they bet last time, for the same again).
 * `peer` is the PeerInfo id of whoever's in it now; none while they're away.
 */
export interface BlackjackSeat {
  seat: number;
  id: string;
  name: string;
  peer?: string;
  bet: number;
  last?: number;
}

/**
 * Where a table is: `idle` (nobody's bet), `betting` (bets are down, the clock's running for the
 * rest), then the round's phases: `insurance`, `playing`, `dealer`, and `done` (the results, for a
 * moment, before it's back to idle).
 */
export type BlackjackStage = 'idle' | 'betting' | 'insurance' | 'playing' | 'dealer' | 'done';

/**
 * A table as its pages see it: the seats, the stage, the clock (`left` ms of `clock` ms, or null for
 * none), the round (hole card hidden) and how far through the shoe it is (`shuffled`: this round
 * was dealt from a fresh one).
 */
export interface BlackjackState {
  seats: BlackjackSeat[];
  stage: BlackjackStage;
  left: number | null;
  clock: number;
  round: BjRoundView | null;
  shoe: { left: number; cut: number; shuffled: boolean };
}

export function emptyBlackjack(): BlackjackState {
  return { seats: [], stage: 'idle', left: null, clock: 0, round: null, shoe: { left: DECKS * 52, cut: CUT_CARD, shuffled: false } };
}
