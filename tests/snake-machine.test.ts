import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAKE_SCORES_KEPT, type SnakeScore } from '../src/shared/snake.js';
import { qualifies, swipeDir } from '../src/client/ui/snake.js';

const table = (n: number, score = (i: number) => 1000 - i * 10): SnakeScore[] =>
  Array.from({ length: n }, (_, i) => ({
    game: `game${String(i).padStart(8, '0')}`,
    name: 'Ada',
    color: '#3ddc5a',
    score: score(i),
    length: 5,
    at: i,
  }));

test('a score asks for a name when it makes the table: any while it has room, else better than the last', () => {
  assert.equal(qualifies(0, []), false, 'nothing scored, nothing to put on it');
  assert.equal(qualifies(10, []), true);
  assert.equal(qualifies(10, table(SNAKE_SCORES_KEPT - 1)), true);
  const full = table(SNAKE_SCORES_KEPT);
  const last = full[full.length - 1].score;
  assert.equal(qualifies(last, full), false, 'a tie with the last place goes to the one that got there first');
  assert.equal(qualifies(last + 10, full), true);
});

test('a swipe steers the way it went most; a short one is a tap', () => {
  assert.equal(swipeDir(5, -8), null);
  assert.equal(swipeDir(60, 10), 'r');
  assert.equal(swipeDir(-60, 30), 'l');
  assert.equal(swipeDir(20, 80), 'd');
  assert.equal(swipeDir(-10, -40), 'u');
});
