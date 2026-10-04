import test from 'node:test';
import assert from 'node:assert/strict';
import { lang, setLang } from '../src/client/i18n/index.js';
import { BALCONY, ASHTRAY, SEATING_BY_ID } from '../src/shared/layout.js';
import { BALL_R } from '../src/client/world/golf.js';
import {
  CARPET,
  CUP,
  CUP_DISTANCE,
  CUP_R,
  CUP_YAW,
  PUTT_TEE,
  newPuttRound,
  onCarpet,
  putt,
  puttLanded,
  puttRoundFromJson,
  puttRoundText,
  puttStroke,
} from '../src/client/world/minigolf.js';

function inLang<T>(l: 'en' | 'de', fn: () => T): T {
  const was = lang();
  setLang(l);
  try {
    return fn();
  } finally {
    setLang(was);
  }
}

/** The putt (0–1) that reaches `d` m along the carpet still rolling at `v` m/s. */
const powerFor = (d: number, v: number) => Math.sqrt(v * v + 2 * 1.15 * d) / 4.2;

/** Every point of a roll is on the carpet, inside its border. */
function staysOn(path: Float32Array) {
  for (let i = 0; i < path.length; i += 3) {
    const [x, z] = [path[i], path[i + 2]];
    assert.ok(x >= CARPET.minX + BALL_R - 1e-9 && x <= CARPET.maxX - BALL_R + 1e-9, `x ${x} on the carpet`);
    assert.ok(z >= CARPET.minZ + BALL_R - 1e-9 && z <= CARPET.maxZ - BALL_R + 1e-9, `z ${z} on the carpet`);
  }
}

test('the hole fits in the smokers\' room, clear of the ashtray and the seats, from the tee', () => {
  assert.ok(CARPET.minX > BALCONY.minX && CARPET.maxX < BALCONY.maxX && CARPET.minZ > BALCONY.minZ && CARPET.maxZ < BALCONY.maxZ);
  assert.ok(PUTT_TEE.x > CARPET.minX && PUTT_TEE.x < CARPET.maxX && PUTT_TEE.z > CARPET.minZ && PUTT_TEE.z < CARPET.maxZ);
  assert.ok(CUP.x > CARPET.minX && CUP.x < CARPET.maxX && CUP.z > CARPET.minZ && CUP.z < CARPET.maxZ);
  assert.ok(CUP_DISTANCE > 4);
  const off = (x: number, z: number, r: number) => x + r < CARPET.minX || x - r > CARPET.maxX || z + r < CARPET.minZ || z - r > CARPET.maxZ;
  assert.ok(off(ASHTRAY.x, ASHTRAY.z, 0.2), 'not over the ashtray');
  for (const id of ['bench', 'stool-1', 'stool-2']) {
    const s = SEATING_BY_ID.get(id)!;
    assert.ok(off(s.x, s.z, 0.25), `not over ${id}`);
  }
});

test('a straight putt at the right pace drops in the cup', () => {
  const roll = putt({ yaw: CUP_YAW, power: powerFor(CUP_DISTANCE, 0.8), from: PUTT_TEE });
  assert.equal(roll.holed, true);
  assert.equal(roll.fromCup, 0);
  assert.equal(roll.rest.x, CUP.x);
  assert.equal(roll.rest.z, CUP.z);
  assert.ok(roll.rest.y < 0, 'down in the cup');
  assert.equal(roll.hits.at(-1)?.kind, 'cup');
  assert.ok(roll.hits.every((h) => h.kind !== 'rail'), 'straight in, off nothing');
  staysOn(roll.path);
  // The same putt rolls the same way on every screen.
  assert.deepEqual(putt({ yaw: CUP_YAW, power: powerFor(CUP_DISTANCE, 0.8), from: PUTT_TEE }), roll);
});

test('a putt that\'s too hard hops the cup, banks off the far border and stays on the carpet', () => {
  const roll = putt({ yaw: CUP_YAW, power: powerFor(CUP_DISTANCE + (CARPET.maxX - CUP.x) + 1, 0), from: PUTT_TEE });
  assert.equal(roll.holed, false);
  assert.ok(roll.hits.some((h) => h.kind === 'rail' && h.at.x > CUP.x), 'off the far end');
  staysOn(roll.path);
  assert.ok(roll.rest.x < CARPET.maxX - BALL_R, 'back off the border');
  // Coming back, it didn't go down either: it came too fast over the cup.
  assert.ok(roll.fromCup > 0);
});

