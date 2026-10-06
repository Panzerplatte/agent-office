import test from 'node:test';
import assert from 'node:assert/strict';
import { BIG_BLIND, BOT_STACK, MAX_BUY_IN, MIN_BUY_IN, SMALL_BLIND, TURN_MS, act, bestHand, buildPots, compareHands, foldOut, freshDeck, options, potTotal, shuffled, startHand, value5, type Card, type Hand } from '../src/shared/poker.js';
import { Poker, SHOW_MS, botAction, equity, parseAction } from '../src/server/poker.js';

const cards = (s: string) => s.split(' ') as Card[];
const best = (s: string) => bestHand(cards(s));
const beats = (a: string, b: string) => compareHands(best(a), best(b));

// ---- Hands ------------------------------------------------------------------------------------------

test('every category is recognised, from high card to a royal flush', () => {
  const hands: [string, string][] = [
    ['high', 'As Kd 9c 7h 3s'],
    ['pair', 'As Ad 9c 7h 3s'],
    ['twoPair', 'As Ad 9c 9h 3s'],
    ['trips', 'As Ad Ac 7h 3s'],
    ['straight', 'As 2d 3c 4h 5s'],
    ['straight', 'Ts 9d 8c 7h 6s'],
    ['flush', 'As Js 9s 7s 3s'],
    ['fullHouse', 'As Ad Ac 7h 7s'],
    ['quads', 'As Ad Ac Ah 7s'],
    ['straightFlush', '9h 8h 7h 6h 5h'],
    ['straightFlush', 'Ah Kh Qh Jh Th'],
  ];
  for (const [category, h] of hands) assert.equal(value5(cards(h)).category, category, h);
  // and each category beats the one below it
  for (let i = 1; i < hands.length; i++) assert.ok(value5(cards(hands[i][1])).score >= value5(cards(hands[i - 1][1])).score, hands[i][1]);
});

test('the wheel is the lowest straight, and the ace does not wrap round', () => {
  assert.ok(beats('6s 5d 4c 3h 2s', 'As 2d 3c 4h 5s') > 0);
  assert.equal(best('Qs Kd Ac 2h 3s').category, 'high');
  assert.ok(beats('Ah 2h 3h 4h 5h', 'Ks Kd Kc Kh As') > 0, 'a steel wheel still beats quads');
});

test('kickers break ties, and the same hand on different suits splits', () => {
  assert.ok(beats('As Ad Kc 7h 3s', 'Ah Ac Qd 7s 3d') > 0, 'pair of aces, king kicker');
  assert.ok(beats('As Ad 9c 7h 4s', 'Ah Ac 9d 7s 3d') > 0, 'down to the last kicker');
  assert.ok(beats('Ks Kd 4c 4h As', 'Kh Kc 4d 4s Qd') > 0, 'two pair, kicker');
  assert.ok(beats('Ks Kd 5c 5h 2s', 'Kh Kc 4d 4s Ad') > 0, 'the second pair counts before the kicker');
  assert.ok(beats('3s 3d 3c 2h 2s', '2c 2d 2h As Ad') > 0, 'full house: trips first');
  assert.ok(beats('As Js 9s 7s 4s', 'Ah Jh 9h 7h 3h') > 0, 'flush: all five cards');
  assert.equal(beats('As Ad Kc 7h 3s', 'Ah Ac Kd 7s 3d'), 0, 'split');
  assert.equal(beats('Ts 9d 8c 7h 6s', 'Th 9c 8d 7s 6h'), 0);
});

test('the best five of seven, with the board playing', () => {
  const v = best('Ah Kh Qh Jh 2c 3d Th');
  assert.equal(v.category, 'straightFlush');
  assert.deepEqual(v.ranks, [12]);
  assert.equal(best('2c 3d As Ks Qs Js Ts').category, 'straightFlush', 'the board plays');
  assert.equal(best('Ac Ad Kh Kd Ks 2c 2d').category, 'fullHouse');
  assert.deepEqual(best('Ac Ad Kh Kd Ks 2c 2d').ranks.slice(0, 2), [11, 12], 'kings full of aces');
  assert.deepEqual(best('Ac Ad Kh Kd Qs Qc 2d').ranks, [12, 11, 10], 'the best two pair, queen kicker');
  assert.equal(best('7c 8d 9h Ts Jc Qd 2h').ranks[0], 10, 'the highest straight');
  assert.equal(best('7c 7d 7h 7s Ac 2d 3h').ranks[1], 12, 'quads with an ace kicker');
  // Two players on one board: the board's straight, and one with a higher one
  assert.ok(beats('Ah 2c 9s Ts Jd Qc Kh', '3d 4c 9s Ts Jd Qc Kh') > 0);
  assert.equal(beats('2h 3c 9s Ts Jd Qc Kh', '4d 5c 9s Ts Jd Qc Kh'), 0, 'both play the board');
});

