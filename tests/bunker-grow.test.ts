// The bunker's grow area (#119): the plants' model (stages, water, light, wilting, pests, harvest),
// the server's actions and clock on everyone's pots, the pots as the page builds them, and the panel's
// words for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { BUNKER_STATIONS, addItem, countItem, type BunkerPerson } from '../src/shared/bunker/index.js';
import { ITEMS, productKind } from '../src/shared/bunker/items.js';
import {
  DIES_AFTER,
  GROW_STAGES,
  LIGHTS,
  MAX_POTS,
  SOILS,
  START_POTS,
  STRAINS,
  THIRSTY,
  WATER_LASTS,
  growItems,
  growRate,
  growStep,
  harvestOf,
  initialGrow,
  loadGrow,
  secondsLeft,
  stageOf,
  strainOf,
  type GrowState,
  type Plant,
  type Pot,
} from '../src/shared/bunker/grow.js';
import { Chips } from '../src/server/chips.js';
import { Bunker } from '../src/server/bunker/index.js';
import { grow } from '../src/server/bunker/grow.js';
import type { ServerMsg } from '../src/shared/protocol.js';

// A canvas that draws nothing, and a document that's just enough for the room and the panels in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

const plant = (seed: string, more: Partial<Plant> = {}): Plant => ({ seed, growth: 0, water: 1, care: 0.8, dry: 0, ...more });
/** Lets `secs` pass in steps of `step` (like the server's tick), watering whenever it's thirsty if `water`. */
function grown(pot: Pot, secs: number, step = 5, water = true): Pot {
  for (let t = 0; t < secs; t += step) {
    if (water && pot.plant && pot.plant.water < THIRSTY) pot.plant.water = 1;
    growStep(pot, step);
  }
  return pot;
}

// ---- The model ---------------------------------------------------------------------------------------

test('the strains: one for every seed, a cheap fast one, a balanced one and a slow premium one, a few minutes a stage', () => {
  const seeds = ITEMS.filter((i) => i.kind === 'seed');
  assert.deepEqual(seeds.map((s) => s.id).sort(), Object.keys(STRAINS).sort());
  for (const s of seeds) {
    const strain = strainOf(s.id)!;
    assert.ok(strain.stage >= 60 && strain.stage <= 600, `${s.id}: minutes, not hours`);
    assert.ok(productKind(s.grows)?.source === 'grow', `${s.id} grows weed`);
  }
  const bySpeed = seeds.map((s) => s.id).sort((a, b) => STRAINS[a].stage - STRAINS[b].stage);
  const price = (id: string) => ITEMS.find((i) => i.id === id)!.price;
  assert.deepEqual(bySpeed, [...bySpeed].sort((a, b) => price(a) - price(b)), 'the cheaper the faster');
  assert.ok(STRAINS[bySpeed[2]].grams > STRAINS[bySpeed[0]].grams, 'the slow one gives more');
  assert.equal(strainOf('soil'), undefined);
  assert.equal(strainOf('constructor'), undefined);
  // Everything the grow area takes is in the catalog.
  const { seeds: s, soils, lamps } = growItems();
  assert.equal(s.length, 3);
  assert.deepEqual(soils.map((i) => i.id).sort(), Object.keys(SOILS).sort());
  assert.deepEqual(lamps.map((i) => i.id).sort(), Object.keys(LIGHTS).filter((k) => k !== 'none').sort());
});

test('a watered plant goes seedling → vegetative → flowering → ready, each stage as long as its strain says, and then waits', () => {
  const pot: Pot = { soil: 'soil', lamp: 'lamp', plant: plant('seed-kush') };
  const stages: string[] = [];
  for (let t = 0; t <= 3 * STRAINS['seed-kush'].stage + 30; t += 5) {
    if (pot.plant!.water < THIRSTY) pot.plant!.water = 1;
    growStep(pot, 5);
    const s = stageOf(pot.plant!);
    if (stages.at(-1) !== s) stages.push(s);
  }
  assert.deepEqual(stages, [...GROW_STAGES]);
  assert.equal(pot.plant!.growth, 3);
  assert.equal(secondsLeft(pot), 0);
  assert.deepEqual(growStep(pot, 600), [], 'a ready plant just waits');
  assert.equal(pot.plant!.dead, undefined);
  // Almost exactly on time under a plain lamp.
  const p2: Pot = { soil: 'soil', lamp: 'lamp', plant: plant('seed-kush') };
  grown(p2, 3 * STRAINS['seed-kush'].stage - 10);
  assert.equal(stageOf(p2.plant!), 'flowering');
});

