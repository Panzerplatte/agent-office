import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_D, BALL_R, CUSHIONS, POCKETS, TABLE, canPlace, groupOf, isSolo, newGame, placeCue, rack, removePlayer, shotOk, simulate, skipTurn, takeShot, teamsOk, type BallPos, type PoolGame, type PoolSeat } from '../src/shared/pool.js';
import { Pool } from '../src/server/pool.js';

const seats = (...ids: string[]): PoolSeat[] => ids.map((id, i) => ({ id, name: id, team: (i % 2) as 0 | 1 }));

/** A shot that sends object ball `n` at (x, y) straight into pocket `pocket`, the cue ball `back` m behind it. */
function potSetup(n: number, x: number, y: number, pocket: number, back = 0.35) {
  const p = POCKETS[pocket];
  // Into a side pocket square on, into a corner at its middle.
  const dx = (p.corner ? p.x : x) - x;
  const dy = (p.corner ? p.y : Math.sign(p.y) * TABLE.width) - y;
  const l = Math.hypot(dx, dy);
  const balls: BallPos[] = [
    { n: 0, x: x - (dx / l) * back, y: y - (dy / l) * back },
    { n, x, y },
  ];
  return { balls, shot: { angle: Math.atan2(dy, dx), power: 0.25, top: -0.4 } };
}

/** A game where the shooter's up with these balls on the table, the break done and the groups as given. */
function midGame(balls: BallPos[], solids: 0 | 1 | null = null, ids = ['a', 'b']): PoolGame {
  const g = newGame(seats(...ids));
  g.balls = balls;
  g.broken = true;
  g.ballInHand = null;
  g.solids = solids;
  return g;
}

/** Somewhere far from everything, for balls that are only there to be on the table. */
const parked = (...ns: number[]): BallPos[] => ns.map((n, i) => ({ n, x: -0.9 + i * 0.07, y: -0.5 }));

// ---- The table --------------------------------------------------------------------------------------

test('the table is a regulation 8-footer, with six pockets and their cushions between them', () => {
  assert.equal(TABLE.length, 2.24);
  assert.equal(TABLE.width, 1.12);
  assert.ok(Math.abs(BALL_D - 0.05715) < 1e-9 && BALL_R === BALL_D / 2);
  assert.equal(POCKETS.length, 6);
  assert.equal(CUSHIONS.length, 6);
  assert.ok(TABLE.cornerMouth < TABLE.sideMouth, 'side pockets are a little wider');
  // Each cushion's ends are the jaws of the pockets either side of it.
  for (const c of CUSHIONS) {
    for (const end of [c.a, c.b]) assert.ok(Math.abs(end.x) <= TABLE.length / 2 + 1e-9 && Math.abs(end.y) <= TABLE.width / 2 + 1e-9);
  }
});

test('the rack: fifteen balls in a triangle on the foot spot, 8 in the middle, a solid and a stripe in the back corners', () => {
  const balls = rack();
  assert.deepEqual(balls.map((b) => b.n), [...Array(16).keys()]);
  const at = (n: number) => balls.find((b) => b.n === n)!;
  assert.deepEqual({ x: at(0).x, y: at(0).y }, TABLE.headSpot);
  assert.equal(at(1).x, TABLE.footSpot.x);
  assert.equal(at(8).y, 0);
  const back = balls.filter((b) => b.x === Math.max(...balls.map((o) => o.x))).sort((p, q) => p.y - q.y);
  assert.equal(back.length, 5);
  assert.notEqual(groupOf(back[0].n), groupOf(back[4].n));
  // Nobody overlaps.
  for (const p of balls) for (const q of balls) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= BALL_D);
});

// ---- The physics ------------------------------------------------------------------------------------

test('the same table and the same shot always end the same way', () => {
  const shot = { angle: 0.013, power: 1, top: 0.2, side: -0.3 };
  const a = simulate(rack(), shot);
  const b = simulate(rack(), shot);
  assert.deepEqual(a, b);
  assert.equal(a.firstHit, 1);
  assert.ok(a.duration > 0 && a.path.length > 1);
  // Everything comes to rest on the table, nobody overlapping.
  for (const p of a.balls) {
    assert.ok(Math.abs(p.x) <= TABLE.length / 2 && Math.abs(p.y) <= TABLE.width / 2);
    for (const q of a.balls) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > BALL_D * 0.98, `${p.n} and ${q.n}`);
  }
  assert.equal(a.balls.length + a.pocketed.length, 16);
});