test('a shuffled deck has all 52 cards, once each', () => {
  let x = 7;
  const d = shuffled((n) => (x = (x * 1103515245 + 12345) % 2 ** 31) % n);
  assert.equal(d.length, 52);
  assert.deepEqual([...d].sort(), freshDeck().sort());
});

// ---- Pots -------------------------------------------------------------------------------------------

test('side pots: each all-in makes a pot only those who covered it can win', () => {
  const pots = buildPots([
    { id: 'a', total: 50, folded: false },
    { id: 'b', total: 100, folded: false },
    { id: 'c', total: 300, folded: false },
    { id: 'd', total: 300, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 200, eligible: ['a', 'b', 'c', 'd'] },
    { amount: 150, eligible: ['b', 'c', 'd'] },
    { amount: 400, eligible: ['c', 'd'] },
  ]);
});

test('side pots: folded chips stay in, but the folder wins none of it', () => {
  const pots = buildPots([
    { id: 'a', total: 80, folded: true },
    { id: 'b', total: 50, folded: false },
    { id: 'c', total: 200, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 150, eligible: ['b', 'c'] },
    { amount: 180, eligible: ['c'] },
  ]);
  // Pots with the same people in them are one.
  assert.deepEqual(buildPots([
    { id: 'a', total: 10, folded: true },
    { id: 'b', total: 40, folded: false },
    { id: 'c', total: 40, folded: false },
  ]), [{ amount: 90, eligible: ['b', 'c'] }]);
});

// ---- Betting ----------------------------------------------------------------------------------------

/** A hand with the cards stacked: `holes` for each player in seat order, then the board (burns in between). */
function deal(stacks: number[], button: number, holes: string[], board = '2c 3d 4h 8s 9c') {
  const n = stacks.length;
  const order: Card[] = [];
  // Hole cards go one at a time round the table from the left of the button.
  for (let r = 0; r < 2; r++) for (let k = 1; k <= n; k++) order.push(cards(holes[(button + k) % n])[r]);
  const b = cards(board);
  const deck = [...order, 'Xx', b[0], b[1], b[2], 'Xx', b[3], 'Xx', b[4]];
  const players = stacks.map((stack, i) => ({ id: 'p' + i, seat: i, stack }));
  return startHand(players, button, deck as Card[]);
}

const up = (h: Hand) => h.players[h.toAct]?.id;
const stacks = (h: Hand) => h.players.map((p) => p.stack);

test('the blinds go round with the button, and preflop starts left of the big blind', () => {
  const h = deal([1000, 1000, 1000, 1000], 0, ['Ah Kd', '2s 7c', '3h 8d', '4c 9s']);
  assert.equal(h.players[1].bet, 5);
  assert.equal(h.players[2].bet, 10);
  assert.equal(up(h), 'p3');
  assert.deepEqual(h.players[3].hole, ['4c', '9s']);
  const h2 = deal([1000, 1000, 1000, 1000], 2, ['Ah Kd', '2s 7c', '3h 8d', '4c 9s']);
  assert.equal(h2.players[3].bet, 5);
  assert.equal(h2.players[0].bet, 10);
  assert.equal(up(h2), 'p1');
});