test('light: a better lamp grows faster, and with none it only crawls along under the room’s tubes', () => {
  const at = (lamp?: string) => grown({ soil: 'soil', lamp, plant: plant('seed-skunk') }, 120).plant!.growth;
  assert.ok(at('lamp-led') > at('lamp') && at('lamp') > at(undefined));
  assert.ok(at(undefined) > 0, 'it still grows');
  assert.ok(Math.abs(at('lamp') - 1) < 0.02, 'a stage in its time under a lamp');
});

test('water: it runs out while the plant grows; dry, it stops growing, wilts, loses quality and in the end dies', () => {
  const pot: Pot = { soil: 'soil', lamp: 'lamp', plant: plant('seed-haze', { water: 1 }) };
  const news = new Set<string>();
  for (let t = 0; t < WATER_LASTS; t += 5) for (const n of growStep(pot, 5)) news.add(n);
  assert.ok(pot.plant!.water <= 1e-9);
  assert.deepEqual([...news].sort(), ['dry', 'thirsty']);
  const g = pot.plant!.growth;
  const care = pot.plant!.care;
  assert.equal(growRate(pot), 0);
  assert.equal(secondsLeft(pot), Infinity);
  growStep(pot, 60);
  assert.equal(pot.plant!.growth, g, 'no growing without water');
  assert.ok(pot.plant!.care < care - 0.05, 'it wilts');
  assert.ok(!pot.plant!.dead);
  const last = growStep(pot, DIES_AFTER);
  assert.deepEqual(last, ['died']);
  assert.equal(pot.plant!.dead, true);
  assert.equal(harvestOf(pot), null);
  assert.deepEqual(growStep(pot, 60), [], 'dead is dead');
});

test('the model doesn’t care how time is cut up: one long step comes out like many short ones', () => {
  const a = grown({ soil: 'soil', plant: plant('seed-kush', { water: 0.8 }) }, 300, 5, false).plant!;
  const b: Pot = { soil: 'soil', plant: plant('seed-kush', { water: 0.8 }) };
  growStep(b, 300);
  for (const k of ['growth', 'water', 'care', 'dry'] as const) assert.ok(Math.abs(a[k] - b.plant![k]) < 1e-6, k);
});

test('pests: they come now and then, eat at the quality and slow it down until they’re sprayed', () => {
  const pot: Pot = { soil: 'soil', lamp: 'lamp', plant: plant('seed-kush') };
  assert.deepEqual(growStep(pot, 5, () => 0), ['pests']);
  const fast = growRate({ ...pot, plant: { ...pot.plant!, pests: undefined } });
  assert.ok(growRate(pot) < fast);
  const care = pot.plant!.care;
  growStep(pot, 60, () => 0);
  assert.ok(pot.plant!.care < care);
  // Without a roll (the page counting down), never.
  const clean: Pot = { soil: 'soil', lamp: 'lamp', plant: plant('seed-kush') };
  growStep(clean, 600);
  assert.equal(clean.plant!.pests, undefined);
});

test('the harvest: the strain’s weed, more and better for a plant looked after, better under an LED panel', () => {
  const ready = (care: number, lamp?: string): Pot => ({ soil: 'soil', lamp, plant: plant('seed-haze', { growth: 3, care }) });
  assert.equal(harvestOf({ soil: 'soil', plant: plant('seed-haze', { growth: 2.9 }) }), null, 'not before it’s ready');
  const good = harvestOf(ready(0.9))!;
  const poor = harvestOf(ready(0.3))!;
  assert.equal(good.product, 'weed-haze');
  assert.ok(good.grams > poor.grams && good.quality > poor.quality);
  assert.ok(good.grams <= STRAINS['seed-haze'].grams);
  assert.ok(harvestOf(ready(0.8, 'lamp-led'))!.quality > harvestOf(ready(0.8, 'lamp'))!.quality);
  assert.equal(harvestOf(ready(1, 'lamp-led'))!.quality, 1);
  // Premium soil starts it off better.
  assert.ok(SOILS['soil-premium'] > SOILS.soil);
});

