// No-limit Texas Hold'em at the casino's poker table: the cards, the hand ranking, side pots and the
// betting rules. The office deals and decides everything (see server/poker.ts); this is the rule
// book both it and the pages read from. Pure, so the tests can play hands through it card by card.

// ---- Cards ------------------------------------------------------------------------------------------

/** Two to ace, low to high: a card's rank is its index here (0 is a deuce, 12 an ace). */
export const RANKS = '23456789TJQKA';
/** Clubs, diamonds, hearts, spades. */
export const SUITS = 'cdhs';

/** A card as two characters, rank then suit: 'As' is the ace of spades, 'Td' the ten of diamonds. */
export type Card = string;

export function isCard(v: unknown): v is Card {
  return typeof v === 'string' && v.length === 2 && RANKS.includes(v[0]) && SUITS.includes(v[1]);
}

export const rankOf = (c: Card) => RANKS.indexOf(c[0]);
export const suitOf = (c: Card) => c[1];

/** All 52, in order. */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

/** A shuffled deck (Fisher–Yates), with `randomInt(n)` a whole number from 0 to n - 1: on the office, crypto's. */
export function shuffled(randomInt: (n: number) => number): Card[] {
  const deck = freshDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ---- Hands ------------------------------------------------------------------------------------------

/** What a hand is, weakest first: its index here is how strong. */
export const CATEGORIES = ['high', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush'] as const;
export type HandCategory = (typeof CATEGORIES)[number];

/**
 * How strong a five-card hand is: its category, then the ranks that break ties between two hands of
 * that category, most important first (for two pair: the high pair, the low pair, the kicker; for a
 * straight: just its top card, 3 for the wheel A-2-3-4-5). `score` puts all that in one number, so
 * a bigger score is a better hand and equal scores split the pot. `cards` are the five that make it.
 */
export interface HandValue {
  category: HandCategory;
  ranks: number[];
  score: number;
  cards: Card[];
}

/** The value of exactly five cards. */
export function value5(cards: readonly Card[]): HandValue {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const distinct = [...new Set(ranks)];
  let straightTop = -1;
  if (distinct.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightTop = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3) straightTop = 3; // A-2-3-4-5: the ace plays low
  }
  // The ranks grouped by how many of each there are, biggest group first, then the higher rank.
  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  const groups = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);
  let category: HandCategory;
  let tie: number[];
  if (straightTop >= 0 && flush) [category, tie] = ['straightFlush', [straightTop]];
  else if (groups[0][1] === 4) [category, tie] = ['quads', byGroup];
  else if (groups[0][1] === 3 && groups[1][1] === 2) [category, tie] = ['fullHouse', byGroup];
  else if (flush) [category, tie] = ['flush', ranks];
  else if (straightTop >= 0) [category, tie] = ['straight', [straightTop]];
  else if (groups[0][1] === 3) [category, tie] = ['trips', byGroup];
  else if (groups[0][1] === 2 && groups[1][1] === 2) [category, tie] = ['twoPair', byGroup];
  else if (groups[0][1] === 2) [category, tie] = ['pair', byGroup];
  else [category, tie] = ['high', ranks];
  let score = CATEGORIES.indexOf(category);
  for (let i = 0; i < 5; i++) score = score * 13 + (tie[i] ?? 0);
  return { category, ranks: tie, score, cards: [...cards] };
}

/** The best five-card hand out of five to seven cards (hole cards and the board). */
export function bestHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5) throw new Error('bestHand needs five cards or more');
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = value5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || v.score > best.score) best = v;
          }
  return best!;
}

/** Above 0 if `a` beats `b`, below 0 if it loses, 0 for a split. */
export const compareHands = (a: HandValue, b: HandValue) => a.score - b.score;

// ---- Pots -------------------------------------------------------------------------------------------

/** A pot, and who can win it: the main pot first, then each side pot. */
export interface Pot {
  amount: number;
  eligible: string[];
}

/**
 * The pots for what everyone has put in this hand (`total`): each all-in level makes a pot that only
 * those who put in at least that much can win. Folded players' chips are in the pots but they can't
 * win any. Pots with the same people in them are one pot. Chips nobody still in the hand could win
 * (more than any of them put in: an uncalled bet's already back, so only a fold can leave that) go in
 * the pot below.
 */