test('heads up the button is the small blind: first preflop, last after the flop', () => {
  const h = deal([1000, 1000], 0, ['Ah Kd', '2s 7c']);
  assert.equal(h.players[0].bet, 5);
  assert.equal(h.players[1].bet, 10);
  assert.equal(up(h), 'p0');
  assert.ok(act(h, 'p0', { kind: 'call' }));
  assert.equal(up(h), 'p1', 'the big blind gets its option');
  assert.ok(options(h, 1).check && options(h, 1).raise);
  assert.ok(act(h, 'p1', { kind: 'check' }));
  assert.equal(h.street, 'flop');
  assert.deepEqual(h.board, ['2c', '3d', '4h']);
  assert.equal(up(h), 'p1', 'the big blind acts first after the flop');
});

test('only the player who is up can act, and only legally', () => {
  const h = deal([1000, 1000, 1000], 0, ['Ah Kd', '2s 7c', '3h 8d']);
  assert.equal(up(h), 'p0');
  assert.equal(act(h, 'p1', { kind: 'fold' }), false, 'not their turn');
  assert.equal(act(h, 'p0', { kind: 'check' }), false, 'there is a bet to call');
  assert.equal(act(h, 'p0', { kind: 'raise', to: 15 }), false, 'a raise has to be at least the big blind more');
  assert.ok(act(h, 'p0', { kind: 'raise', to: 30 }));
  assert.equal(h.currentBet, 30);
  assert.equal(options(h, 1).min, 50, 'the next raise is by at least 20 again');
  assert.equal(act(h, 'p1', { kind: 'raise', to: 45 }), false);
  assert.ok(act(h, 'p1', { kind: 'raise', to: 100 }));
  assert.equal(options(h, 2).min, 170);
  assert.equal(options(h, 2).call, 90);
  assert.ok(act(h, 'p2', { kind: 'fold' }));
  assert.ok(act(h, 'p0', { kind: 'call' }));
  assert.equal(h.street, 'flop');
  assert.equal(potTotal(h), 210);
  assert.equal(up(h), 'p1', 'first left of the button after the flop');
  assert.equal(options(h, 1).min, 10, 'a bet is at least the big blind');
});

test('everyone folds to a bet: the bettor takes the pot unseen', () => {
  const h = deal([1000, 1000, 1000], 0, ['Ah Kd', '2s 7c', '3h 8d']);
  act(h, 'p0', { kind: 'raise', to: 40 });
  act(h, 'p1', { kind: 'fold' });
  act(h, 'p2', { kind: 'fold' });
  assert.equal(h.toAct, -1);
  assert.equal(h.street, 'showdown');
  assert.deepEqual(h.result!.won, { p0: 55 });
  assert.deepEqual(h.result!.shown, {});
  assert.deepEqual(stacks(h), [1015, 995, 990]);
});

test('checked down to a showdown, the best hand wins; a tie splits with the odd chip left of the button', () => {
  const h = deal([1000, 1000, 1000], 0, ['Ah Kd', 'As Kc', '7h 7d'], '2c 3d 9h Qs Jc');
  act(h, 'p0', { kind: 'call' });
  act(h, 'p1', { kind: 'call' });
  act(h, 'p2', { kind: 'check' });
  for (const street of ['flop', 'turn', 'river']) {
    assert.equal(h.street, street);
    act(h, 'p1', { kind: 'check' });
    act(h, 'p2', { kind: 'check' });
    act(h, 'p0', { kind: 'check' });
  }
  assert.equal(h.street, 'showdown');
  assert.equal(h.result!.pots[0].category, 'pair');
  assert.deepEqual(h.result!.pots[0].winners, ['p2']);
  // A split: both play aces and kings
  const t = deal([1000, 1000, 1000], 1, ['Ah Kd', '7h 7d', 'As Kc'], 'Ac Kh 2d 2s 9c');
  // button p1, sb p2, bb p0; p1 first
  act(t, 'p1', { kind: 'fold' });
  assert.equal(act(t, 'p2', { kind: 'raise', to: 15 }), false, 'a raise of 5 is not enough');
  assert.equal(t.players[2].bet, 5);
  act(t, 'p2', { kind: 'call' });
  act(t, 'p0', { kind: 'check' });
  for (let i = 0; i < 3; i++) {
    act(t, 'p2', { kind: 'check' });
    act(t, 'p0', { kind: 'check' });
  }
  assert.deepEqual(t.result!.pots, [{ amount: 20, winners: ['p2', 'p0'], category: 'twoPair' }]);
  assert.deepEqual(t.result!.won, { p2: 10, p0: 10 });
});

