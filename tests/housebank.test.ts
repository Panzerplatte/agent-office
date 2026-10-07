import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BlackjackTable, DEALER_STEP } from '../src/server/blackjack.js';
import { Chips } from '../src/server/chips.js';
import { Crash } from '../src/server/crash.js';
import { CrashStats } from '../src/server/crashstats.js';
import { HouseBank } from '../src/server/housebank.js';
import { Plinko } from '../src/server/plinko.js';
import { Roulette } from '../src/server/roulette.js';
import { Slots } from '../src/server/slots.js';
import { CUT_CARD, type Card } from '../src/shared/blackjack.js';
import { START_CHIPS } from '../src/shared/chips.js';
import { BET_TIME, timeFor } from '../src/shared/crash.js';
import { HOUSE_GAMES, HOUSE_SHARE, formatChips } from '../src/shared/housebank.js';
import { BET_TIME as ROULETTE_BET_TIME, SPIN_TIME } from '../src/shared/roulette.js';
import { REELS, evaluate } from '../src/shared/slots.js';

// Players' chips wallets (see server/chips.ts): a browser's, without accounts, and an account's.
const NADINE = 'browser:6e6164696e655f5f5f5f5f5f5f5f5f5f';
const KEVIN = 'browser:6b6576696e5f5f5f5f5f5f5f5f5f5f5f';
const MARC = 'account:marc000000000003';
const dir = () => mkdtempSync(path.join(tmpdir(), 'agent-office-housebank-'));

/** A house bank (and the chips it pays into) in a fresh data dir. */
function setup(data = dir()) {
  let now = 1_000_000;
  const chips = new Chips(data, { now: () => now, saveAfter: 0 });
  const bank = new HouseBank(data, chips, { now: () => now, saveAfter: 0 });
  return { data, chips, bank, go: (ms: number) => (now += ms) };
}

// ---- The rates ---------------------------------------------------------------------------------------

test('every casino game gives the bank its lost stakes in full, poker nothing', () => {
  for (const g of HOUSE_GAMES) assert.equal(HOUSE_SHARE[g], g === 'poker' ? 0 : 1, g);
  const { bank } = setup();
  bank.lost('poker', 500);
  assert.equal(bank.chipsTotal, 0n, 'poker pots go player to player');
  bank.lost('roulette', 0);
  bank.lost('roulette', -5);
  bank.lost('roulette', Number.NaN);
  assert.equal(bank.chipsTotal, 0n, 'nothing lost, nothing in');
});

test("the trading table's fee: fractions of a chip add up to whole ones", () => {
  const { bank } = setup();
  for (let i = 0; i < 10; i++) bank.lost('trading', 0.1); // a 0.1 % fee on a 100-chip stake
  assert.equal(bank.from('trading'), 1n);
  bank.lost('trading', 2.5);
  assert.equal(bank.chipsTotal, 3n);
});

// ---- Each game, as it settles --------------------------------------------------------------------------

test('Crash: a bet lost in the crash goes in, a cashed-out one does not', () => {
  const { chips, bank } = setup();
  let now = 1_000_000;
  let point = 1;
  const c = new Crash(chips, { now: () => now, point: () => point, series: () => ({ back: 0.99, max: 100 }), house: bank });
  assert.ok(c.bet('p1', 'browser:aaaaaaaaaaaaaaaa', 'Ann', 100));
  now += BET_TIME;
  c.tick(); // an instant crash at 1.00×
  assert.equal(c.state().phase, 'crashed');
  assert.equal(bank.from('crash'), 100n);
  // Next round, cashed out at 2×: a win, nothing for the bank.
  now = c.nextAt();
  c.tick();
  point = 5;
  assert.ok(c.bet('p1', 'browser:aaaaaaaaaaaaaaaa', 'Ann', 50));
  now += BET_TIME;
  c.tick();
  assert.equal(c.state().phase, 'running');
  now += Math.ceil(timeFor(2));
  assert.ok(c.cashOut('browser:aaaaaaaaaaaaaaaa') > 50);
  now = c.nextAt();
  c.tick();
  assert.equal(c.state().phase, 'crashed');
  assert.equal(bank.chipsTotal, 100n);
});

