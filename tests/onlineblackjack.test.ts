import test from 'node:test';
import assert from 'node:assert/strict';
import { DEALER_STEP, RESULTS_TIME, TURN_TIME } from '../src/server/blackjack.js';
import { OnlineBlackjack, atPc } from '../src/server/onlineblackjack.js';
import { CUT_CARD, MAX_SEATS, type Card } from '../src/shared/blackjack.js';
import { EMOTE_EVERY, ONLINE_KEEP, atFloor, canSkip, controlsFor, isFull, mmss, seatOf } from '../src/shared/onlineblackjack.js';

class FakeBank {
  money = new Map<string, number>();
  log: string[] = [];
  balance(key: string) {
    return this.money.get(key) ?? 0;
  }
  take(key: string, amount: number, why: string) {
    if (amount <= 0 || this.balance(key) < amount) return false;
    this.money.set(key, this.balance(key) - amount);
    this.log.push(`-${amount} ${key} ${why}`);
    return true;
  }
  give(key: string, amount: number, why: string) {
    this.money.set(key, this.balance(key) + amount);
    this.log.push(`+${amount} ${key} ${why}`);
  }
}

/** The cards in the order they're dealt: one to each player, the dealer's up card, again with the hole card, then whatever's drawn. */
function order(hands: [Card, Card][], dealer: [Card, Card], ...rest: Card[]): Card[] {
  return [...hands.map((h) => h[0]), dealer[0], ...hands.map((h) => h[1]), dealer[1], ...rest];
}

function online(money: Record<string, number> = { ka: 100, kb: 100, kc: 100 }) {
  const bank = new FakeBank();
  for (const [k, v] of Object.entries(money)) bank.money.set(k, v);
  let t = 1000;
  const ob = new OnlineBlackjack(bank, { now: () => t, timers: false });
  /** Stacks the next cards table `id` deals (the rest of the shoe is twos, far from the cut card). */
  const stack = (id: number, cards: Card[]) => {
    ob.table(id)!.game.shoe = [...Array.from({ length: 2 * CUT_CARD }, () => '2C' as Card), ...[...cards].reverse()];
  };
  /** Time goes by: every table's clock, and the kept seats'. */
  const later = (ms: number) => {
    t += ms;
    for (const s of ob.state().tables) ob.table(s.id)?.tick();
    ob.tick();
  };
  return { ob, bank, stack, later };
}

test('atPc: only the boss chair, facing the PC', () => {
  assert.ok(atPc('boss-chair:0'));
  assert.equal(atPc('couch:1'), false);
  assert.equal(atPc(undefined), false);
  assert.equal(atPc('nonsense'), false);
});

test('alone: sit down at a table of your own, bet, play, and get paid through the bank as online blackjack', () => {
  const { ob, bank, stack, later } = online();
  assert.ok(ob.join('p1', 'Ada', 'ka', 'f1'));
  assert.equal(ob.join('p1', 'Ada', 'ka', 'f1'), false, 'at a table already');
  const s = ob.state();
  assert.equal(s.tables.length, 1);
  assert.deepEqual(s.tables[0].floors, { [s.tables[0].seats[0].id]: 'f1' });
  assert.equal(atFloor(s, 'f1')?.seat.name, 'Ada');
  assert.equal(atFloor(s, 'f2'), undefined);
  assert.equal(controlsFor(s.tables[0], 'p1', 100).kind, 'bet');

  stack(1, order([['TS', '9H']], ['TC', '7D']));
  assert.equal(ob.bet('p1', 101), false, 'never more than you have');
  assert.equal(ob.bet('p2', 10), false, 'not at a table');
  assert.ok(ob.bet('p1', 10), 'alone, it deals at once');
  assert.equal(ob.state().tables[0].stage, 'playing');
  assert.deepEqual(controlsFor(ob.state().tables[0], 'p1', 90), { kind: 'moves', moves: ['hit', 'stand', 'double'], stake: 10 });
  assert.ok(ob.act('p1', 'stand'));
  later(DEALER_STEP);
  later(DEALER_STEP);
  assert.equal(ob.state().tables[0].stage, 'done');
  assert.equal(bank.balance('ka'), 110);
  assert.deepEqual(bank.log, ['-10 ka onlineblackjack.bet', '+20 ka onlineblackjack.win']);
  later(RESULTS_TIME);
  assert.deepEqual(controlsFor(ob.state().tables[0], 'p1', 110), { kind: 'bet', cap: 110, again: 10 });
});