test('a saved grow section is made safe, whatever’s in it', () => {
  assert.deepEqual(loadGrow(null), initialGrow());
  assert.deepEqual(loadGrow({ pots: 'x' }).pots.length, START_POTS);
  const s = loadGrow({
    at: 5,
    pots: [
      { soil: 'soil', lamp: 'lamp-led', plant: { seed: 'seed-kush', growth: 9, water: -1, care: 'x', dry: 1e9, pests: true } },
      { soil: 'gold', lamp: 'sun', plant: { seed: 'seed-kush' } },
      { plant: { seed: 'nope' } },
      7,
      ...Array.from({ length: 20 }, () => ({})),
    ],
  });
  assert.equal(s.pots.length, MAX_POTS);
  assert.deepEqual(s.pots[0], { soil: 'soil', lamp: 'lamp-led', plant: { seed: 'seed-kush', growth: 3, water: 0, care: 0, dry: DIES_AFTER, pests: true } });
  assert.deepEqual(s.pots[1], {}, 'no plant without soil');
  assert.deepEqual(s.pots[2], {});
  assert.deepEqual(s.pots[3], {});
  assert.equal(s.at, 5);
});

// ---- On the server ---------------------------------------------------------------------------------

const A = 'account:ada';
const B = 'account:bob';

function office() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-office-grow-'));
  const chips = new Chips(dir, { saveAfter: 0 });
  const sent: { id: string; msg: ServerMsg }[] = [];
  const clock = { now: 1_000_000 };
  const bunker = new Bunker(dir, { chips, saveAfter: 0, now: () => clock.now, send: (id, msg) => sent.push({ id, msg }) });
  const act = (id: string, action: string, args?: unknown) => bunker.act(id, { feature: 'grow', action, args });
  const mine = (id = A) => bunker.state(id);
  /** Lets `secs` pass on the bunker's clock, ticking every 5 s like the office, with the dice for pests at `roll` (1: none ever). */
  const pass = (secs: number, roll = 1) => {
    const random = Math.random;
    Math.random = () => roll;
    try {
      for (let t = 0; t < secs; t += 5) {
        clock.now += 5000;
        bunker.tick();
      }
    } finally {
      Math.random = random;
    }
  };
  const toasts = (id = A) => sent.filter((s) => s.id === id && s.msg.t === 'bunker.event').map((s) => (s.msg as Extract<ServerMsg, { t: 'bunker.event' }>).event);
  return { dir, chips, bunker, sent, clock, act, mine, pass, toasts };
}

/** Puts supplies in `id`'s inventory, by acting once (so they have a bunker) and reaching in. */
function stock(o: ReturnType<typeof office>, id: string, items: Record<string, number>) {
  o.act(id, 'water', { pot: 0 });
  const me = (o.bunker as unknown as { people: Map<string, BunkerPerson> }).people.get(id)!;
  for (const [item, n] of Object.entries(items)) addItem(me.inventory, item, n);
}

test('everyone starts with four empty pots', () => {
  const o = office();
  assert.equal(o.mine().grow.pots.length, START_POTS);
  assert.deepEqual(o.mine().grow, grow.initial());
});

