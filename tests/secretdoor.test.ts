import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { WebSocket } from 'ws';
import { CASINO, CASINO_ROOM, CASINO_SEATING, CASINO_SHOP, SECRET_DOOR, SECRET_ROOM, casinoFootprints, casinoWalkable, shopFootprints } from '../src/shared/casino.js';
import { DoorMotion, DoorPush, SECRET_MOTION, SECRET_PUSH, SecretDoor, doorFront, inDoorway, pushingInto, type Pusher } from '../src/shared/secretdoor.js';

// A canvas that draws nothing: enough for the casino's signs and textures to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

const D = SECRET_DOOR;
const Q = SECRET_ROOM;
const R = CASINO_ROOM;
/** Up against the door from the hall (a body's 0.32 off the wall), and from the room. */
const HALL = { x: D.x, z: R.maxZ - 0.33 };
const ROOM = { x: D.x, z: Q.minZ + 0.33 };
/** Walking straight into it from the hall (+z, facing +z: rotY 0), or from the room (-z, facing -z). */
const intoFromHall = (over: Partial<Pusher> = {}): Pusher => ({ ...HALL, facing: 0, wishX: 0, wishZ: 1, ...over });
const intoFromRoom = (over: Partial<Pusher> = {}): Pusher => ({ ...ROOM, facing: Math.PI, wishX: 0, wishZ: -1, ...over });

/** Feeds `push` frames of `dt` for `seconds` and says what it said last. */
function hold(push: DoorPush, p: Pusher | ((i: number) => Pusher), seconds: number, dt = 1 / 60) {
  let out: number = 0;
  for (let i = 0; i * dt < seconds; i++) out = push.update(dt, typeof p === 'function' ? p(i) : p);
  return out;
}

// ---- Where it is --------------------------------------------------------------------------------------

test("the secret room is about 3 × 3 m behind the hall's south wall, clear of the shop and everything else", () => {
  assert.ok(Math.abs(Q.maxX - Q.minX - 3) < 0.3 && Math.abs(Q.maxZ - Q.minZ - 3) < 0.3, 'about 3 × 3');
  assert.ok(Q.minZ > R.maxZ, 'behind the wall');
  assert.ok(D.x - D.width / 2 > Q.minX + 0.3 && D.x + D.width / 2 < Q.maxX - 0.3, 'the door opens into it');
  assert.ok(D.height < Q.height && D.height > 2, 'a door you walk through without ducking');
  // Not the shop's room, nor its doorway.
  const S = CASINO_SHOP.room;
  assert.ok(Q.minX - 0.3 > S.maxX + 0.3 || Q.maxX + 0.3 < S.minX - 0.3, 'apart from the shop, walls and all');
  assert.ok(Math.abs(D.x - CASINO_SHOP.door.x) > 5);
  assert.ok(Q.maxX + 0.3 <= R.maxX, 'inside the casino\'s footprint');
  // Nothing in the hall stands in front of it or in its swing, and nobody sits there.
  for (const f of [...casinoFootprints(), ...shopFootprints()]) {
    const clear = f.maxX < D.x - D.width / 2 - 1.5 || f.minX > D.x + D.width / 2 + 1.5 || f.maxZ < R.maxZ - D.width - 1;
    assert.ok(clear, `a footprint at ${f.minX}..${f.maxX}, ${f.minZ}..${f.maxZ} is in the way`);
  }
  for (const s of CASINO_SEATING) assert.ok(!inDoorway(s.x, s.z, -1, 1), `${s.id} is clear of it`);
});

test('you can stand in the secret room, and in its doorway only while it is open', () => {
  assert.ok(casinoWalkable((Q.minX + Q.maxX) / 2, (Q.minZ + Q.maxZ) / 2));
  assert.ok(!casinoWalkable(Q.minX + 0.1, (Q.minZ + Q.maxZ) / 2), 'not in its walls');
  assert.ok(!casinoWalkable(D.x, R.maxZ + 0.15), 'the doorway is wall while it is shut');
  assert.ok(casinoWalkable(D.x, R.maxZ + 0.15, 0.3, true), 'and a way through while it is open');
  assert.ok(!casinoWalkable(D.x + D.width, R.maxZ + 0.15, 0.3, true), 'but only between its jambs');
  assert.ok(casinoWalkable(HALL.x, R.maxZ - 0.4));
});

