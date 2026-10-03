import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { BlackjackTable, BET_TIME, DEALER_STEP, RESULTS_TIME, TURN_TIME } from '../src/server/blackjack.js';
import { BlackjackGame, CUT_CARD, DECKS, MIN_BET, MAX_BET, betOk, dealerHits, deck, handValue, isBlackjack, isCard, outcome, payout, staked, type Card } from '../src/shared/blackjack.js';

const hv = (...c: Card[]) => handValue(c);

/** A game whose shoe deals `cards` next, in that order (on top of plenty more, so the cut card isn't near). */
function stacked(...cards: Card[]): BlackjackGame {
  const g = new BlackjackGame(randomInt);
  g.shoe = [...Array.from({ length: 2 * CUT_CARD }, () => '2C' as Card), ...cards.reverse()];
  return g;
}

/** The deal order for players p1, p2 … and the dealer: first cards round, then second cards round. */
function order(players: Card[][], dealer: [Card, Card]): Card[] {
  return [...players.map((p) => p[0]), dealer[0], ...players.map((p) => p[1]), dealer[1]];
}

const one = (bet = 10) => [{ seat: 0, id: 'a', name: 'Ada', bet }];

test('cards and decks', () => {
  assert.equal(deck().length, 52);
  assert.equal(new Set(deck()).size, 52);
  assert.ok(isCard('AS') && isCard('TH') && !isCard('1S') && !isCard('AX') && !isCard(5));
  const g = new BlackjackGame(randomInt);
  assert.equal(g.shoe.length, DECKS * 52);
  assert.equal(g.shoe.filter((c) => c === 'AS').length, DECKS);
});

test('hand values: aces are soft until they would bust', () => {
  assert.deepEqual(hv('AS', 'KH'), { total: 21, soft: true });
  assert.deepEqual(hv('AS', '6H'), { total: 17, soft: true });
  assert.deepEqual(hv('AS', '6H', 'TD'), { total: 17, soft: false });
  assert.deepEqual(hv('AS', 'AH'), { total: 12, soft: true });
  assert.deepEqual(hv('AS', 'AH', '9C'), { total: 21, soft: true });
  assert.deepEqual(hv('AS', 'AH', 'AC', 'AD'), { total: 14, soft: true });
  assert.deepEqual(hv('KS', 'QH', '2C'), { total: 22, soft: false });
  assert.deepEqual(hv('5S', '7H'), { total: 12, soft: false });
  assert.ok(isBlackjack(['AS', 'JD']) && !isBlackjack(['AS', '5D', '5H']) && !isBlackjack(['TS', '9D']));
});

test('the dealer stands on soft 17 and hits 16', () => {
  assert.equal(dealerHits(['AS', '6H']), false);
  assert.equal(dealerHits(['TS', '7H']), false);
  assert.equal(dealerHits(['TS', '6H']), true);
  assert.equal(dealerHits(['AS', '5H']), true);
  assert.equal(dealerHits(['AS', '5H', 'AC']), false);
});

test('payouts: 3:2 for blackjack (rounded down), 1:1 a win, the stake back on a push', () => {
  assert.equal(payout('blackjack', 10), 25);
  assert.equal(payout('blackjack', 5), 12);
  assert.equal(payout('win', 10), 20);
  assert.equal(payout('push', 10), 10);
  assert.equal(payout('lose', 10), 0);
  assert.equal(payout('bust', 10), 0);
  assert.equal(outcome(['AS', 'KH'], false, ['TS', '9H']), 'blackjack');
  assert.equal(outcome(['AS', 'KH'], true, ['TS', '9H']), 'win');
  assert.equal(outcome(['AS', 'KH'], false, ['AH', 'KD']), 'push');
  assert.equal(outcome(['TS', 'KH'], false, ['AH', 'KD']), 'lose');
  assert.equal(outcome(['TS', 'KH', '5C'], false, ['TH', '6D', '9D']), 'bust');
  assert.equal(outcome(['TS', '7H'], false, ['TH', '6D', '9D']), 'win');
  assert.equal(outcome(['TS', '7H'], false, ['TH', '7D']), 'push');
  assert.equal(outcome(['TS', '7H'], false, ['TH', '8D']), 'lose');
  assert.ok(betOk(MIN_BET) && betOk(MAX_BET) && !betOk(MIN_BET - 1) && !betOk(MAX_BET + 1) && !betOk(10.5) && !betOk('10'));
});