test('soil, a seed, water, the stages on the office’s clock, a toast when it’s ready, and the harvest into the stash', () => {
  const o = office();
  stock(o, A, { soil: 1, 'seed-skunk': 1, lamp: 1 });
  assert.equal(o.act(A, 'plant', { pot: 0, item: 'seed-skunk' }), false, 'soil first');
  assert.equal(o.act(A, 'soil', { pot: 0, item: 'seed-skunk' }), false, 'that’s not soil');
  assert.equal(o.act(A, 'soil', { pot: 0, item: 'soil' }), true);
  assert.equal(o.act(A, 'soil', { pot: 0, item: 'soil' }), false, 'it has soil');
  assert.equal(o.act(A, 'soil', { pot: 1, item: 'soil' }), false, 'none left');
  assert.equal(o.act(A, 'plant', { pot: 0, item: 'soil' }), false, 'that’s not a seed');
  assert.equal(o.act(A, 'plant', { pot: 9, item: 'seed-skunk' }), false, 'no such pot');
  assert.equal(o.act(A, 'plant', { pot: '0', item: 'seed-skunk' }), false);
  assert.equal(o.act(A, 'plant', { pot: 0, item: 'seed-skunk' }), true);
  assert.equal(o.act(A, 'lamp', { pot: 0, item: 'lamp' }), true);
  let s = o.mine();
  assert.equal(countItem(s.inventory, 'seed-skunk') + countItem(s.inventory, 'soil') + countItem(s.inventory, 'lamp'), 0, 'all used up');
  assert.equal(s.grow.pots[0].plant?.seed, 'seed-skunk');
  assert.equal(o.act(A, 'harvest', { pot: 0 }), false, 'not ready');
  // It grows on the clock, watered when it's thirsty.
  const stage = STRAINS['seed-skunk'].stage;
  for (let t = 0; t < 3 * stage + 20; t += 20) {
    o.pass(20);
    s = o.mine();
    if (s.grow.pots[0].plant!.water < 0.5) assert.equal(o.act(A, 'water', { pot: 0 }), true);
  }
  s = o.mine();
  assert.equal(stageOf(s.grow.pots[0].plant!), 'ready');
  assert.deepEqual(
    o.toasts().map((e) => e.key),
    ['grow.ready'],
  );
  assert.deepEqual(o.toasts()[0].params, { pot: 1 });
  assert.equal(o.act(A, 'water', { pot: 0 }), false, 'a ready plant needs nothing');
  assert.equal(o.act(A, 'harvest', { pot: 0 }), true);
  s = o.mine();
  assert.equal(s.products.length, 1);
  const [unit] = s.products;
  assert.equal(unit.product, 'weed-skunk');
  assert.equal(unit.pack, undefined, 'raw, for the packing table');
  assert.ok(unit.grams > 0 && unit.grams <= STRAINS['seed-skunk'].grams);
  assert.ok(unit.quality > 0.5 && unit.quality <= 1);
  assert.deepEqual(s.grow.pots[0], { lamp: 'lamp' }, 'the soil’s spent, the lamp stays');
  assert.equal(o.toasts().at(-1)?.key, 'grow.harvested');
  assert.equal(o.act(A, 'harvest', { pot: 0 }), false);
});

test('left dry it wilts and dies, with a toast each time; a dead plant is cleared out', () => {
  const o = office();
  stock(o, A, { soil: 1, 'seed-kush': 1 });
  o.act(A, 'soil', { pot: 2, item: 'soil' });
  o.act(A, 'plant', { pot: 2, item: 'seed-kush' });
  o.pass(WATER_LASTS);
  assert.deepEqual(
    o.toasts().map((e) => [e.key, e.level, e.params?.pot]),
    [['grow.dry', 'warn', 3]],
  );
  o.pass(DIES_AFTER + 10);
  assert.equal(o.mine().grow.pots[2].plant?.dead, true);
  assert.deepEqual(
    o.toasts().map((e) => e.key),
    ['grow.dry', 'grow.died'],
  );
  assert.equal(o.act(A, 'water', { pot: 2 }), false);
  assert.equal(o.act(A, 'harvest', { pot: 2 }), false);
  assert.equal(o.act(A, 'clear', { pot: 2 }), true);
  assert.deepEqual(o.mine().grow.pots[2], {});
  assert.equal(o.act(A, 'clear', { pot: 2 }), false);
});

test('pests come on the server’s clock and are sprayed off', () => {
  const o = office();
  stock(o, A, { soil: 1, 'seed-kush': 1 });
  o.act(A, 'soil', { pot: 0, item: 'soil' });
  o.act(A, 'plant', { pot: 0, item: 'seed-kush' });
  assert.equal(o.act(A, 'spray', { pot: 0 }), false, 'nothing to spray');
  o.pass(5, 0);
  assert.equal(o.mine().grow.pots[0].plant?.pests, true);
  assert.equal(o.toasts().at(-1)?.key, 'grow.pests');
  assert.equal(o.act(A, 'spray', { pot: 0 }), true);
  assert.equal(o.mine().grow.pots[0].plant?.pests, undefined);
});