// ---- The push ---------------------------------------------------------------------------------------------

test('walking straight into that exact spot for a moment opens it, from either side', () => {
  assert.equal(doorFront(HALL.x, HALL.z), 1);
  assert.equal(doorFront(ROOM.x, ROOM.z), -1);
  assert.equal(pushingInto(intoFromHall()), 1);
  assert.equal(pushingInto(intoFromRoom()), -1);
  // A little off straight is still straight into it.
  assert.equal(pushingInto(intoFromHall({ facing: 0.3, wishX: Math.sin(0.3), wishZ: Math.cos(0.3) })), 1);
  assert.equal(pushingInto(intoFromHall({ x: D.x + D.width / 2 - SECRET_PUSH.inset - 0.01 })), 1, 'anywhere across its middle');

  assert.equal(hold(new DoorPush(), intoFromHall(), SECRET_PUSH.hold + 0.05), 1);
  assert.equal(hold(new DoorPush(), intoFromRoom(), SECRET_PUSH.hold + 0.05), -1);
  // Just bumping into it isn't pushing it.
  assert.equal(hold(new DoorPush(), intoFromHall(), SECRET_PUSH.hold * 0.6), 0);
});

test("walking past it, along it, at it at a slant, away from it, or into the wall beside it doesn't", () => {
  const cases: [string, Pusher][] = [
    ['walking past along the wall', intoFromHall({ facing: Math.PI / 2, wishX: 1, wishZ: 0 })],
    ['facing it but walking along it', intoFromHall({ wishX: 1, wishZ: 0 })],
    ['walking into it looking along the wall', intoFromHall({ facing: Math.PI / 2 })],
    ['at a slant', intoFromHall({ facing: 0.8, wishX: Math.sin(0.8), wishZ: Math.cos(0.8) })],
    ['walking away from it', intoFromHall({ facing: Math.PI, wishZ: -1 })],
    ['standing still in front of it', intoFromHall({ wishX: 0, wishZ: 0 })],
    ['into the wall beside it', intoFromHall({ x: D.x - D.width / 2 - 0.4 })],
    ['into the wall a meter along', intoFromHall({ x: D.x + 1 })],
    ['half off its edge', intoFromHall({ x: D.x + D.width / 2 - 0.1 })],
    ['from a step back', intoFromHall({ z: R.maxZ - 1 })],
    ['from the room, walking the hall way', intoFromRoom({ facing: 0, wishZ: 1 })],
    ['out in the hall', intoFromHall({ x: 0, z: 0 })],
  ];
  for (const [what, p] of cases) {
    assert.equal(pushingInto(p), 0, what);
    assert.equal(hold(new DoorPush(), p, 2), 0, what);
  }
  // Walking along the wall past it: a whole pass, every frame in front of it, never opens it.
  assert.equal(hold(new DoorPush(), (i) => intoFromHall({ x: D.x - 1.5 + i * (1.4 / 60), facing: Math.PI / 2, wishX: 1, wishZ: 0 }), 3 / 1.4), 0);
  // Pushing on and off in bursts shorter than a push doesn't add up.
  const push = new DoorPush();
  for (let k = 0; k < 10; k++) {
    assert.equal(hold(push, intoFromHall(), SECRET_PUSH.hold * 0.7), 0);
    assert.equal(hold(push, intoFromHall({ wishZ: 0 }), 0.1), 0);
  }
});

// ---- The office's door ---------------------------------------------------------------------------------------

const at = (x: number, z: number, more: object = {}) => ({ floor: CASINO, x, z, ...more });