test('everyone at a PC, on any floor, sits at the same table, and a sixth person gets a new one', () => {
  const { ob } = online();
  for (let i = 0; i < MAX_SEATS; i++) assert.ok(ob.join(`p${i}`, `P${i}`, `k${i}`, `f${i}`));
  let s = ob.state();
  assert.equal(s.tables.length, 1);
  assert.ok(isFull(s.tables[0]));
  assert.deepEqual(
    s.tables[0].seats.map((x) => x.seat),
    [0, 1, 2, 3, 4],
  );
  assert.equal(atFloor(s, 'f3')?.seat.name, 'P3');
  assert.ok(ob.join('p5', 'P5', 'k5', 'f5'));
  s = ob.state();
  assert.equal(s.tables.length, 2);
  assert.equal(seatOf(s, 'p5')?.table.id, 2);
  // The new table goes once its one player leaves.
  assert.ok(ob.left('p5'));
  assert.equal(ob.state().tables.length, 1);
});

test('stepping away keeps your seat a while: nobody else gets it, and you are back in it from any floor', () => {
  const { ob, later } = online();
  ob.join('p1', 'Ada', 'ka', 'f1');
  ob.join('p2', 'Bo', 'kb', 'f2');
  assert.ok(ob.away('p1'));
  assert.equal(ob.away('p1'), false);
  let s = ob.state();
  assert.deepEqual(
    s.tables[0].kept.map((k) => [k.seat, k.name, k.left]),
    [[0, 'Ada', ONLINE_KEEP]],
  );
  assert.equal(atFloor(s, 'f1'), undefined, 'the monitor on their floor is back to Minesweeper');
  // Someone new is put next to it, not in it.
  ob.join('p3', 'Cy', 'kc', 'f3');
  assert.equal(seatOf(ob.state(), 'p3')?.seat.seat, 2);
  later(ONLINE_KEEP - 1000);
  // Back, from another floor's PC (and another connection): in the same seat.
  assert.ok(ob.join('p9', 'Ada', 'ka', 'f4'));
  s = ob.state();
  assert.equal(seatOf(s, 'p9')?.seat.seat, 0);
  assert.equal(s.tables[0].kept.length, 0);
  assert.equal(atFloor(s, 'f4')?.seat.name, 'Ada');
});

test('a kept seat goes once its time is up, and a table nobody is at goes with it', () => {
  const { ob, later } = online();
  ob.join('p1', 'Ada', 'ka', 'f1');
  ob.away('p1');
  assert.equal(ob.state().tables.length, 1);
  later(ONLINE_KEEP - 1);
  assert.equal(ob.state().tables[0].kept.length, 1);
  later(2);
  assert.deepEqual(ob.state().tables, []);
  // Coming back after that: a fresh seat.
  assert.ok(ob.join('p1', 'Ada', 'ka', 'f1'));
  assert.equal(ob.state().tables[0].seats.length, 1);
});

test('away in a round: the others can skip your hand, and you are back in it with your cards', () => {
  const { ob, bank, stack, later } = online();
  ob.join('p1', 'Ada', 'ka', 'f1');
  ob.join('p2', 'Bo', 'kb', 'f2');
  stack(1, order([['TS', '6H'], ['9S', '8H']], ['TC', '7D']));
  ob.bet('p1', 10);
  ob.bet('p2', 20);
  let s = ob.state();
  assert.equal(s.tables[0].stage, 'playing');
  ob.away('p1');
  s = ob.state();
  assert.equal(s.tables[0].kept.length, 0, 'the table itself holds them while they are in the round');
  assert.equal(s.tables[0].seats.length, 2);
  assert.ok(canSkip(s.tables[0], 'p2'));
  assert.equal(canSkip(s.tables[0], 'p1'), false);
  // Back before anyone skipped: their own turn, their own cards.
  assert.ok(ob.join('p1b', 'Ada', 'ka', 'f1'));
  s = ob.state();
  assert.deepEqual(s.tables[0].round!.players[0].hands[0].cards, ['TS', '6H']);
  assert.equal(controlsFor(s.tables[0], 'p1b', 90).kind, 'moves');
  ob.away('p1b');
  assert.equal(ob.skip('p1b'), false, 'not at the table');
  assert.ok(ob.skip('p2'), 'Bo skips Ada');
  assert.equal(ob.state().tables[0].round!.turn!.player, 1);
  assert.ok(ob.act('p2', 'stand'));
  later(DEALER_STEP);
  later(DEALER_STEP);
  // Dealer 17: Ada's 16 loses, Bo's 17 pushes.
  assert.equal(bank.balance('ka'), 90);
  assert.equal(bank.balance('kb'), 100);
  // After the round, the place is still kept for a while (now by the online tables).
  later(RESULTS_TIME);
  s = ob.state();
  assert.deepEqual(
    s.tables[0].kept.map((k) => k.seat),
    [0],
  );
  assert.equal(s.tables[0].seats.length, 1);
});

