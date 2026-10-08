// The bunker's packing table (#121): loose product weighed on the scale into bags, jars and bricks,
// the scoops rolled by the office, light units remembering their real weight, the packing machine's
// batches, and the table and panel as the page builds them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { BUNKER_STATIONS, addItem, addUnit, type BunkerEvent, type BunkerPerson } from '../src/shared/bunker/index.js';
import { bunkerItem } from '../src/shared/bunker/items.js';
import { CARTEL_PACKS, MACHINE_BATCH, PACKS, PACK_MACHINE, benchTarget, looseUnits, packHolds, packedStacks, reading, shortBy, startProblem, type PackState } from '../src/shared/bunker/pack.js';
import { BUNKER_HANDLERS, Bunker } from '../src/server/bunker/index.js';
import type { BunkerCtx } from '../src/server/bunker/feature.js';
import { makePack, pack } from '../src/server/bunker/pack.js';
import type { ServerMsg } from '../src/shared/protocol.js';

// A canvas that draws nothing: enough for the scale's display to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) =>
      k === 'measureText'
        ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
        : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern'
          ? () => ({ addColorStop() {} })
          : noop(),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

/** Someone with `grams` of loose Bunker Kush at quality 0.8 (unit u1), and `bags` of each packaging. */
function person(grams = 50, bags = 20): BunkerPerson {
  const me = { inventory: {}, products: [], nextUnit: 1, ...Object.fromEntries(Object.entries(BUNKER_HANDLERS).map(([f, h]) => [f, h.initial()])) } as unknown as BunkerPerson;
  addUnit(me, { product: 'weed-kush', quality: 0.8, grams });
  for (const p of PACKS) addItem(me.inventory, p, bags);
  return me;
}

function ctxOf(me: BunkerPerson) {
  const events: BunkerEvent[] = [];
  const ctx: BunkerCtx = {
    id: 'a',
    now: 0,
    me,
    balance: () => 0,
    pay: () => false,
    spend: () => false,
    event: (key, params, level) => events.push({ key, ...(params ? { params } : {}), ...(level ? { level } : {}) }),
  };
  return { ctx, events };
}

/** The table with scoops that are always `r` of the way between a scoop's least and most. */
const fixed = (r: number) => makePack(() => r);

// ---- What there is ---------------------------------------------------------------------------------------

test('the packagings: little bag 1 g, bag 5 g, jar 20 g and the brick of 500 g for the cartel, and the machine is for sale', () => {
  assert.deepEqual(
    PACKS.map((p) => [p, packHolds(p)]),
    [
      ['bag', 1],
      ['bag-big', 5],
      ['jar', 20],
      ['brick', 500],
    ],
  );
  for (const p of PACKS) assert.equal(bunkerItem(p)?.kind, 'packaging');
  assert.deepEqual([...CARTEL_PACKS], ['brick']);
  const machine = bunkerItem(PACK_MACHINE);
  assert.ok(machine && machine.price > 0 && machine.kind === 'equipment');
  assert.ok(MACHINE_BATCH > 1);
});

test('the scale reads low, under, on or over against its target', () => {
  assert.equal(reading(0, 5), 'low');
  assert.equal(reading(2.4, 5), 'low');
  assert.equal(reading(4.5, 5), 'under');
  assert.equal(reading(4.95, 5), 'on');
  assert.equal(reading(5.1, 5), 'on');
  assert.equal(reading(5.3, 5), 'over');
});

test('what the table will start with: a loose unit, a packaging you have enough of, and the machine for more than one', () => {
  const me = person();
  assert.equal(startProblem(me, 'u1', 'bag', 1), null);
  assert.equal(startProblem(me, 'u9', 'bag', 1), 'noUnit');
  assert.equal(startProblem(me, 'u1', 'soil', 1), 'noPack');
  assert.equal(startProblem(me, 'u1', 'bag', 0), 'badCount');
  assert.equal(startProblem(me, 'u1', 'bag', 1.5), 'badCount');
  assert.equal(startProblem(me, 'u1', 'bag', 3), 'noMachine');
  addItem(me.inventory, PACK_MACHINE, 1);
  assert.equal(startProblem(me, 'u1', 'bag', 3), null);
  assert.equal(startProblem(me, 'u1', 'bag', MACHINE_BATCH + 1), 'badCount');
  assert.equal(startProblem(me, 'u1', 'brick', 1), null);
  me.inventory.brick = 0;
  assert.equal(startProblem(me, 'u1', 'brick', 1), 'noBags');
  // A packed unit isn't loose: it doesn't go on the scale again.
  addUnit(me, { product: 'weed-kush', quality: 1, grams: 5, pack: 'bag-big' });
  assert.deepEqual(
    looseUnits(me).map((u) => u.id),
    ['u1'],
  );
  assert.equal(startProblem(me, 'u2', 'bag', 1), 'noUnit');
});

