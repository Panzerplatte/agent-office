import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { Crash } from '../src/server/crash.js';
import { CrashStats } from '../src/server/crashstats.js';
import { CRASH_BOARD, CRASH_SCREEN, CASINO_ROOM, SLOT_MACHINES, SLOT_SIZE } from '../src/shared/casino.js';
import { BET_TIME, CRASHED_TIME, CRASH_TOP, addWager, crashRanking, emptyTotals, settle, takeWager, timeFor, type CrashBoardRow } from '../src/shared/crash.js';

const A = 'browser:aaaaaaaaaaaaaaaa';
const B = 'browser:bbbbbbbbbbbbbbbb';
const C = 'account:cc';

// ---- Adding up ----------------------------------------------------------------------------------------

test('totals: a bet adds to what was wagered, a cash-out adds what it made, a loss takes the stake off', () => {
  let t = emptyTotals();
  t = addWager(t, 100);
  t = settle(t, 100, 250, 2.5);
  assert.deepEqual(t, { wagered: 100, net: 150, rounds: 1, best: { won: 150, m: 2.5 } });
  t = settle(addWager(t, 200), 200, 0, 1.4);
  assert.deepEqual(t, { wagered: 300, net: -50, rounds: 2, best: { won: 150, m: 2.5 } }, 'a loss keeps the best win');
  t = settle(addWager(t, 1000), 1000, 1100, 1.1);
  assert.equal(t.net, 50);
  assert.deepEqual(t.best, { won: 150, m: 2.5 }, 'a smaller win is not the best');
  t = settle(addWager(t, 10), 10, 1000, 100);
  assert.deepEqual(t.best, { won: 990, m: 100 }, 'a bigger one is');
  // Cashed out at 1.00× (or rounded down to the stake): no win, no loss.
  t = settle(addWager(t, 10), 10, 10, 1);
  assert.equal(t.net, 1040);
  assert.equal(t.rounds, 5);
  // Taken back: never wagered.
  assert.equal(takeWager(addWager(t, 500), 500).wagered, t.wagered);
  assert.equal(takeWager(emptyTotals(), 5).wagered, 0, 'never below 0');
});

// ---- The ranking --------------------------------------------------------------------------------------

const row = (name: string, wagered: number, net: number, rounds = 1): CrashBoardRow => ({ name, wagered, net, rounds });

test('ranking: most wagered and most won, most first, the top 10 each; only who is up is on the most won', () => {
  const rows = [row('Ada', 500, -500), row('Bo', 2000, 300), row('Cy', 100, 900), row('Di', 0, 0), row('Ed', 700, 0)];
  const r = crashRanking(rows);
  assert.deepEqual(r.wagered.map((x) => x.name), ['Bo', 'Ed', 'Ada', 'Cy'], 'nobody who never bet');
  assert.deepEqual(r.won.map((x) => x.name), ['Cy', 'Bo'], 'nobody even or down');
  const many = Array.from({ length: 25 }, (_, i) => row(`P${String(i).padStart(2, '0')}`, (i + 1) * 10, i + 1));
  const top = crashRanking(many);
  assert.equal(top.wagered.length, CRASH_TOP);
  assert.equal(top.won.length, CRASH_TOP);
  assert.equal(top.wagered[0].name, 'P24');
  assert.equal(top.won[9].name, 'P15');
  // A tie: more rounds first, then by name.
  const tie = crashRanking([row('Zed', 100, 50, 1), row('Amy', 100, 50, 1), row('Max', 100, 50, 3)]);
  assert.deepEqual(tie.wagered.map((x) => x.name), ['Max', 'Amy', 'Zed']);
  assert.deepEqual(tie.won.map((x) => x.name), ['Max', 'Amy', 'Zed']);
});

// ---- In the game --------------------------------------------------------------------------------------

function game(dir = mkdtempSync(path.join(tmpdir(), 'agent-office-crashboard-'))) {
  const clock = { now: 1_000_000, point: 2 };
  const chips = new Chips(dir, { now: () => clock.now, saveAfter: 0 });
  let changes = 0;
  const stats = new CrashStats(dir, { saveAfter: 0, onChange: () => changes++ });
  const c = new Crash(chips, { now: () => clock.now, point: () => clock.point, stats });
  const wait = (ms: number) => {
    clock.now += ms;
    c.tick();
  };
  /** One round crashing at `point`: everyone in `bets` bets, those in `outs` cash out at their multiplier. */
  const round = (point: number, bets: [string, number][], outs: [string, number][] = []) => {
    clock.point = point;
    for (const [who, amount] of bets) assert.ok(c.bet(`p-${who}`, who, who.slice(-2), amount, '#ff0000'));
    wait(BET_TIME);
    let at = 0;
    for (const [who, m] of [...outs].sort((a, b) => a[1] - b[1])) {
      wait(timeFor(m) + 1 - at);
      at = timeFor(m) + 1;
      assert.ok(c.cashOut(who) > 0);
    }
    wait(timeFor(point + 0.01) + 60 - at);
    wait(CRASHED_TIME);
  };
  return { dir, clock, chips, stats, c, wait, round, changes: () => changes };
}

