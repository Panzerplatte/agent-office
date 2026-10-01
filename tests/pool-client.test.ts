import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_R, POCKETS, TABLE, newGame, rack, simulate, takeShot, type BallPos } from '../src/shared/pool.js';
import { POOL_TABLE } from '../src/shared/layout.js';
import { TEAM_COLORS, aimLine, drops, pathAt, seatColor, standSpot, tableAt } from '../src/client/world/pool.js';

const seats = [
  { id: 'a', name: 'Ada', team: 0 as const },
  { id: 'b', name: 'Bo', team: 1 as const },
  { id: 'c', name: 'Cy', team: 0 as const },
  { id: 'd', name: 'Di', team: 1 as const },
];

test('a path is played back straight between its keys, and held at either end', () => {
  const k = [0, 0, 0, 100, 1000, 0, 300, 1000, 500];
  assert.deepEqual(pathAt(k, -5), { x: 0, y: 0 });
  assert.deepEqual(pathAt(k, 50), { x: 0.5, y: 0 });
  assert.deepEqual(pathAt(k, 200), { x: 1, y: 0.25 });
  assert.deepEqual(pathAt(k, 1e9), { x: 1, y: 0.5 });
});

test('played back to the end, a shot leaves the balls where the office says they stopped', () => {
  const g = newGame(seats.slice(0, 2));
  const pb = takeShot(g, { angle: 0, power: 1 })!;
  const end = tableAt(pb, pb.duration);
  // The 8 on the break goes back on the spot and a scratch back in the kitchen: those the playback can't know.
  const placed = new Set([...(pb.spotted8 ? [8] : []), ...(pb.pocketed.includes(0) ? [0] : [])]);
  const want = g.balls.filter((b) => !placed.has(b.n));
  for (const b of want) {
    const got = end.balls.find((o) => o.n === b.n);
    assert.ok(got, `ball ${b.n} still on the table`);
    assert.ok(Math.hypot(got.x - b.x, got.y - b.y) < 0.002, `ball ${b.n} where it stopped`);
  }
  assert.deepEqual(end.dropped.map((d) => d.n).sort(), [...pb.pocketed].sort());
});

test('a ball that drops goes into the pocket the office credited it to, when it does', () => {
  // The 1 straight into the foot corner at +x +y.
  const balls: BallPos[] = [
    { n: 0, x: 0.2, y: 0.1 },
    { n: 1, x: 0.7, y: 0.35 },
  ];
  const pocket = POCKETS[3];
  const angle = Math.atan2(pocket.y - 0.35, pocket.x - 0.7);
  // Strike the cue ball at the ghost ball's spot behind the 1, on the line to the pocket.
  const ghost = { x: 0.7 - Math.cos(angle) * 2 * BALL_R, y: 0.35 - Math.sin(angle) * 2 * BALL_R };
  const res = simulate(balls, { angle: Math.atan2(ghost.y - 0.1, ghost.x - 0.2), power: 0.5 });
  assert.equal(res.pocketed[0]?.n, 1);
  const d = drops({ pocketed: res.pocketed.map((p) => p.n), path: res.path });
  assert.equal(d[0].pocket, res.pocketed[0].pocket);
  assert.equal(d[0].t, res.pocketed[0].t);
  assert.ok(tableAt({ from: balls, path: res.path, pocketed: [1] }, d[0].t - 1).balls.some((b) => b.n === 1));
  assert.ok(!tableAt({ from: balls, path: res.path, pocketed: [1] }, d[0].t).balls.some((b) => b.n === 1));
});

test('the aiming line stops at the first ball it would touch, with a ghost ball touching it', () => {
  const balls: BallPos[] = [
    { n: 0, x: -0.5, y: 0 },
    { n: 3, x: 0.2, y: 0.02 },
    { n: 9, x: 0.6, y: 0 },
  ];
  const a = aimLine(balls, 0)!;
  assert.equal(a.hit, 3);
  assert.ok(Math.abs(Math.hypot(a.x - 0.2, a.y - 0.02) - 2 * BALL_R) < 1e-9);
  // The 3 goes off along the line from the ghost ball through its centre: forward and a little to +y.
  assert.ok(a.dir!.x > 0.8 && a.dir!.y > 0);
  // Aimed away from both, it runs to the cushion.
  const off = aimLine(balls, Math.PI)!;
  assert.equal(off.hit, null);
  assert.ok(Math.abs(off.x - (-TABLE.length / 2 + BALL_R)) < 1e-9);
  // The rack's apex, from the head spot.
  assert.equal(aimLine(rack(), 0)!.hit, 1);
});

test('the shooter stands behind the cue ball, outside the table, whichever way they aim', () => {
  const X = POOL_TABLE.outer.length / 2;
  const Y = POOL_TABLE.outer.width / 2;
  for (let a = -Math.PI; a < Math.PI; a += 0.3) {
    const cue = { x: 0.3 * Math.cos(a * 3), y: 0.2 * Math.sin(a * 2) };
    const s = standSpot(cue, a);
    assert.ok(Math.abs(s.x) > X || Math.abs(s.y) > Y, 'off the table');
    // Behind it: the cue ball's between them and where they aim.
    const back = (s.x - cue.x) * Math.cos(a) + (s.y - cue.y) * Math.sin(a);
    assert.ok(back < 0);
  }
});

test('each player has their own colour, warm on side A and cool on side B', () => {
  const colors = seats.map((s) => seatColor(seats, s.id));
  assert.equal(new Set(colors).size, 4);
  assert.ok((TEAM_COLORS[0] as readonly string[]).includes(colors[0]) && (TEAM_COLORS[0] as readonly string[]).includes(colors[2]));
  assert.ok((TEAM_COLORS[1] as readonly string[]).includes(colors[1]) && (TEAM_COLORS[1] as readonly string[]).includes(colors[3]));
});