test('a straight shot pots the ball, in the side and in the corner', () => {
  for (const [pocket, x, y] of [[4, 0, 0.3], [3, 0.85, 0.4], [0, -0.8, -0.3]] as const) {
    const { balls, shot } = potSetup(5, x, y, pocket);
    const r = simulate(balls, shot);
    assert.equal(r.firstHit, 5);
    assert.deepEqual(r.pocketed.map((p) => [p.n, p.pocket]), [[5, pocket]], `into pocket ${pocket}`);
    assert.ok(r.events.some((e) => e.type === 'hit' && e.a === 0 && e.b === 5));
  }
});

test('a ball off a cushion comes back, slower, at the angle it went in', () => {
  // Straight at the foot cushion and back.
  const straight = simulate([{ n: 0, x: 0, y: 0 }], { angle: 0, power: 0.3 });
  const hits = straight.events.filter((e) => e.type === 'cushion');
  assert.equal(hits[0].b, 2, 'the foot cushion');
  assert.ok(straight.balls[0].x < TABLE.length / 2 - BALL_R);
  assert.ok(Math.abs(straight.balls[0].y) < 1e-9);
  assert.equal(straight.cushions.length, 0, 'no contact with a ball, so none counted');
  // At 45° into the +y side's rail: x keeps going, y turns round, a little flatter (the cushion takes
  // some of the speed into it, none of the speed along it).
  const angled = simulate([{ n: 0, x: -0.8, y: 0 }], { angle: Math.PI / 4, power: 0.15 });
  const first = angled.events.find((e) => e.type === 'cushion')!;
  assert.equal(first.b, 4);
  const keys = [];
  for (let i = 0; i < angled.path[0].k.length; i += 3) keys.push(angled.path[0].k.slice(i, i + 3));
  const [, hx, hy] = keys.find(([t]) => t === first.t)!;
  const [, ax, ay] = keys.find(([t]) => t >= first.t + 150)!;
  assert.ok(ax > hx && ay < hy, 'on along x, back down y');
  const out = Math.atan2(hy - ay, ax - hx);
  assert.ok(out > Math.PI / 6 && out < Math.PI / 4, `${(out * 180) / Math.PI}° off the cushion`);
  assert.ok(first.v < 0.15 * 7, 'slower than it was hit');
});

test('draw brings the cue ball back, follow takes it on, after hitting a ball full', () => {
  const balls = [{ n: 0, x: -0.15, y: 0 }, { n: 3, x: 0, y: 0 }];
  const cue = (top: number) => simulate(balls, { angle: 0, power: 0.15, top }).balls.find((b) => b.n === 0)!.x;
  assert.ok(cue(-1) < -0.15 - 0.05, 'drawn back past where it started');
  assert.ok(cue(1) > 0.1, 'followed through');
  assert.ok(cue(-1) < cue(0) && cue(0) < cue(1));
});

test('shots from a page: real numbers, some power, spin within reach', () => {
  assert.ok(shotOk({ angle: 1, power: 0.5 }));
  assert.ok(shotOk({ angle: -3, power: 1, top: -1, side: 1 }));
  for (const bad of [{ angle: NaN, power: 0.5 }, { angle: 0, power: 0 }, { angle: 0, power: 1.2 }, { angle: 0, power: 0.5, top: 2 }, { angle: 0, power: '1' }, { power: 0.5 }, { angle: Infinity, power: 0.5 }, { angle: 0, power: 0.5, side: NaN }]) {
    assert.ok(!shotOk(bad), JSON.stringify(bad));
  }
});

// ---- The rules --------------------------------------------------------------------------------------

test('the break: from the kitchen; the table stays open, and potting keeps the breaker at it', () => {
  const g = newGame(seats('a', 'b'));
  assert.equal(g.ballInHand, 'kitchen');
  assert.ok(!canPlace(g, 0, 0), 'not past the head string');
  assert.ok(placeCue(g, -0.8, 0.1));
  // Find a break that pots something (deterministic, so this is always the same one).
  let angle = 0;
  let played;
  for (; angle < 0.2; angle += 0.0025) {
    const t = newGame(seats('a', 'b'));
    t.balls[0] = { n: 0, x: -0.8, y: 0.1 };
    played = takeShot(t, { angle: Math.atan2(-0.1, TABLE.footSpot.x + 0.8) + angle, power: 1 });
    if (played!.pocketed.some((n) => n !== 0 && n !== 8) && !played!.foul) {
      assert.equal(played!.outcome, 'again');
      assert.equal(t.players[t.up].id, 'a');
      assert.equal(t.solids, null, 'still open');
      assert.ok(t.broken);
      return;
    }
  }
  assert.fail('no break potted anything');
});