test('the office opens it only for someone right at it in the casino, and it stays open while anyone is in its way', () => {
  const door = new SecretDoor();
  assert.deepEqual(door.state(), { open: false, side: 1 });
  assert.equal(door.push(at(0, 0), 0), false, 'from across the hall');
  assert.equal(door.push(at(D.x + 1.2, HALL.z), 0), false, 'from the wall beside it');
  assert.equal(door.push({ ...at(HALL.x, HALL.z), floor: 'project' }, 0), false, 'from another floor');
  assert.equal(door.push(at(HALL.x, HALL.z, { seat: 'casino-sofa-1:0' }), 0), false, 'sitting down');
  assert.equal(door.push(at(HALL.x, HALL.z), 1000), true);
  assert.deepEqual(door.state(), { open: true, side: 1 });
  assert.equal(door.push(at(HALL.x, HALL.z), 1100), false, 'already open');

  // Open at least a while, even with nobody about.
  assert.equal(door.tick(1000 + SECRET_MOTION.minOpen - 1, []), false);
  // Someone in the doorway, or where it swings into the room: it waits.
  const inTheWay = [at(D.x, R.maxZ + 0.16), at(D.x + 0.3, Q.minZ + 0.6), at(D.x - D.width / 2 - 0.1, R.maxZ - 0.2)];
  for (const p of inTheWay) assert.equal(door.tick(10_000, [p]), false, `waits for someone at ${p.x}, ${p.z}`);
  // People elsewhere, in the room's far corner, or on another floor at that spot don't keep it.
  assert.equal(door.tick(10_000, [at(0, 0), at(Q.maxX - 0.4, Q.maxZ - 0.4), { ...at(D.x, R.maxZ + 0.16), floor: 'project' }]), true);
  assert.deepEqual(door.state(), { open: false, side: 1 });
  assert.equal(door.tick(20_000, []), false, 'already shut');

  // From inside, it opens out into the hall.
  assert.equal(door.push(at(ROOM.x, ROOM.z), 30_000), true);
  assert.deepEqual(door.state(), { open: true, side: -1 });
  assert.equal(door.tick(40_000, [at(D.x, R.maxZ - 0.7)]), false, 'someone where it swings out into the hall');
  assert.equal(door.tick(40_000, [at(D.x, Q.minZ + 1)]), true);
});

// ---- The motion -----------------------------------------------------------------------------------------------

test('it presses in a few centimeters before it swings, and shuts to exactly 0: locked, not a hair ajar', () => {
  const m = new DoorMotion();
  assert.ok(m.locked);
  m.update(0.1, { open: true, side: 1 });
  assert.ok(m.depth > 0 && m.angle === 0, 'pressed in first');
  for (let i = 0; i < 200; i++) m.update(1 / 60, { open: true, side: 1 });
  assert.equal(m.depth, SECRET_MOTION.depth);
  assert.ok(SECRET_MOTION.depth >= 0.02 && SECRET_MOTION.depth <= 0.06, 'a few centimeters');
  assert.equal(m.angle, SECRET_MOTION.angle);
  assert.ok(m.passable);
  // Shutting, with ragged frames: it swings back, then settles out flush, and is exactly shut.
  let locks = 0;
  let wasPassable = true;
  for (let i = 0; i < 2000 && !m.locked; i++) {
    if (m.update(((i * 7919) % 13) / 300 + 0.001, { open: false, side: 1 })) locks++;
    if (!m.passable) wasPassable = false;
    else assert.ok(wasPassable, 'never passable again once it has started to shut');
  }
  assert.ok(m.locked);
  assert.equal(locks, 1, 'it says so once');
  assert.ok(Object.is(m.press, 0) && Object.is(m.swing, 0) && Object.is(m.depth, 0) && Object.is(m.angle, 0));
  assert.equal(m.update(1, { open: false, side: 1 }), false, 'and stays that way');
  assert.ok(m.locked);
});

