import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BALCONY_DOOR, EXIT_DOOR, FLOOR, WALL_T } from '../src/shared/layout.js';

// The bunker's shell (world/bunker/shell.ts): the room it builds in place of the office's, the doors
// that move with the office's hidden ones, the light that's the same day and night, and that it all
// goes again when it's disposed.

// A canvas that draws nothing: enough for the office's (and the shell's) textures to be built in Node.
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
const { lightBunker } = await import('../src/client/world/bunker/shellparts/lighting.js');

function setup() {
  const office = buildOffice();
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() };
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#bfe3ff', 40, 90);
  scene.add(office.group);
  const bunker = createBunker(office, { scene, camera: new THREE.PerspectiveCamera(), lights, sky: { lampsOn: 0, daylight: 1 } as never, sound: {} as never });
  const shell = bunker.group.getObjectByName('bunker-shell')!;
  return { office, lights, scene, bunker, shell };
}

const hidden = (m: THREE.Mesh) => !(m.material as THREE.Material).visible;

test('the shell stands in for the walls, windows, glass doors, lamps and everything outside', () => {
  const { office, bunker, shell } = setup();
  assert.ok(shell, 'the shell is in the bunker group');
  const colliders = office.colliders.map((c) => ({ ...c }));
  const look = office.look;
  const lists = [look.walls, look.windows, look.balconyDoor, look.lamps, look.rugs];
  const wore = lists.map((l) => l.map((m) => m.material));
  bunker.set(true);
  for (const list of lists) assert.ok(list.length > 0 && list.every(hidden));
  // Down at the street and the rest of the building: all gone but the exit door's sign over it.
  const outside: THREE.Mesh[] = [];
  for (const g of [look.ground, look.tower]) g.traverse((o) => (o as THREE.Mesh).isMesh && outside.push(o as THREE.Mesh));
  const shown = outside.filter((m) => !hidden(m));
  assert.ok(outside.length > 50);
  assert.equal(shown.length, 1, 'only the exit sign');
  assert.ok((shown[0].material as THREE.MeshBasicMaterial).map, 'it is a sign');
  // The balcony stays (walled in), and so does the floor, reskinned in concrete with its holes.
  assert.ok(look.balcony.every((m) => !hidden(m)));
  assert.ok(look.floorMat.map && look.floorMat.map !== office.look.ceilingMat.map);
  // Nothing moves: the same colliders.
  assert.deepEqual(office.colliders, colliders);
  bunker.set(false);
  assert.deepEqual(
    lists.map((l) => l.map((m) => m.material)),
    wore,
    'back as they were',
  );
});

test('the blast door rolls up as the hidden glass doors open, and the steel exit door swings with the hidden one', () => {
  const { office, bunker, shell } = setup();
  bunker.set(true);
  const blast = shell.getObjectByName('blast-door')!;
  const exit = shell.getObjectByName('exit-door')!;
  bunker.update(0.1);
  assert.equal(blast.position.y, 0, 'shut');
  const shut = exit.matrix.clone();
  // Someone comes up to each door: the office opens them (hidden), the shell's follow.
  const people = [
    { x: BALCONY_DOOR.u, y: 0, z: FLOOR.maxZ - 1 },
    { x: FLOOR.minX + 1, y: 0, z: EXIT_DOOR.u },
  ];
  for (let i = 0; i < 20; i++) {
    office.update(i * 0.1, 0.1, people);
    bunker.update(0.1);
  }
  assert.ok(blast.position.y > EXIT_DOOR.y1 - 0.3, `rolled up (${blast.position.y.toFixed(2)})`);
  assert.ok(!exit.matrix.equals(shut), 'swung open');
  // The steel leaf hangs indoors, just inside the wall, where the room's light falls on it.
  const at = new THREE.Vector3().setFromMatrixPosition(shut);
  assert.ok(at.x > FLOOR.minX - 0.02 && at.x < FLOOR.minX + WALL_T, `hinge at x ${at.x.toFixed(2)}`);
  for (let i = 0; i < 30; i++) {
    office.update(3 + i * 0.1, 0.1, []);
    bunker.update(0.1);
  }
  assert.equal(blast.position.y, 0, 'back down');
  assert.ok(exit.matrix.equals(shut), 'shut again');
});

test('upstairs the exit door is walled up, on the bottom floor it is there', () => {
  const { office, bunker, shell } = setup();
  bunker.set(true);
  office.setLevel(2, 3);
  office.stack.set({ index: 2, count: 3 });
  bunker.update(0.1);
  assert.equal(shell.getObjectByName('exit-door')!.visible, false);
  assert.equal(shell.getObjectByName('exit-sealed')!.visible, true);
  office.setLevel(0, 3);
  office.stack.set({ index: 0, count: 3 });
  bunker.update(0.1);
  assert.equal(shell.getObjectByName('exit-door')!.visible, true);
  assert.equal(shell.getObjectByName('exit-sealed')!.visible, false);
});

/**
 * What lights a surface facing up (or down) indoors: the hemisphere and ambient lights, plus the
 * lamplight the sky adds indoors in the dark, (0.65 + 0.35 × up) of it (sky.ts). Red channel.
 */
function indoors(lights: { hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight }, skyLamplight: number, up: 1 | -1) {
  const hemi = (up > 0 ? lights.hemi.color.r : lights.hemi.groundColor.r) * lights.hemi.intensity;
  return hemi + lights.ambient.color.r * lights.ambient.intensity + skyLamplight * (0.65 + 0.35 * up);
}

test('the light is the same at noon and at midnight, and there is no sun', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#bfe3ff', 40, 90);
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() };
  // What the sky sets: a clear noon, and midnight (sky.ts's numbers), and how much lamplight it adds indoors then.
  const officeNight = new THREE.Color('#ffd49c');
  const office = new THREE.Color('#fff2de');
  const at = (hemi: number, ambient: number, sun: number) => {
    lights.hemi.intensity = hemi;
    lights.ambient.intensity = ambient;
    lights.sun.intensity = sun;
    const need = 1 - Math.min(1, (hemi + ambient + 0.6 * sun) / (1.5 + 0.5 + 0.6 * 2.2));
    const sky = office.clone().lerp(officeNight, need).multiplyScalar(need * 3.2).r;
    lightBunker(lights, scene);
    assert.equal(lights.sun.intensity, 0);
    return [indoors(lights, sky, 1), indoors(lights, sky, -1)];
  };
  const noon = at(1.5, 0.5, 2.2);
  const midnight = at(0.38, 0.12, 0.4);
  assert.ok(Math.abs(noon[0] - midnight[0]) < 0.01 && Math.abs(noon[1] - midnight[1]) < 0.01, `noon ${noon} vs midnight ${midnight}`);
  // Dimmer than the office by day.
  assert.ok(noon[0] < 1.5 + 0.5);
  assert.equal((scene.fog as THREE.Fog).near > 20, true);
});

test('disposing it lets go of every geometry, material and texture it made', () => {
  const { bunker, shell } = setup();
  bunker.set(true);
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  shell.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    geos.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      mats.add(mat);
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map) texs.add(map);
    }
  });
  assert.ok(geos.size > 10 && mats.size > 10 && texs.size > 3);
  const disposed = new Set<unknown>();
  for (const x of [...geos, ...mats, ...texs]) x.addEventListener('dispose', () => disposed.add(x));
  bunker.dispose();
  for (const x of [...geos, ...mats, ...texs]) assert.ok(disposed.has(x), `${x.constructor.name} disposed`);
  assert.equal(shell.parent, null);
  assert.equal(shell.children.length, 0);
});