// ---- Packing ---------------------------------------------------------------------------------------------

test('scoop to the target and seal: a unit of the same product and quality, off the loose one, the bag used', () => {
  const me = person(50);
  const { ctx, events } = ctxOf(me);
  const table = fixed(0.5); // a big scoop is 35 % of the target, a scoop 10 %, a pinch 2 %
  const s = me.pack;
  assert.equal(table.act(ctx, s, 'start', { from: 'u1', pack: 'bag-big' }), true);
  assert.deepEqual(s.bench, { from: 'u1', pack: 'bag-big', count: 1, grams: 0 });
  assert.equal(table.act(ctx, s, 'seal', undefined), false, 'nothing on the scale');
  assert.equal(events.at(-1)?.key, 'pack.tooLight');
  for (const scoop of ['big', 'big', 'scoop', 'scoop', 'pinch', 'pinch', 'pinch', 'pinch', 'pinch']) table.act(ctx, s, 'add', scoop);
  assert.equal(s.bench!.grams, 5); // 1.75 + 1.75 + 0.5 + 0.5 + 5 × 0.1
  assert.equal(table.act(ctx, s, 'seal', undefined), true);
  assert.equal(events.at(-1)?.key, 'pack.sealed');
  const packed = me.products.find((u) => u.pack)!;
  assert.deepEqual({ ...packed, id: undefined }, { id: undefined, product: 'weed-kush', quality: 0.8, grams: 5, pack: 'bag-big' });
  assert.equal(me.products.find((u) => u.id === 'u1')!.grams, 45);
  assert.equal(me.inventory['bag-big'], 19);
  // The table's ready for the next one.
  assert.deepEqual(s.bench, { from: 'u1', pack: 'bag-big', count: 1, grams: 0 });
});

test('a bit over is given away into the bag, and under makes a light unit that remembers its real weight', () => {
  const me = person(50);
  const { ctx, events } = ctxOf(me);
  const table = fixed(1); // a big scoop is 45 % of the target
  const s = me.pack;
  table.act(ctx, s, 'start', { from: 'u1', pack: 'jar' });
  for (let i = 0; i < 3; i++) table.act(ctx, s, 'add', 'big');
  assert.equal(s.bench!.grams, 27);
  table.act(ctx, s, 'seal', undefined);
  assert.equal(events.at(-1)?.key, 'pack.sealedOver');
  assert.equal(events.at(-1)?.params?.over, 7);
  const over = me.products.find((u) => u.pack === 'jar')!;
  assert.equal(over.grams, 27);
  assert.equal(shortBy(over), 0);
  assert.equal(me.products.find((u) => u.id === 'u1')!.grams, 23, 'the extra came off the loose product too');

  // Under: two big scoops is 18 of 20 g.
  table.act(ctx, s, 'add', 'big');
  table.act(ctx, s, 'add', 'big');
  table.act(ctx, s, 'seal', undefined);
  assert.equal(events.at(-1)?.key, 'pack.sealedUnder');
  assert.equal(events.at(-1)?.level, 'warn');
  const light = me.products.filter((u) => u.pack === 'jar')[1];
  assert.equal(light.grams, 18);
  assert.equal(shortBy(light), 2);
});