test('open table: the first ball legally potted gives the shooter its group', () => {
  const { balls, shot } = potSetup(11, 0, 0.3, 4);
  const g = midGame([...balls, ...parked(2, 8)]);
  const r = takeShot(g, shot)!;
  assert.equal(r.foul, null);
  assert.ok(r.assigned);
  assert.equal(r.outcome, 'again');
  assert.equal(g.solids, 1, 'a has stripes, so b has solids');
  assert.equal(g.players[g.up].id, 'a');
  assert.deepEqual(g.pocketed, [11]);
});

test('hitting the other side\'s ball first is a foul: ball in hand anywhere for them', () => {
  const { balls, shot } = potSetup(11, 0, 0.3, 4);
  const g = midGame([...balls, ...parked(2, 8)], 0); // a has solids
  const r = takeShot(g, shot)!;
  assert.equal(r.foul, 'wrongBall');
  assert.equal(r.outcome, 'foul');
  assert.equal(g.players[g.up].id, 'b');
  assert.equal(g.ballInHand, 'table');
  assert.ok(placeCue(g, 0.9, -0.4), 'anywhere');
  assert.ok(!placeCue(g, 0.9, 1), 'but on the table');
  assert.ok(!placeCue(g, -0.9, -0.5), 'and not on a ball');
});

test('a scratch is a foul, and the cue ball comes back for the other side to place', () => {
  // The cue ball straight into the side pocket, nothing in the way.
  const g = midGame([{ n: 0, x: 0, y: 0 }, ...parked(2, 8, 9)], 0);
  const r = takeShot(g, { angle: Math.PI / 2, power: 0.4 })!;
  assert.deepEqual(r.pocketed, [0]);
  assert.equal(r.foul, 'noHit');
  assert.equal(g.ballInHand, 'table');
  assert.ok(g.balls.some((b) => b.n === 0), 'back on the table');
  assert.equal(g.players[g.up].id, 'b');
});

test('no ball potted and no cushion after contact is a foul', () => {
  // A soft touch, the 2 barely moving.
  const g = midGame([{ n: 0, x: -0.2, y: 0 }, { n: 2, x: 0, y: 0 }, ...parked(8, 9)], 0);
  const r = takeShot(g, { angle: 0, power: 0.05 })!;
  assert.equal(r.firstHit, 2);
  assert.equal(r.rail, false);
  assert.equal(r.foul, 'noRail');
});

test('a legal shot that pots nothing passes the turn, without ball in hand', () => {
  const g = midGame([{ n: 0, x: -0.2, y: 0 }, { n: 2, x: 0, y: 0 }, ...parked(8, 9)], 0);
  const r = takeShot(g, { angle: 0, power: 0.3 })!;
  assert.equal(r.foul, null);
  assert.equal(r.outcome, 'turn');
  assert.equal(g.ballInHand, null);
  assert.equal(g.players[g.up].id, 'b');
});

test('the 8 before your group is cleared loses', () => {
  const { balls, shot } = potSetup(8, 0, 0.3, 4);
  const g = midGame([...balls, ...parked(2, 9)], 0);
  const r = takeShot(g, shot)!;
  assert.equal(r.outcome, 'lost');
  assert.ok(g.over);
  assert.equal(g.winner, 1);
  assert.equal(takeShot(g, shot), null, 'nobody shoots any more');
});

test('the 8 on the open table loses too', () => {
  const { balls, shot } = potSetup(8, 0, 0.3, 4);
  const g = midGame([...balls, ...parked(2, 9)]);
  assert.equal(takeShot(g, shot)!.outcome, 'lost');
});

test('the 8 after clearing your group wins, but not with a scratch', () => {
  const { balls, shot } = potSetup(8, 0, 0.3, 4);
  const g = midGame([...balls, ...parked(9, 10)], 0);
  const r = takeShot(g, shot)!;
  assert.equal(r.foul, null);
  assert.equal(r.outcome, 'won');
  assert.equal(g.winner, 0);

  // The same, followed in by the cue ball.
  const s = potSetup(8, 0, 0.25, 4, 0.2);
  const h = midGame([...s.balls, ...parked(9, 10)], 0);
  const lost = takeShot(h, { ...s.shot, power: 0.5, top: 1 })!;
  assert.deepEqual(lost.pocketed.slice().sort(), [0, 8]);
  assert.equal(lost.foul, 'scratch');
  assert.equal(lost.outcome, 'lost');
  assert.equal(h.winner, 1);
});

