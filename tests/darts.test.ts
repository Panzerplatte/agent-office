import test from 'node:test';
import assert from 'node:assert/strict';
import { DART_COLORS, RINGS, SECTORS, SECTOR_ANGLE, dartOk, newGame, removePlayer, score, sectorAt, throwDart, type DartsGame } from '../src/shared/darts.js';
import { Darts } from '../src/server/darts.js';

/** A point `r` meters out from the bull, `deg` degrees clockwise from straight up. */
function at(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: r * Math.cos(a) };
}

/** Where to hit for `label` ("T20", "D16", "5", "25", "BULL", "MISS"): in the middle of that bed. */
function aim(label: string) {
  if (label === 'BULL') return { x: 0, y: 0 };
  if (label === '25') return { x: 0, y: (RINGS.bull + RINGS.outerBull) / 2 };
  if (label === 'MISS') return { x: 0, y: 0.3 };
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const n = Number(mult === 1 ? label : label.slice(1));
  const r = mult === 3 ? (RINGS.tripleIn + RINGS.tripleOut) / 2 : mult === 2 ? (RINGS.doubleIn + RINGS.doubleOut) / 2 : (RINGS.tripleOut + RINGS.doubleIn) / 2;
  return at(r, SECTORS.indexOf(n as (typeof SECTORS)[number]) * 18);
}

const s = (label: string) => score(aim(label).x, aim(label).y);

/** Throws `labels` in turn, whoever's up. */
function play(g: DartsGame, ...labels: string[]) {
  return labels.map((l) => throwDart(g, aim(l).x, aim(l).y));
}

const seats = (...ids: string[]) => ids.map((id, i) => ({ id, name: id, color: DART_COLORS[i] }));

// ---- The board --------------------------------------------------------------------------------------

test('every sector sits where a regulation board has it, clockwise from 20 at the top', () => {
  for (let i = 0; i < 20; i++) assert.equal(sectorAt(at(0.13, i * 18).x, at(0.13, i * 18).y), SECTORS[i]);
  assert.equal(sectorAt(1, 0), 6, '6 to the right');
  assert.equal(sectorAt(0, -1), 3, '3 at the bottom');
  assert.equal(sectorAt(-1, 0), 11, '11 to the left');
  assert.ok(Math.abs(SECTOR_ANGLE - Math.PI / 10) < 1e-12);
});

test('each ring scores what it should', () => {
  assert.deepEqual(score(0, 0), { value: 50, mult: 2, sector: 25, label: 'BULL' });
  assert.deepEqual(score(0.01, 0), { value: 25, mult: 1, sector: 25, label: '25' });
  assert.deepEqual(s('T20'), { value: 60, mult: 3, sector: 20, label: 'T20' });
  assert.deepEqual(s('D16'), { value: 32, mult: 2, sector: 16, label: 'D16' });
  assert.deepEqual(s('5'), { value: 5, mult: 1, sector: 5, label: '5' });
  assert.deepEqual(score(0, 0.05), { value: 20, mult: 1, sector: 20, label: '20' }, 'inner single');
  assert.deepEqual(score(0, 0.3), { value: 0, mult: 0, sector: 0, label: 'MISS' });
  assert.equal(score(NaN, 0).label, 'MISS');
  assert.equal(score(Infinity, 0).label, 'MISS');
});

test('right on a wire counts for the side nearer the bull; just past it, the next ring', () => {
  const e = 1e-6;
  const ring = (r: number) => score(0, r).label;
  assert.equal(ring(RINGS.bull), 'BULL');
  assert.equal(ring(RINGS.bull + e), '25');
  assert.equal(ring(RINGS.outerBull), '25');
  assert.equal(ring(RINGS.outerBull + e), '20');
  assert.equal(ring(RINGS.tripleIn), '20');
  assert.equal(ring(RINGS.tripleIn + e), 'T20');
  assert.equal(ring(RINGS.tripleOut), 'T20');
  assert.equal(ring(RINGS.tripleOut + e), '20');
  assert.equal(ring(RINGS.doubleIn), '20');
  assert.equal(ring(RINGS.doubleIn + e), 'D20');
  assert.equal(ring(RINGS.doubleOut), 'D20');
  assert.equal(ring(RINGS.doubleOut + e), 'MISS');
});