test('a round alone: hit, stand, the dealer draws to 17 and the win pays 1:1', () => {
  const g = stacked(...order([['TS', '5H']], ['9C', '7D']), '4C', '8S');
  g.deal(one());
  assert.equal(g.round!.phase, 'playing');
  assert.deepEqual(g.view()!.dealer, ['9C', null]);
  assert.deepEqual(g.actions('a'), ['hit', 'stand', 'double']);
  assert.deepEqual(g.actions('b'), []);
  assert.ok(g.act('a', 'hit'));
  assert.equal(handValue(g.round!.players[0].hands[0].cards).total, 19);
  assert.ok(g.act('a', 'stand'));
  assert.equal(g.round!.phase, 'dealer');
  assert.equal(g.dealerStep(), 'reveal');
  assert.equal(g.dealerStep(), 'draw');
  assert.deepEqual(g.round!.dealer, ['9C', '7D', '8S']);
  assert.equal(g.dealerStep(), 'done');
  const p = g.round!.players[0];
  assert.equal(p.hands[0].outcome, 'win');
  assert.equal(p.paid, 20);
  assert.equal(g.running, false);
});

test('hitting to 21 stands, going over busts, and the dealer does not draw for a table of busts', () => {
  const g = stacked(...order([['TS', '6H']], ['TC', '6D']), 'KD', '5S');
  g.deal(one());
  g.act('a', 'hit');
  const h = g.round!.players[0].hands[0];
  assert.ok(h.done);
  assert.equal(g.round!.phase, 'dealer');
  g.dealerPlay();
  assert.deepEqual(g.round!.dealer, ['TC', '6D']);
  assert.equal(h.outcome, 'bust');
  assert.equal(g.round!.players[0].paid, 0);
});

test('a natural pays 3:2 and is done before anyone plays; the dealer still plays for the others', () => {
  const g = stacked(...order([['AS', 'KH'], ['TS', '8H']], ['9C', '8D']));
  g.deal([
    { seat: 3, id: 'b', name: 'Bo', bet: 20 },
    { seat: 1, id: 'a', name: 'Ada', bet: 10 },
  ]);
  const [a, b] = g.round!.players;
  assert.equal(a.id, 'a', 'seat order');
  assert.ok(a.hands[0].done);
  assert.deepEqual(g.up()!.player.id, 'b');
  g.act('b', 'stand');
  g.dealerPlay();
  assert.equal(a.hands[0].outcome, 'blackjack');
  assert.equal(a.paid, 25);
  assert.equal(b.hands[0].outcome, 'win');
  assert.equal(b.paid, 40);
});

test('the dealer peeks under a ten: a blackjack there ends the round at once', () => {
  const g = stacked(...order([['TS', '9H'], ['AH', 'QH']], ['KC', 'AD']));
  g.deal([
    { seat: 0, id: 'a', name: 'Ada', bet: 10 },
    { seat: 1, id: 'b', name: 'Bo', bet: 10 },
  ]);
  assert.equal(g.round!.phase, 'done');
  assert.equal(g.round!.hole, false);
  assert.equal(g.round!.players[0].paid, 0);
  assert.equal(g.round!.players[1].hands[0].outcome, 'push');
  assert.equal(g.round!.players[1].paid, 10);
});