test('the 8 on the break is spotted, not a loss', () => {
  const g = newGame(seats('a', 'b'));
  const { balls, shot } = potSetup(8, 0, 0.3, 4);
  g.balls = [...balls, ...parked(1, 9)];
  const r = takeShot(g, shot)!;
  assert.ok(r.break && r.spotted8);
  assert.ok(!g.over);
  assert.deepEqual(g.balls.find((b) => b.n === 8), { n: 8, ...TABLE.footSpot });
  assert.equal(r.outcome, 'turn', 'the 8 doesn\'t count as a ball potted');
});

// ---- On your own -------------------------------------------------------------------------------------

test('on your own: anyone can start, there are no groups, and you shoot again whatever happens', () => {
  assert.ok(teamsOk(seats('a')));
  assert.ok(teamsOk([{ id: 'a', name: 'a', team: 1 }]), 'on either side');
  assert.ok(!teamsOk([]));
  assert.ok(!teamsOk([{ id: 'a', name: 'a', team: 0 }, { id: 'b', name: 'b', team: 0 }]), 'two on one side is no game');
  const g = newGame([{ id: 'a', name: 'a', team: 1 }], 0);
  assert.ok(isSolo(g) && !g.over);
  assert.equal(g.breaker, 1, 'you break yourself');
  assert.equal(g.ballInHand, 'kitchen');

  // A stripe, then a solid: both count, and nobody gets a group.
  let { balls, shot } = potSetup(11, 0, 0.3, 4);
  const h = midGame([...balls, ...parked(2, 8)], null, ['a']);
  let r = takeShot(h, shot)!;
  assert.equal(r.outcome, 'again');
  assert.ok(!r.assigned);
  assert.equal(h.solids, null);
  ({ balls, shot } = potSetup(2, 0, 0.3, 4));
  h.balls = [...balls, ...parked(8)];
  assert.equal(takeShot(h, shot)!.outcome, 'again');

  // A miss is a foul: ball in hand, and still your shot.
  h.balls = [{ n: 0, x: -0.3, y: 0.3 }, ...parked(3, 8)];
  r = takeShot(h, { angle: Math.PI, power: 0.02 })!;
  assert.equal(r.outcome, 'foul');
  assert.equal(h.ballInHand, 'table');
  assert.equal(h.players[h.up].id, 'a');
  // A legal shot that pots nothing: still your shot.
  h.balls = [{ n: 0, x: -0.2, y: 0 }, { n: 3, x: 0, y: 0 }, ...parked(8)];
  r = takeShot(h, { angle: 0, power: 0.3 })!;
  assert.equal(r.outcome, 'turn');
  assert.equal(h.players[h.up].id, 'a');
  assert.ok(!h.over);
  // The 8 first while there are others is a foul.
  ({ balls, shot } = potSetup(8, 0, 0.3, 4));
  h.balls = [{ n: 0, x: -0.2, y: 0 }, { n: 8, x: 0, y: 0 }, ...parked(3)];
  assert.equal(takeShot(h, { angle: 0, power: 0.3 })!.foul, 'wrongBall');
});

test('on your own: the 8 last wins the rack, the 8 early ends it with no winner', () => {
  const { balls, shot } = potSetup(8, 0, 0.3, 4);
  const won = midGame([...balls], null, ['a']);
  assert.equal(takeShot(won, shot)!.outcome, 'won');
  assert.ok(won.over);
  assert.equal(won.winner, 0);

  const early = midGame([...balls.map((b) => ({ ...b })), ...parked(12)], null, ['a']);
  assert.equal(takeShot(early, shot)!.outcome, 'lost');
  assert.ok(early.over);
  assert.equal(early.winner, null);
  assert.ok(!skipTurn(midGame([], null, ['a'])), 'nobody to skip to');
});

// ---- Turns and sides --------------------------------------------------------------------------------

/** Plays a shot that touches nothing (a foul), so the turn passes; puts the cue ball back where it was. */
function miss(g: PoolGame) {
  g.balls = [{ n: 0, x: -0.3, y: 0.3 }, ...parked(2, 8, 9)];
  return takeShot(g, { angle: Math.PI, power: 0.02 })!;
}

