import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { CREDIT_AMOUNTS, CREDIT_MAX, CREDIT_MERGED, CREDIT_PAYOFF, CREDIT_PER_MINUTE, EARN, START_CHIPS, creditAmountOk, creditWork, workTime, type ChipsState } from '../src/shared/chips.js';

const A = 'account:ada';
const B = 'browser:0123456789abcdef0123';

/** A bank in a fresh folder, on a clock the test moves, with every state it sent and every credit paid back. */
function bank(dir = mkdtempSync(path.join(tmpdir(), 'agent-office-credit-'))) {
  const clock = { now: new Date(2026, 9, 6, 10, 0).getTime() };
  const states: { id: string; state: ChipsState; reason?: string; quiet: boolean }[] = [];
  const paid: string[] = [];
  const chips = new Chips(dir, {
    now: () => clock.now,
    saveAfter: 0,
    onChange: (id, state, entry, quiet) => states.push({ id, state, reason: entry?.reason, quiet }),
    onCredit: (id) => paid.push(id),
  });
  return { chips, clock, states, paid, dir };
}

test('credit comes in set amounts, 10,000 at most', () => {
  assert.equal(Math.max(...CREDIT_AMOUNTS), CREDIT_MAX);
  assert.equal(CREDIT_MAX, 10_000);
  for (const n of CREDIT_AMOUNTS) assert.equal(creditAmountOk(n), true);
  for (const n of [0, -500, 750, 10_001, 20_000, 1e9, 500.5, NaN, '500', null]) assert.equal(creditAmountOk(n), false, String(n));
  const { chips, dir } = bank();
  assert.equal(chips.credit(A, 20_000), 'amount');
  assert.equal(chips.credit(A, 10_001), 'amount');
  assert.equal(chips.balance(A), START_CHIPS);
  assert.equal(chips.owed(A), 0);
  // The most there is.
  assert.equal(chips.credit(A, 10_000), null);
  assert.equal(chips.balance(A), START_CHIPS + 10_000);
  assert.equal(chips.ledger(A)[0].reason, 'credit');
  assert.equal(chips.ledger(A)[0].amount, 10_000);
  assert.deepEqual(chips.state(A).credit, { amount: 10_000, owed: 10_000 });
  rmSync(dir, { recursive: true });
});

test('no new credit until the last one is paid back', () => {
  const { chips, dir } = bank();
  assert.equal(chips.credit(A, 2500), null);
  assert.equal(chips.credit(A, 500), 'owing');
  assert.equal(chips.balance(A), START_CHIPS + 2500);
  // Work towards it, but not all: still owing.
  chips.work([A], creditWork(2500) - 1);
  assert.ok(chips.owed(A) > 0);
  assert.equal(chips.credit(A, 500), 'owing');
  // Someone else isn't held up by it.
  assert.equal(chips.credit(B, 500), null);
  rmSync(dir, { recursive: true });
});

test('four hours of work pay off a full credit, pro rata, and then the next one is there', () => {
  assert.equal(CREDIT_PAYOFF, 240);
  assert.equal(CREDIT_PER_MINUTE * 60, 2500);
  const { chips, states, paid, dir } = bank();
  chips.credit(A, 10_000);
  // An hour of work: 2,500 paid off.
  chips.work([A], 60);
  assert.equal(chips.owed(A), 7500);
  // Minute by minute, the rest (2 h 59 min of it doesn't do).
  for (let i = 0; i < 179; i++) chips.work([A]);
  assert.ok(chips.owed(A) > 0);
  assert.equal(chips.credit(A, 500), 'owing');
  assert.deepEqual(paid, []);
  chips.work([A]);
  assert.equal(chips.owed(A), 0);
  assert.equal(chips.state(A).credit, undefined);
  assert.deepEqual(paid, [A]);
  // The page heard each step quietly, without a ledger entry, the last with nothing owed.
  const last = states.filter((s) => s.id === A).at(-1)!;
  assert.equal(last.reason, undefined);
  assert.equal(last.quiet, true);
  assert.equal(last.state.credit, undefined);
  // Working on doesn't add up anything; the balance never changed by work.
  chips.work([A], 100);
  assert.equal(chips.balance(A), START_CHIPS + 10_000);
  assert.equal(chips.credit(A, 1000), null);
  assert.equal(chips.balance(A), START_CHIPS + 11_000);
  rmSync(dir, { recursive: true });
});

