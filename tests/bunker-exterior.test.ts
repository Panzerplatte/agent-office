import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// A canvas that draws nothing (as in bunker.test.ts): enough for the office's textures to be built in Node.
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
const { buildTower, setBunkerFloors } = await import('../src/client/world/tower.js');

/** The materials that glow at night in the tower's windows (NightParts.windows), and whether the tower wears any of them. */
function litWindows(night: { windows: THREE.Material[] }, group: THREE.Object3D): number {
  let n = 0;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && night.windows.includes(m.material as THREE.Material)) n++;
  });
  return n;
}

test('a floor in the bunker look has no windows from the other floors, and none lit at night', () => {
  const night = { bulbs: [], halos: [], lamps: [], windows: [] as THREE.Material[], street: 0, clouds: new THREE.MeshToonMaterial(), wetGlass: new THREE.MeshBasicMaterial() };
  const tower = buildTower([], night as never);
  // On the bottom floor of three: floors 1 and 2 are the tower's.
  tower.set(0, 3);
  const glass = litWindows(night, tower.group);
  assert.ok(glass > 0, 'office floors have windows that light up');
  /** How much the tower draws, for telling whether it was rebuilt differently. */
  const verts = () => {
    let n = 0;
    tower.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) n += m.geometry.getAttribute('position').count;
    });
    return n;
  };
  const before = verts();
  setBunkerFloors([false, true, true]);
  assert.equal(litWindows(night, tower.group), 0, 'nothing glows from a bunker floor');
  assert.notEqual(verts(), before, 'the tower was rebuilt');
  setBunkerFloors([false, true, false]);
  assert.ok(litWindows(night, tower.group) > 0 && litWindows(night, tower.group) <= glass, 'the office floor above it has its windows again');
  setBunkerFloors([false, false, false]);
  assert.equal(verts(), before, 'all office again: the same tower as before');
  setBunkerFloors([]);
});

test('the bunker floor you are on gets a concrete facade outside, and switching back takes it away', () => {
  const office = buildOffice();
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() };
  const bunker = createBunker(office, { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), lights, sky: { lampsOn: 0, daylight: 1 } as never, sound: {} as never });
  const facade = bunker.group.getObjectByName('bunker-exterior')!;
  assert.ok(facade, 'the exterior is in the bunker');
  const wore = office.look.windows.map((m) => m.material);
  bunker.set(true);
  assert.ok(office.look.windows.every((m) => !(m.material as THREE.Material).visible), 'no windows');
  assert.ok(office.look.walls.every((m) => !(Array.isArray(m.material) ? m.material[0] : m.material).visible), 'no office walls');
  bunker.update(0.1);
  bunker.set(false);
  assert.deepEqual(office.look.windows.map((m) => m.material), wore, 'the windows are back as they were');
  assert.equal(bunker.group.visible, false);
  bunker.dispose();
});