test('insurance under an ace: pays 2:1 on a dealer blackjack, is lost otherwise', () => {
  let g = stacked(...order([['TS', '9H'], ['8H', '8C']], ['AC', 'KD']));
  g.deal([
    { seat: 0, id: 'a', name: 'Ada', bet: 10 },
    { seat: 1, id: 'b', name: 'Bo', bet: 10 },
  ]);
  assert.equal(g.round!.phase, 'insurance');
  assert.deepEqual(g.actions('a'), []);
  assert.equal(g.cost('a', 'insurance'), 5);
  assert.ok(g.insure('a', true));
  assert.equal(g.insure('a', false), false, 'once');
  assert.equal(g.round!.phase, 'insurance');
  g.closeInsurance();
  assert.equal(g.round!.phase, 'done');
  const [a, b] = g.round!.players;
  assert.equal(a.insurance, 5);
  assert.equal(a.paid, 15, 'insurance 5 back 3×, the hand lost');
  assert.equal(staked(a), 15);
  assert.equal(b.insurance, 0);
  assert.equal(b.paid, 0);

  g = stacked(...order([['TS', '9H']], ['AC', '7D']));
  g.deal(one());
  g.insure('a', true);
  assert.equal(g.round!.phase, 'playing');
  g.act('a', 'stand');
  g.dealerPlay();
  const p = g.round!.players[0];
  assert.equal(p.insurancePaid, 0);
  assert.equal(p.paid, 20, 'the hand won, the insurance lost');
});

test('double: twice the stake, one card, and done', () => {
  const g = stacked(...order([['6S', '5H']], ['TC', '7D']), 'TH');
  g.deal(one());
  assert.equal(g.cost('a', 'double'), 10);
  assert.ok(g.act('a', 'double'));
  const h = g.round!.players[0].hands[0];
  assert.deepEqual(h.cards, ['6S', '5H', 'TH']);
  assert.ok(h.doubled && h.done);
  assert.equal(h.bet, 20);
  g.dealerPlay();
  assert.equal(h.outcome, 'win');
  assert.equal(g.round!.players[0].paid, 40);
  // Not on three cards.
  const g2 = stacked(...order([['2S', '3H']], ['TC', '7D']), '4C');
  g2.deal(one());
  g2.act('a', 'hit');
  assert.deepEqual(g2.actions('a'), ['hit', 'stand']);
  assert.equal(g2.cost('a', 'double'), 0);
  assert.equal(g2.act('a', 'double'), false);
});

test('split: two hands with a stake each, played in turn, only once, and 21 on a split is not a blackjack', () => {
  const g = stacked(...order([['8S', '8H']], ['TC', '7D']), 'AC', 'KD', '8C', 'TS');
  g.deal(one());
  assert.ok(g.actions('a').includes('split'));
  assert.equal(g.cost('a', 'split'), 10);
  assert.ok(g.act('a', 'split'));
  const p = g.round!.players[0];
  assert.equal(p.hands.length, 2);
  assert.deepEqual(p.hands[0].cards, ['8S', 'AC']);
  assert.deepEqual(p.hands[1].cards, ['8H', 'KD']);
  assert.equal(staked(p), 20);
  assert.deepEqual(g.up()!.hand, p.hands[0]);
  // Re-splitting isn't allowed, even with another pair.
  assert.ok(!g.actions('a').includes('split'));
  g.act('a', 'stand');
  assert.deepEqual(g.up()!.hand, p.hands[1]);
  assert.ok(g.actions('a').includes('double'), 'double after split');
  g.act('a', 'hit');
  assert.ok(p.hands[1].done, '8 + K + 8 = 26: bust');
  g.dealerPlay();
  assert.equal(p.hands[0].outcome, 'win');
  assert.equal(p.hands[1].outcome, 'bust');
  assert.equal(p.paid, 20);
});