export function buildPots(players: readonly { id: string; total: number; folded: boolean }[]): Pot[] {
  const levels = [...new Set(players.map((p) => p.total).filter((t) => t > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.total, level) - prev);
    const eligible = players.filter((p) => !p.folded && p.total >= level).map((p) => p.id);
    const last = pots[pots.length - 1];
    if (last && (eligible.length === 0 || sameIds(last.eligible, eligible))) last.amount += amount;
    else pots.push({ amount, eligible });
    prev = level;
  }
  return pots.filter((p) => p.amount > 0);
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// ---- The table --------------------------------------------------------------------------------------

/** Seats round the table: hands are for two to this many. */
export const SEATS = 6;
export const MIN_PLAYERS = 2;
/** The blinds, in chips. */
export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
/** What you can sit down with (and top up to between hands), in chips: 10 to 1,000 big blinds (up to 10,000, for high rollers). */
export const MIN_BUY_IN = 10 * BIG_BLIND;
export const MAX_BUY_IN = 1000 * BIG_BLIND;
/** How long you have to act on your turn (ms) before the office checks or folds for you. */
export const TURN_MS = 30_000;
/** Dealer-Bots you can sit at the table, at most. */
export const MAX_BOTS = 3;
/** What a Dealer-Bot sits down with, and buys back in with when it's out. */
export const BOT_STACK = 1000;

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

/** What someone does on their turn. `raise` is to `to` chips in all this round (a bet when there's none yet). */
export type PokerAction = { kind: 'fold' } | { kind: 'check' } | { kind: 'call' } | { kind: 'raise'; to: number } | { kind: 'allin' };
export type ActionKind = PokerAction['kind'];
/** What someone did last, shown by their seat: an action, a bet (a raise from nothing), or posting a blind. */
export type LastAction = ActionKind | 'bet' | 'sb' | 'bb';

/** One player in a hand: their seat, what they have in front of them, and where they are in it. */
export interface HandPlayer {
  id: string;
  seat: number;
  stack: number;
  /** In this betting round. */
  bet: number;
  /** In this hand, all rounds. */
  total: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  /** Has acted in this betting round since it was last raised. */
  acted: boolean;
  /** The bet when they last acted this round, or -1: unless it's gone up by a full raise since, they can't raise again. */
  faced: number;
  /** The last thing they did, to show by their seat. */
  last?: LastAction;
}

/** What a hand ended with: each pot and who won it, what everyone got, and the hands shown. */
export interface HandResult {
  pots: { amount: number; winners: string[]; category?: HandCategory }[];
  /** What each winner got, in chips. */
  won: Record<string, number>;
  /** The hands that went to showdown: none when everyone else folded. */
  shown: Record<string, HandValue>;
}

/** A hand of Hold'em, from the blinds to the showdown. */
export interface Hand {
  players: HandPlayer[];
  /** Index into `players` of the button, the small blind and the big blind. */
  button: number;
  sb: number;
  bb: number;
  bigBlind: number;
  deck: Card[];
  board: Card[];
  street: Street;
  /** Whose turn it is (an index into `players`), or -1 when nobody's (the hand's over). */
  toAct: number;
  /** The most anyone has put in this round. */
  currentBet: number;
  /** How much the last full raise was by (the big blind until someone raises): a raise has to be at least that much more again. */
  minRaise: number;
  result: HandResult | null;
}

/**
 * Deals a hand for `players` (in seat order round the table, each with chips), with the button on
 * players[button]: posts the blinds (heads up, the button is the small blind), deals two cards each
 * off `deck` (which it takes cards from) and puts the first player on the turn.
 */
export function startHand(players: readonly { id: string; seat: number; stack: number }[], button: number, deck: Card[], blinds = { small: SMALL_BLIND, big: BIG_BLIND }): Hand {
  if (players.length < MIN_PLAYERS) throw new Error('a hand needs two players');
  const n = players.length;
  const ps: HandPlayer[] = players.map((p) => ({ id: p.id, seat: p.seat, stack: p.stack, bet: 0, total: 0, hole: [], folded: false, allIn: false, acted: false, faced: -1 }));
  const sb = n === 2 ? button : (button + 1) % n;
  const bb = (sb + 1) % n;
  const h: Hand = { players: ps, button, sb, bb, bigBlind: blinds.big, deck, board: [], street: 'preflop', toAct: -1, currentBet: 0, minRaise: blinds.big, result: null };
  put(h, sb, blinds.small);
  ps[sb].last = 'sb';
  put(h, bb, blinds.big);
  ps[bb].last = 'bb';
  h.currentBet = Math.max(ps[sb].bet, ps[bb].bet, blinds.big);
  for (let round = 0; round < 2; round++) for (let i = 1; i <= n; i++) ps[(button + i) % n].hole.push(deck.shift()!);
  h.toAct = h.bb;
  nextTurn(h);
  return h;
}

/** Moves up to `amount` from players[i]'s stack into their bet. */
function put(h: Hand, i: number, amount: number) {
  const p = h.players[i];
  const x = Math.min(amount, p.stack);
  p.stack -= x;
  p.bet += x;
  p.total += x;
  if (p.stack === 0) p.allIn = true;
}

/** Still in the hand and with chips behind: someone who can still act. */
const canAct = (p: HandPlayer) => !p.folded && !p.allIn;

/** What players[i] may do now, on their turn. */
export interface Options {
  /** Checking is free (nothing to call). */
  check: boolean;
  /** What calling costs (0 if there's nothing to call); can be less than the bet, all-in. */
  call: number;
  /** Whether they can bet or raise at all, and to how much (in all this round): from `min` to `max` (all-in). */
  raise: boolean;
  min: number;
  max: number;
}

export function options(h: Hand, i: number): Options {
  const p = h.players[i];
  const toCall = Math.max(0, h.currentBet - p.bet);
  const max = p.bet + p.stack;
  const reopened = p.faced < 0 || h.currentBet - p.faced >= h.minRaise;
  const raise = p.stack > toCall && reopened;
  const min = Math.min(max, h.currentBet === 0 ? h.bigBlind : h.currentBet + h.minRaise);
  return { check: toCall === 0, call: Math.min(toCall, p.stack), raise, min, max };
}

/**
 * Player `id` does `a`, if it's their turn and they may: then the hand goes on (the next player, the
 * next card, or the showdown). Says whether it counted. Raising to `max` (or anything over) is all-in,
 * as is calling with too few chips; a raise under the minimum is only allowed all-in.
 */
export function act(h: Hand, id: string, a: PokerAction): boolean {
  if (h.toAct < 0 || h.players[h.toAct].id !== id) return false;
  const i = h.toAct;
  const p = h.players[i];
  const o = options(h, i);
  const facing = h.currentBet;
  switch (a.kind) {
    case 'fold':
      p.folded = true;
      break;
    case 'check':
      if (!o.check) return false;
      break;
    case 'call':
      if (o.check) return false;
      put(h, i, o.call);
      break;
    case 'raise':
    case 'allin': {
      const to = a.kind === 'allin' ? o.max : Math.min(Math.floor(a.to), o.max);
      if (!Number.isFinite(to)) return false;
      if (to <= h.currentBet) {
        // All-in for no more than the bet: that's a call (for less).
        if (a.kind !== 'allin' || o.check) return false;
        put(h, i, o.call);
        break;
      }
      if (!o.raise || (to < o.min && to < o.max)) return false;
      const by = to - h.currentBet;
      put(h, i, to - p.bet);
      // Everyone else acts again; after an all-in short of a full raise, those who'd acted may only call or fold (see `faced`).
      if (by >= h.minRaise) h.minRaise = by;
      for (const q of h.players) if (q !== p) q.acted = false;
      h.currentBet = to;
      break;
    }
  }
  p.acted = true;
  p.faced = h.currentBet;
  p.last = p.allIn && a.kind !== 'fold' ? 'allin' : a.kind === 'raise' && facing === 0 ? 'bet' : a.kind;
  nextTurn(h);
  return true;
}

/**
 * Player `id` folds out of turn: they left the table for good. Their chips in the pot stay there.
 * Says whether they were still in the hand.
 */
export function foldOut(h: Hand, id: string): boolean {
  const i = h.players.findIndex((p) => p.id === id);
  if (i < 0 || h.toAct < 0 || h.players[i].folded) return false;
  if (i === h.toAct) return act(h, id, { kind: 'fold' });
  h.players[i].folded = true;
  h.players[i].last = 'fold';
  // Whoever's up stays up, unless that fold ended the round (or the hand): look on from just before them.
  h.toAct = (h.toAct - 1 + h.players.length) % h.players.length;
  nextTurn(h);
  return true;
}

/** Whether `p` still has to act this round: hasn't yet, or hasn't matched the bet. */
function needsToAct(h: Hand, p: HandPlayer): boolean {
  return !p.acted || p.bet < h.currentBet;
}

/**
 * Moves the turn on from players[h.toAct] to the next one who still has to act this round; if nobody
 * does, the round's over: the next card, or the showdown (running the board out when at most one
 * player can still bet), or the pot to the last one standing.
 */
function nextTurn(h: Hand) {
  for (;;) {
    const live = h.players.filter((p) => !p.folded);
    if (live.length <= 1) return finish(h);
    const actors = h.players.filter(canAct);
    // Alone with chips behind and nothing to call: nobody's left to bet against.
    const done = actors.length === 0 || (actors.length === 1 && actors[0].bet >= h.currentBet) || actors.every((p) => !needsToAct(h, p));
    if (!done) {
      const n = h.players.length;
      for (let k = 1; k <= n; k++) {
        const j = (h.toAct + k) % n;
        if (canAct(h.players[j]) && needsToAct(h, h.players[j])) {
          h.toAct = j;
          return;
        }
      }
    }
    // The round's over: everyone's bets go in, and the next card comes.
    for (const p of h.players) {
      p.bet = 0;
      p.acted = false;
      p.faced = -1;
    }
    h.currentBet = 0;
    h.minRaise = h.bigBlind;
    if (h.street === 'river') return finish(h);
    dealStreet(h);
    // First to act after the flop is the first one left of the button.
    h.toAct = h.button;
    if (h.players.filter(canAct).length < 2) {
      // Nobody can bet any more: run out the board.
      while ((h.street as Street) !== 'river') dealStreet(h);
      return finish(h);
    }
    for (const p of h.players) if (!p.folded && !p.allIn) p.last = undefined;
  }
}

function dealStreet(h: Hand) {
  h.deck.shift(); // burn
  const next: Record<string, Street> = { preflop: 'flop', flop: 'turn', turn: 'river' };
  h.street = next[h.street];
  h.board.push(...h.deck.splice(0, h.street === 'flop' ? 3 : 1));
}

/**
 * The hand's over: everything in goes to the pots, and each pot to the best hand that can win it
 * (split evenly when hands tie, the odd chip to the first winner left of the button). With one player
 * left it's all theirs, unseen.
 */
function finish(h: Hand) {
  h.toAct = -1;
  const live = h.players.filter((p) => !p.folded);
  const pots = buildPots(h.players);
  const won: Record<string, number> = {};
  const shown: Record<string, HandValue> = {};
  const showdown = live.length > 1;
  if (showdown) {
    while (h.board.length < 5) h.board.push(h.deck.shift()!); // (only reached with the board already out)
    for (const p of live) shown[p.id] = bestHand([...p.hole, ...h.board]);
  }
  const order = (id: string) => (h.players.findIndex((p) => p.id === id) - h.button - 1 + 2 * h.players.length) % h.players.length;
  const result: HandResult = { pots: [], won, shown };
  for (const pot of pots) {
    let winners = pot.eligible;
    if (showdown && winners.length > 1) {
      const top = Math.max(...winners.map((id) => shown[id].score));
      winners = winners.filter((id) => shown[id].score === top);
    }
    winners = [...winners].sort((a, b) => order(a) - order(b));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const id of winners) {
      const x = share + (odd-- > 0 ? 1 : 0);
      won[id] = (won[id] ?? 0) + x;
      h.players.find((p) => p.id === id)!.stack += x;
    }
    result.pots.push({ amount: pot.amount, winners, category: showdown && pot.eligible.length > 1 ? shown[winners[0]].category : undefined });
  }
  for (const p of h.players) p.bet = 0;
  h.street = 'showdown';
  h.result = result;
}

