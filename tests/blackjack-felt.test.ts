import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBlackjack, type BjHand, type BlackjackState, type Card } from '../src/shared/blackjack.js';
import { BLACKJACK_FELT, BLACKJACK_TABLE } from '../src/shared/casino.js';
import { cardSpots } from '../src/client/blackjack.js';
import { CARD_W, CARD_H } from '../src/client/world/cards.js';
import type { CardSpot } from '../src/client/world/cards.js';

const view = { table: BLACKJACK_TABLE, spots: BLACKJACK_FELT.spots, dealerSpot: BLACKJACK_FELT.dealer };
const edge = -BLACKJACK_TABLE.size.width / 2;
/** The felt inside the rail: a half ellipse this far round from the middle of the straight edge. */
const FELT = { x: BLACKJACK_TABLE.size.length / 2 - 0.13, y: BLACKJACK_TABLE.size.width - 0.13 };
const BET_R = 0.065;
/** The chip tray along the straight edge: this far either side of the middle, 0.18 in. */
const TRAY = 0.34;

let n = 0;
/** `k` different cards (keys must differ within a seat). */
const cards = (k: number): Card[] => Array.from({ length: k }, () => (['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'][n++ % 13] + 'SHDC'[Math.floor(n / 13) % 4]) as Card);
const hand = (k: number): BjHand => ({ cards: cards(k), bet: 10, doubled: false, split: false, done: false });

/** Every seat taken, each with `hands` hands of `each` cards, and the dealer with `dealer` cards. */
function table(hands: number, each: number, dealer: number): BlackjackState {
  const d = emptyBlackjack();
  d.round = {
    players: BLACKJACK_TABLE.seats.map((_, seat) => ({ seat, id: `p${seat}`, name: `P${seat}`, hands: Array.from({ length: hands }, () => hand(each)), insurance: null })),
    dealer: cards(dealer),
    hole: false,
    phase: 'dealer',
    turn: null,
  };
  return d;
}

/** A card's corners on the felt. */
function corners(s: CardSpot): [number, number][] {
  const r = s.rot ?? 0;
  const ax = [Math.cos(r), -Math.sin(r)];
  const az = [Math.sin(r), Math.cos(r)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [s.x + (ax[0] * i * CARD_W) / 2 + (az[0] * j * CARD_H) / 2, s.z + (ax[1] * i * CARD_W) / 2 + (az[1] * j * CARD_H) / 2]);
}

/** Two cards overlap: no axis of either separates them. */
function overlap(a: CardSpot, b: CardSpot): boolean {
  const pa = corners(a);
  const pb = corners(b);
  for (const p of [pa, pb]) {
    for (let i = 0; i < 2; i++) {
      const ex = p[i + 1][0] - p[i][0];
      const ey = p[i + 1][1] - p[i][1];
      const proj = (q: [number, number][]) => q.map(([x, y]) => x * -ey + y * ex);
      const A = proj(pa);
      const B = proj(pb);
      if (Math.max(...A) <= Math.min(...B) || Math.max(...B) <= Math.min(...A)) return false;
    }
  }
  return true;
}

/** How near a card comes to point (x, y). */
function distance(s: CardSpot, x: number, y: number): number {
  const r = s.rot ?? 0;
  const dx = x - s.x;
  const dy = y - s.z;
  const lx = Math.abs(dx * Math.cos(r) - dy * Math.sin(r)) - CARD_W / 2;
  const ly = Math.abs(dx * Math.sin(r) + dy * Math.cos(r)) - CARD_H / 2;
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
}

const seatOf = (s: CardSpot) => (s.key.startsWith('d') ? 'dealer' : s.key.slice(1, s.key.indexOf(':')));

for (const [what, d] of [
  ['five seats with long hands', table(1, 6, 7)],
  ['five seats all split, four cards a hand', table(2, 4, 7)],
] as const) {
  test(`blackjack felt: ${what}: the dealer's cards, each seat's and its neighbours' stay apart, off the bets and on the felt`, () => {
    const spots = cardSpots(d, view);
    for (const a of spots) {
      for (const b of spots) {
        if (seatOf(a) !== seatOf(b)) assert.ok(!overlap(a, b), `${a.key} lies on ${b.key}`);
      }
      // Clear of every betting circle, the chips in it included.
      for (const p of BLACKJACK_FELT.spots) assert.ok(distance(a, p.bet.x, p.bet.y) > BET_R, `${a.key} lies on a bet`);
      for (const [x, y] of corners(a)) {
        assert.ok(y > edge + 0.18 || Math.abs(x) > TRAY, `${a.key} lies on the chip tray`);
        assert.ok((x / FELT.x) ** 2 + ((y - edge) / FELT.y) ** 2 < 1, `${a.key} hangs over the rail`);
      }
    }
    // The dealer's cards well apart from any player's: a hand's width at least.
    const dealer = spots.filter((s) => seatOf(s) === 'dealer');
    for (const s of spots.filter((x) => seatOf(x) !== 'dealer')) {
      for (const c of dealer) assert.ok(Math.hypot(s.x - c.x, s.z - c.z) > CARD_H * 1.5, `${s.key} is right by the dealer's ${c.key}`);
    }
  });
}

test("blackjack felt: a split's two hands lie side by side, not on each other", () => {
  const spots = cardSpots(table(2, 3, 2), view);
  for (let seat = 0; seat < BLACKJACK_TABLE.seats.length; seat++) {
    const mine = spots.filter((s) => seatOf(s) === String(seat));
    const [h1, h2] = [mine.slice(0, 3), mine.slice(3)];
    for (const a of h1) for (const b of h2) assert.ok(!overlap(a, b), `seat ${seat}: ${a.key} lies on ${b.key}`);
  }
});

test("blackjack felt: each seat's place is out toward its own stool, its bet behind its cards", () => {
  BLACKJACK_FELT.spots.forEach((p, i) => {
    const s = BLACKJACK_TABLE.seats[i];
    const toStool = Math.atan2(s.z - edge, s.x);
    const toCards = Math.atan2(p.cards.y - edge, p.cards.x);
    assert.ok(Math.abs(toStool - toCards) < 0.3, `seat ${i}'s cards are off to one side`);
    assert.ok(Math.hypot(p.bet.x, p.bet.y - edge) > Math.hypot(p.cards.x, p.cards.y - edge) + CARD_H, `seat ${i}'s bet isn't behind its cards`);
  });
});