test('1 v 1: the turn goes back and forth', () => {
  const g = midGame([], 0, ['a', 'b']);
  const order = [g.players[g.up].id];
  for (let i = 0; i < 4; i++) {
    miss(g);
    order.push(g.players[g.up].id);
  }
  assert.deepEqual(order, ['a', 'b', 'a', 'b', 'a']);
});

test('2 v 2: sides alternate, each side\'s players in turn, and a side shares its group', () => {
  const s = seats('a1', 'b1', 'a2', 'b2');
  assert.ok(teamsOk(s));
  assert.ok(!teamsOk(s.slice(0, 3)));
  const g = newGame(s);
  assert.deepEqual(g.players.map((p) => p.id), ['a1', 'b1', 'a2', 'b2']);
  g.broken = true;
  g.solids = 0;
  const order = [g.players[g.up].id];
  for (let i = 0; i < 5; i++) {
    miss(g);
    order.push(g.players[g.up].id);
  }
  assert.deepEqual(order, ['a1', 'b1', 'a2', 'b2', 'a1', 'b1']);
  // b's side breaks the next one, b1 first.
  assert.deepEqual(newGame(s, 1).players.map((p) => p.id), ['b1', 'a1', 'b2', 'a2']);
});

test('2 v 2: a partner leaving leaves their side to the other; a whole side leaving ends it', () => {
  const g = newGame(seats('a1', 'b1', 'a2', 'b2'));
  g.broken = true;
  miss(g); // b1's shot
  assert.ok(removePlayer(g, 'b1'));
  assert.equal(g.players[g.up].id, 'b2', 'their partner shoots instead');
  assert.ok(!g.over);
  miss(g);
  assert.equal(g.players[g.up].id, 'a2');
  miss(g);
  assert.equal(g.players[g.up].id, 'b2');
  removePlayer(g, 'b2');
  assert.ok(g.over);
  assert.equal(g.winner, null);
  assert.ok(!removePlayer(g, 'nobody'));
});

test('skipping someone who\'s away: to their partner if they have one there, else to the other side', () => {
  const g = newGame(seats('a1', 'b1', 'a2', 'b2'));
  assert.equal(g.players[g.up].id, 'a1');
  g.players[0].away = true;
  assert.ok(skipTurn(g));
  assert.equal(g.players[g.up].id, 'a2', 'their partner, with the break still to play');
  assert.equal(g.ballInHand, 'kitchen');
  // Both of a side away: the other side's turn, without ball in hand from a foul.
  const h = midGame([], 0, ['a', 'b']);
  h.ballInHand = 'table';
  h.players[0].away = true;
  assert.ok(skipTurn(h));
  assert.equal(h.players[h.up].id, 'b');
  assert.equal(h.ballInHand, null);
});

// ---- The table on a floor ---------------------------------------------------------------------------

test('the office\'s table: sides, starting, shooting only on your turn, and once the balls have stopped', () => {
  let now = 1000;
  const t = new Pool(() => now);
  assert.ok(t.join('a', 'Ada'));
  assert.ok(!t.join('a', 'Ada'));
  assert.ok(t.join('b', 'Bob'));
  assert.deepEqual(t.state().lobby.map((s) => s.team), [0, 1]);
  assert.ok(t.join('c', 'Cy'));
  assert.ok(!t.start('a'), 'three can\'t play');
  assert.ok(t.join('d', 'Di'));
  assert.ok(!t.join('e', 'Ed'), 'full');
  assert.ok(!t.setTeam('a', 1), 'that side\'s full');
  assert.ok(!t.setTeam('a', 2 as never));
  assert.ok(t.start('b'));
  assert.ok(!t.setTeam('a', 1), 'not mid-game');

  assert.equal(t.shoot('b', { angle: 0, power: 1 }), null, 'not b\'s shot');
  assert.equal(t.shoot('a', { angle: 0, power: NaN }), null);
  assert.ok(!t.place('a', { x: 0.5, y: 0 }), 'in the kitchen for the break');
  assert.ok(!t.place('a', { x: '-0.6' as never, y: 0 }));
  assert.ok(t.place('a', { x: -0.7, y: 0 }));
  const shot = t.shoot('a', { angle: 0, power: 1 })!;
  assert.ok(shot && shot.at === 1000 && shot.path.length > 1 && shot.from.length === 16);
  const up = t.state().game!.players[t.state().game!.up].id;
  assert.equal(t.shoot(up, { angle: 0, power: 0.5 }), null, 'the balls are still rolling');
  now += shot.duration + 1000;
  assert.ok(t.shoot(up, { angle: 0, power: 0.5 }));

  // Stepping away (walking off, leaving the floor, a dropped connection) keeps their seat, as away.
  assert.ok(t.away('a'));
  assert.ok(!t.away('a'));
  assert.ok(t.state().game!.players.find((p) => p.id === 'a')!.away);
  assert.ok(t.state().lobby.find((s) => s.id === 'a')!.away);
  assert.ok(t.join('a', 'Ada'), 'back');
  assert.ok(!t.state().game!.players.find((p) => p.id === 'a')!.away);
  // Only Leave takes them out of the game.
  assert.ok(t.left('a'));
  assert.ok(!t.left('a'));
  assert.ok(!t.state().game!.players.some((p) => p.id === 'a'));
  assert.ok(t.reset('b'));
  assert.equal(t.state().game, null);
  for (const id of ['b', 'c', 'd']) t.left(id);
  assert.deepEqual(t.state(), { lobby: [], game: null });
});

