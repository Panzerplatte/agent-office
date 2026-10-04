import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FOOD_POINTS,
  GOLDEN_EVERY,
  GOLDEN_POINTS,
  GOLDEN_TICKS,
  QUEUE_MAX,
  SNAKE_COLS,
  SNAKE_ROWS,
  SNAKE_SCORES_KEPT,
  START_LENGTH,
  TICK_MIN,
  TICK_START,
  checkFrame,
  checkResult,
  frameOf,
  newGame,
  scoreFor,
  snakeCells,
  step,
  tickMs,
  turn,
  pause,
  resume,
  neighbor,
  type Dir,
  type SnakeGame,
} from '../src/shared/snake.js';
import { GOOD_RUN, PACE_GRACE, SnakeArcade, SnakeScores, leastTime } from '../src/server/snake.js';
import { EARN } from '../src/shared/chips.js';

const at = (x: number, y: number) => y * SNAKE_COLS + x;
/** A game with the snake and food where a test wants them. */
const game = (g: Partial<SnakeGame>): SnakeGame => ({ ...newGame(1), ...g });

test('a new game: the snake in the middle heading right, the food somewhere off it', () => {
  for (let seed = 0; seed < 50; seed++) {
    const g = newGame(seed);
    assert.equal(g.snake.length, START_LENGTH);
    assert.equal(g.dir, 'r');
    assert.equal(g.state, 'play');
    assert.ok(g.food >= 0 && g.food < SNAKE_COLS * SNAKE_ROWS);
    assert.ok(!g.snake.includes(g.food));
  }
  // The same seed is the same game.
  assert.deepEqual(newGame(7), newGame(7));
});

test('the snake moves a cell a step, and turns the way the keys say', () => {
  let g = game({ snake: [at(5, 5), at(4, 5), at(3, 5)], food: at(0, 0) });
  g = step(g);
  assert.deepEqual(g.snake, [at(6, 5), at(5, 5), at(4, 5)]);
  g = step(turn(g, 'd'));
  assert.deepEqual(g.snake, [at(6, 6), at(6, 5), at(5, 5)]);
  assert.equal(g.dir, 'd');
  assert.equal(g.ticks, 2);
});

test('no turning straight back, and quick key presses wait their turn', () => {
  const g = game({ snake: [at(5, 5), at(4, 5), at(3, 5)], food: at(0, 0) });
  // Heading right: left is back into itself, right is where it's going already.
  assert.equal(turn(g, 'l'), g);
  assert.equal(turn(g, 'r'), g);
  // Up then left in one step: both count, one a step (and left is fine after up).
  let q = turn(turn(g, 'u'), 'l');
  assert.deepEqual(q.queue, ['u', 'l']);
  // Right after left is straight back on the queued way: ignored.
  assert.deepEqual(turn(q, 'r').queue, ['u', 'l']);
  q = step(q);
  assert.deepEqual(q.snake.slice(0, 2), [at(5, 4), at(5, 5)]);
  q = step(q);
  assert.deepEqual(q.snake.slice(0, 2), [at(4, 4), at(5, 4)]);
  // The queue holds QUEUE_MAX turns at most.
  let full = g;
  for (const d of ['u', 'l', 'd', 'r', 'u'] as const) full = turn(full, d);
  assert.equal(full.queue.length, QUEUE_MAX);
});

test('eating grows the snake, scores, and puts new food off it', () => {
  let g = game({ snake: [at(5, 5), at(4, 5), at(3, 5)], food: at(6, 5) });
  g = step(g);
  assert.deepEqual(g.snake, [at(6, 5), at(5, 5), at(4, 5), at(3, 5)]);
  assert.equal(g.eaten, 1);
  assert.equal(g.score, FOOD_POINTS);
  assert.notEqual(g.food, at(6, 5));
  assert.ok(!g.snake.includes(g.food));
  // The tail stays put for that step only.
  g = step(game({ ...g, food: at(0, 0) }));
  assert.equal(g.snake.length, START_LENGTH + 1);
});