test('split tens (any two of value ten), and split aces get one card each', () => {
  let g = stacked(...order([['KS', 'QH']], ['TC', '7D']));
  g.deal(one());
  assert.ok(g.actions('a').includes('split'));
  g = stacked(...order([['AS', 'AH']], ['9C', '7D']), 'KC', '5D', 'TS');
  g.deal(one());
  g.act('a', 'split');
  const p = g.round!.players[0];
  assert.ok(p.hands.every((h) => h.done));
  assert.equal(g.round!.phase, 'dealer');
  g.dealerPlay();
  assert.deepEqual(g.round!.dealer, ['9C', '7D', 'TS']);
  assert.equal(p.hands[0].outcome, 'win', 'A+K after a split is 21, not a blackjack: paid 1:1');
  assert.equal(p.hands[0].paid, 20);
  assert.equal(p.hands[1].outcome, 'win');
});

test('only the player who is up acts; standUp skips an away player; leaving stands every hand', () => {
  const g = stacked(...order([['TS', '5H'], ['9S', '7H'], ['8S', '8C']], ['TC', '8D']));
  g.deal([
    { seat: 0, id: 'a', name: 'A', bet: 10 },
    { seat: 1, id: 'b', name: 'B', bet: 10 },
    { seat: 2, id: 'c', name: 'C', bet: 10 },
  ]);
  assert.equal(g.act('b', 'hit'), false);
  assert.ok(g.standUp());
  assert.equal(g.up()!.player.id, 'b');
  g.leave('c');
  assert.equal(g.up()!.player.id, 'b');
  g.leave('b');
  assert.equal(g.round!.phase, 'dealer');
  g.dealerPlay();
  assert.deepEqual(g.round!.players.map((p) => p.hands[0].outcome), ['lose', 'lose', 'lose']);
});

test('deal: one hand per seat and per player, nobody with no bet, never twice at once', () => {
  const g = stacked(...order([['TS', '5H'], ['9S', '7H']], ['TC', '8D']));
  assert.equal(g.deal([]), null);
  const r = g.deal([
    { seat: 0, id: 'a', name: 'A', bet: 10 },
    { seat: 0, id: 'b', name: 'B', bet: 10 },
    { seat: 1, id: 'a', name: 'A', bet: 10 },
    { seat: 2, id: 'c', name: 'C', bet: 0 },
    { seat: 7, id: 'd', name: 'D', bet: 10 },
  ])!;
  assert.deepEqual(r.players.map((p) => p.id), ['a']);
  assert.equal(g.deal(one()), null);
});

test('the shoe is shuffled once the cut card is out, and the view never shows the hole card', () => {
  const g = new BlackjackGame(randomInt);
  let shuffles = 0;
  let rounds = 0;
  while (rounds < 300) {
    g.deal([
      { seat: 0, id: 'a', name: 'A', bet: 10 },
      { seat: 1, id: 'b', name: 'B', bet: 10 },
    ]);
    if (g.shuffled) shuffles++;
    const r = g.round!;
    if (r.phase === 'insurance') g.closeInsurance();
    if (g.round!.hole && g.round!.phase !== 'done') assert.equal(g.view()!.dealer[1], null);
    while (g.up()) g.act(g.up()!.player.id, total(g.up()!.hand.cards) < 15 ? 'hit' : 'stand');
    g.dealerPlay();
    assert.equal(g.round!.phase, 'done');
    for (const p of g.round!.players) assert.equal(p.paid, p.hands.reduce((s, h) => s + h.paid!, 0) + p.insurancePaid!);
    rounds++;
  }
  assert.ok(shuffles >= 3, `shuffled ${shuffles} times`);
});

function total(c: Card[]) {
  return handValue(c).total;
}

// ---- The table (server) -----------------------------------------------------------------------------

class FakeBank {
  money = new Map<string, number>();
  log: string[] = [];
  balance(key: string) {
    return this.money.get(key) ?? 0;
  }
  take(key: string, amount: number) {
    if (amount <= 0 || this.balance(key) < amount) return false;
    this.money.set(key, this.balance(key) - amount);
    this.log.push(`-${amount} ${key}`);
    return true;
  }
  give(key: string, amount: number) {
    this.money.set(key, this.balance(key) + amount);
    this.log.push(`+${amount} ${key}`);
  }
}

