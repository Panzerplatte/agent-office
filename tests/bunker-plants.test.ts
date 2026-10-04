import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLANTS } from '../src/shared/layout.js';

// A canvas that draws nothing: enough for the office's boards, signs and textures to be built in Node (as in bunker.test.ts).
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

const { buildOffice } = await import('../src/client/world/office.js');
const { createBunker } = await import('../src/client/world/bunker/index.js');

test('in the bunker no potted plant shows indoors (round the room, upstairs, on the desks), and they all come back', () => {
  const office = buildOffice();
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() };
  const bunker = createBunker(office, { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), lights, sky: { lampsOn: 0, daylight: 1 } as never, sound: {} as never });
  // Every plant office.ts built: a group of a pot and three balls of leaves. The balcony's aren't the bunker's to hide.
  const balcony = new Set<THREE.Object3D>(office.look.balcony);
  const plants: THREE.Mesh[] = [];
  office.group.traverse((g) => {
    const [pot, ...leaves] = g.children as THREE.Mesh[];
    if (g.children.length !== 4 || !(pot.geometry instanceof THREE.CylinderGeometry) || pot.geometry.parameters.radiusTop !== 0.28 || !leaves.every((l) => l.geometry instanceof THREE.SphereGeometry)) return;
    if (!balcony.has(pot)) plants.push(...(g.children as THREE.Mesh[]));
  });
  // The room's, the boss's two, and the desks' little ones.
  assert.ok(plants.length / 4 > PLANTS.length + 2, `${plants.length / 4} plants`);
  const shows = (m: THREE.Mesh) => (m.material as THREE.Material).visible;
  assert.ok(plants.every(shows));

  bunker.set(true);
  for (const m of plants) assert.ok(!shows(m), `the plant at ${m.parent!.position.x}, ${m.parent!.position.z} is hidden`);

  bunker.set(false);
  assert.ok(plants.every(shows), 'the plants are back');
});