test('food never lands on the snake, however long it gets', () => {
  // A snake filling all but the bottom row, snaking back and forth: every free cell is on that row.
  const snake: number[] = [];
  for (let y = 0; y < SNAKE_ROWS - 1; y++) for (let i = 0; i < SNAKE_COLS; i++) snake.push(at(y % 2 ? SNAKE_COLS - 1 - i : i, y));
  snake.reverse();
  const head = snake[0];
  for (let seed = 0; seed < 200; seed++) {
    const g = step(game({ snake, dir: 'd', queue: [], food: head + SNAKE_COLS, seed }));
    assert.equal(g.state, 'play');
    assert.ok(g.food >= at(0, SNAKE_ROWS - 1), `seed ${seed}: food at ${g.food}`);
    assert.ok(!g.snake.includes(g.food));
  }
});

test('golden food comes out every few pieces, worth more, and goes again', () => {
  let g = game({ snake: [at(5, 5), at(4, 5), at(3, 5)], food: at(6, 5), eaten: GOLDEN_EVERY - 1, score: scoreFor(GOLDEN_EVERY - 1, 0) });
  g = step(g);
  assert.ok(g.golden, 'golden food is out');
  assert.equal(g.golden.left, GOLDEN_TICKS);
  assert.ok(!g.snake.includes(g.golden.cell) && g.golden.cell !== g.food);
  // Eaten: GOLDEN_POINTS, and it grows.
  const eaten = step(game({ ...g, golden: { cell: at(7, 5), left: 5 }, food: at(0, 0) }));
  assert.equal(eaten.golds, 1);
  assert.equal(eaten.score, g.score + GOLDEN_POINTS);
  assert.equal(eaten.snake.length, g.snake.length + 1);
  assert.equal(eaten.golden, null);
  // Left alone, it's gone after GOLDEN_TICKS steps.
  // (Going round and round a square of four cells.)
  const round = ['d', 'l', 'u', 'r'] as const;
  let left = game({ ...g, snake: [at(1, 1), at(0, 1), at(0, 0)], food: at(19, 19), golden: { cell: at(19, 0), left: GOLDEN_TICKS }, queue: [], dir: 'r' });
  for (let i = 0; i < GOLDEN_TICKS - 1; i++) left = step(turn(left, round[i % 4]));
  assert.equal(left.state, 'play');
  assert.ok(left.golden);
  left = step(turn(left, round[(GOLDEN_TICKS - 1) % 4]));
  assert.equal(left.golden, null);
});

test('into a wall or itself the game is over, the snake left where it was', () => {
  const wall = step(game({ snake: [at(SNAKE_COLS - 1, 5), at(SNAKE_COLS - 2, 5), at(SNAKE_COLS - 3, 5)], food: at(0, 0) }));
  assert.equal(wall.state, 'over');
  assert.equal(wall.snake[0], at(SNAKE_COLS - 1, 5));
  assert.equal(step(wall), wall);
  assert.equal(step(game({ snake: [at(5, 0), at(4, 0), at(3, 0)], food: at(9, 9), dir: 'u' })).state, 'over');
  // A snake of five, turning into its own side.
  const coil = game({ snake: [at(5, 5), at(4, 5), at(4, 6), at(5, 6), at(6, 6)], dir: 'r', food: at(0, 0), queue: ['d'] });
  assert.equal(step(coil).state, 'over');
  // Into the cell its tail is leaving is fine.
  const chase = game({ snake: [at(5, 5), at(4, 5), at(4, 6), at(5, 6)], dir: 'r', food: at(0, 0), queue: ['d'] });
  assert.equal(step(chase).state, 'play');
});

test('paused, nothing moves', () => {
  const g = pause(game({ food: at(0, 0) }));
  assert.equal(g.state, 'paused');
  assert.equal(step(g), g);
  assert.equal(resume(g).state, 'play');
});

test('the snake speeds up as it grows', () => {
  assert.equal(tickMs(START_LENGTH), TICK_START);
  assert.ok(tickMs(START_LENGTH + 10) < tickMs(START_LENGTH + 1));
  assert.equal(tickMs(400), TICK_MIN);
});

