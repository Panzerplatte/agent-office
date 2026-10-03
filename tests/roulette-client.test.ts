import test from 'node:test';
import assert from 'node:assert/strict';
import { SPIN_TIME, SPOTS } from '../src/shared/roulette.js';
import { LAND, ballPath, chipStack, feltSpot, rotorSpeed } from '../src/client/world/roulette.js';

test('the ball runs round the track, comes down and comes to rest in its pocket as the spin ends', () => {
  const start = ballPath(0);
  assert.equal(start.down, 0, 'on the track');
  assert.ok(start.behind > Math.PI * 2 * 5, 'with laps to go');
  const landed = ballPath(SPIN_TIME * LAND);
  assert.deepEqual(landed, { behind: 0, down: 1, hop: 0 }, 'in its pocket');
  assert.deepEqual(ballPath(SPIN_TIME * 2), { behind: 0, down: 1, hop: 0 }, 'and stays there');
  // Always on its way, never back: what's left to go only shrinks, and it only comes down.
  let last = ballPath(0);
  for (let e = 50; e <= SPIN_TIME; e += 50) {
    const p = ballPath(e);
    assert.ok(p.behind <= last.behind, `behind at ${e}`);
    assert.ok(p.down >= last.down, `down at ${e}`);
    assert.ok(p.hop >= 0 && p.hop < 0.03);
    last = p;
  }
  // Lands before the office pays out (at SPIN_TIME), so the toast never gives it away.
  assert.ok(LAND < 1);
});

test('the wheel turns faster once it is spun, then settles back', () => {
  assert.ok(rotorSpeed(0) > rotorSpeed(SPIN_TIME));
  assert.equal(rotorSpeed(-1), rotorSpeed(SPIN_TIME * 3), 'idle');
});

test('a stack is drawn with the biggest chips first', () => {
  assert.deepEqual(chipStack(631), [500, 100, 25, 5, 1]);
  assert.deepEqual(chipStack(15), [5, 5, 5]);
  assert.equal(chipStack(5000).length, 10);
  assert.equal(chipStack(99999).length, 12, 'never taller than that');
});

test('every spot has a place on the felt, inside bets on the numbers, the rest in their boxes', () => {
  // A stand-in for the table's view: numbers 0.12 × 0.15 m, 3 at the top left.
  const view = {
    cell: { x: 0.12, y: 0.15 },
    numberSpot: (n: number) => (n === 0 ? { x: -0.32, y: -0.115 } : { x: -0.38 + 0.12 * (Math.floor((n - 1) / 3) + 1.5), y: -0.34 + 0.15 * (2 - ((n - 1) % 3) + 0.5) }),
    betSpot: (b: string) => ({ x: b.length, y: 1 }),
  };
  for (const s of SPOTS.values()) {
    const p = feltSpot(view, s);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), s.id);
  }
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `${JSON.stringify(a)} ≈ ${JSON.stringify(b)}`);
  near(feltSpot(view, SPOTS.get('straight:17')!), view.numberSpot(17));
  const split = feltSpot(view, SPOTS.get('split:17-20')!);
  assert.ok(Math.abs(split.x - (view.numberSpot(17).x + view.numberSpot(20).x) / 2) < 1e-9, 'between the two');
  assert.deepEqual(feltSpot(view, SPOTS.get('dozen:2')!), view.betSpot('dozen2'));
  assert.deepEqual(feltSpot(view, SPOTS.get('straight:0')!), view.numberSpot(0));
});