test('the odd chip of a split goes to the first winner left of the button', () => {
  // Three in: one folds after putting 5 in, so 25 splits between two: 13 to the first left of the button
  const h = deal([1000, 1000, 1000], 0, ['As Kc', '7h 7d', 'Ah Kd'], 'Ac Kh 2d 2s 9c');
  // button p0 (first preflop), sb p1, bb p2
  act(h, 'p0', { kind: 'call' });
  act(h, 'p1', { kind: 'fold' });
  act(h, 'p2', { kind: 'check' });
  for (let i = 0; i < 3; i++) {
    act(h, 'p2', { kind: 'check' });
    act(h, 'p0', { kind: 'check' });
  }
  assert.deepEqual(h.result!.won, { p2: 13, p0: 12 });
  assert.deepEqual(stacks(h), [1002, 995, 1003]);
});

test('all-in for less makes a side pot, and the board runs out', () => {
  // p0 has 50, p1 200, p2 1000. p0 has the best hand, p1 the second best.
  const h = deal([50, 200, 1000], 0, ['Ah Ad', 'Kh Kd', '7c 2s'], 'Ac Kc 9d 5h 3s');
  act(h, 'p0', { kind: 'allin' });
  assert.equal(h.players[0].allIn, true);
  act(h, 'p1', { kind: 'allin' });
  act(h, 'p2', { kind: 'call' });
  assert.equal(h.street, 'showdown', 'nobody can bet any more: the board runs out');
  assert.equal(h.board.length, 5);
  assert.deepEqual(h.result!.pots.map((p) => [p.amount, p.winners]), [[150, ['p0']], [300, ['p1']]]);
  assert.deepEqual(stacks(h), [150, 300, 800]);
  assert.equal(stacks(h).reduce((a, b) => a + b), 1250, 'no chip lost or made');
});

test('an uncalled part of a bet comes back', () => {
  const h = deal([1000, 300], 0, ['Ah Ad', 'Kh Kd'], 'Ac Kc 9d 5h 3s');
  act(h, 'p0', { kind: 'allin' });
  act(h, 'p1', { kind: 'call' });
  assert.deepEqual(h.result!.won, { p0: 600 + 700 });
  assert.deepEqual(stacks(h), [1300, 0]);
  const g = deal([1000, 300], 0, ['Kh Kd', 'Ah Ad'], 'Ac Kc 9d 5h 3s');
  act(g, 'p0', { kind: 'allin' });
  act(g, 'p1', { kind: 'call' });
  assert.deepEqual(stacks(g), [700, 600], 'the 700 nobody could call comes back');
});

test('an all-in short of a full raise does not reopen the betting for who already acted', () => {
  // p0 raises to 100, p1 all-in for 130 (30 more, short of a raise of 90), p2 folds: p0 may only call or fold.
  const h = deal([1000, 130, 1000], 0, ['Ah Kd', '2s 7c', '3h 8d']);
  act(h, 'p0', { kind: 'raise', to: 100 });
  act(h, 'p1', { kind: 'allin' });
  assert.equal(h.currentBet, 130);
  // p2 hadn't acted: they can still raise, to at least 130 + 90
  assert.equal(options(h, 2).raise, true);
  assert.equal(options(h, 2).min, 220);
  act(h, 'p2', { kind: 'call' });
  const o = options(h, 0);
  assert.equal(o.raise, false);
  assert.equal(o.call, 30);
  assert.equal(act(h, 'p0', { kind: 'raise', to: 400 }), false);
  assert.ok(act(h, 'p0', { kind: 'call' }));
  assert.equal(h.street, 'flop');
});

test('a short big blind all-in still lets the others play it out', () => {
  const h = deal([1000, 1000, 6], 0, ['Ah Kd', '2s 7c', '3h 8d']);
  assert.equal(h.players[2].allIn, true);
  assert.equal(h.currentBet, 10, 'you still have to call the full big blind');
  act(h, 'p0', { kind: 'call' });
  act(h, 'p1', { kind: 'call' });
  assert.equal(h.street, 'flop');
  assert.equal(up(h), 'p1');
});