test('a smaller credit is paid off proportionally faster, and a merged PR counts as a chunk of work', () => {
  const { chips, dir } = bank();
  chips.credit(A, 2500);
  assert.equal(creditWork(2500), 60);
  assert.equal(workTime(creditWork(chips.owed(A))), '1 h');
  chips.merged(A);
  assert.equal(chips.owed(A), Math.ceil(2500 - CREDIT_MERGED * CREDIT_PER_MINUTE));
  chips.work([A], 60 - CREDIT_MERGED);
  assert.equal(chips.owed(A), 0);
  assert.equal(chips.credit(A, 500), null);
  rmSync(dir, { recursive: true });
});

test('chips won at mini games go to the credit; other earnings do not', () => {
  const { chips, states, dir } = bank();
  chips.credit(A, 500);
  const before = chips.balance(A);
  // Being about isn't a mini game: it's all yours.
  assert.equal(chips.earn(A, 'daily'), EARN.daily.chips);
  assert.equal(chips.balance(A), before + EARN.daily.chips);
  assert.equal(chips.owed(A), 500);
  // A darts win pays the credit off instead (the ledger shows both).
  assert.equal(chips.earn(A, 'dartsWin'), EARN.dartsWin.chips);
  assert.equal(chips.owed(A), 500 - EARN.dartsWin.chips);
  assert.equal(chips.balance(A), before + EARN.daily.chips);
  assert.deepEqual(chips.ledger(A).slice(0, 2).map((e) => [e.reason, e.amount]), [['credit.repay', -EARN.dartsWin.chips], ['dartsWin', EARN.dartsWin.chips]]);
  assert.equal(states.at(-1)!.quiet, true);
  assert.equal(states.at(-1)!.state.credit?.owed, 500 - EARN.dartsWin.chips);
  // More than is owed: the rest is yours.
  chips.work([A], creditWork(chips.owed(A)) - 1);
  const owed = chips.owed(A);
  assert.ok(owed > 0 && owed < EARN.golfHole.chips);
  const mid = chips.balance(A);
  chips.earn(A, 'golfHole');
  assert.equal(chips.owed(A), 0);
  assert.equal(chips.balance(A), mid + EARN.golfHole.chips - owed);
  rmSync(dir, { recursive: true });
});

test('a credit, and what is still owed on it, are kept across a restart', () => {
  const first = bank();
  first.chips.credit(A, 5000);
  first.chips.work([A], 30);
  first.chips.flush();
  const again = bank(first.dir).chips;
  assert.equal(again.balance(A), START_CHIPS + 5000);
  assert.equal(again.owed(A), 5000 - 30 * CREDIT_PER_MINUTE);
  assert.equal(again.credit(A, 500), 'owing');
  again.work([A], creditWork(again.owed(A)));
  assert.equal(again.credit(A, 500), null);
  rmSync(first.dir, { recursive: true });
});

test('without a credit (or once it is paid back) mini-game chips go on the balance as always', () => {
  const { chips, dir } = bank();
  const start = chips.balance(A);
  assert.equal(chips.earn(A, 'poolWin'), EARN.poolWin.chips);
  assert.equal(chips.balance(A), start + EARN.poolWin.chips);
  assert.equal(chips.ledger(A)[0].reason, 'poolWin');
  assert.equal(chips.owed(A), 0);
  // Take one, pay it off with work, and winnings are all yours again.
  chips.credit(A, 500);
  chips.work([A], creditWork(500));
  assert.equal(chips.owed(A), 0);
  const after = chips.balance(A);
  assert.equal(chips.earn(A, 'golfHole'), EARN.golfHole.chips);
  assert.equal(chips.balance(A), after + EARN.golfHole.chips);
  assert.equal(chips.ledger(A)[0].reason, 'golfHole');
  rmSync(dir, { recursive: true });
});
