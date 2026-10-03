import test from 'node:test';
import assert from 'node:assert/strict';
import { CASINO, CASINO_ASHTRAY, CASINO_LOUNGE, CASINO_SEATING, casinoFootprints, casinoWalkable } from '../src/shared/casino.js';
import { ASHTRAY, BALCONY } from '../src/shared/layout.js';
import { ROOF } from '../src/shared/rooftop.js';
import { canSmokeAt, hasAshtray, inCasinoLounge, onBalcony } from '../src/shared/smoking.js';

const at = (x: number, z: number, y = 0) => ({ x, y, z });

test('every office floor and the casino have an ashtray, the roof none', () => {
  assert.equal(hasAshtray('main'), true);
  assert.equal(hasAshtray(null), true);
  assert.equal(hasAshtray(CASINO), true);
  assert.equal(hasAshtray(ROOF), false);
});

test('on an office floor you smoke out on the balcony, as before, and not inside', () => {
  assert.ok(canSmokeAt('main', at(ASHTRAY.x, ASHTRAY.z)));
  assert.ok(canSmokeAt('main', at(BALCONY.minX + 1, BALCONY.minZ - 0.5)), 'a little slack at the door');
  assert.ok(!canSmokeAt('main', at(0, 0)), 'not in the office');
  assert.ok(!canSmokeAt('main', at(ASHTRAY.x, ASHTRAY.z, 3)), 'not a floor up');
  assert.ok(!canSmokeAt('main', at(CASINO_ASHTRAY.x, CASINO_ASHTRAY.z)), "the casino's lounge spot is just the office up here");
  assert.equal(onBalcony(at(ASHTRAY.x, ASHTRAY.z)), true);
});

test("in the casino you smoke in the lounge and by its ashtray, not at the tables or on the balcony's spot", () => {
  assert.ok(canSmokeAt(CASINO, at(CASINO_ASHTRAY.x, CASINO_ASHTRAY.z)));
  assert.ok(canSmokeAt(CASINO, at(CASINO_LOUNGE.x, CASINO_LOUNGE.z)));
  // Everywhere you can stand round the ashtray, within the reach you can use it from.
  for (let a = 0; a < 16; a++) {
    const p = at(CASINO_ASHTRAY.x + Math.cos((a / 8) * Math.PI) * 0.6, CASINO_ASHTRAY.z + Math.sin((a / 8) * Math.PI) * 0.6);
    assert.ok(canSmokeAt(CASINO, p), `${p.x}, ${p.z}`);
  }
  // Every sofa round the lounge's table.
  for (const s of CASINO_SEATING.filter((s) => s.id.startsWith('casino-sofa'))) assert.ok(inCasinoLounge(at(s.x, s.z)), s.id);
  assert.ok(!canSmokeAt(CASINO, at(0, 0)), 'the middle of the room');
  assert.ok(!canSmokeAt(CASINO, at(-8.5, -6.6)), 'the poker table');
  assert.ok(!canSmokeAt(CASINO, at(ASHTRAY.x, ASHTRAY.z)), "there's no balcony down here");
  assert.ok(!canSmokeAt(ROOF, at(ASHTRAY.x, ASHTRAY.z)), 'nor up on the roof');
});

test("the casino's ashtray stands in the lounge, out of everything's way, and you can walk up to it", () => {
  const A = CASINO_ASHTRAY;
  const mine = casinoFootprints().filter((f) => A.x > f.minX && A.x < f.maxX && A.z > f.minZ && A.z < f.maxZ);
  assert.equal(mine.length, 1, 'one footprint, its own');
  assert.ok(!casinoWalkable(A.x, A.z));
  assert.ok(casinoWalkable(A.x, A.z - 0.75), 'from the room, to its north');
  // Off the sofas, so you can still sit on (and get up off) them.
  for (const s of CASINO_SEATING.filter((s) => s.id.startsWith('casino-sofa'))) assert.ok(Math.hypot(s.x - A.x, s.z - A.z) > 1, s.id);
});