test('the turn clock stands an away hand on its own', () => {
  const { ob, stack, later } = online();
  ob.join('p1', 'Ada', 'ka', 'f1');
  stack(1, order([['TS', '6H']], ['TC', '7D']));
  ob.bet('p1', 10);
  ob.away('p1');
  later(TURN_TIME);
  assert.equal(ob.state().tables[0].stage, 'dealer');
});

test('leave gives the seat up at once: no place kept, and an empty table goes', () => {
  const { ob } = online();
  ob.join('p1', 'Ada', 'ka', 'f1');
  ob.join('p2', 'Bo', 'kb', 'f2');
  assert.ok(ob.left('p1'));
  assert.equal(ob.left('p1'), false);
  const s = ob.state();
  assert.equal(s.tables[0].kept.length, 0);
  assert.deepEqual(
    s.tables[0].seats.map((x) => x.name),
    ['Bo'],
  );
  ob.left('p2');
  assert.deepEqual(ob.state().tables, []);
});

test('your seat from another page of yours: that page has it now', () => {
  const { ob } = online();
  ob.join('p1', 'Ada', 'ka', 'f1');
  assert.ok(ob.join('p2', 'Ada', 'ka', 'f2'));
  const s = ob.state();
  assert.equal(s.tables[0].seats.length, 1);
  assert.equal(seatOf(s, 'p2')?.seat.seat, 0);
  assert.equal(seatOf(s, 'p1'), undefined);
  assert.equal(ob.bet('p1', 10), false);
});

test('faces: only the listed ones, only at a table, not too often', () => {
  const { ob, later } = online();
  assert.equal(ob.emote('p1', '👍'), undefined, 'not at a table');
  ob.join('p1', 'Ada', 'ka', 'f1');
  assert.equal(ob.emote('p1', '💩'), undefined);
  assert.equal(ob.emote('p1', 42), undefined);
  assert.deepEqual(ob.emote('p1', '👍'), { table: 1, seat: 0, emote: '👍' });
  assert.equal(ob.emote('p1', '😂'), undefined, 'too soon');
  later(EMOTE_EVERY);
  assert.ok(ob.emote('p1', '😂'));
});

test('the buttons: bet, bet down, insurance, waiting, sitting down again', () => {
  const { ob, stack } = online({ ka: 30, kb: 100 });
  assert.deepEqual(controlsFor(undefined, 'p1', 30), { kind: 'join' });
  ob.join('p1', 'Ada', 'ka', 'f1');
  ob.join('p2', 'Bo', 'kb', 'f2');
  assert.deepEqual(controlsFor(ob.state().tables[0], 'p1', 30), { kind: 'bet', cap: 30, again: 0 });
  assert.deepEqual(controlsFor(ob.state().tables[0], 'p1', 50_000), { kind: 'bet', cap: 10_000, again: 0 }, 'a high roller, up to the table limit');
  stack(1, order([['TS', '6H'], ['9S', '8H']], ['AC', '7D']));
  ob.bet('p1', 20);
  assert.deepEqual(controlsFor(ob.state().tables[0], 'p1', 30), { kind: 'down', bet: 20, deal: true });
  ob.bet('p2', 10);
  assert.deepEqual(controlsFor(ob.state().tables[0], 'p1', 10), { kind: 'insure', cost: 10 });
  ob.insure('p1', false);
  assert.equal(controlsFor(ob.state().tables[0], 'p1', 10).kind, 'wait', 'Bo still to say');
  assert.deepEqual(controlsFor(ob.state().tables[0], 'p3', 10), { kind: 'join' });
});

test('mmss', () => {
  assert.equal(mmss(ONLINE_KEEP), '3:00');
  assert.equal(mmss(61_000), '1:01');
  assert.equal(mmss(1), '0:01');
  assert.equal(mmss(-5), '0:00');
});
