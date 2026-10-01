import test from 'node:test';
import assert from 'node:assert/strict';
import { DART_COLORS, DEFAULT_OPTIONS, newGame, removePlayer, throwDart, type DartsGame } from '../src/shared/darts.js';
import { DARTBOARD } from '../src/shared/layout.js';
import { SWEET, dartsNews, landing, ocheSpot, sway } from '../src/client/world/darts.js';

const seats = [
  { id: 'a', name: 'Ada', color: DART_COLORS[0] },
  { id: 'b', name: 'Bo', color: DART_COLORS[1] },
];
const copy = (g: DartsGame) => structuredClone(g);
/** The treble 20, and the single 5 next to it. */
const T20 = { x: 0, y: 0.103 };
const S5 = { x: -0.04, y: 0.13 };

test('a dart the office scored shows up as thrown, by whoever was up', () => {
  const g = newGame(DEFAULT_OPTIONS, seats);
  const before = copy(g);
  throwDart(g, T20.x, T20.y);
  const news = dartsNews(before, g);
  assert.equal(news.thrown.length, 1);
  assert.equal(news.thrown[0].dart.label, 'T20');
  assert.equal(news.thrown[0].by.id, 'a');
  assert.equal(news.turnOver, false);
  assert.equal(news.cleared, false);
});

test('the third dart ends the turn: it comes from the finished turn, not the next player’s', () => {
  const g = newGame(DEFAULT_OPTIONS, seats);
  throwDart(g, T20.x, T20.y);
  throwDart(g, S5.x, S5.y);
  const before = copy(g);
  throwDart(g, T20.x, T20.y);
  const news = dartsNews(before, g);
  assert.equal(g.players[g.up].id, 'b');
  assert.deepEqual(news.thrown.map((t) => [t.dart.label, t.by.id]), [['T20', 'a']]);
  assert.equal(news.turnOver, true);
  assert.equal(news.bust, false);
});

test('a bust and a win say so with their dart', () => {
  const g = newGame({ mode: 301, doubleOut: true }, seats);
  g.players[0].score = g.from = 40;
  let before = copy(g);
  throwDart(g, T20.x, T20.y);
  let news = dartsNews(before, g);
  assert.equal(news.bust, true);
  assert.equal(news.turnOver, true);
  assert.equal(news.won, false);

  // Bo leaves 32 and finishes on D16.
  g.players[1].score = g.from = 32;
  before = copy(g);
  // 16 is 13 sectors clockwise from the top.
  const a = (13 * 18 * Math.PI) / 180;
  const d16 = { x: 0.166 * Math.sin(a), y: 0.166 * Math.cos(a) };
  throwDart(g, d16.x, d16.y);
  news = dartsNews(before, g);
  assert.equal(news.thrown[0].dart.label, 'D16');
  assert.equal(news.won, true);
  assert.equal(g.over, true);
});

test('a new game, a cleared one, and a thrower who left mid-turn take the darts out of the board', () => {
  const g = newGame(DEFAULT_OPTIONS, seats);
  assert.equal(dartsNews(null, g).cleared, true);
  assert.equal(dartsNews(g, null).cleared, true);
  throwDart(g, T20.x, T20.y);
  const before = copy(g);
  removePlayer(g, 'a');
  assert.equal(dartsNews(before, g).cleared, true);
  // And nothing at all changed is no news.
  const same = dartsNews(copy(g), g);
  assert.equal(same.thrown.length + Number(same.cleared), 0);
});

test('let go on the sweet spot and the dart lands near the aim; off it, it drops or flies high', () => {
  const steady = () => 0.5;
  const on = landing(T20, SWEET, steady);
  assert.ok(Math.hypot(on.x - T20.x, on.y - T20.y) < 0.01);
  assert.ok(landing(T20, SWEET - 0.4, steady).y < T20.y - 0.05, 'too soft drops');
  assert.ok(landing(T20, SWEET + 0.25, steady).y > T20.y + 0.03, 'too hard flies high');
  // On the sweet spot, a good share of darts at the treble 20 hit it, but far from all: it takes skill.
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const p = landing(T20, SWEET, rand);
    const r = Math.hypot(p.x, p.y);
    if (r > 0.099 && r <= 0.107 && Math.abs(Math.atan2(p.x, p.y)) < Math.PI / 20) hits++;
  }
  assert.ok(hits > 200 && hits < 1600, `${hits} of 2000 in the treble 20`);
});

test('the sway wanders a little, never far', () => {
  for (let t = 0; t < 30; t += 0.37) {
    const s = sway(t);
    assert.ok(Math.hypot(s.x, s.y) < 0.014);
  }
  const none = sway(3, 0);
  assert.equal(Math.hypot(none.x, none.y), 0);
});

test('every colour has its own spot behind the oche, facing the board', () => {
  const spots = DART_COLORS.map((c) => ocheSpot(c));
  for (const s of spots) {
    assert.ok(s.x < DARTBOARD.oche.x, 'behind the throw line');
    assert.ok(Math.abs(s.facing - Math.PI / 2) < 0.4, 'facing the board, east');
  }
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) > 0.5);
});