test('Plinko: what a ball did not pay back goes in', () => {
  const { chips, bank } = setup();
  let now = 1_000_000;
  const paths = [
    [1, 1, 1, 1, 0, 0, 0, 0], // the middle slot: 0.4× at medium
    [0, 0, 0, 0, 0, 0, 0, 0], // the edge: 13×
  ] as (0 | 1)[][];
  const p = new Plinko(chips, { now: () => now, path: () => paths.shift()!, house: bank });
  assert.ok(p.drop('peer', 'browser:aaaaaaaaaaaaaaaa', 'Ann', { bet: 100, rows: 8, risk: 'medium' }));
  now += 60_000;
  p.tick();
  assert.equal(bank.from('plinko'), 60n, '100 staked, 40 back');
  assert.ok(p.drop('peer', 'browser:aaaaaaaaaaaaaaaa', 'Ann', { bet: 100, rows: 8, risk: 'medium' }));
  now += 60_000;
  p.tick();
  assert.equal(bank.from('plinko'), 60n, 'a win gives nothing, and takes nothing out');
});

test('roulette: every chip on a losing spot goes in, the winning spots do not', () => {
  const { chips, bank } = setup();
  let now = 1_000_000;
  const r = new Roulette(chips, { now: () => now, spin: () => 17, house: bank });
  assert.ok(r.join('p1', 'Ada', 'account:ada'));
  assert.ok(r.bet('p1', 'straight:17', 10));
  assert.ok(r.bet('p1', 'red', 20)); // 17 is black
  assert.ok(r.bet('p1', 'straight:3', 5));
  now += ROULETTE_BET_TIME;
  r.tick();
  now += SPIN_TIME;
  r.tick();
  assert.equal(bank.from('roulette'), 25n);
  assert.equal(chips.balance('account:ada'), START_CHIPS - 35 + 360, 'the win is paid as ever');
});

test('slots: a spin that pays back less than its bet puts the difference in', () => {
  const { chips, bank } = setup();
  // A losing set of stops, and a winning one, found from the real reels.
  const all: number[][] = [];
  for (let a = 0; a < REELS[0].length; a++) for (let b = 0; b < REELS[1].length; b++) all.push([a, b, 0]);
  const losing = all.find((s) => evaluate(s, 10).win === 0)!;
  const winning = all.find((s) => evaluate(s, 10).win > 10)!;
  const queue = [losing, winning];
  let cur: number[] = [];
  let reel = 0;
  let now = 1_000_000;
  const s = new Slots(1, chips, {
    now: () => now,
    random: () => {
      if (reel === 0) cur = queue.shift()!;
      const v = cur[reel];
      reel = (reel + 1) % 3;
      return v;
    },
    later: (fn) => fn(),
    house: bank,
  });
  assert.ok(s.join('p', 0, 'Ann', 'browser:aaaaaaaaaaaaaaaa'));
  assert.ok(s.spin('p', 10));
  assert.equal(bank.from('slots'), 10n);
  now += 60_000;
  assert.ok(s.spin('p', 10));
  assert.equal(bank.from('slots'), 10n, 'a win puts nothing in');
});