test('pushed from the other side while it is still open one way, it shuts first and then opens the other way', () => {
  const m = new DoorMotion();
  for (let i = 0; i < 100; i++) m.update(1 / 30, { open: true, side: 1 });
  let sawLocked = false;
  for (let i = 0; i < 400; i++) {
    m.update(1 / 30, { open: true, side: -1 });
    if (m.locked) sawLocked = true;
    assert.ok(m.side === 1 || sawLocked, 'never swings the other way before it has shut');
  }
  assert.ok(sawLocked);
  assert.equal(m.side, -1);
  assert.ok(m.passable);
  // Coming down while it's open: straight there.
  const late = new DoorMotion();
  late.snap({ open: true, side: -1 });
  assert.ok(late.passable && late.side === -1 && late.angle === SECRET_MOTION.angle);
});

// ---- The wall, the door and the room as built --------------------------------------------------------------------

const { buildCasino } = await import('../src/client/world/casino.js');
const { SECRET_LAMP, SECRET_LAMP_REACH } = await import('../src/client/world/casinosecret.js');

const touches = (c: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, r = 0.32) => {
  const nx = Math.max(c.minX, Math.min(x, c.maxX));
  const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
  return (x - nx) ** 2 + (z - nz) ** 2 < r * r;
};
/** Whether a body at (x, z) bumps into anything (walls, not floors or what's overhead). */
const blocked = (colliders: { minX: number; maxX: number; minZ: number; maxZ: number; top: number; bottom?: number }[], x: number, z: number) =>
  colliders.some((c) => c.top > 0.5 && (c.bottom ?? 0) < 1.8 && touches(c, x, z));

/** Whether every corner of the leaf in the wall's thickness (the hall's rail to the room's face) is in the doorway, not in the wall either side of it. */
function clearOfTheWall(leaf: THREE.Object3D): boolean {
  const v = new THREE.Vector3();
  let ok = true;
  leaf.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const inWall = v.z > R.maxZ - 0.1 + 1e-4 && v.z < Q.minZ - 1e-4;
      if (inWall && (v.x < D.x - D.width / 2 - 1e-4 || v.x > D.x + D.width / 2 + 1e-4)) ok = false;
    }
  });
  return ok;
}

/** Every frame of `seconds` at 60 fps, with the office saying `state`, `you` standing where you are. */
function run(view: ReturnType<typeof buildCasino>['secretDoor'], state: { open: boolean; side: 1 | -1 }, seconds: number, you?: { x: number; z: number }) {
  view.set(state);
  for (let i = 0; i < seconds * 60; i++) view.update(1 / 60, you);
}

test('shut, the door is the wall in one piece; open, the leaf swings, and shut again it is exactly back where it was', () => {
  const casino = buildCasino();
  const door = casino.secretDoor;
  const { leaf, closed } = door;
  const start = { p: leaf.position.clone(), q: leaf.quaternion.clone() };
  assert.ok(start.p.equals(closed.position) && start.q.equals(closed.quaternion));
  assert.ok(door.whole.visible && !door.cut.visible, 'shut, it is the wall in one piece');
  assert.ok(door.whole.parent === door.group && door.leaf.parent === door.cut);

  // Pushed from the hall: in, then into the room.
  run(door, { open: true, side: 1 }, 0.15);
  assert.ok(!door.whole.visible && door.cut.visible);
  assert.ok(leaf.position.z > closed.position.z + 0.005 && leaf.quaternion.equals(closed.quaternion), 'pressed in, not turned yet');
  run(door, { open: true, side: 1 }, 3);
  const open = new THREE.Vector3(1, 0, 0).applyQuaternion(leaf.quaternion);
  assert.ok(open.z > 0.95, 'swung round into the room');
  leaf.updateMatrixWorld(true);
  assert.ok(clearOfTheWall(leaf), 'never through the wall beside it');
  const box = new THREE.Box3().setFromObject(leaf);
  assert.ok(box.min.z >= R.maxZ - 0.11, 'all on the room side');

  // And shut again: exactly as built (not a hair off), and the wall in one piece again.
  run(door, { open: false, side: 1 }, 3);
  assert.ok(door.motion.locked);
  assert.ok(leaf.position.equals(closed.position), `${leaf.position.toArray()} is ${closed.position.toArray()}`);
  assert.ok(leaf.quaternion.equals(closed.quaternion));
  assert.deepEqual(leaf.children[0].position.toArray(), [0, 0, 0]);
  assert.deepEqual(leaf.children[0].quaternion.toArray(), [0, 0, 0, 1]);
  assert.ok(door.whole.visible && !door.cut.visible);

  // From the room: out into the hall, and back.
  run(door, { open: true, side: -1 }, 3);
  assert.ok(new THREE.Vector3(1, 0, 0).applyQuaternion(leaf.quaternion).z < -0.95, 'swung out into the hall');
  leaf.updateMatrixWorld(true);
  assert.ok(clearOfTheWall(leaf), 'never through the wall beside it');
  assert.ok(new THREE.Box3().setFromObject(leaf).max.z <= Q.minZ + 1e-6, 'all on the hall side');
  run(door, { open: false, side: -1 }, 3);
  assert.ok(leaf.position.equals(closed.position) && leaf.quaternion.equals(closed.quaternion) && door.whole.visible);
});

