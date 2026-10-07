import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/accounts.js';
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

const OWNER = 'nadine0000000001';
const OTHER = 'someone000000002';
const dir = () => mkdtempSync(path.join(tmpdir(), 'agent-office-housebank-'));

/** A house bank (and the chips it pays into) in a fresh data dir, owned by OWNER. */
function setup(owner: string | null = OWNER, data = dir()) {
  let now = 1_000_000;
  const chips = new Chips(data, { now: () => now, saveAfter: 0 });
  const bank = new HouseBank(data, chips, { now: () => now, owner: () => owner ?? undefined, saveAfter: 0 });
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

test('only the owner can withdraw, never more than the bank holds, onto their own balance with a ledger entry', () => {
  const { chips, bank } = setup();
  bank.lost('roulette', 300);
  bank.lost('crash', 200);
  assert.equal(bank.withdraw(OTHER, 'Mallory', 10), 'owner', 'anyone else is turned away');
  assert.equal(bank.withdraw(undefined, 'Shared', 10), 'owner', 'so is the shared password');
  assert.equal(chips.balance(`account:${OTHER}`), START_CHIPS);
  assert.equal(bank.withdraw(OWNER, 'Nadine', 501), 'balance', 'no more than the bank holds');
  assert.equal(bank.withdraw(OWNER, 'Nadine', 0), 'amount');
  assert.equal(bank.withdraw(OWNER, 'Nadine', 1.5), 'amount');
  assert.equal(bank.withdraw(OWNER, 'Nadine', '-3'), 'amount');
  assert.equal(bank.chipsTotal, 500n, 'nothing changed');
  assert.equal(bank.withdraw(OWNER, 'Nadine', 120), 120n);
  assert.equal(bank.chipsTotal, 380n);
  assert.equal(chips.balance(`account:${OWNER}`), START_CHIPS + 120);
  assert.deepEqual(chips.ledger(`account:${OWNER}`)[0], { at: 1_000_000, amount: 120, reason: 'housebank', balance: START_CHIPS + 120 });
  assert.equal(bank.withdraw(OWNER, 'Nadine', 'all'), 380n);
  assert.equal(bank.chipsTotal, 0n, 'never below 0');
  assert.equal(bank.withdraw(OWNER, 'Nadine', 'all'), 'balance');
  // The owner sees the log; everyone else only the total.
  assert.deepEqual(bank.state(OTHER), { total: '0' });
  const mine = bank.state(OWNER);
  assert.equal(mine.owner, true);
  assert.deepEqual(mine.games, { crash: '200', roulette: '300' });
  assert.deepEqual(
    mine.withdrawals!.map((w) => [w.amount, w.by]),
    [
      ['380', 'Nadine'],
      ['120', 'Nadine'],
    ],
  );
});

test('with no owner set nobody can withdraw', () => {
  const { bank } = setup(null);
  bank.lost('slots', 50);
  assert.equal(bank.withdraw(OWNER, 'Nadine', 10), 'owner');
  assert.equal(bank.withdraw(undefined, 'x', 10), 'owner');
});

test('the owner is an account setting, changeable, and only an existing account', () => {
  const data = dir();
  const accounts = new Accounts(data);
  assert.equal(accounts.bankOwner, undefined);
  assert.equal(accounts.setBankOwner('nope'), false, 'no such account');
  const raw = { invites: [], accounts: [] as unknown[] };
  raw.accounts = [{ id: OWNER, name: 'Nadine Nagelfee', role: 'member', hash: 'x', salt: 'y', createdAt: 1, createdBy: 't' }];
  writeFileSync(path.join(data, 'accounts.json'), JSON.stringify(raw));
  // (As `agent-office accounts` does, from outside: the office re-reads the file.)
  const again = new Accounts(data);
  assert.ok(again.setBankOwner(OWNER));
  assert.equal(new Accounts(data).bankOwner, OWNER, 'kept on disk');
  assert.equal(again.state(new Set()).bankOwner, OWNER, 'admins see it');
  assert.ok(again.setBankOwner(undefined));
  assert.equal(again.bankOwner, undefined);
});

// ---- Persistence and size ----------------------------------------------------------------------------

test('the bank is kept on disk: total, per game, withdrawals', () => {
  const { data, bank, chips } = setup();
  bank.lost('plinko', 70);
  bank.lost('blackjack', 30);
  bank.withdraw(OWNER, 'Nadine', 40);
  bank.flush();
  chips.flush();
  const again = new HouseBank(data, new Chips(data), { owner: () => OWNER });
  assert.equal(again.chipsTotal, 60n);
  assert.equal(again.from('plinko'), 70n);
  assert.equal(again.from('blackjack'), 30n);
  assert.deepEqual(again.state(OWNER).withdrawals!.map((w) => w.amount), ['40']);
});

test('no upper limit: far past what a JS number holds exactly, kept exactly', () => {
  const { data, bank, chips } = setup();
  const big = Number.MAX_SAFE_INTEGER; // 9,007,199,254,740,991
  for (let i = 0; i < 1000; i++) bank.lost('roulette', big);
  const want = BigInt(big) * 1000n;
  assert.equal(bank.chipsTotal, want);
  bank.flush();
  const again = new HouseBank(data, chips, { owner: () => OWNER });
  assert.equal(again.chipsTotal, want, 'and read back exactly');
  assert.equal(again.state(undefined).total, want.toString());
  assert.equal(formatChips(want.toString(), 'de-DE'), '9.007.199.254.740.991.000');
  // Taking out "all" stops where the owner's balance can still be added up exactly.
  assert.equal(again.withdraw(OWNER, 'Nadine', 'all'), BigInt(big - START_CHIPS));
  assert.equal(chips.balance(`account:${OWNER}`), big);
  assert.equal(again.withdraw(OWNER, 'Nadine', 1), 'balance', 'the owner has all a balance can hold');
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