test('the big blind can raise when everyone limps, and the round ends after it checks', () => {
  const h = deal([1000, 1000, 1000], 0, ['Ah Kd', '2s 7c', '3h 8d']);
  act(h, 'p0', { kind: 'call' });
  act(h, 'p1', { kind: 'call' });
  assert.equal(up(h), 'p2');
  assert.ok(act(h, 'p2', { kind: 'raise', to: 40 }));
  assert.equal(up(h), 'p0', 'everyone has to act again');
  act(h, 'p0', { kind: 'call' });
  act(h, 'p1', { kind: 'call' });
  assert.equal(h.street, 'flop');
});

test('someone leaving folds out of turn: the hand goes on, or ends if one is left', () => {
  const h = deal([1000, 1000, 1000], 0, ['Ah Kd', '2s 7c', '3h 8d']);
  assert.equal(up(h), 'p0');
  assert.ok(foldOut(h, 'p2'));
  assert.equal(up(h), 'p0', 'still their turn');
  act(h, 'p0', { kind: 'call' });
  assert.equal(up(h), 'p1');
  act(h, 'p1', { kind: 'call' });
  assert.equal(h.street, 'flop');
  assert.ok(foldOut(h, 'p0'));
  assert.equal(h.street, 'showdown');
  assert.deepEqual(h.result!.won, { p1: 30 });
  // Folding out the one whose turn it'd be after the only player left to act ends the round
  const g = deal([1000, 1000, 1000], 0, ['Ah Kd', '2s 7c', '3h 8d']);
  act(g, 'p0', { kind: 'call' });
  act(g, 'p1', { kind: 'call' });
  assert.ok(foldOut(g, 'p0'));
  assert.equal(up(g), 'p2');
  act(g, 'p2', { kind: 'check' });
  assert.equal(g.street, 'flop');
  assert.equal(up(g), 'p1');
});

test('no chips are ever made or lost, over many random hands', () => {
  let seed = 1;
  const rand = (n: number) => ((seed = (seed * 16807) % 2147483647) % n);
  for (let k = 0; k < 400; k++) {
    const n = 2 + rand(5);
    const st = Array.from({ length: n }, () => 1 + rand(400));
    const before = st.reduce((a, b) => a + b);
    const h = startHand(st.map((stack, i) => ({ id: 'p' + i, seat: i, stack })), rand(n), shuffled(rand));
    let guard = 0;
    while (h.toAct >= 0 && guard++ < 200) {
      const o = options(h, h.toAct);
      const id = h.players[h.toAct].id;
      const r = rand(10);
      const ok = r < 2 ? act(h, id, { kind: 'fold' })
        : r < 5 ? act(h, id, o.check ? { kind: 'check' } : { kind: 'call' })
        : !o.raise ? act(h, id, o.check ? { kind: 'check' } : { kind: 'call' })
        : r < 8 ? act(h, id, { kind: 'raise', to: o.min + rand(Math.max(1, o.max - o.min)) })
        : act(h, id, { kind: 'allin' });
      assert.ok(ok, `act ${r} ${JSON.stringify(o)}`);
    }
    assert.equal(h.toAct, -1);
    assert.equal(h.players.reduce((s, p) => s + p.stack, 0), before);
    assert.ok(h.players.every((p) => p.stack >= 0));
  }
});

// ---- The table --------------------------------------------------------------------------------------

/** A bank that keeps balances in a map, like server/chips.ts: no bet over the balance. */
function bank(start = 1000) {
  const bal = new Map<string, number>();
  const get = (id: string) => bal.get(id) ?? start;
  return {
    bal: get,
    bet(id: string, n: number) {
      if (!Number.isSafeInteger(n) || n <= 0 || n > get(id)) return false;
      bal.set(id, get(id) - n);
      return true;
    },
    award(id: string, n: number) {
      if (!Number.isSafeInteger(n) || n <= 0) return false;
      bal.set(id, get(id) + n);
      return true;
    },
  };
}

function table(start = 1000) {
  const b = bank(start);
  let t = 0;
  let seed = 3;
  const poker = new Poker(b, () => t, (n) => ((seed = (seed * 16807) % 2147483647) % n));
  return { b, poker, wait: (ms: number) => { t += ms; return poker.tick(); } };
}

