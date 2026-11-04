import test from 'node:test';
import assert from 'node:assert/strict';
import { ASHTRAY, BALCONY, FLOOR, LOFT, PARACHUTE, WINDOWS, streetBelow } from '../src/shared/layout.js';
import { CLEARANCE, JUMP_WINDOWS, KEEP_OUT, LANDING, clearance, glideStep, jumpSpotNear, landable, moveClear, windowFloor, type Glide, type JumpSpot } from '../src/shared/skydive.js';

/** Standing `d` inside window `i`, a little off its middle, looking out (or in). */
function atWindow(i: number, d = 0.6, out = true, off = 0.6): [number, number, number, number, number] {
  const o = WINDOWS[i];
  const y = windowFloor(o);
  const s = out ? 1 : -1;
  switch (o.wall) {
    case 'south':
      return [o.u + off, y, FLOOR.maxZ - d, 0, s];
    case 'north':
      return [o.u + off, y, FLOOR.minZ + d, 0, -s];
    case 'east':
      return [FLOOR.maxX - d, y, o.u + off, s, 0];
    case 'west':
      return [FLOOR.minX + d, y, o.u + off, -s, 0];
  }
}

test('every window you can jump from is in reach from inside it, looking out', () => {
  assert.ok(JUMP_WINDOWS.length >= 4);
  for (const i of JUMP_WINDOWS) {
    const spot = jumpSpotNear(...atWindow(i));
    assert.equal(spot?.kind, 'window', `window ${i}`);
    assert.equal(spot?.window, i);
    assert.equal(spot?.floor, windowFloor(WINDOWS[i]));
    assert.equal(spot?.y, WINDOWS[i].y0);
    // Out on the wall's outside face, the way out pointing away from the building.
    assert.ok(clearance(spot!.x, spot!.z) < 0.01, `window ${i} spot on the outside face`);
    assert.ok(clearance(spot!.x + spot!.nx * 0.5, spot!.z + spot!.nz * 0.5) > 0.4, `window ${i} points out`);
    // Either half, but never through the mullion in the middle.
    const left = jumpSpotNear(...atWindow(i, 0.6, true, -0.6))!;
    const along = (s: JumpSpot) => (s.nx ? s.z : s.x);
    assert.ok(Math.abs(along(left) - WINDOWS[i].u) > 0.5 && Math.abs(along(spot!) - WINDOWS[i].u) > 0.5);
    assert.ok(Math.sign(along(left) - WINDOWS[i].u) !== Math.sign(along(spot!) - WINDOWS[i].u));
  }
});

test('not looking out, too far from it, or on the wrong level, there is no window to jump from', () => {
  for (const i of JUMP_WINDOWS) {
    assert.equal(jumpSpotNear(...atWindow(i, 0.6, false)), null, `looking in, ${i}`);
    assert.equal(jumpSpotNear(...atWindow(i, 2.5)), null, `too far, ${i}`);
    const [x, y, z, lx, lz] = atWindow(i);
    assert.equal(jumpSpotNear(x, y + 2.5, z, lx, lz), null, `wrong level, ${i}`);
  }
  // The loft's windows are up on the loft, not from the floor under it.
  const loft = WINDOWS.findIndex((o) => o.y0 >= LOFT.y);
  const [x, , z, lx, lz] = atWindow(loft);
  assert.equal(jumpSpotNear(x, 0, z, lx, lz), null);
  // In the middle of the office there's nothing.
  assert.equal(jumpSpotNear(0, 0, 0, 0, 1), null);
});

test('the windows that open onto the balcony are not for jumping', () => {
  WINDOWS.forEach((o, i) => {
    const onto = o.wall === 'south' && o.y0 < LOFT.y && o.u + o.width / 2 > BALCONY.minX && o.u - o.width / 2 < BALCONY.maxX;
    assert.equal(JUMP_WINDOWS.includes(i), !onto, `window ${i}`);
    if (onto) assert.notEqual(jumpSpotNear(...atWindow(i))?.kind, 'window');
  });
});

