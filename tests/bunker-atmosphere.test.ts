import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// A canvas that draws nothing: enough for the office's boards, signs and textures to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

// The transition runs on the page's clock: drive it by hand.
let now = 0;
Object.defineProperty(performance, 'now', { configurable: true, value: () => now });

const { buildOffice } = await import('../src/client/world/office.js');
const { createBunker } = await import('../src/client/world/bunker/index.js');

function setup() {
  const office = buildOffice();
  const scene = new THREE.Scene();
  scene.add(office.group);
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() };
  scene.add(lights.sun, lights.hemi, lights.ambient);
  const played: string[] = [];
  const hum: boolean[] = [];
  const sound = { setBunker: (on: boolean) => hum.push(on), breaker: () => played.push('breaker'), tubeTick: () => played.push('tick') };
  const bunker = createBunker(office, { scene, camera: new THREE.PerspectiveCamera(), lights, sky: { lampsOn: 0, daylight: 1 } as never, sound: sound as never });
  /** A frame: the sky sets the lights, the bunker's parts run, then the renderer's hook. */
  const frame = (ms = 50) => {
    now += ms;
    lights.hemi.intensity = 1;
    lights.ambient.intensity = 1;
    lights.sun.intensity = 1;
    bunker.update(ms / 1000);
    const want = lights.hemi.intensity;
    scene.onBeforeRender(null as never, scene, null as never, null);
    return { want, got: lights.hemi.intensity };
  };
  const tick = () => new Promise<void>((r) => queueMicrotask(r));
  return { office, scene, lights, bunker, played, hum, frame, tick };
}

test('switching the style throws the breaker, the lights go out and come back; arriving on a bunker floor does not', async () => {
  now = 0;
  const { office, bunker, played, hum, frame, tick } = setup();
  // Loading the page on a bunker floor: an arrival, so just the hum.
  bunker.set(true);
  await tick();
  assert.deepEqual(played, []);
  assert.equal(hum.at(-1), true);
  assert.ok(bunker.group.getObjectByName('bunker-dust') && bunker.group.getObjectByName('bunker-tube'));
  const { want, got } = frame();
  assert.equal(got, want, 'no transition: the light is as the parts set it');

  // Someone switches it back to the office: the clunk, and the office goes dark for a moment too.
  bunker.set(false);
  assert.equal(hum.at(-1), false, 'the hum fades out');
  await tick();
  assert.deepEqual(played, ['breaker']);
  assert.ok(frame().got < 0.1, 'dark');
  for (let i = 0; i < 40; i++) frame();
  assert.equal(frame().got, 1, 'and back on');

  // And to the bunker again: dark, flickering back on, with the tube ticking.
  bunker.set(true);
  await tick();
  assert.equal(played.at(-1), 'breaker');
  assert.ok(frame().got < 0.1);
  for (let i = 0; i < 40; i++) frame();
  const after = frame();
  assert.equal(after.got, after.want, 'all on again');
  assert.ok(played.includes('tick'));

  // Riding to another floor that's an office: no breaker.
  const n = played.length;
  bunker.set(false);
  office.stack.set({ index: 1, count: 2 });
  await tick();
  assert.equal(played.length, n);
  // Nor going up on the roof (the office hides in the same message).
  bunker.set(true);
  await tick();
  played.length = 0;
  bunker.set(false);
  office.group.visible = false;
  await tick();
  assert.deepEqual(played, []);
  bunker.dispose();
});

test('the lights are put back exactly, and the static ones are not dimmed twice', async () => {
  now = 0;
  const { scene, bunker, frame, tick } = setup();
  const lamp = new THREE.PointLight('#fff', 3);
  bunker.group.add(lamp);
  bunker.set(true);
  await tick();
  bunker.set(false);
  bunker.set(true);
  await tick();
  frame();
  // The renderer runs the hook more than once a frame (the outline pass): the same result.
  const dimmed = lamp.intensity;
  assert.ok(dimmed < 3);
  scene.onBeforeRender(null as never, scene, null as never, null);
  assert.equal(lamp.intensity, dimmed);
  for (let i = 0; i < 40; i++) frame();
  assert.equal(lamp.intensity, 3);
  bunker.dispose();
});

test('switching back and forth leaks nothing, and dispose takes it all away', async () => {
  now = 0;
  const { scene, bunker, frame, tick } = setup();
  const hook = scene.onBeforeRender;
  const count = () => {
    let n = 0;
    bunker.group.traverse(() => n++);
    return n;
  };
  bunker.set(true);
  const objects = count();
  for (let i = 0; i < 20; i++) {
    bunker.set(false);
    await tick();
    frame();
    bunker.set(true);
    await tick();
    frame();
  }
  assert.equal(count(), objects);
  bunker.dispose();
  assert.equal(bunker.group.getObjectByName('bunker-dust'), undefined);
  assert.notEqual(scene.onBeforeRender, hook, 'the scene hook is gone');
});