test('a frame round-trips, and a bad one is turned away', () => {
  const g = game({ snake: [at(5, 5), at(5, 6), at(4, 6), at(3, 6)], food: at(9, 9), eaten: 1, score: FOOD_POINTS, ticks: 4, golden: { cell: at(0, 0), left: 3 } });
  const f = frameOf(g);
  assert.deepEqual(checkFrame(f), f);
  assert.deepEqual(snakeCells(f.head, f.body), g.snake);
  assert.equal(JSON.stringify(f).length < 200, true);
  assert.equal(checkFrame({ ...f, score: f.score + 1 }), null, 'score not what it ate');
  assert.equal(checkFrame({ ...f, body: f.body + 'r' }), null, 'longer than what it ate');
  assert.equal(checkFrame({ ...f, food: at(5, 6) }), null, 'food on the snake');
  assert.equal(checkFrame({ ...f, golden: f.food }), null, 'golden on the food');
  assert.equal(checkFrame({ ...f, body: 'udu' }), null, 'crosses itself');
  assert.equal(checkFrame({ ...f, head: at(0, 0), body: 'uuu' }), null, 'off the grid');
  assert.equal(checkFrame({ ...f, state: 'won' }), null);
  assert.equal(checkFrame(null), null);
  // A whole game played by the rules gives frames that all check out.
  let p = newGame(42);
  for (let i = 0; i < 500 && p.state === 'play'; i++) {
    p = step(turn(p, (['u', 'r', 'd', 'l'] as const)[Math.floor(i / 7) % 4]));
    assert.ok(checkFrame(frameOf(p)), `step ${i}`);
  }
});

test('a result adds up only when its score is what its pieces make', () => {
  assert.deepEqual(checkResult({ score: 70, eaten: 7, golds: 0, ticks: 100 }), { score: 70, eaten: 7, golds: 0, ticks: 100 });
  assert.deepEqual(checkResult({ score: scoreFor(6, 1), eaten: 6, golds: 1, ticks: 100 }), { score: 100, eaten: 6, golds: 1, ticks: 100 });
  assert.equal(checkResult({ score: 80, eaten: 7, golds: 0, ticks: 100 }), null);
  // More golden pieces than plain ones let out.
  assert.equal(checkResult({ score: scoreFor(5, 1), eaten: 5, golds: 1, ticks: 100 }), null);
  // More pieces than steps.
  assert.equal(checkResult({ score: 70, eaten: 7, golds: 0, ticks: 6 }), null);
  assert.equal(checkResult({ score: -10, eaten: -1, golds: 0, ticks: 0 }), null);
});

const tmp = (t: TestContext) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-snake-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const gameId = (n: number) => `game${String(n).padStart(8, '0')}`;
const entry = (n: number, score: number, name = 'Ada') => ({ game: gameId(n), name, color: '#06d6a0', score, length: START_LENGTH + Math.floor(score / FOOD_POINTS) % 300 });

test('the table keeps the best ten, saved across a restart, and a new leader is news', (t) => {
  const dir = tmp(t);
  const table = new SnakeScores(dir);
  assert.deepEqual(table.record(entry(1, 100)), { changed: true, first: true });
  assert.deepEqual(table.record(entry(2, 50, 'Grace')), { changed: true, first: false });
  // The same game twice is once.
  assert.deepEqual(table.record(entry(2, 60, 'Grace')), { changed: false, first: false });
  assert.equal(table.record(entry(3, 0)).changed, false);
  for (let i = 10; i < 10 + SNAKE_SCORES_KEPT; i++) table.record(entry(i, 200 + i * 10));
  assert.equal(table.top().length, SNAKE_SCORES_KEPT);
  assert.equal(table.record(entry(40, 10)).changed, false, 'worse than all of a full table');
  assert.deepEqual(table.record(entry(41, 9000, 'Grace')), { changed: true, first: true });
  const after = new SnakeScores(dir);
  assert.deepEqual(after.top(), table.top());
  assert.equal(after.top()[0].name, 'Grace');
});

test('a broken or tampered table file is a fresh start, not a crash', (t) => {
  const dir = tmp(t);
  writeFileSync(path.join(dir, 'snake.json'), JSON.stringify([{ game: gameId(1), name: 'Ada', color: 'red', score: 30, length: 6, at: 1 }, { game: 'x', name: 'Bad', score: 1e12, length: 2, at: 1 }]));
  assert.deepEqual(
    new SnakeScores(dir).top().map((s) => [s.name, s.color]),
    [['Ada', '#4f86f7']],
  );
  writeFileSync(path.join(dir, 'snake.json'), '{not json');
  assert.deepEqual(new SnakeScores(dir).top(), []);
});

