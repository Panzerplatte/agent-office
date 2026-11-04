import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHECKPOINTS, COURSE, FLAG, START, pieceUnder, pieceX } from '../src/shared/jumprun.js';
import { streetBelow } from '../src/shared/layout.js';

// A canvas that draws nothing: enough for the office's and the course's textures to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) =>
      k === 'measureText'
        ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
        : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern'
          ? () => ({ addColorStop() {} })
          : k === 'getImageData'
            ? () => ({ data: new Uint8ClampedArray(4) })
            : noop(),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
const doc = { createElement: () => canvas(), addEventListener() {}, removeEventListener() {}, documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } };
Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });

const { buildOffice } = await import('../src/client/world/office.js');
const { buildJumpRun } = await import('../src/client/world/jumprun.js');
const { PlayerController } = await import('../src/client/player.js');
const { RunTracker, setStreet, stepMovers } = await import('../src/client/jumprun.js');

const DT = 1 / 60;

/**
 * Someone running the course with the player's own controls and physics (W forward toward the next
 * piece, Space to jump, letting go of W over where they want to land), on floor `index`: it waits
 * on a piece for a moving platform to come round. Says how it went.
 */
function play(t: TestContext, index: number) {
  const win = new EventTarget();
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  t.after(() => {
    if (prev) Object.defineProperty(globalThis, 'window', prev);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const office = buildOffice();
  office.setLevel(index, index + 1);
  const world = buildJumpRun();
  const colliders = [...office.colliders, ...world.colliders.map((c) => c.c)];
  const street = streetBelow(index);
  setStreet(world, street);
  const player = new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement, colliders);
  player.street = street;
  const press = (codes: string[]) => {
    player.clearKeys();
    for (const code of codes) {
      const e = new Event('keydown');
      Object.defineProperty(e, 'code', { value: code });
      win.dispatchEvent(e);
    }
  };
  const run = new RunTracker();
  const events: string[] = [];
  let time = 0;
  let falls = 0;
  const frame = (keys: string[]) => {
    press(keys);
    player.update(DT);
    time += DT;
    stepMovers(world, player, time);
    for (const ev of run.step({ x: player.pos.x, y: player.pos.y, z: player.pos.z, street, grounded: player.grounded, t: time, here: true })) {
      events.push(ev.e === 'checkpoint' ? `checkpoint ${ev.n}` : ev.e);
      if (ev.e === 'back') {
        falls++;
        player.pos.set(ev.to.x, ev.to.y, ev.to.z);
        player.vy = 0;
      }
    }
  };
  const aim = (x: number, z: number) => {
    player.camYaw = Math.atan2(-(x - player.pos.x), -(z - player.pos.z));
  };
  const standingOn = () => (player.grounded ? pieceUnder(player.pos.x, player.pos.z, 0.32, time) : -2);

  // Up to the line, and over it.
  player.pos.set((START.x0 + START.x1) / 2, street, START.z + 2);
  for (let i = 0; i < 400 && standingOn() !== 0; i++) {
    const p = COURSE[0];
    aim(p.x, p.z);
    const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    frame(d < 1.3 ? ['KeyW', 'Space'] : ['KeyW']);
  }
  let at = standingOn();
  for (let next = 1; next < COURSE.length && falls < 5; next++) {
    const to = COURSE[next];
    const from = COURSE[at];
    // Wait for a moving platform to come round to where you'll get on it (or, on one, to where you'll get off).
    const lined = () => {
      if (to.move) return Math.abs(pieceX(to, time + 0.7) - to.x) < 0.2;
      if (from?.move) return Math.abs(pieceX(from, time + 0.7) - to.x) < 0.25;
      return true;
    };
    for (let i = 0; i < 600 && !lined(); i++) frame([]);
    let jumped = false;
    for (let i = 0; i < 600; i++) {
      const tx = pieceX(to, time);
      aim(tx, to.z);
      const d = Math.hypot(tx - player.pos.x, to.z - player.pos.z);
      // The edge of what you're on, a little ahead: time to jump. Or the next piece is right there.
      const fwd = { x: -Math.sin(player.camYaw), z: -Math.cos(player.camYaw) };
      const ahead = pieceUnder(player.pos.x + fwd.x * 0.3, player.pos.z + fwd.z * 0.3, 0.32, time);
      const near = Math.max(Math.abs(tx - player.pos.x) - to.w / 2, Math.abs(to.z - player.pos.z) - to.d / 2);
      const keys: string[] = [];
      if (player.grounded && standingOn() === next) break;
      if (d > 0.2) keys.push('KeyW');
      if (player.grounded && !jumped && (ahead !== at || near < 0.45)) {
        keys.push('Space');
        jumped = true;
      }
      if (player.grounded && jumped && player.vy === 0 && standingOn() !== next) jumped = false;
      frame(keys);
      // Landed on the street: put back on the checkpoint (see frame), start that piece over from there.
      if (falls && standingOn() !== at && standingOn() >= 0 && COURSE[standingOn()].checkpoint) break;
    }
    const now = standingOn();
    if (now !== next) {
      // Put back on a checkpoint: carry on from there.
      if (now >= 0 && COURSE[now].checkpoint) {
        at = now;
        next = now;
        continue;
      }
      return { events, falls, reached: at, stuckAt: next, pos: player.pos.clone() };
    }
    at = next;
  }
  // Over to the flag.
  for (let i = 0; i < 300 && run.running; i++) {
    aim(FLAG.x, FLAG.z);
    frame(['KeyW']);
  }
  return { events, falls, reached: at, stuckAt: -1, pos: player.pos.clone() };
}

for (const index of [0, 2]) {
  test(`someone running it with the player's own jump gets from the line to the flag, on floor ${index}'s street`, (t) => {
    const r = play(t, index);
    assert.equal(r.stuckAt, -1, `stuck going onto piece ${r.stuckAt} at ${r.pos.toArray().map((v) => v.toFixed(2))}`);
    assert.equal(r.falls, 0, 'never fell off');
    assert.deepEqual(r.events, ['start', ...Array.from({ length: CHECKPOINTS }, (_, i) => `checkpoint ${i + 1}`), 'finish']);
  });
}