test('blackjack: a lost hand goes in, a won one does not', () => {
  const { bank } = setup();
  const money = new Map([
    ['ka', 100],
    ['kb', 100],
  ]);
  const fake = {
    balance: (k: string) => money.get(k) ?? 0,
    take: (k: string, n: number) => (money.get(k)! >= n ? (money.set(k, money.get(k)! - n), true) : false),
    give: (k: string, n: number) => void money.set(k, money.get(k)! + n),
  };
  let t = 1000;
  const tb = new BlackjackTable(fake, { now: () => t, timers: false, house: bank });
  // Ada 19, Bo 16 against the dealer's 17: Ada wins, Bo loses.
  const cards: Card[] = ['TS', '9C', 'TC', '9H', '6D', '7D'];
  tb.game.shoe = [...Array.from({ length: 2 * CUT_CARD }, () => '2C' as Card), ...cards.reverse()];
  assert.ok(tb.join('p1', 'Ada', 'ka'));
  assert.ok(tb.join('p2', 'Bo', 'kb'));
  assert.ok(tb.bet('p1', 10));
  assert.ok(tb.bet('p2', 20));
  assert.ok(tb.act('p1', 'stand'));
  assert.ok(tb.act('p2', 'stand'));
  for (let i = 0; i < 5 && tb.state().stage !== 'done'; i++) ((t += DEALER_STEP), tb.tick());
  assert.equal(tb.state().stage, 'done');
  assert.equal(money.get('ka'), 110);
  assert.equal(bank.from('blackjack'), 20n);
});

// ---- Withdrawals ------------------------------------------------------------------------------------

test('any player can withdraw (without accounts), never more than the bank holds, onto their own balance with a ledger entry', () => {
  const { chips, bank } = setup();
  bank.lost('roulette', 300);
  bank.lost('crash', 200);
  assert.equal(bank.withdraw(NADINE, 'Nadine', 501), 'balance', 'no more than the bank holds');
  assert.equal(bank.withdraw(NADINE, 'Nadine', 0), 'amount');
  assert.equal(bank.withdraw(NADINE, 'Nadine', 1.5), 'amount');
  assert.equal(bank.withdraw(NADINE, 'Nadine', '-3'), 'amount');
  assert.equal(bank.chipsTotal, 500n, 'nothing changed');
  assert.equal(bank.withdraw(NADINE, 'Nadine', 120), 120n);
  assert.equal(bank.chipsTotal, 380n);
  assert.equal(chips.balance(NADINE), START_CHIPS + 120);
  assert.deepEqual(chips.ledger(NADINE)[0], { at: 1_000_000, amount: 120, reason: 'housebank', balance: START_CHIPS + 120 });
  // Someone else, too: anyone may.
  assert.equal(bank.withdraw(KEVIN, 'Kevin', 80), 80n);
  assert.equal(chips.balance(KEVIN), START_CHIPS + 80);
  assert.equal(bank.withdraw(NADINE, 'Nadine', 'all'), 300n);
  assert.equal(bank.chipsTotal, 0n, 'never below 0');
  assert.equal(bank.withdraw(KEVIN, 'Kevin', 'all'), 'balance');
  assert.equal(bank.withdraw(KEVIN, 'Kevin', 1), 'balance');
  // Everyone sees the same: the total, what each game put in, and who took how much.
  const seen = bank.state();
  assert.deepEqual(seen.games, { crash: '200', roulette: '300' });
  assert.deepEqual(
    seen.withdrawals!.map((w) => [w.amount, w.by]),
    [
      ['300', 'Nadine'],
      ['80', 'Kevin'],
      ['120', 'Nadine'],
    ],
  );
});

test('with accounts, an account withdraws onto its own balance as before', () => {
  const { chips, bank } = setup();
  bank.lost('slots', 50);
  assert.equal(bank.withdraw(MARC, 'Marc', 30), 30n);
  assert.equal(chips.balance(MARC), START_CHIPS + 30);
  assert.equal(chips.ledger(MARC)[0].reason, 'housebank');
  assert.equal(bank.chipsTotal, 20n);
});

test('two withdrawals at once never take out more than the bank holds', async () => {
  const { chips, bank } = setup();
  bank.lost('crash', 1000);
  // Many players at the machine at the same moment, each going for more than half of it.
  const players = Array.from({ length: 8 }, (_, i) => `browser:${String(i).repeat(32)}`);
  const results = await Promise.all(players.map((p, i) => Promise.resolve().then(() => bank.withdraw(p, `P${i}`, i % 2 ? 'all' : 600))));
  const paid = results.filter((r): r is bigint => typeof r === 'bigint');
  assert.equal(paid.reduce((a, b) => a + b, 0n), 1000n, 'exactly what was there, no more');
  assert.equal(bank.chipsTotal, 0n);
  assert.equal(players.reduce((sum, p) => sum + chips.balance(p) - START_CHIPS, 0), 1000);
  assert.ok(results.filter((r) => r === 'balance').length >= 6, 'the rest are told there is not enough');
});