/** A way towards the food that doesn't run into anything, if there is one. */
const chase = (g: SnakeGame): Dir => {
  const [hx, hy, fx, fy] = [g.snake[0] % SNAKE_COLS, Math.floor(g.snake[0] / SNAKE_COLS), g.food % SNAKE_COLS, Math.floor(g.food / SNAKE_COLS)];
  const want: Dir[] = [fx > hx ? 'r' : 'l', fy > hy ? 'd' : 'u', fx > hx ? 'l' : 'r', fy > hy ? 'u' : 'd'];
  const body = g.snake.slice(0, -1);
  return want.find((d) => neighbor(g.snake[0], d) !== -1 && !body.includes(neighbor(g.snake[0], d)) && neighbor(g.snake[0], d) !== g.snake[1]) ?? g.dir;
};
/** An arcade with a clock the test moves. */
const arcade = (t: TestContext) => {
  const clock = { now: 1_000_000 };
  const table = new SnakeScores(tmp(t));
  return { a: new SnakeArcade(table, () => clock.now), table, clock };
};
const ada = { owner: 'name:Ada', name: 'Ada', color: '#06d6a0' };

test('a game played at the pace of its steps goes on the table', (t) => {
  const { a, table, clock } = arcade(t);
  // A real game, played step by step, its frames sent as it goes.
  let g = newGame(3);
  const id = a.start(ada);
  for (let i = 0; i < 300 && g.state === 'play'; i++) {
    clock.now += tickMs(g.snake.length);
    g = step(turn(g, chase(g)));
    if (i % 5 === 0) assert.equal(a.frame(id, checkFrame(frameOf(g))!), 'ok');
  }
  assert.ok(g.eaten > 3, 'it ate something');
  const r = a.over(id, checkResult(g)!);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.changed, true);
  assert.equal(r.first, true);
  assert.equal(table.top()[0].score, g.score);
  assert.equal(table.top()[0].length, g.snake.length);
  // Over is over: the same game can't be sent again.
  assert.equal(a.over(id, checkResult(g)!).verdict, 'none');
});

test('a score faster than the snake can go, or going down, is thrown out', (t) => {
  const { a, table, clock } = arcade(t);
  // 60 pieces in 3 seconds: no snake moves that fast.
  const id = a.start(ada);
  clock.now += 3000;
  assert.equal(a.over(id, { score: 600, eaten: 60, golds: 0, ticks: 100 }).verdict, 'void');
  assert.deepEqual(table.top(), []);
  // A frame that goes backwards ends the game.
  const id2 = a.start(ada);
  clock.now += leastTime(100, 5) + PACE_GRACE;
  assert.equal(a.frame(id2, { ...frameOf(newGame(1)), score: 50, eaten: 5, ticks: 100, body: 'llllllll'.slice(0, START_LENGTH + 4) }), 'ok');
  assert.equal(a.over(id2, { score: 40, eaten: 4, golds: 0, ticks: 120 }).verdict, 'void');
  // Starting another game ends the one before, with no score; so does stepping away.
  const id3 = a.start(ada);
  a.start(ada);
  assert.equal(a.over(id3, { score: 0, eaten: 0, golds: 0, ticks: 1 }).verdict, 'none');
  const id4 = a.start(ada);
  a.leave(id4);
  assert.equal(a.over(id4, { score: 0, eaten: 0, golds: 0, ticks: 1 }).verdict, 'none');
});

test('the least time a game takes counts each step at its quickest', () => {
  assert.equal(leastTime(0, 0), 0);
  assert.equal(leastTime(10, 0), 10 * TICK_START);
  assert.equal(leastTime(3, 2), tickMs(START_LENGTH) + tickMs(START_LENGTH + 1) + tickMs(START_LENGTH + 2));
});

test('a good run pays chips, capped like the other games', () => {
  assert.ok(EARN.snakeScore.cooldown && EARN.snakeScore.perDay);
  assert.ok(EARN.snakeScore.chips <= EARN.dartsWin.chips);
  assert.ok(GOOD_RUN > 0 && GOOD_RUN % FOOD_POINTS === 0);
});