test('either side of the 20/1 and 3/19 wires', () => {
  const r = 0.13;
  assert.equal(score(at(r, 8.99).x, at(r, 8.99).y).label, '20');
  assert.equal(score(at(r, 9.01).x, at(r, 9.01).y).label, '1');
  assert.equal(score(at(r, -8.99).x, at(r, -8.99).y).label, '20', '20 reaches round to the 5');
  assert.equal(score(at(r, -9.01).x, at(r, -9.01).y).label, '5');
  assert.equal(score(at(r, 188.99).x, at(r, 188.99).y).label, '3');
  assert.equal(score(at(r, 189.01).x, at(r, 189.01).y).label, '19');
  assert.equal(score(0, -r).label, '3');
  assert.equal(score(-0, -r).label, '3');
});

test('a dart from the page has to be two numbers near the board', () => {
  assert.ok(dartOk({ x: 0.1, y: -0.2 }));
  assert.ok(!dartOk({ x: '0', y: 0 }));
  assert.ok(!dartOk({ x: NaN, y: 0 }));
  assert.ok(!dartOk({ x: 5, y: 0 }));
  assert.ok(!dartOk({ x: undefined, y: 0 }));
});

test('four colours, all different', () => {
  assert.equal(DART_COLORS.length, 4);
  assert.equal(new Set(DART_COLORS).size, 4);
  for (const c of DART_COLORS) assert.match(c, /^#[0-9a-f]{6}$/);
});

// ---- The game ---------------------------------------------------------------------------------------

test('three darts a turn, then the next player, round and round', () => {
  const g = newGame({ mode: 301, doubleOut: true }, seats('ann', 'bob'));
  assert.equal(g.players[g.up].id, 'ann');
  const r = play(g, 'T20', '20', '5');
  assert.deepEqual(r.map((x) => x!.turnOver), [false, false, true]);
  assert.equal(g.players[0].score, 301 - 85);
  assert.equal(g.players[g.up].id, 'bob');
  assert.deepEqual(g.darts, []);
  assert.deepEqual(g.turns.map((t) => [t.player, t.from, t.darts.map((d) => d.label), t.bust]), [['ann', 301, ['T20', '20', '5'], false]]);
  assert.deepEqual([g.turns[0].darts[0].x, g.turns[0].darts[0].y], [aim('T20').x, aim('T20').y], 'where each dart landed is kept');
  play(g, '1', '1');
  assert.equal(g.darts.length, 2, 'the turn so far');
  assert.equal(g.players[1].score, 299);
  play(g, '1');
  assert.equal(g.players[g.up].id, 'ann');
  assert.equal(g.from, 216);
});

test('double-out: finishing on a double (or the bull) wins', () => {
  const g = newGame({ mode: 301, doubleOut: true }, seats('ann', 'bob'));
  g.players[0].score = g.from = 40;
  const [r] = play(g, 'D20');
  assert.ok(r!.won && r!.turnOver && !r!.bust);
  assert.ok(g.over);
  assert.equal(g.winner, 'ann');
  assert.equal(g.players[0].score, 0);
  assert.equal(throwDart(g, 0, 0), null, 'nobody throws once it is over');

  const b = newGame({ mode: 501, doubleOut: true }, seats('ann'));
  assert.equal(b.players[0].score, 501);
  b.players[0].score = b.from = 50;
  assert.ok(play(b, 'BULL')[0]!.won, 'the bull is a double');
});

test('double-out busts: below 0, down to 1, or 0 on a single; the score goes back to the start of the turn', () => {
  for (const [from, darts, label] of [
    [40, ['10', 'T20'], 'below 0'],
    [40, ['19', '20'], 'to 1'],
    [40, ['20', '20'], 'out on a single'],
    [60, ['T20'], 'out on a triple'],
    [25, ['25'], 'out on the outer bull'],
  ] as [number, string[], string][]) {
    const g = newGame({ mode: 301, doubleOut: true }, seats('ann', 'bob'));
    g.players[0].score = g.from = from;
    const r = play(g, ...darts);
    const last = r[r.length - 1]!;
    assert.ok(last.bust && last.turnOver && !last.won, label);
    assert.equal(g.players[0].score, from, label);
    assert.equal(g.players[g.up].id, 'bob', `${label}: bob's turn`);
    assert.ok(g.turns[0].bust);
    assert.ok(!g.over);
  }
});

test('without double-out, any dart that gets to exactly 0 wins, and only going below 0 busts', () => {
  const g = newGame({ mode: 301, doubleOut: false }, seats('ann', 'bob'));
  g.players[0].score = g.from = 21;
  const [a, b] = play(g, '20', '1');
  assert.ok(!a!.bust, 'down to 1 is fine');
  assert.ok(b!.won);
  assert.equal(g.winner, 'ann');

  const h = newGame({ mode: 301, doubleOut: false }, seats('ann', 'bob'));
  h.players[0].score = h.from = 30;
  const r = play(h, '20', 'T20');
  assert.ok(r[1]!.bust);
  assert.equal(h.players[0].score, 30);
});

test('a whole game of 301 to the finish', () => {
  const g = newGame({ mode: 301, doubleOut: true }, seats('ann', 'bob'));
  play(g, 'T20', 'T20', 'T20'); // ann 121
  play(g, 'MISS', 'MISS', 'MISS'); // bob 301
  play(g, 'T20', 'T19', 'BULL'); // ann bust: 121 - 60 - 57 = 4, 4 - 50 < 0
  assert.equal(g.players[0].score, 121);
  play(g, '1', '1', '1');
  play(g, 'T20', '13'); // ann 48
  assert.equal(g.players[0].score, 48);
  const [r] = play(g, 'D12');
  assert.equal(g.players[0].score, 24);
  assert.ok(!r!.won);
  play(g, '2', '2', '2'); // bob
  assert.ok(play(g, 'D12')[0]!.won);
  assert.equal(g.winner, 'ann');
  assert.equal(g.turns.length, 7);
});

test('someone leaving mid-game: their turn is skipped, and with one left the game is over', () => {
  const g = newGame({ mode: 301, doubleOut: true }, seats('ann', 'bob', 'cat'));
  play(g, '20', '20', '20');
  play(g, '5'); // bob, mid-turn
  assert.ok(removePlayer(g, 'bob'));
  assert.equal(g.players[g.up].id, 'cat', "bob's turn goes to cat");
  assert.deepEqual(g.darts, []);
  assert.equal(g.from, 301);
  assert.ok(!removePlayer(g, 'bob'));
  play(g, '1', '1', '1');
  assert.equal(g.players[g.up].id, 'ann');
  assert.ok(removePlayer(g, 'cat'), 'someone not up leaves');
  assert.equal(g.players[g.up].id, 'ann');
  assert.ok(g.over);
  assert.equal(g.winner, null);

  const solo = newGame({ mode: 301, doubleOut: true }, seats('ann'));
  play(solo, '20');
  assert.ok(!solo.over, 'practising alone is a game too');
  removePlayer(solo, 'ann');
  assert.ok(solo.over);
});

test('the last player in the order leaving on their turn hands it round to the first', () => {
  const g = newGame({ mode: 301, doubleOut: true }, seats('ann', 'bob', 'cat'));
  play(g, '1', '1', '1', '1', '1', '1');
  assert.equal(g.players[g.up].id, 'cat');
  removePlayer(g, 'cat');
  assert.equal(g.players[g.up].id, 'ann');
  assert.equal(g.from, 298);
  removePlayer(g, 'ann');
  assert.ok(g.over);
});

// ---- On a floor -------------------------------------------------------------------------------------

test('the board: up to four people, each with the first colour free', () => {
  const d = new Darts();
  for (const id of ['ann', 'bob', 'cat', 'dan']) assert.ok(d.join(id, id));
  assert.ok(!d.join('eve', 'eve'), 'full');
  assert.ok(!d.join('ann', 'ann'), 'already there');
  assert.deepEqual(d.state().lobby.map((p) => p.color), [...DART_COLORS]);
  assert.ok(d.left('bob'));
  assert.ok(!d.left('bob'));
  assert.ok(d.join('eve', 'eve'));
  assert.deepEqual(d.state().lobby.map((p) => [p.id, p.color]), [['ann', DART_COLORS[0]], ['cat', DART_COLORS[2]], ['dan', DART_COLORS[3]], ['eve', DART_COLORS[1]]]);
});

test('the board: options and starting are for the people at it, and only between games', () => {
  const d = new Darts();
  assert.deepEqual(d.state(), { lobby: [], mode: 301, doubleOut: true, game: null });
  assert.ok(!d.setOptions('ann', { mode: 501 }), 'not at the board');
  assert.ok(!d.start('ann'));
  d.join('ann', 'Ann');
  d.join('bob', 'Bob');
  assert.ok(d.setOptions('bob', { mode: 501, doubleOut: false }));
  assert.ok(!d.setOptions('bob', { mode: 999 as 301 }), 'no such game');
  assert.ok(d.start('bob'));
  const g = d.state().game!;
  assert.deepEqual(g.players.map((p) => [p.id, p.name, p.score]), [['ann', 'Ann', 501], ['bob', 'Bob', 501]]);
  assert.ok(!g.doubleOut);
  assert.ok(!d.start('ann'), 'one is on');
  assert.ok(!d.setOptions('ann', { mode: 301 }), 'not mid-game');
});

test("the board: only whoever's turn it is throws, real numbers only, and no faster than a person could", () => {
  let now = 1_000_000;
  const d = new Darts(() => now);
  d.join('ann', 'Ann');
  d.join('bob', 'Bob');
  assert.ok(!d.throw('ann', { x: 0, y: 0 }), 'no game yet');
  d.start('ann');
  assert.ok(!d.throw('bob', aim('T20')), "not Bob's turn");
  assert.ok(!d.throw('eve', aim('T20')), 'not even playing');
  assert.ok(!d.throw('ann', { x: 'a', y: 0 }));
  assert.ok(!d.throw('ann', { x: 3, y: 0 }));
  assert.ok(d.throw('ann', aim('T20')));
  assert.ok(!d.throw('ann', aim('T20')), 'straight away again is too soon');
  now += 300;
  assert.ok(d.throw('ann', aim('T20')));
  now += 300;
  assert.ok(d.throw('ann', aim('T20')));
  assert.equal(d.state().game!.players[0].score, 121);
  now += 300;
  assert.ok(!d.throw('ann', aim('T20')), "Bob's turn now");
  assert.ok(d.throw('bob', aim('BULL')));
  assert.deepEqual(d.state().game!.darts.map((x) => x.label), ['BULL']);
});

test('the board: joining mid-game waits for the next one; leaving mid-game skips you, and alone it ends', () => {
  const d = new Darts();
  d.join('ann', 'Ann');
  d.join('bob', 'Bob');
  d.start('ann');
  assert.ok(d.join('cat', 'Cat'), 'at the board');
  assert.deepEqual(d.state().game!.players.map((p) => p.id), ['ann', 'bob'], 'but not in this game');
  assert.ok(!d.throw('cat', aim('20')));
  assert.ok(!d.reset('cat'), "only its players call a game off that's still on");
  assert.ok(d.left('cat'));
  assert.ok(!d.state().game!.over);
  assert.ok(d.left('ann'), 'Ann walks off on their turn');
  const g = d.state().game!;
  assert.ok(g.over, 'Bob alone: over');
  assert.equal(g.winner, null);
  assert.ok(d.start('bob'), 'a new one, just Bob');
  assert.deepEqual(d.state().game!.players.map((p) => p.id), ['bob']);
  assert.ok(d.reset('bob'));
  assert.equal(d.state().game, null);
  assert.ok(!d.reset('bob'), 'nothing to clear');
  d.start('bob');
  d.left('bob');
  assert.deepEqual(d.state(), { lobby: [], mode: 301, doubleOut: true, game: null }, 'nobody at the board: the scoreboard is cleared');
});

test("the board's state is a copy: changing it changes nothing", () => {
  const d = new Darts();
  d.join('ann', 'Ann');
  d.start('ann');
  const st = d.state();
  st.game!.players[0].score = 1;
  st.lobby.pop();
  assert.equal(d.state().game!.players[0].score, 301);
  assert.equal(d.state().lobby.length, 1);
});