test('the borders bounce the ball back across the carpet', () => {
  // Hard across it, at an angle: off one long side, then the other.
  const roll = putt({ yaw: CUP_YAW + 1.2, power: 0.8, from: PUTT_TEE });
  const rails = roll.hits.filter((h) => h.kind === 'rail');
  assert.ok(rails.length >= 2, `${rails.length} bounces`);
  assert.ok(rails.some((h) => h.at.z > PUTT_TEE.z) && rails.some((h) => h.at.z < PUTT_TEE.z), 'off both sides');
  // A bounce gives back less than it got.
  for (let i = 1; i < rails.length; i++) assert.ok(rails[i].speed < rails[i - 1].speed + 1e-9);
  staysOn(roll.path);
});

test('the ball slows on the carpet and stops', () => {
  const roll = putt({ yaw: CUP_YAW, power: 0.3, from: PUTT_TEE });
  assert.equal(roll.holed, false);
  // v²/2a along the line, short of the cup.
  const want = (0.3 * 4.2) ** 2 / (2 * 1.15);
  assert.ok(Math.abs(roll.rest.x - PUTT_TEE.x - want) < 0.02, `stopped ${roll.rest.x - PUTT_TEE.x} m on, not ${want}`);
  assert.ok(Math.abs(roll.rest.z - PUTT_TEE.z) < 1e-6);
  assert.ok(roll.seconds > 0 && roll.seconds < 3);
  // Slower and slower: each step of the path shorter than the one before.
  const p = roll.path;
  let last = Infinity;
  for (let i = 3; i < p.length; i += 3) {
    const step = Math.hypot(p[i] - p[i - 3], p[i + 2] - p[i - 1]);
    assert.ok(step <= last + 1e-9);
    last = step;
  }
  assert.ok(Math.abs(roll.fromCup - (CUP.x - roll.rest.x)) < 1e-6);
  // Nothing (or nonsense) doesn't move it, or throw it off the carpet.
  assert.equal(putt({ yaw: 0, power: 0, from: PUTT_TEE }).rest.x, PUTT_TEE.x);
  const odd = putt({ yaw: NaN, power: 5, from: { x: 99, z: Number.NaN } });
  staysOn(odd.path);
  assert.deepEqual(onCarpet({ x: 99, z: -99 }), { x: CARPET.maxX - BALL_R, z: CARPET.minZ + BALL_R });
});

test('a putt from where the ball lies, and a slow roll over the cup drops', () => {
  const from = { x: CUP.x - 0.5, z: CUP.z + 0.02 };
  const yaw = Math.atan2(CUP.x - from.x, CUP.z - from.z);
  assert.equal(putt({ yaw, power: powerFor(0.5, 0.4), from }).holed, true);
  // Just wide of it: past it.
  const wide = putt({ yaw: yaw + Math.atan2(CUP_R * 1.6, 0.5), power: powerFor(0.5, 0.4), from });
  assert.equal(wide.holed, false);
});

test('a round counts strokes until the ball drops, then starts again from the tee', () => {
  let r = newPuttRound();
  inLang('en', () => assert.equal(puttRoundText(r), 'First putt of the round'));
  r = puttStroke(r);
  const short = putt({ yaw: CUP_YAW, power: powerFor(CUP_DISTANCE - 0.4, 0), from: r.lie });
  r = puttLanded(r, short);
  assert.equal(r.strokes, 1);
  assert.deepEqual(r.lie, onCarpet(short.rest));
  inLang('en', () => assert.match(puttRoundText(r), /^1 stroke · \d+ cm to the cup$/));
  inLang('de', () => assert.match(puttRoundText(r), /^1 Schlag · \d+ cm bis zum Loch$/));
  r = puttStroke(r);
  r = puttLanded(r, { holed: true, rest: short.rest });
  assert.equal(r.holed, true);
  assert.equal(r.best, 2);
  inLang('en', () => assert.equal(puttRoundText(r), '🏆 Holed in 2!'));
  // Kept across a reload.
  assert.deepEqual(puttRoundFromJson(JSON.stringify(r)), r);
  assert.deepEqual(puttRoundFromJson('nonsense'), newPuttRound());
  // The next putt is the first of a new round, from the tee: in one, it's a hole in one.
  r = puttStroke(r);
  assert.equal(r.strokes, 1);
  assert.deepEqual(r.lie, PUTT_TEE);
  r = puttLanded(r, { holed: true, rest: short.rest });
  assert.equal(r.best, 1);
  inLang('en', () => assert.equal(puttRoundText(r), '🏆 Hole in one!'));
  inLang('de', () => assert.equal(puttRoundText(r), '🏆 Hole in One!'));
});