test('the doorway is wall while it is shut, a way through while it is open, and never shuts on you', () => {
  const casino = buildCasino();
  const door = casino.secretDoor;
  const cs = casino.colliders;
  const doorway = { x: D.x, z: (R.maxZ + Q.minZ) / 2 };
  assert.ok(cs.includes(door.doorway));
  assert.ok(blocked(cs, doorway.x, doorway.z), 'shut: wall');
  assert.ok(blocked(cs, HALL.x, R.maxZ - 0.2), 'shut: you stop at it');
  run(door, { open: true, side: 1 }, 0.4);
  assert.ok(blocked(cs, doorway.x, doorway.z), 'still wall while it only presses in');
  run(door, { open: true, side: 1 }, 2);
  assert.ok(!cs.includes(door.doorway));
  for (const z of [R.maxZ - 0.4, R.maxZ, doorway.z, Q.minZ, Q.minZ + 0.4]) assert.ok(!blocked(cs, D.x, z), `open: through at z ${z}`);
  // But only between its jambs.
  assert.ok(blocked(cs, D.x - D.width / 2 - 0.1, doorway.z) && blocked(cs, D.x + D.width / 2 + 0.1, doorway.z));
  // In the room you're walled in on every side.
  for (const [x, z] of [
    [Q.minX, (Q.minZ + Q.maxZ) / 2],
    [Q.maxX, (Q.minZ + Q.maxZ) / 2],
    [D.x, Q.maxZ],
    [Q.minX + 0.4, Q.minZ],
  ])
    assert.ok(blocked(cs, x, z), `room wall at ${x}, ${z}`);

  // Shutting while you're standing in the doorway (the office thought it clear): it never shuts you in the wall.
  run(door, { open: false, side: 1 }, 3, doorway);
  assert.ok(!cs.includes(door.doorway), 'stays passable while you are in it');
  run(door, { open: false, side: 1 }, 0.1, { x: D.x, z: Q.minZ + 1 });
  assert.ok(cs.includes(door.doorway), 'and is wall again once you are out');
  assert.equal(cs.filter((c) => c === door.doorway).length, 1);
});