/** All the chips in the middle: what's been put in this hand, bets of this round included. */
export function potTotal(h: Hand): number {
  return h.players.reduce((s, p) => s + p.total, 0);
}

// ---- What the pages see -----------------------------------------------------------------------------

/** Someone in a seat, as everyone at the casino sees them. */
export interface PokerSeatView {
  /** Their place's id, which stays the same while they come and go. */
  id: string;
  name: string;
  /** A Dealer-Bot, not a person. */
  bot?: boolean;
  /** Who's sitting there now (a PeerInfo id); none while they're away. */
  peer?: string;
  /** Chips in front of them, not counting their bet. */
  stack: number;
  /** In this hand: dealt in, their bet this round, folded or all-in, and the last thing they did. */
  inHand: boolean;
  bet: number;
  folded: boolean;
  allIn: boolean;
  last?: LastAction;
  /** Their two cards: only for their owner, and for everyone once they're shown at the showdown. */
  cards?: Card[];
  /** They're sitting out of the next hand (away, or out of chips). */
  out?: boolean;
}

/** Your turn: what you may do (see Options). */
export interface PokerTurn extends Options {
  seat: number;
}

/**
 * The poker table, as one page sees it: the seats (SEATS of them, null for an empty one), the
 * button, the board and the pots, whose turn it is and how long they have left, and what the last
 * hand ended with. `you` is the seat you're sitting in; `turn` what you may do, when it's yours.
 */
export interface PokerState {
  seats: (PokerSeatView | null)[];
  hand: number;
  button: number;
  street: Street | null;
  board: Card[];
  /** The chips in the middle, bets of this round included. */
  pot: number;
  /** The pots when the hand's over (main pot first), with who won each. */
  result: { pots: { amount: number; winners: number[]; category?: HandCategory }[]; won: Record<number, number>; shown: Record<number, HandCategory> } | null;
  /** The seat whose turn it is, or -1. */
  toAct: number;
  /** How long they have left (ms), when the state was sent. */
  timeLeft: number;
  currentBet: number;
  you: number;
  /** Your seat, sitting there or not (kept for you while you're away), or -1. */
  kept: number;
  turn: PokerTurn | null;
}

export function emptyPoker(): PokerState {
  return { seats: Array(SEATS).fill(null), hand: 0, button: -1, street: null, board: [], pot: 0, result: null, toAct: -1, timeLeft: 0, currentBet: 0, you: -1, kept: -1, turn: null };
}