test('tipping back, clearing the table, and the scale never taking more than there is or than it holds', () => {
  const me = person(3);
  const { ctx, events } = ctxOf(me);
  const table = fixed(1);
  const s = me.pack;
  table.act(ctx, s, 'start', { from: 'u1', pack: 'bag-big' });
  table.act(ctx, s, 'add', 'big');
  assert.equal(s.bench!.grams, 2.25);
  assert.equal(table.act(ctx, s, 'empty', undefined), true);
  assert.equal(s.bench!.grams, 0);
  assert.equal(table.act(ctx, s, 'empty', undefined), false);
  // Only 3 g of it: the scale stops there.
  table.act(ctx, s, 'add', 'big');
  table.act(ctx, s, 'add', 'big');
  assert.equal(s.bench!.grams, 3);
  assert.equal(table.act(ctx, s, 'add', 'pinch'), false);
  assert.equal(events.at(-1)?.key, 'pack.noMore');
  assert.equal(table.act(ctx, s, 'add', 'shovel'), false, 'not a scoop');
  // Sealing all of it uses up the loose unit, and the table clears.
  table.act(ctx, s, 'seal', undefined);
  assert.equal(
    me.products.find((u) => u.id === 'u1'),
    undefined,
  );
  assert.equal(s.bench, null);
  assert.equal(table.act(ctx, s, 'stop', undefined), false);

  // A big enough unit: the scale takes no more than half again its target.
  const me2 = person(100);
  const two = ctxOf(me2);
  table.act(two.ctx, me2.pack, 'start', { from: 'u1', pack: 'bag' });
  for (let i = 0; i < 5; i++) table.act(two.ctx, me2.pack, 'add', 'big');
  assert.equal(me2.pack.bench!.grams, 1.5);
  assert.equal(two.events.at(-1)?.key, 'pack.full');
  assert.equal(table.act(two.ctx, me2.pack, 'stop', undefined), true);
  assert.equal(me2.pack.bench, null);
  assert.equal(me2.products[0].grams, 100, 'clearing the table puts it all back');
});

test('the packing machine packs several at once, the grams shared out between them', () => {
  const me = person(60);
  addItem(me.inventory, PACK_MACHINE, 1);
  const { ctx, events } = ctxOf(me);
  const table = fixed(0.5);
  const s = me.pack;
  assert.equal(table.act(ctx, s, 'start', { from: 'u1', pack: 'bag-big', count: 4 }), true);
  assert.equal(benchTarget(s.bench!), 20);
  for (let i = 0; i < 2; i++) table.act(ctx, s, 'add', 'big'); // 7 + 7
  for (let i = 0; i < 6; i++) table.act(ctx, s, 'add', 'scoop'); // + 6 × 2
  assert.equal(s.bench!.grams, 26);
  table.act(ctx, s, 'seal', undefined);
  const bags = me.products.filter((u) => u.pack === 'bag-big');
  assert.equal(bags.length, 4);
  for (const b of bags) assert.equal(b.grams, 6.5);
  assert.equal(me.inventory['bag-big'], 16);
  assert.equal(events.at(-1)?.key, 'pack.sealedOver');
  // They stack.
  assert.deepEqual(
    packedStacks(me.products).map((st) => [st.product, st.pack, st.quality, st.ids.length, st.grams]),
    [['weed-kush', 'bag-big', 0.8, 4, 26]],
  );
  // Without the machine, one at a time.
  const me2 = person();
  const two = ctxOf(me2);
  assert.equal(table.act(two.ctx, me2.pack, 'start', { from: 'u1', pack: 'bag', count: 2 }), false);
  assert.equal(two.events.at(-1)?.key, 'pack.noMachine');
  assert.equal(me2.pack.bench, null);
});

test('when the loose product goes elsewhere mid-packing, the table clears instead of packing nothing', () => {
  const me = person(10);
  const { ctx, events } = ctxOf(me);
  const table = fixed(0.5);
  table.act(ctx, me.pack, 'start', { from: 'u1', pack: 'bag' });
  table.act(ctx, me.pack, 'add', 'big');
  me.products = []; // sold, say
  assert.equal(table.act(ctx, me.pack, 'seal', undefined), true);
  assert.equal(me.pack.bench, null);
  assert.equal(events.at(-1)?.key, 'pack.gone');
  assert.equal(me.inventory.bag, 20, 'no bag used');
});

test('the saved table is made safe, and unknown actions do nothing', () => {
  assert.deepEqual(pack.initial(), { bench: null });
  assert.deepEqual(pack.load(undefined), { bench: null });
  assert.deepEqual(pack.load({ bench: 'x' }), { bench: null });
  assert.deepEqual(pack.load({ bench: { from: 'u1', pack: 'crate', count: 1, grams: 1 } }), { bench: null });
  assert.deepEqual(pack.load({ bench: { from: 'u1', pack: 'bag', count: 99, grams: 1 } }), { bench: null });
  assert.deepEqual(pack.load({ bench: { from: 'u1', pack: 'bag', count: 1, grams: 1e9 } }), { bench: { from: 'u1', pack: 'bag', count: 1, grams: 1.5 } });
  assert.deepEqual(pack.load({ bench: { from: 'u1', pack: 'jar', count: 2, grams: -3 } }), { bench: { from: 'u1', pack: 'jar', count: 2, grams: 0 } });
  const me = person();
  const { ctx } = ctxOf(me);
  assert.equal(pack.act(ctx, me.pack, 'anything', undefined), false);
  assert.equal(pack.act(ctx, me.pack, 'start', null), false);
  assert.equal(pack.tick(ctx, me.pack), false);
});