test('at the balcony railing, looking out over it, you can jump: not by the ashtray', () => {
  const z = BALCONY.maxZ - 0.5;
  const spot = jumpSpotNear(-2, 0, z, 0.2, 1);
  assert.equal(spot?.kind, 'railing');
  assert.equal(spot?.y, PARACHUTE.railTop);
  assert.ok(Math.abs(spot!.x - -2) < 1e-9 && spot!.z > BALCONY.maxZ - 0.1 && spot!.nz === 1);
  assert.equal(jumpSpotNear(-2, 0, z, 0, -1), null, 'looking back in');
  assert.equal(jumpSpotNear(-2, 0, BALCONY.minZ + 0.3, 0, 1), null, 'back by the doors');
  assert.equal(jumpSpotNear(ASHTRAY.x, 0, z, 0, 1), null, 'at the ashtray');
  assert.equal(jumpSpotNear(-2, -3, z, 0, 1), null, 'down under it');
});

test('you can come down out in the open, not in or on the building, a balcony or past the far sidewalk', () => {
  assert.ok(landable(0, 20), 'the lot');
  assert.ok(landable(-5, 27), 'the street');
  assert.ok(landable(30, 22.5), 'the sidewalk');
  assert.ok(landable(-25, 0), 'beside the building');
  assert.ok(!landable(0, 0), 'inside');
  assert.ok(!landable(0, FLOOR.maxZ), 'in the garage under it');
  assert.ok(!landable(-4, BALCONY.maxZ - 0.5), 'on a balcony');
  assert.ok(!landable(-19, 9), 'on the exit stairs');
  assert.ok(!landable(-5, 45), "on a neighbour's roof");
  assert.ok(!landable(60, 0), 'far off');
});

test('sliding along the building: never any nearer it than you already are', () => {
  const p = { x: 8, z: FLOOR.maxZ + 3 };
  for (let i = 0; i < 200; i++) moveClear(p, 0.05, -0.1);
  assert.ok(clearance(p.x, p.z) >= CLEARANCE - 1e-6);
  assert.ok(p.x > 5, 'it slid along');
  // Just out of a window, closer in than that, it still can't get any closer.
  const q = { x: -14, z: FLOOR.maxZ + 0.6 };
  const before = clearance(q.x, q.z);
  moveClear(q, 0, -0.5);
  assert.ok(clearance(q.x, q.z) >= before - 1e-9);
});

/** A tiny seeded random, so the glides are the same every run. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Jumps from `spot` on floor `index`, steered by `steer`, all the way down: where it came down, how long it took, and its worst clearance after the leap. */
function fly(spot: JumpSpot, index: number, steer: (t: number) => { turn: number; push: number }) {
  const street = streetBelow(index);
  const dt = 1 / 60;
  // The leap and the free fall (as client/skydive.ts does them).
  const p = { x: spot.x, z: spot.z };
  let y = spot.y;
  let vy = 2;
  let t = 0;
  for (; t < 0.6 && !(t > 0.25 && vy < 0 && y - street < 3.2); t += dt) {
    vy -= 9.8 * dt;
    moveClear(p, spot.nx * 2.4 * dt, spot.nz * 2.4 * dt);
    y += vy * dt;
  }
  assert.ok(y > street, 'still in the air when the chute opens');
  const g: Glide = { x: p.x, y, z: p.z, heading: Math.atan2(spot.nx, spot.nz), speed: 2.4, vy };
  let worst = clearance(g.x, g.z);
  let prev = worst;
  for (let n = 0; g.y > street; n++) {
    assert.ok(n < 60 * 120, 'it comes down within two minutes');
    glideStep(g, steer(t), dt, street);
    t += dt;
    const c = clearance(g.x, g.z);
    assert.ok(c >= Math.min(prev, CLEARANCE) - 1e-9, 'never back toward the building');
    prev = c;
    worst = Math.min(worst, c);
    assert.ok(g.x >= LANDING.minX && g.x <= LANDING.maxX && g.z >= LANDING.minZ && g.z <= LANDING.maxZ);
  }
  return { g, t, worst, landedSoftly: g.vy > -1.5 };
}