test("the leaf is cut from the wall: the wallpaper's pattern lines up across it, and the leaf and the wall round it make the whole wall", () => {
  const casino = buildCasino();
  const door = casino.secretDoor;
  casino.group.updateMatrixWorld(true);
  const papers = (root: THREE.Object3D) => {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshToonMaterial).map && (m.material as THREE.Material).type === 'MeshToonMaterial') out.push(m);
    });
    return out;
  };
  const wholePaper = papers(door.whole);
  const cutPaper = papers(door.cut);
  assert.equal(wholePaper.length, 1);
  assert.equal(cutPaper.length, 2, 'the wall with the doorway out of it, in one piece, and the leaf');
  assert.ok(cutPaper.every((m) => (m.material as THREE.MeshToonMaterial).map!.image === (wholePaper[0].material as THREE.MeshToonMaterial).map!.image), 'the same wallpaper');
  // Each vertex's pattern coordinate is the one the wall in one piece has at that point.
  const mapOf = (m: THREE.Mesh) => {
    const pos = m.geometry.attributes.position;
    const uv = m.geometry.attributes.uv;
    const v = new THREE.Vector3();
    // Where in the pattern: the coordinate as the texture's repeat and offset take it.
    const map = (m.material as THREE.MeshToonMaterial).map!;
    return Array.from({ length: pos.count }, (_, i) => ({ at: v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone(), uv: [uv.getX(i) * map.repeat.x + map.offset.x, uv.getY(i) * map.repeat.y + map.offset.y] }));
  };
  const ref = mapOf(wholePaper[0]);
  const a = ref.find((r) => r.at.x > R.maxX - 0.01 && r.at.y < 2)!;
  const b = ref.find((r) => r.at.x < R.maxX - 1 && r.at.y > 2)!;
  const uvAt = (p: THREE.Vector3) => {
    const sx = (b.uv[0] - a.uv[0]) / (b.at.x - a.at.x);
    const sy = (b.uv[1] - a.uv[1]) / (b.at.y - a.at.y);
    return [a.uv[0] + (p.x - a.at.x) * sx, a.uv[1] + (p.y - a.at.y) * sy];
  };
  for (const m of cutPaper)
    for (const { at, uv } of mapOf(m)) {
      const want = uvAt(at);
      assert.ok(Math.abs(uv[0] - want[0]) < 1e-5 && Math.abs(uv[1] - want[1]) < 1e-5, `pattern at ${at.toArray()}`);
      assert.ok(Math.abs(at.z - ref[0].at.z) < 1e-6, 'in the same plane');
    }
  // Area: the cut wall's faces (both sides) plus the leaf's are the whole wall's.
  const area = (root: THREE.Object3D) => {
    let sum = 0;
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !(m.material as THREE.MeshBasicMaterial).map) return;
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, i + 1).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(pos, i + 2).applyMatrix4(m.matrixWorld);
        sum += new THREE.Triangle(a, b, c).getArea();
      }
    });
    return sum;
  };
  assert.ok(Math.abs(area(door.whole) - area(door.cut)) < 1e-4, `${area(door.whole)} vs ${area(door.cut)}`);
});

test("no light gets through the shut door: the hall's lights don't reach the room, and the room's lamp doesn't reach the hall", () => {
  const casino = buildCasino();
  casino.group.updateMatrixWorld(true);
  const door = casino.secretDoor;
  const room = new THREE.Box3(new THREE.Vector3(Q.minX, 0, R.maxZ), new THREE.Vector3(Q.maxX, Q.height, Q.maxZ));
  // The hall's side of the wall: the rail stands 0.1 proud of it.
  const hall = new THREE.Box3(new THREE.Vector3(R.minX, 0, R.minZ), new THREE.Vector3(R.maxX, R.height, R.maxZ));
  let lights = 0;
  casino.group.traverse((o) => {
    const l = o as THREE.PointLight | THREE.SpotLight;
    if (!(l.isPointLight || l.isSpotLight)) return;
    const at = l.getWorldPosition(new THREE.Vector3());
    if (l === door.lamp) return;
    lights++;
    assert.ok(l.distance > 0, 'every light in the casino has a reach');
    assert.ok(room.distanceToPoint(at) > l.distance, `a light at ${at.toArray().map((v) => v.toFixed(1))} reaches into the secret room`);
  });
  assert.ok(lights > 5);
  // The room's own: a short light for people in there, short of the wall.
  assert.equal(door.lamp.distance, SECRET_LAMP_REACH);
  assert.ok(hall.distanceToPoint(door.lamp.getWorldPosition(new THREE.Vector3())) > SECRET_LAMP_REACH + 0.05);
  assert.ok(SECRET_LAMP.y < Q.height && SECRET_LAMP.y > D.height - 0.5, 'hanging from the ceiling');
  // Its surfaces are lit by the lamp in their own material, which no light in the scene touches.
  let lit = 0;
  door.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    if (mat.customProgramCacheKey?.() === 'secret-room-lit') {
      lit++;
      assert.equal(mat.type, 'MeshBasicMaterial');
    }
  });
  assert.ok(lit >= 7, 'floor, ceiling, four walls and the leaf');
});