test('lamps: hung from your inventory, swapped (the old one back on the shelf) and taken down again', () => {
  const o = office();
  stock(o, A, { lamp: 1, 'lamp-led': 1 });
  assert.equal(o.act(A, 'lamp', { pot: 0, item: 'none' }), false);
  assert.equal(o.act(A, 'lamp', { pot: 0, item: 'pot' }), false);
  assert.equal(o.act(A, 'lamp', { pot: 0, item: 'lamp' }), true);
  assert.equal(o.act(A, 'lamp', { pot: 0, item: 'lamp' }), false, 'already there, and none left');
  assert.equal(o.act(A, 'lamp', { pot: 0, item: 'lamp-led' }), true);
  let s = o.mine();
  assert.equal(s.grow.pots[0].lamp, 'lamp-led');
  assert.equal(countItem(s.inventory, 'lamp'), 1);
  assert.equal(countItem(s.inventory, 'lamp-led'), 0);
  assert.equal(o.act(A, 'unlamp', { pot: 0 }), true);
  s = o.mine();
  assert.equal(s.grow.pots[0].lamp, undefined);
  assert.equal(countItem(s.inventory, 'lamp-led'), 1);
  assert.equal(o.act(A, 'unlamp', { pot: 0 }), false);
});

test('more pots, bought at the PC, up to as many as the row holds', () => {
  const o = office();
  assert.equal(o.act(A, 'addPot'), false, 'none to set up');
  stock(o, A, { pot: 10 });
  for (let n = START_POTS; n < MAX_POTS; n++) assert.equal(o.act(A, 'addPot'), true);
  assert.equal(o.act(A, 'addPot'), false, 'the row’s full');
  const s = o.mine();
  assert.equal(s.grow.pots.length, MAX_POTS);
  assert.equal(countItem(s.inventory, 'pot'), 10 - (MAX_POTS - START_POTS));
});

test('your pots are yours: the plants grow per person, and keep growing while you’re not there', () => {
  const o = office();
  stock(o, A, { soil: 1, 'seed-kush': 1 });
  stock(o, B, {});
  o.act(A, 'soil', { pot: 0, item: 'soil' });
  o.act(A, 'plant', { pot: 0, item: 'seed-kush' });
  o.pass(60);
  assert.ok(o.mine(A).grow.pots[0].plant!.growth > 0);
  assert.equal(o.mine(B).grow.pots[0].plant, undefined);
  assert.equal(o.toasts(B).length, 0);
});

test('time the office was off doesn’t count, and the plants are saved and sent now and then while they grow', () => {
  const o = office();
  stock(o, A, { soil: 1, 'seed-kush': 1 });
  o.act(A, 'soil', { pot: 0, item: 'soil' });
  o.act(A, 'plant', { pot: 0, item: 'seed-kush' });
  o.pass(10);
  const g = o.mine().grow.pots[0].plant!.growth;
  o.clock.now += 3 * 3600_000; // The office was off for three hours.
  o.bunker.tick();
  const after = o.mine().grow.pots[0].plant!;
  assert.equal(after.growth, g);
  assert.ok(!after.dead);
  // Sent along at least once a minute while it grows.
  const before = o.sent.filter((s) => s.msg.t === 'bunker.state').length;
  o.pass(65);
  assert.ok(o.sent.filter((s) => s.msg.t === 'bunker.state').length > before);
  // And read back after a restart.
  o.bunker.flush();
  const again = new Bunker(o.dir, { chips: o.chips, saveAfter: 0 });
  assert.equal(again.state(A).grow.pots[0].plant?.seed, 'seed-kush');
});

test('the handler on its own: bad args and unknown actions change nothing', () => {
  const state: GrowState = initialGrow();
  const me = { inventory: {}, products: [], nextUnit: 1 } as unknown as BunkerPerson;
  const ctx = { id: A, now: 1, me, balance: () => 0, pay: () => false, spend: () => false, event() {} };
  for (const args of [undefined, null, 5, 'x', { pot: -1 }, { pot: 1.5 }, { pot: 0, item: 7 }]) {
    for (const action of ['soil', 'plant', 'water', 'spray', 'lamp', 'unlamp', 'harvest', 'clear', 'dance']) assert.equal(grow.act(ctx, state, action, args), false, `${action} ${JSON.stringify(args)}`);
  }
  assert.deepEqual(state.pots, initialGrow().pots);
});

// ---- On the page ---------------------------------------------------------------------------------------

const { buildGrow, potSlot } = await import('../src/client/world/drugbunker/grow.js');

