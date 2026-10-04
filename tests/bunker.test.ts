import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DESKS } from '../src/shared/layout.js';

// A canvas that draws nothing: enough for the office's boards, signs and textures to be built in Node.
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

/** Every mesh with what it wears and whether it shows, every visible flag, and the look's materials' props. */
function snapshot(office: ReturnType<typeof buildOffice>) {
  const meshes = new Map<THREE.Object3D, unknown>();
  office.group.traverse((o) => meshes.set(o, [o.visible, (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).material : null]));
  const l = office.look;
  const mats = [l.wallMat, l.trimMat, l.floorMat, l.ceilingMat].map((m) => [m.color.getHexString(), m.emissive.getHexString(), m.map, m.emissiveMap]);
  return { meshes, mats, colliders: [...office.colliders], interactables: office.interactables.map((i) => ({ ...i })) };
}

test('the bunker look hides the office it replaces, and switching back puts every bit of it back', () => {
  const office = buildOffice();
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() };
  const bunker = createBunker(office, { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), lights, sky: { lampsOn: 0, daylight: 1 } as never, sound: {} as never });
  const before = snapshot(office);
  const shownMeshes = () => {
    let n = 0;
    office.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && m.material.visible) n++;
    });
    return n;
  };
  const shown = shownMeshes();
  assert.ok(office.look.walls.length > 10 && office.look.windows.length > 0 && office.look.seats.size > 10, 'the handles are there');
  const desk = office.look.seats.get(DESKS[0].id)!;
  assert.ok(desk.furniture.length > 0 && desk.chair.length > 0);
  // Nothing that shows something is in the handles, nor the desk's anchors.
  const handled = new Set<THREE.Object3D>([...office.look.walls, ...office.look.loft, ...office.look.meeting.room, ...office.look.meeting.table, ...office.look.lounge.tv, ...[...office.look.seats.values()].flatMap((s) => [...s.furniture, ...s.chair])]);
  for (const screen of [office.tvScreen, office.bossScreen, office.machineScreen, office.meetingBoard, office.meetingSign, ...Object.values(office.boardMeshes)]) assert.ok(!handled.has(screen));
  const view = office.desks.get(DESKS[0].id)!;
  for (const m of desk.furniture) for (let o: THREE.Object3D | null = m; o; o = o.parent) assert.ok(o !== view.laptopAnchor && o !== view.seatAnchor && o !== view.vacancy && o !== view.chair);

  bunker.set(true);
  assert.equal(bunker.on, true);
  assert.equal(bunker.group.visible, true);
  assert.equal(bunker.group.parent, office.group);
  assert.ok(shownMeshes() < shown, 'some office meshes are hidden');
  assert.ok(office.look.rugs.every((r) => !(r.material as THREE.Material).visible), 'the rugs are hidden');
  assert.notEqual(office.look.wallMat.color.getHexString(), before.mats[0][0], 'the walls are concrete');
  // Only the look changes: the same colliders and interactables.
  assert.deepEqual(office.colliders, before.colliders);
  assert.deepEqual(office.interactables, before.interactables);
  // Walls repainted for the next floor while in the bunker: still the bunker's, and that floor's when it's off.
  bunker.repaint(() => office.look.wallMat.color.set('#123456'));
  assert.notEqual(office.look.wallMat.color.getHexString(), '123456');
  // The frame: dimmer light, only while it's on.
  lights.hemi.intensity = 1;
  bunker.update(0.016);
  assert.ok(lights.hemi.intensity < 1);

  bunker.set(false);
  assert.equal(office.look.wallMat.color.getHexString(), '123456', 'the repaint shows once the bunker is off');
  office.look.wallMat.color.set(`#${before.mats[0][0]}`);
  const after = snapshot(office);
  assert.equal(after.meshes.size, before.meshes.size);
  for (const [o, was] of before.meshes) assert.deepEqual(after.meshes.get(o), was, `${o.type} ${o.name} is as it was`);
  assert.deepEqual(after.mats, before.mats);
  assert.equal(shownMeshes(), shown);
  assert.equal(bunker.group.visible, false);
  lights.hemi.intensity = 1;
  bunker.update(0.016);
  assert.equal(lights.hemi.intensity, 1, 'off, it leaves the light alone');

  // On and off again, the same.
  bunker.set(true);
  bunker.set(true);
  bunker.set(false);
  for (const [o, was] of before.meshes) assert.deepEqual(snapshot(office).meshes.get(o), was);
});