test('high rollers buy in with up to 10,000 (never more than they have), the blinds as they were', () => {
  assert.equal(MAX_BUY_IN, 10_000);
  assert.deepEqual([SMALL_BLIND, BIG_BLIND], [5, 10]);
  const { b, poker } = table(20_000);
  assert.equal(poker.sit('c1', 'Ada', 'k1', 'chips:a', MAX_BUY_IN + 1), false, 'over the most');
  assert.ok(poker.sit('c1', 'Ada', 'k1', 'chips:a', MAX_BUY_IN));
  assert.equal(b.bal('chips:a'), 10_000);
  assert.equal(poker.topUp('c1', 1), false, 'topped up past the most');
  const poor = table(5000);
  assert.equal(poor.poker.sit('c2', 'Bo', 'k2', 'chips:b', 6000), false, 'more than the balance');
  assert.ok(poor.poker.sit('c2', 'Bo', 'k2', 'chips:b', 5000));
});

test('sitting down takes the buy-in, standing up gives back what is in front of you', () => {
  const { b, poker } = table();
  assert.equal(poker.sit('c1', 'Ada', 'k1', 'chips:a', MIN_BUY_IN - 1), false, 'under the minimum');
  assert.equal(poker.sit('c1', 'Ada', 'k1', 'chips:a', 1001), false, 'more than the balance');
  assert.ok(poker.sit('c1', 'Ada', 'k1', 'chips:a', 400));
  assert.equal(b.bal('chips:a'), 600);
  assert.equal(poker.sit('c1', 'Ada', 'k1', 'chips:a', 400), false, 'already sitting');
  assert.equal(poker.state('c1').you, 0);
  assert.ok(poker.leave('c1'));
  assert.equal(b.bal('chips:a'), 1000);
  assert.equal(poker.state('c1').you, -1);
});

test('alone with Dealer-Bots: hands are dealt and played through, and nobody sees the bots\' cards', () => {
  const { b, poker, wait } = table();
  poker.sit('c1', 'Ada', 'k1', 'chips:a', 500);
  assert.ok(poker.addBot('c1'));
  assert.ok(poker.addBot('c1'));
  assert.equal(poker.addBot('c2'), false, 'only someone at the table');
  wait(2000);
  let s = poker.state('c1');
  assert.equal(s.hand, 1);
  assert.equal(s.seats[0]!.cards!.length, 2, 'my own cards');
  assert.equal(s.seats[1]!.cards, undefined, 'not the bots\'');
  assert.equal(poker.state('c9').seats[0]!.cards, undefined, 'and nobody else sees mine');
  // Play a few hands: I always check or call; the bots do their thing.
  for (let k = 0; k < 3000 && poker.state().hand < 6; k++) {
    s = poker.state('c1');
    if (s.turn) assert.ok(poker.act('c1', s.turn.check ? { kind: 'check' } : { kind: 'call' }));
    if (s.seats[0]!.stack === 0 && s.toAct < 0) assert.ok(poker.topUp('c1', 200), 'out of chips: top up');
    wait(500);
  }
  assert.ok(poker.state().hand >= 6, 'hands keep coming');
  poker.leave('c1');
  for (let k = 0; k < 100; k++) wait(1000);
  const st = poker.state();
  assert.ok(st.seats.every((x) => x === null), 'the bots go when the last person does');
  assert.ok(b.bal('chips:a') <= 1000 + 2 * BOT_STACK * 6);
});

