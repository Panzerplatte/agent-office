import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

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

test('in the bunker no office pendant lamp shows (over the desks, the lounge, the boss\'s desk upstairs), and they all come back', () => {
  const office = buildOffice();
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() };
  const bunker = createBunker(office, { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), lights, sky: { lampsOn: 0, daylight: 1 } as never, sound: {} as never });
  // Every pendant office.ts hung: a group of a cord, an open cone of a shade and a bulb.
  const pendants: THREE.Mesh[] = [];
  office.group.traverse((g) => {
    const [cord, shade, bulb] = g.children as THREE.Mesh[];
    if (g.children.length !== 3 || !(cord.geometry instanceof THREE.CylinderGeometry) || !(shade.geometry instanceof THREE.ConeGeometry) || shade.geometry.parameters.radius !== 0.5 || !(bulb.geometry instanceof THREE.SphereGeometry)) return;
    pendants.push(cord, shade, bulb);
  });
  // The five over the desks and the lounge, and the boss's.
  assert.ok(pendants.length / 3 >= 6, `${pendants.length / 3} pendants`);
  const shows = (m: THREE.Mesh) => (m.material as THREE.Material).visible;
  assert.ok(pendants.every(shows));

  bunker.set(true);
  for (const m of pendants) assert.ok(!shows(m), `the pendant at ${m.parent!.position.x}, ${m.parent!.position.y}, ${m.parent!.position.z} is hidden`);

  bunker.set(false);
  assert.ok(pendants.every(shows), 'the pendants are back');
});