test('the game counts every bet and settles cash-outs and losses into the totals', () => {
  const g = game();
  g.round(3, [[A, 100], [B, 200], [C, 50]], [[A, 2]]);
  assert.deepEqual(g.stats.of(A), { wagered: 100, net: 100, rounds: 1, best: { won: 100, m: 2 } }, 'cashed out at 2×');
  assert.deepEqual(g.stats.of(B), { wagered: 200, net: -200, rounds: 1 }, 'still in at the crash');
  assert.deepEqual(g.stats.of(C), { wagered: 50, net: -50, rounds: 1 });
  g.round(1, [[A, 40]]);
  assert.deepEqual(g.stats.of(A), { wagered: 140, net: 60, rounds: 2, best: { won: 100, m: 2 } }, 'an instant crash at 1.00× loses');
  g.round(5, [[B, 300]], [[B, 4]]);
  assert.deepEqual(g.stats.of(B), { wagered: 500, net: 700, rounds: 2, best: { won: 900, m: 4 } });
  // The totals match what the chips bank paid and took.
  assert.equal(g.chips.balance(A) - g.chips.balance(C), 60 - -50);
  const board = g.stats.board();
  assert.deepEqual(board.wagered.map((r) => r.id), [B, A, C]);
  assert.deepEqual(board.won.map((r) => r.id), [B, A]);
  assert.equal(board.won[0].name, 'bb');
  assert.equal(board.won[0].color, '#ff0000');
  assert.ok(g.changes() > 0);
});

test('a bet taken back, or given back when the office stops, was never wagered', () => {
  const g = game();
  assert.ok(g.c.bet('p', A, 'Ada', 100));
  assert.equal(g.stats.of(A)?.wagered, 100, 'counted as it goes down');
  assert.ok(g.c.cancel(A));
  assert.deepEqual(g.stats.of(A), { wagered: 0, net: 0, rounds: 0 });
  assert.ok(g.c.bet('p', A, 'Ada', 70));
  assert.ok(g.c.bet('q', B, 'Bo', 30));
  g.wait(BET_TIME);
  g.clock.point = 50;
  g.wait(timeFor(1.5));
  assert.ok(g.c.cashOut(B) > 0);
  g.c.close();
  assert.deepEqual(g.stats.of(A), { wagered: 0, net: 0, rounds: 0 }, 'given back: as if it never was');
  assert.equal(g.stats.of(B)?.wagered, 30, 'cashed out before: that one counts');
  assert.deepEqual(g.stats.board().wagered.map((r) => r.id), [B]);
});

test('the totals are kept across a restart, all-time (rounds and cycles never reset them), and a conn: id is not saved', () => {
  const g = game();
  for (let i = 0; i < 30; i++) g.round(2, [[A, 10]], i % 2 ? [[A, 1.5]] : []);
  g.c.bet('p', 'conn:x', 'Temp', 10);
  g.stats.flush();
  const again = new CrashStats(g.dir);
  assert.deepEqual(again.of(A), g.stats.of(A));
  assert.deepEqual(again.of(A), { wagered: 300, net: 15 * 5 - 15 * 10, rounds: 30, best: { won: 5, m: 1.5 } });
  assert.equal(again.of('conn:x'), undefined);
  assert.ok(!readFileSync(path.join(g.dir, 'crash-stats.json'), 'utf8').includes('conn:'));
});

test('an unreadable file is never written over', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-crashboard-'));
  writeFileSync(path.join(dir, 'crash-stats.json'), '{ broken');
  const stats = new CrashStats(dir, { saveAfter: 0 });
  stats.bet(A, 10, 'Ada');
  stats.flush();
  assert.equal(readFileSync(path.join(dir, 'crash-stats.json'), 'utf8'), '{ broken');
});

// ---- On the wall --------------------------------------------------------------------------------------

test('the scoreboard hangs on the west wall right next to the Crash screen, clear of it and the slot machines', () => {
  assert.equal(CRASH_BOARD.x, CRASH_SCREEN.x);
  const frame = 0.08;
  const north = CRASH_BOARD.z - CRASH_BOARD.width / 2 - frame;
  const south = CRASH_BOARD.z + CRASH_BOARD.width / 2 + frame;
  const screenNorth = CRASH_SCREEN.z - CRASH_SCREEN.width / 2 - 0.11;
  assert.ok(south < screenNorth, 'clear of the screen');
  assert.ok(screenNorth - south < 0.3, 'but right next to it');
  const slotsSouth = Math.max(...SLOT_MACHINES.map((m) => m.z + SLOT_SIZE.width / 2));
  assert.ok(north > slotsSouth, 'clear of the slot machines');
  assert.ok(CRASH_BOARD.y + CRASH_BOARD.height / 2 + frame < CASINO_ROOM.height, 'under the ceiling');
});