test('away: not dealt in, folded at once if it is your turn, and back in your seat when you return', () => {
  const { b, poker, wait } = table();
  poker.sit('c1', 'Ada', 'k1', 'chips:a', 500);
  poker.sit('c2', 'Bo', 'k2', 'chips:b', 500);
  wait(2000);
  let s = poker.state('c1');
  assert.equal(s.hand, 1);
  const up = s.toAct === 0 ? 'c1' : 'c2';
  const other = up === 'c1' ? 'c2' : 'c1';
  assert.ok(poker.away(up));
  wait(100);
  s = poker.state(other);
  assert.equal(s.street, 'showdown', 'folded at once, so the other wins');
  wait(SHOW_MS + 100);
  assert.equal(poker.state().hand, 1, 'no hand without two to play');
  assert.ok(poker.state().seats.some((x) => x?.out), 'the away seat is sitting out');
  assert.ok(poker.sit(up, 'Ada', up === 'c1' ? 'k1' : 'k2', 'whatever', 0), 'back in their seat, no buy-in');
  wait(SHOW_MS + 100);
  assert.equal(poker.state().hand, 2);
  // Out of time: checked or folded for you, and sitting out from the next hand until you're back.
  s = poker.state();
  const slow = ['c1', 'c2'][s.toAct];
  wait(TURN_MS + 10);
  assert.notEqual(poker.state().toAct, s.toAct);
  for (let k = 0; k < 10 && poker.state().toAct >= 0; k++) wait(TURN_MS + 10);
  assert.ok(poker.state(slow).seats[poker.state(slow).you]!.out, 'sitting out');
  wait(SHOW_MS + 100);
  assert.equal(poker.state().toAct, -1, 'no hand dealt while one of two sits out');
  assert.ok(poker.sit(slow, 'x', 'x', 'x', 0), 'back');
  wait(SHOW_MS + 100);
  assert.ok(poker.state().toAct >= 0, 'dealt in again');
  assert.equal(b.bal('chips:a') + b.bal('chips:b'), 1000);
});

test('leaving in the middle of a hand folds you, and pays you out when it is over', () => {
  const { b, poker, wait } = table();
  poker.sit('c1', 'Ada', 'k1', 'chips:a', 500);
  poker.sit('c2', 'Bo', 'k2', 'chips:b', 500);
  poker.sit('c3', 'Cy', 'k3', 'chips:c', 500);
  wait(2000);
  const s = poker.state();
  const notUp = ['c1', 'c2', 'c3'].find((_, i) => i !== s.toAct)!;
  assert.ok(poker.leave(notUp));
  assert.notEqual(poker.state().street, 'showdown');
  // Fold everything out
  for (let k = 0; k < 20 && poker.state().toAct >= 0; k++) {
    const peer = ['c1', 'c2', 'c3'][poker.state().toAct];
    poker.act(peer, { kind: 'fold' });
  }
  const total = b.bal('chips:a') + b.bal('chips:b') + b.bal('chips:c');
  const onTable = poker.state().seats.reduce((x, y) => x + (y?.stack ?? 0), 0);
  assert.equal(total + onTable, 3000, 'no chip made or lost');
  assert.equal(poker.state().seats.filter(Boolean).length, 2, 'the leaver\'s seat is free');
});

test('the shutdown gives everyone back their stack and what they had in the hand', () => {
  const { b, poker, wait } = table();
  poker.sit('c1', 'Ada', 'k1', 'chips:a', 500);
  poker.sit('c2', 'Bo', 'k2', 'chips:b', 300);
  wait(2000);
  poker.cashOutAll();
  assert.equal(b.bal('chips:a'), 1000);
  assert.equal(b.bal('chips:b'), 1000);
});

test('page input is checked', () => {
  assert.deepEqual(parseAction({ kind: 'raise', to: 40 }), { kind: 'raise', to: 40 });
  assert.equal(parseAction({ kind: 'raise', to: 40.5 }), null);
  assert.equal(parseAction({ kind: 'raise', to: -1 }), null);
  assert.equal(parseAction({ kind: 'steal' }), null);
  assert.equal(parseAction(null), null);
});

test('a Dealer-Bot raises aces and folds rubbish to a big bet', () => {
  let seed = 11;
  const rand = (n: number) => ((seed = (seed * 16807) % 2147483647) % n);
  const strong = deal([1000, 1000, 1000], 0, ['As Ah', '2s 7c', '3h 8d']);
  const a = botAction(strong, 0, rand);
  assert.ok(a.kind === 'raise' || a.kind === 'allin');
  const weak = deal([1000, 1000, 1000], 0, ['Ah Kd', '2s 7c', '3h 8d']);
  act(weak, 'p0', { kind: 'raise', to: 300 });
  assert.equal(botAction(weak, 1, rand).kind, 'fold');
  assert.ok(equity(cards('As Ah'), [], 1) > 0.75);
  assert.ok(equity(cards('2s 7c'), [], 1) < 0.45);
});