// ---- In the running office ------------------------------------------------------------------------------

const bundled = ['public', 'dist/public'].some((d) => existsSync(path.join(import.meta.dirname, '..', d, 'index.html')));

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  await new Promise((r) => srv.close(r));
  return port;
}

interface Person {
  msgs: any[];
  send(msg: object): void;
  next(t: string, ok?: (m: any) => boolean, ms?: number): Promise<any>;
  close(): void;
}

test('everyone in the casino sees the door open and shut together, and whoever comes down sees it as it is', { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'secret-door-office-'));
  process.env.AGENT_OFFICE_HOME = path.join(root, 'home');
  const project = path.join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: project });
  const { loadConfig } = await import('../src/server/config.js');
  const { startServer } = await import('../src/server/server.js');
  const port = await freePort();
  const office = await startServer(loadConfig([project, '--port', String(port), '--password', 'dev', '--no-open']));
  const origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password: 'dev' }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const people: Person[] = [];
  const join = (name: string, floor?: string): Person => {
    const chips = Buffer.from(name.padEnd(16, '_')).toString('hex');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&chips=${chips}${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`, { headers: { cookie, origin } });
    const msgs: any[] = [];
    const waiting: (() => void)[] = [];
    ws.on('message', (d) => {
      msgs.push(JSON.parse(String(d)));
      for (const w of waiting.splice(0)) w();
    });
    let seen = 0;
    const p: Person = {
      msgs,
      send: (msg) => ws.send(JSON.stringify(msg)),
      next: (t, ok = () => true, ms = 5000) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`${name} never got ${t}`)), ms);
          const look = () => {
            for (; seen < msgs.length; seen++) {
              if (msgs[seen].t === t && ok(msgs[seen])) {
                clearTimeout(timer);
                return resolve(msgs[seen++]);
              }
            }
            waiting.push(look);
          };
          look();
        }),
      close: () => ws.close(),
    };
    people.push(p);
    return p;
  };
  const move = (p: Person, x: number, z: number) => p.send({ t: 'move', x, y: 0, z, rotY: 0, moving: false });
  try {
    const ann = join('Ann', CASINO);
    const bob = join('Bob', CASINO);
    const welcome = await ann.next('welcome');
    assert.deepEqual(welcome.secretDoor, { open: false, side: 1 });
    await bob.next('welcome');
    // Pushing from across the hall does nothing.
    move(ann, 0, 0);
    ann.send({ t: 'secretDoor.push' });
    // From right at it, it opens, for both.
    move(ann, HALL.x, HALL.z);
    ann.send({ t: 'secretDoor.push' });
    assert.deepEqual((await ann.next('secretDoor')).door, { open: true, side: 1 });
    assert.deepEqual((await bob.next('secretDoor')).door, { open: true, side: 1 });
    // Ann walks in and stands in the doorway: it waits for her.
    move(ann, D.x, (R.maxZ + Q.minZ) / 2);
    // Cid comes down while it's open: he sees it open.
    const cid = join('Cid', CASINO);
    assert.deepEqual((await cid.next('welcome')).secretDoor, { open: true, side: 1 });
    await new Promise((r) => setTimeout(r, SECRET_MOTION.minOpen + 600));
    // Still open: she's in the way.
    for (const p of [ann, bob]) assert.equal(p.msgs.filter((m) => m.t === 'secretDoor').length, 1);
    // Then she's through, in the room's far corner: it shuts, for everyone.
    move(ann, Q.maxX - 0.4, Q.maxZ - 0.4);
    const shut = await Promise.all([ann, bob, cid].map((p) => p.next('secretDoor', () => true, 2000)));
    for (const s of shut) assert.deepEqual(s.door, { open: false, side: 1 });
    // From inside, it opens out into the hall.
    move(ann, ROOM.x, ROOM.z);
    ann.send({ t: 'secretDoor.push' });
    assert.deepEqual((await bob.next('secretDoor')).door, { open: true, side: -1 });
  } finally {
    for (const p of people) p.close();
    await office.shutdown();
  }
});