const spots = (): JumpSpot[] => [...JUMP_WINDOWS.map((i) => jumpSpotNear(...atWindow(i))!), jumpSpotNear(-2, 0, BALCONY.maxZ - 0.5, 0, 1)!, jumpSpotNear(BALCONY.minX + 0.5, 0, BALCONY.maxZ - 0.5, 0, 1)!];

test('from every spot and floor, however you steer, the glide keeps clear of the building and lands out in the open', () => {
  const r = rand(138);
  const steering: ((t: number) => { turn: number; push: number })[] = [
    () => ({ turn: 0, push: 0 }),
    () => ({ turn: -1, push: 0 }),
    () => ({ turn: 1, push: 1 }),
    () => ({ turn: 0, push: -1 }),
    () => ({ turn: 0.6, push: 1 }),
    (t) => ({ turn: Math.sin(t * 0.7) > 0 ? 1 : -1, push: Math.cos(t * 0.3) }),
    () => ({ turn: r() * 2 - 1, push: r() * 2 - 1 }),
  ];
  for (const spot of spots()) {
    for (const index of [0, 1, 3, 7]) {
      for (const steer of steering) {
        const { g } = fly(spot, index, steer);
        assert.ok(landable(g.x, g.z), `${spot.kind} ${spot.window ?? ''} floor ${index}: came down at ${g.x.toFixed(1)}, ${g.z.toFixed(1)}`);
        // And it's clear of every part of the building, not just the nearest.
        for (const b of KEEP_OUT) assert.ok(g.x < b.minX || g.x > b.maxX || g.z < b.minZ || g.z > b.maxZ);
      }
    }
  }
});

test('a short hop from the bottom floor, a long glide from high up, and a soft landing either way', () => {
  const spot = jumpSpotNear(-2, 0, BALCONY.maxZ - 0.5, 0, 1)!;
  const low = fly(spot, 0, () => ({ turn: 0, push: 0 }));
  const high = fly(spot, 6, () => ({ turn: 0, push: 0 }));
  assert.ok(low.t < 4, `bottom floor: ${low.t.toFixed(1)} s`);
  assert.ok(high.t > 12, `sixth floor: ${high.t.toFixed(1)} s`);
  assert.ok(low.landedSoftly && high.landedSoftly, 'the flare brakes it');
  // Steering does something.
  const left = fly(spot, 4, () => ({ turn: -1, push: 0 }));
  const right = fly(spot, 4, () => ({ turn: 1, push: 0 }));
  assert.ok(left.g.x > right.g.x + 2, 'A turns left (east, flying south), D right');
});

test('someone else gliding down gets a chute over them a moment out, which folds away once they are down', async () => {
  const THREE = await import('three');
  const { PeerChutes } = await import('../src/client/world/skydive.js');
  const chutes = new PeerChutes();
  const street = streetBelow(2);
  const root = new THREE.Group();
  const step = (n: number, y: number, x = 0, z = 22) => {
    root.position.set(x, y, z);
    for (let i = 0; i < n; i++) chutes.update(0.05, [{ id: 'sam', root, color: '#06d6a0' }], street);
  };
  // Hopping about on the balcony, or standing on the street: nothing.
  step(40, 0.8, -3, BALCONY.maxZ - 0.5);
  step(40, street, 0, 22);
  step(4, street + 1.2);
  assert.ok(!chutes.has('sam'));
  // Out in the air, clear of the building: falling free a moment, then the chute's open.
  step(4, street + 9);
  assert.ok(!chutes.has('sam'), 'not straight away');
  step(8, street + 7);
  assert.ok(chutes.has('sam'));
  assert.equal(root.children.length, 1);
  // Down: it folds away and is gone.
  step(40, street);
  assert.ok(!chutes.has('sam'));
  assert.equal(root.children.length, 0);
  // Gone from the floor mid-glide: it goes with them.
  step(20, street + 9);
  assert.ok(chutes.has('sam'));
  chutes.update(0.05, [], street);
  assert.ok(!chutes.has('sam'));
  assert.equal(root.children.length, 0);
});