function table(cards: Card[], money: Record<string, number> = { ka: 100, kb: 100 }) {
  const bank = new FakeBank();
  for (const [k, v] of Object.entries(money)) bank.money.set(k, v);
  let t = 1000;
  const tb = new BlackjackTable(bank, { now: () => t, timers: false });
  tb.game.shoe = [...Array.from({ length: 2 * CUT_CARD }, () => '2C' as Card), ...cards.reverse()];
  return { tb, bank, later: (ms: number) => ((t += ms), tb.tick()) };
}

test('table: sit, bet (never more than you have), deal at once when everyone has bet, pay out after the dealer', () => {
  const { tb, bank, later } = table(order([['TS', '9H']], ['TC', '7D']));
  assert.ok(tb.join('p1', 'Ada', 'ka'));
  assert.equal(tb.join('p1', 'Ada', 'ka'), false);
  assert.equal(tb.bet('p1', 101), false, 'more than the balance');
  assert.equal(tb.bet('p1', MIN_BET - 1), false);
  assert.equal(tb.bet('p9', 10), false, 'not sitting');
  assert.ok(tb.bet('p1', 10));
  assert.equal(tb.state().stage, 'playing');
  assert.equal(bank.balance('ka'), 90);
  assert.equal(tb.act('p1', 'fold'), false);
  assert.ok(tb.act('p1', 'stand'));
  assert.equal(tb.state().stage, 'dealer');
  later(DEALER_STEP); // reveal
  later(DEALER_STEP); // 17: stands, settles
  assert.equal(tb.state().stage, 'done');
  assert.equal(bank.balance('ka'), 110);
  assert.equal(tb.state().round!.players[0].paid, 20);
  later(RESULTS_TIME);
  assert.equal(tb.state().stage, 'idle');
  assert.equal(tb.state().round, null);
  assert.equal(tb.state().seats[0].last, 10);
});

test('table: betting waits for the others, then the clock deals to whoever bet', () => {
  const { tb, bank, later } = table(order([['TS', '9H']], ['TC', '7D']));
  tb.join('p1', 'Ada', 'ka');
  tb.join('p2', 'Bo', 'kb');
  tb.bet('p1', 10);
  assert.equal(tb.state().stage, 'betting');
  assert.equal(tb.state().left, BET_TIME);
  later(BET_TIME);
  assert.equal(tb.state().stage, 'playing');
  assert.deepEqual(tb.state().round!.players.map((p) => p.name), ['Ada']);
  assert.equal(bank.balance('kb'), 100);
});

test('table: double and split take another stake through the bank, only if you have it', () => {
  const { tb, bank } = table(order([['8S', '8H']], ['TC', '7D']), { ka: 15 });
  tb.join('p1', 'Ada', 'ka');
  tb.bet('p1', 10);
  assert.equal(tb.act('p1', 'split'), false, 'only 5 left');
  assert.equal(tb.act('p1', 'double'), false);
  assert.equal(bank.balance('ka'), 5);
  assert.ok(tb.act('p1', 'hit'));
});

