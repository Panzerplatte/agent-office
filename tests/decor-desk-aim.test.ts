import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deskPose } from '../src/shared/decor.js';
import { DESKS, LOFT } from '../src/shared/layout.js';

// gallery.ts draws its "Loading…" notices on a canvas: one that draws nothing does in Node.
const noop = (): unknown => new Proxy(function () {}, { get: () => noop(), apply: () => undefined, set: () => true });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => noop() }), documentElement: { lang: 'en' } } });
const { aimAtDesk, aimAtWall } = await import('../src/client/world/gallery.js');

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} ≈ ${b}`);

test('aiming down at a desk top finds the desk and the spot on it, in its own frame', () => {
  for (const desk of DESKS) {
    // Standing at the chair, eyes at 1.6 m, looking at a spot left of the laptop.
    const eye = deskPose(desk, 0, 1.2);
    const spot = deskPose(desk, -0.8, 0.25);
    const ray = new THREE.Ray(new THREE.Vector3(eye.x, 1.6, eye.z), new THREE.Vector3(spot.x - eye.x, spot.y - 1.6, spot.z - eye.z).normalize());
    const hit = aimAtDesk(ray);
    assert.ok(hit, desk.id);
    assert.equal(hit.desk, desk.id);
    near(hit.dx, -0.8, `${desk.id} dx`);
    near(hit.dz, 0.25, `${desk.id} dz`);
    // The wall behind the desk is further away, so the desk takes the picture.
    assert.equal(aimAtWall(ray, hit.t), null);
  }
});

test('aiming at a wall, from up in the loft, or past the desks finds no desk', () => {
  const d = DESKS[0];
  const eye = deskPose(d, 0, 1.2);
  assert.equal(aimAtDesk(new THREE.Ray(new THREE.Vector3(eye.x, 1.6, eye.z), new THREE.Vector3(0, 0.2, -1).normalize())), null);
  assert.equal(aimAtDesk(new THREE.Ray(new THREE.Vector3(eye.x, 0.5, eye.z), new THREE.Vector3(0, -1, 0))), null);
  assert.equal(aimAtDesk(new THREE.Ray(new THREE.Vector3(d.x, LOFT.y + 1.6, d.z), new THREE.Vector3(0, -1, 0))), null);
  // Straight down onto open floor between the pods.
  assert.equal(aimAtDesk(new THREE.Ray(new THREE.Vector3(-6, 1.6, 0), new THREE.Vector3(0, -1, 0))), null);
});
