import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BALCONY } from '../src/shared/layout.js';

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

/** What E is about for `o`: its own interactable or its nearest ancestor's. */
const interactOf = (o: THREE.Object3D) => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.interact) return p.userData.interact as { kind: string; seatId?: string };
  return null;
};
const shows = (m: THREE.Mesh) => !Array.isArray(m.material) && m.material.visible;

function setup() {
  const office = buildOffice();
  // The sky's rain, as world/sky.ts keeps it: a line per drop.
  const rainLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)));
  // Its halos round the bulbs: one on the balcony's string lights, one over a desk.
  const halos = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-6.5, 3.4, 13.4, 0, 4, 0], 3)));
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() };
  const bunker = createBunker(office, { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), lights, sky: { lampsOn: 0, daylight: 1, rainLines, halos: [halos] } as never, sound: {} as never });
  return { office, bunker, rainLines, halos };
}

test('in the bunker the balcony is a smokers\' room: the outdoors go, the ashtray and the seats stay, the tee is a putting green', () => {
  const { office, bunker } = setup();
  const meshes = (pick: (m: THREE.Mesh) => boolean) => {
    const out: THREE.Mesh[] = [];
    office.group.traverse((o) => (o as THREE.Mesh).isMesh && pick(o as THREE.Mesh) && out.push(o as THREE.Mesh));
    return out;
  };
  const ashtray = office.look.balcony.filter((m) => interactOf(m)?.kind === 'smoke');
  const outdoors = office.look.balcony.filter((m) => interactOf(m)?.kind !== 'smoke');
  const tee = meshes((m) => interactOf(m)?.kind === 'golf');
  const seats = office.look.balcony.filter((m) => interactOf(m)?.kind === 'seat');
  assert.ok(ashtray.length > 0 && outdoors.length > 3 && tee.length > 2 && seats.length > 0);
  const before = { colliders: [...office.colliders], interactables: office.interactables.map((i) => ({ ...i })) };
  const wore = new Map([...outdoors, ...tee, ...ashtray].map((m) => [m, m.material]));
  const room = bunker.group.getObjectByName('smokers-room')!;
  assert.ok(room, 'the smokers\' room is one of the bunker\'s parts');

  bunker.set(true);
  assert.ok(outdoors.every((m) => !shows(m)), 'the deck, railing, string lights, plants and bistro set are hidden');
  assert.ok(tee.every((m) => !shows(m)), 'the golf tee is hidden');
  assert.ok(ashtray.every(shows), 'the ashtray stays, where smoking starts');
  assert.ok(room.visible && bunker.group.visible);
  assert.ok(room.getObjectByName('putting-green'), 'the mini golf hole is in it');
  // Its things aren't aimed at: E at the hidden seats and tee still works through them.
  room.traverse((o) => {
    const hits: THREE.Intersection[] = [];
    o.raycast(new THREE.Raycaster(new THREE.Vector3(o.position.x, 5, o.position.z), new THREE.Vector3(0, -1, 0)), hits);
    assert.equal(hits.length, 0, `${o.type} ${o.name} isn't aimed at`);
  });
  // Every new mesh is in (or on) the balcony, or the RAUCHERRAUM sign just inside the doors.
  const box = new THREE.Box3();
  room.updateMatrixWorld(true);
  room.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    box.setFromObject(o);
    assert.ok(box.min.x > BALCONY.minX - 0.2 && box.max.x < BALCONY.maxX + 0.2 && box.min.z > BALCONY.minZ - 1 && box.max.z < BALCONY.maxZ + 0.2, `${o.name || o.type} is in the room`);
  });
  // Only the look: the same colliders and interactables (the seats, the ashtray, the tee).
  assert.deepEqual(office.colliders, before.colliders);
  assert.deepEqual(office.interactables, before.interactables);
  for (const kind of ['smoke', 'golf']) assert.ok(office.interactables.some((i) => i.kind === kind));
  for (const id of ['bench', 'stool-1', 'stool-2']) assert.ok(office.interactables.some((i) => i.seatId === id));

  bunker.set(false);
  for (const [m, was] of wore) assert.equal(m.material, was, 'off, the balcony and the tee are back as they were');
  assert.equal(bunker.group.visible, false);
  bunker.dispose();
});

test('no rain falls in the smokers\' room, while it still does outside it, and the string lights\' halos go', () => {
  const { bunker, rainLines, halos } = setup();
  const h = halos.geometry.attributes.position.array as Float32Array;
  const a = rainLines.geometry.attributes.position.array as Float32Array;
  const drops = () => {
    // One drop in the room, one out over the street.
    a.set([-5, 1.5, 15, -5, 2, 15, -5, 1.5, 30, -5, 2, 30]);
    rainLines.geometry.setDrawRange(0, 4);
  };
  bunker.set(true);
  drops();
  bunker.update(0.016);
  assert.ok(a[1] < -100 && a[4] < -100, 'the drop in the room is out of sight');
  assert.equal(a[7], 1.5, 'the one outside still falls');
  assert.ok(h[1] < -100, 'the string lights\' halo is gone');
  assert.equal(h[4], 4, 'the desk lamp\'s is the shell\'s business');
  bunker.set(false);
  drops();
  bunker.update(0.016);
  assert.equal(a[1], 1.5, 'off, the rain is the sky\'s again');
  assert.equal(Math.round(h[1] * 10), 34, 'and the halo is back');
  bunker.dispose();
});