test('table: an away player keeps the seat and hand; others can skip them; the clock stands for them', () => {
  const { tb, bank, later } = table(order([['TS', '5H'], ['9S', '7H']], ['TC', '8D']));
  tb.join('p1', 'Ada', 'ka');
  tb.join('p2', 'Bo', 'kb');
  tb.bet('p1', 10);
  tb.bet('p2', 10);
  assert.equal(tb.state().stage, 'playing');
  assert.equal(tb.skip('p2'), false, 'Ada is here');
  tb.away('p1');
  assert.equal(tb.state().seats.length, 2);
  assert.equal(tb.state().seats[0].peer, undefined);
  // Back after a reload: the same seat, under a new connection.
  assert.ok(tb.join('p1b', 'Ada', 'ka'));
  assert.equal(tb.state().seats.length, 2);
  assert.ok(tb.act('p1b', 'stand'));
  // Bo walks off on his turn: Ada skips him.
  tb.away('p2');
  assert.ok(tb.skip('p1b'));
  assert.equal(tb.state().stage, 'dealer');
  later(DEALER_STEP);
  later(DEALER_STEP);
  assert.equal(tb.state().stage, 'done');
  assert.equal(bank.balance('ka'), 90);
  later(RESULTS_TIME);
  assert.deepEqual(tb.state().seats.map((s) => s.name), ['Ada'], 'away and in no round: the seat goes');
  // The turn clock stands for whoever's slow.
  const t2 = table(order([['TS', '5H']], ['TC', '8D']));
  t2.tb.join('p1', 'Ada', 'ka');
  t2.tb.bet('p1', 10);
  t2.later(TURN_TIME - 1);
  assert.equal(t2.tb.state().stage, 'playing');
  t2.later(1);
  assert.equal(t2.tb.state().stage, 'dealer');
});

test('table: leaving mid-round stands your hands and still pays you', () => {
  const { tb, bank, later } = table(order([['TS', '9H']], ['TC', '7D']));
  tb.join('p1', 'Ada', 'ka');
  tb.bet('p1', 10);
  assert.ok(tb.left('p1'));
  assert.equal(tb.state().seats.length, 0);
  later(DEALER_STEP);
  later(DEALER_STEP);
  assert.equal(bank.balance('ka'), 110);
});

test('table: insurance takes half the stake through the bank', () => {
  const { tb, bank, later } = table(order([['TS', '9H']], ['AC', 'KD']));
  tb.join('p1', 'Ada', 'ka');
  tb.bet('p1', 10);
  assert.equal(tb.state().stage, 'insurance');
  assert.deepEqual(tb.state().round!.dealer, ['AC', null]);
  assert.ok(tb.insure('p1', true));
  assert.equal(tb.state().stage, 'done');
  assert.equal(bank.balance('ka'), 100, '-10 stake, -5 insurance, +15 insurance paid 2:1');
  later(RESULTS_TIME);
  assert.equal(tb.state().stage, 'idle');
});

test('table: five seats at most, at the seat you sit down on; an away player\'s seat is kept for them', () => {
  const { tb } = table([], { a: 1 });
  assert.ok(tb.join('p0', 'A', 'k0', 3));
  assert.equal(tb.join('p1', 'B', 'k1', 3), false, 'taken');
  assert.equal(tb.join('p1', 'B', 'k1', 9), false);
  for (let i = 1; i < 5; i++) assert.ok(tb.join(`p${i}`, `N${i}`, `k${i}`));
  assert.equal(tb.join('p5', 'F', 'k5'), false);
  assert.deepEqual(tb.state().seats.map((s) => s.seat), [0, 1, 2, 3, 4]);
  assert.equal(tb.state().seats.find((s) => s.seat === 3)!.name, 'A');
  const t2 = table(order([['TS', '5H']], ['TC', '8D']));
  t2.tb.join('p1', 'Ada', 'ka', 0);
  t2.tb.bet('p1', 10);
  t2.tb.away('p1');
  assert.equal(t2.tb.join('p2', 'Bo', 'kb', 0), false, 'kept for Ada');
  assert.ok(t2.tb.join('p1b', 'Ada', 'ka', 2), 'back in her own seat, from another stool');
  assert.equal(t2.tb.state().seats[0].seat, 0, 'not moved mid-round');
  t2.tb.act('p1b', 'stand');
  t2.later(DEALER_STEP);
  t2.later(DEALER_STEP);
  t2.later(RESULTS_TIME);
  t2.tb.away('p1b');
  assert.ok(t2.tb.join('p1c', 'Ada', 'ka', 2));
  assert.equal(t2.tb.state().seats[0].seat, 2, 'between rounds she moves with her stool');
});