// ---- Persistence and size ----------------------------------------------------------------------------

test('the bank is kept on disk: total, per game, withdrawals', () => {
  const { data, bank, chips } = setup();
  bank.lost('plinko', 70);
  bank.lost('blackjack', 30);
  bank.withdraw(NADINE, 'Nadine', 40);
  bank.flush();
  chips.flush();
  const again = new HouseBank(data, new Chips(data));
  assert.equal(again.chipsTotal, 60n);
  assert.equal(again.from('plinko'), 70n);
  assert.equal(again.from('blackjack'), 30n);
  assert.deepEqual(again.state().withdrawals!.map((w) => w.amount), ['40']);
});

test('no upper limit: far past what a JS number holds exactly, kept exactly', () => {
  const { data, bank, chips } = setup();
  const big = Number.MAX_SAFE_INTEGER; // 9,007,199,254,740,991
  for (let i = 0; i < 1000; i++) bank.lost('roulette', big);
  const want = BigInt(big) * 1000n;
  assert.equal(bank.chipsTotal, want);
  bank.flush();
  const again = new HouseBank(data, chips);
  assert.equal(again.chipsTotal, want, 'and read back exactly');
  assert.equal(again.state().total, want.toString());
  assert.equal(formatChips(want.toString(), 'de-DE'), '9.007.199.254.740.991.000');
  // Taking out "all" stops where the player's balance can still be added up exactly.
  assert.equal(again.withdraw(NADINE, 'Nadine', 'all'), BigInt(big - START_CHIPS));
  assert.equal(chips.balance(NADINE), big);
  assert.equal(again.withdraw(NADINE, 'Nadine', 1), 'balance', 'they have all a balance can hold');
  assert.equal(again.chipsTotal, want - BigInt(big - START_CHIPS));
});

// ---- Backfill ----------------------------------------------------------------------------------------

test('backfill: what the casino won before the bank counts once, per person and game', () => {
  const data = dir();
  const chips = new Chips(data, { saveAfter: 0 });
  const A = 'browser:aaaaaaaaaaaaaaaa';
  const B = 'browser:bbbbbbbbbbbbbbbb';
  chips.bet(A, 100, 'roulette.bet');
  chips.award(A, 30, 'roulette.win'); // A lost 70 at roulette
  chips.bet(A, 50, 'onlineblackjack.bet'); // and 50 at blackjack on the PC
  chips.bet(B, 10, 'slots.bet');
  chips.award(B, 200, 'slots.jackpot'); // B won at slots: nothing
  chips.bet(B, 40, 'poker.buyin'); // poker: nothing
  chips.bet(B, 20, 'crash.bet'); // Crash counts from its own totals instead
  const stats = new CrashStats(data, { saveAfter: 0 });
  stats.bet(A, 100, 'Ann');
  stats.settle(A, 100, 0, 1.5); // A lost 100 on Crash
  stats.bet(B, 100, 'Bo');
  stats.settle(B, 100, 300, 3); // B won on Crash: nothing
  const bank = new HouseBank(data, chips, { saveAfter: 0 });
  assert.equal(bank.backfillDone, false);
  const counted = bank.backfill({ ledgers: chips.ledgers(), crashNets: stats.nets() });
  assert.deepEqual(counted, { crash: 100n, roulette: 70n, blackjack: 50n });
  assert.equal(bank.chipsTotal, 220n);
  bank.flush();
  // Never twice, whatever the restarts.
  const again = new HouseBank(data, chips);
  assert.equal(again.backfillDone, true);
  assert.equal(again.backfill({ ledgers: chips.ledgers(), crashNets: stats.nets() }), null);
  assert.equal(again.chipsTotal, 220n);
});
