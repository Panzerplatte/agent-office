import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as layout from '../src/shared/layout.js';
import { BEANBAGS, DESKS, MEETING_SEATS, STATIONS } from '../src/shared/layout.js';

// A canvas that draws nothing: enough for the office's and the bunker's textures to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

const { buildOffice } = await import('../src/client/world/office.js');
const { buildFurniture } = await import('../src/client/world/bunker/furniture.js');

/** Everything that gets disposed, by what it is. */
const disposed = new Set<unknown>();
for (const proto of [THREE.BufferGeometry.prototype, THREE.Material.prototype, THREE.Texture.prototype]) {
  const was = proto.dispose;
  proto.dispose = function (this: unknown) {
    disposed.add(this);
    return was.call(this);
  } as never;
}

function setup() {
  const office = buildOffice();
  const group = new THREE.Group();
  office.group.add(group);
  const ctx = {
    group,
    office,
    look: office.look,
    layout,
    deps: {} as never,
    standIn: (from: THREE.Object3D, to: THREE.Object3D) => {
      for (let o: THREE.Object3D | null = from; o; o = o.parent) {
        if (o.userData.interact) {
          to.userData.interact = o.userData.interact;
          return;
        }
      }
    },
  };
  return { office, group, part: buildFurniture(ctx as never) };
}

/** What the bunker added: everything in office.group now that wasn't there before. */
function added(office: ReturnType<typeof buildOffice>, before: Set<THREE.Object3D>) {
  const out: THREE.Object3D[] = [];
  office.group.traverse((o) => !before.has(o) && out.push(o));
  return out;
}

test('every seat gets its bunker furniture, built in place, and the office pieces it replaces are named', () => {
  const { office, group, part } = setup();
  const hidden = new Set(part.hideOffice);
  // The desks' furniture and chairs, the lounge, the war room's table: all hidden.
  for (const id of [DESKS[0].id, BEANBAGS[0].id, MEETING_SEATS[0].id]) for (const m of office.look.seats.get(id)!.chair) assert.ok(hidden.has(m), `${id}'s chair is replaced`);
  for (const m of [...office.look.lounge.couch, ...office.look.lounge.kitchen, ...office.look.meeting.table, ...office.look.lounge.tv]) assert.ok(hidden.has(m));
  // Never a screen or a board's face, nor a kiosk's sign.
  for (const s of [office.tvScreen, office.bossScreen, office.machineScreen, office.meetingBoard, office.meetingSign, ...Object.values(office.boardMeshes)]) assert.ok(!hidden.has(s as THREE.Mesh));
  for (const m of office.look.seats.get(STATIONS[0].id)!.furniture) if ((m.material as THREE.MeshBasicMaterial).map) assert.ok(!hidden.has(m), 'the kiosk keeps its sign');

  const colliders = office.colliders.map((c) => ({ ...c }));
  const interactables = office.interactables.map((i) => ({ ...i }));
  part.set!(true);
  assert.equal(group.children.length, 1);
  // Each desk's chair turns with the office's, so it's under it; the bench is where the desk is.
  for (const def of [DESKS[3], BEANBAGS[2], MEETING_SEATS[1]]) assert.ok(office.desks.get(def.id)!.chair.children.some((c) => !(c as THREE.Mesh).isMesh), `${def.id} has its bunker chair`);
  // Aiming down at a bench, the couch or the war room's table still finds the desk, the couch, the
  // meeting: the bunker's pieces let the ray through to the hidden office ones in their place.
  const aimDown = (x: number, z: number) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 2.5, z), new THREE.Vector3(0, -1, 0));
    ray.camera = new THREE.PerspectiveCamera();
    office.group.updateMatrixWorld(true);
    for (const hit of ray.intersectObject(office.group, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (o.userData.interact) return o.userData.interact;
      return null;
    }
    return null;
  };
  const desk = office.desks.get(DESKS[5].id)!;
  assert.equal(aimDown(DESKS[5].x, DESKS[5].z), desk.group.userData.interact, 'aiming at the bench is aiming at the desk');
  assert.equal(aimDown(10.5, 0.4)?.seatId, 'couch');
  assert.equal(aimDown(layout.MEETING_TABLE.x, layout.MEETING_TABLE.z)?.kind, 'meeting');
  // Only the look changes.
  assert.deepEqual(office.colliders, colliders);
  assert.deepEqual(office.interactables, interactables);
  part.dispose();
});

test('switching off takes it all down and disposes of it, as many times as you like', () => {
  const { office, group, part } = setup();
  const before = new Set<THREE.Object3D>();
  office.group.traverse((o) => before.add(o));
  const officeStuff = new Set<unknown>();
  office.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    officeStuff.add(m.geometry);
    for (const mat of [m.material].flat()) officeStuff.add(mat);
  });
  for (let round = 0; round < 3; round++) {
    part.set!(true);
    const mine = added(office, before);
    assert.ok(mine.filter((o) => (o as THREE.Mesh).isMesh).length > 100, 'plenty was built');
    const things = new Set<unknown>();
    for (const o of mine) {
      const m = o as THREE.Mesh;
      if (!m.isMesh) continue;
      things.add(m.geometry);
      for (const mat of [m.material].flat()) {
        if (officeStuff.has(mat)) continue;
        things.add(mat);
        const map = (mat as THREE.MeshToonMaterial).map;
        if (map) things.add(map);
      }
      assert.ok(!officeStuff.has(m.geometry), 'no office geometry is shared');
    }
    part.set!(false);
    assert.equal(added(office, before).length, 0, 'nothing is left behind');
    assert.equal(group.children.length, 0);
    for (const t of things) assert.ok(disposed.has(t), `${(t as { type?: string }).type} is disposed`);
  }
  // Off twice, or disposed while off: nothing more to do.
  part.set!(false);
  part.dispose();
});