test('the pots in 3D: yours, with soil, a plant growing up to its stage, the lamp you hung, inside the grow spot', () => {
  const spot = BUNKER_STATIONS.grow;
  const view = buildGrow(spot);
  const pot = (i: number) => view.group.getObjectByName(`grow-pot-${i}`)!;
  for (let i = 0; i < MAX_POTS; i++) {
    const at = potSlot(i, spot.w, spot.d);
    assert.ok(Math.abs(at.x) < spot.w / 2 && Math.abs(at.z) < spot.d / 2, `pot ${i} is in the spot`);
  }
  // Before the office has said: four empty pots.
  view.update!(0, 0.016, null);
  assert.deepEqual(
    Array.from({ length: MAX_POTS }, (_, i) => pot(i).visible),
    [true, true, true, true, false, false, false, false],
  );
  const mine = { inventory: {}, products: [], nextUnit: 1, grow: initialGrow() } as unknown as BunkerPerson;
  mine.grow.pots.push({});
  mine.grow.pots[0] = { soil: 'soil', lamp: 'lamp-led', plant: plant('seed-kush', { growth: 0.2 }) };
  mine.grow.pots[1] = { soil: 'soil-premium', plant: plant('seed-haze', { growth: 2.6 }) };
  view.update!(1, 0.016, mine);
  assert.ok(pot(4).visible && !pot(5).visible);
  const height = (i: number) => {
    const p = pot(i).getObjectByName('grow-plant')!;
    assert.ok(p.visible);
    p.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(p).max.y;
  };
  assert.ok(height(1) > height(0) + 0.3, 'the flowering one is much taller than the seedling');
  assert.equal(pot(2).getObjectByName('grow-plant')!.visible, false);
  // It goes on growing between the office's updates.
  const before = height(0);
  view.update!(200, 0.016, mine);
  assert.ok(height(0) > before);
  // Nothing of it reaches past the spot's height, and you can't walk into the pots (but can stand in front).
  view.group.updateMatrixWorld(true);
  assert.ok(new THREE.Box3().setFromObject(view.group).max.y <= spot.h + 0.05);
  const front = { x: spot.x + spot.d / 2 + 0.7, z: spot.z };
  const solid = (x: number, z: number) => view.colliders!.some((c) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ);
  const slot = potSlot(0, spot.w, spot.d);
  assert.ok(solid(spot.x + slot.z, spot.z - slot.x));
  assert.ok(!solid(front.x, front.z));
});

test('the panel’s words: stages, timers, icons, and every toast the server sends, in both languages', async () => {
  const { potStatus, clock, plantIcon, potNow } = await import('../src/client/ui/bunker/grow.js');
  const { setLang, t } = await import('../src/client/i18n/index.js');
  const { bunkerHelp } = await import('../src/client/ui/bunker/index.js');
  assert.equal(clock(0), '0:00');
  assert.equal(clock(187), '3:07');
  assert.equal(clock(3725), '1:02:05');
  assert.equal(plantIcon(undefined, false), '🪴');
  assert.equal(plantIcon(undefined, true), '🟫');
  assert.equal(plantIcon(plant('seed-kush', { growth: 1.5 }), true), '🌿');
  assert.equal(plantIcon(plant('seed-kush', { dead: true }), true), '🥀');
  for (const lang of ['en', 'de'] as const) {
    setLang(lang);
    for (const key of ['grow.ready', 'grow.dry', 'grow.pests', 'grow.died', 'grow.harvested', 'grow.stashFull']) {
      const text = t(`bunker.${key}` as Parameters<typeof t>[0], { pot: 2, grams: 12.5, quality: 80 });
      assert.doesNotMatch(text, /^bunker\.|\{/, `${key} in ${lang}`);
    }
    for (const s of GROW_STAGES) assert.doesNotMatch(potStatus({ soil: 'soil', lamp: 'lamp', plant: plant('seed-kush', { growth: GROW_STAGES.indexOf(s) + 0.5 }) }).stage, /^bunker\./);
    assert.match(bunkerHelp(), lang === 'en' ? /harvest/ : /ernte/);
  }
  setLang('en');
  const growing: Pot = { soil: 'soil', lamp: 'lamp', plant: plant('seed-kush', { growth: 2 }) };
  assert.deepEqual(potStatus(growing), { stage: 'Flowering', timer: `ready in ${clock(STRAINS['seed-kush'].stage)}` });
  assert.equal(potStatus({ soil: 'soil', plant: plant('seed-kush', { water: 0, dry: 5 }) }).timer, 'not growing');
  assert.equal(potStatus({}).stage, 'Empty: fill it with soil');
  // The timer counts down between the office's updates, without touching what the office sent.
  const later = potNow(growing, 30);
  assert.ok(later.plant!.growth > 2 && growing.plant!.growth === 2);
});