test('your seat is yours, not your connection\'s: back in it after a reload, with your side and your turn', () => {
  let now = 0;
  const t = new Pool(() => now);
  t.join('c1', 'Ada', 'key-ada');
  t.join('d1', 'Bob', 'key-bob');
  assert.ok(t.start('c1'));
  // Ada reloads: her old connection drops, the new one steps up with the same key.
  assert.ok(t.away('c1'));
  assert.ok(t.join('c2', 'Ada', 'key-ada'));
  const g = t.state().game!;
  assert.deepEqual(g.players.map((p) => [p.id, p.team, !!p.away]), [['c2', 0, false], ['d1', 1, false]]);
  assert.deepEqual(t.state().lobby.map((s) => s.id), ['c2', 'd1']);
  assert.ok(t.place('c2', { x: -0.7, y: 0 }), 'still her break');
  assert.ok(!t.join('c2', 'Ada', 'key-ada'), 'already there');
  // Someone else can't take a seat that's away, even with the table full.
  assert.ok(t.away('c2'));
  t.join('e', 'Cy', 'key-cy');
  t.join('f', 'Di', 'key-di');
  assert.ok(!t.join('g', 'Ed', 'key-ed'), 'full');
  assert.ok(t.join('c3', 'Ada', 'key-ada'), 'but Ada gets hers back');
});

test('while whoever\'s up is away the others can skip them; nobody can skip someone who\'s there', () => {
  let now = 0;
  const t = new Pool(() => now);
  t.join('a', 'A');
  t.join('b', 'B');
  t.start('a');
  assert.ok(!t.skip('b'), 'a is right there');
  t.away('a');
  assert.ok(!t.skip('a'), 'not by someone away');
  assert.ok(!t.skip('x'), 'not by someone not at the table');
  assert.ok(t.skip('b'));
  assert.equal(t.state().game!.players[t.state().game!.up].id, 'b');
  // A game that's all away can be cleared by whoever's at the table; then the seats that were away go.
  t.away('b');
  t.join('c', 'C');
  assert.ok(t.reset('c'));
  assert.deepEqual(t.state().lobby.map((s) => s.id), ['c']);
});

test('on your own: one at the table can start, and stepping away keeps the game for them', () => {
  const t = new Pool(() => 0);
  t.join('a', 'A');
  assert.ok(t.start('a'));
  assert.ok(isSolo(t.state().game!));
  assert.ok(t.away('a'));
  assert.ok(t.state().game, 'still there');
  assert.ok(t.join('a2', 'A', 'a'));
  assert.equal(t.state().game!.players[0].id, 'a2');
  assert.ok(t.left('a2'));
  assert.deepEqual(t.state(), { lobby: [], game: null });
});

test('away from the lobby (no game running) is off the table: there\'s no seat to keep', () => {
  const t = new Pool(() => 0);
  t.join('a', 'A');
  t.join('b', 'B');
  assert.ok(t.away('a'));
  assert.deepEqual(t.state().lobby.map((s) => s.id), ['b']);
});

test('the next game is broken by the other side', () => {
  const t = new Pool(() => 0);
  t.join('a', 'A');
  t.join('b', 'B');
  t.start('a');
  assert.equal(t.state().game!.players[0].id, 'a');
  t.reset('a');
  t.start('a');
  assert.equal(t.state().game!.players[0].id, 'b');
});