test('through the office: bunker.act at the table changes their bunker and toasts by its keys', () => {
  const sent: ServerMsg[] = [];
  const bunker = new Bunker(mkdtempSync(path.join(os.tmpdir(), 'bunker-pack-')), {
    chips: { balance: () => 0, award: () => true, bet: () => true },
    send: (_id, msg) => sent.push(msg),
    saveAfter: 1e9,
    handlers: { pack: fixed(0.5) },
  });
  assert.equal(bunker.act('a', { feature: 'pack', action: 'start', args: { from: 'u1', pack: 'bag' } }), false);
  const ev = sent.at(-1);
  assert.ok(ev?.t === 'bunker.event' && ev.event.key === 'pack.noUnit');
  bunker.stop();
  bunker.flush();
});

// ---- On the page -----------------------------------------------------------------------------------------

test('the table: a scale whose heap grows with what you weigh, the packaging open beside it, the machine once bought', async () => {
  const { buildPack, displayGrams } = await import('../src/client/world/drugbunker/pack.js');
  const view = buildPack(BUNKER_STATIONS.pack);
  const heap = view.group.getObjectByName('pack-heap')!;
  const machine = view.group.getObjectByName('pack-machine')!;
  const packing = view.group.getObjectByName('pack-packing')!;
  assert.ok(view.colliders?.length);
  view.update!(0, 0.016, null);
  assert.equal(heap.visible, false);
  assert.equal(machine.visible, false);
  const me = person();
  (me.pack as PackState).bench = { from: 'u1', pack: 'jar', count: 1, grams: 5 };
  view.update!(1, 0.016, me);
  assert.equal(heap.visible, true);
  const small = heap.scale.x;
  (me.pack as PackState).bench!.grams = 20;
  view.update!(2, 0.016, me);
  assert.ok(heap.scale.x > small);
  assert.equal(packing.children.filter((c) => c.visible).length, 1);
  addItem(me.inventory, PACK_MACHINE, 1);
  view.update!(3, 0.016, me);
  assert.equal(machine.visible, true);
  // It stays inside its spot.
  const b = new THREE.Box3().setFromObject(view.group);
  const spot = BUNKER_STATIONS.pack;
  assert.ok(b.max.x - b.min.x <= spot.w + 1e-6 && b.max.z - b.min.z <= spot.d + 1e-6 && b.max.y <= spot.h + 0.25, 'the machine on the table stands a little over it, no more');
  assert.deepEqual([displayGrams(0.5), displayGrams(120.25), displayGrams(5000)], ['0.50', '120.3', '5000']);
});

test("the table's texts are there in both languages, and its help goes in the bunker's", async () => {
  const { setLang, t } = await import('../src/client/i18n/index.js');
  const { bunkerHelp } = await import('../src/client/ui/bunker/index.js');
  const table = (await import('../src/client/i18n/bunker/pack.js')).default;
  assert.deepEqual(Object.keys(table.de).sort(), Object.keys(table.en).sort());
  const keys = ['noUnit', 'noPack', 'noBags', 'noMachine', 'badCount', 'gone', 'noMore', 'full', 'tooLight', 'shelfFull', 'sealed', 'sealedOver', 'sealedUnder'];
  for (const lang of ['en', 'de'] as const) {
    setLang(lang);
    for (const k of keys) assert.doesNotMatch(t(`bunker.pack.${k}` as never, { count: 2, grams: 0.98, target: 1, over: 0.5, under: 0.02, min: 0.5 }), /^bunker\.|\{|undefined/, `${k} in ${lang}`);
    assert.match(bunkerHelp(), lang === 'en' ? /packing table/ : /Packtisch/);
  }
  assert.match(t('bunker.pack.sealedUnder' as never, { count: 1, grams: 0.98, under: 0.02, target: 1 }), /0,98 g/);
  setLang('en');
});
