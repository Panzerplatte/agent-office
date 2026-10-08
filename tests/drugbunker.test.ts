// The bunker under the casino (#118): its place and layout, the ladder from the casino's secret room,
// everyone's bunker on the server (bunker.json, the features' dispatch, the chips), the room as the
// page builds it, and its panels. (tests/bunker.test.ts is the floor's bunker look, a different thing.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { WebSocket } from 'ws';
import {
  BUNKER,
  BUNKER_FEATURES,
  BUNKER_LADDER,
  BUNKER_ROOM,
  BUNKER_STATIONS,
  BUNKER_STATION_IDS,
  STATION_REACH,
  addItem,
  addUnit,
  atBunkerLadder,
  bunkerBuyReason,
  bunkerReasonOf,
  bunkerSaleReason,
  bunkerWalkable,
  countItem,
  ladderBox,
  stationBox,
  stationFront,
  takeItem,
  takeUnit,
  type BunkerPerson,
} from '../src/shared/bunker/index.js';
import { ITEMS, PRODUCTS, bunkerItem, productKind, productValue } from '../src/shared/bunker/items.js';
import { CASINO, SECRET_DOOR, SECRET_HATCH, SECRET_ROOM, casinoWalkable } from '../src/shared/casino.js';
import { inDoorway } from '../src/shared/secretdoor.js';
import { Chips } from '../src/server/chips.js';
import { BUNKER_HANDLERS, Bunker } from '../src/server/bunker/index.js';
import type { BunkerFeatureHandler } from '../src/server/bunker/feature.js';
import { START_CHIPS } from '../src/shared/chips.js';
import type { ServerMsg } from '../src/shared/protocol.js';

// A canvas that draws nothing: enough for the rooms' textures and signs to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

const R = BUNKER_ROOM;
const box = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0) => ({ minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad });
const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

// ---- The place and its layout ---------------------------------------------------------------------------

test('the bunker is a place of its own, like the roof and the casino: never a project floor', () => {
  assert.equal(BUNKER, '@bunker');
  assert.notEqual(BUNKER, CASINO);
  assert.doesNotMatch(BUNKER, /^[a-z0-9-]+$/);
  assert.deepEqual([...BUNKER_FEATURES], ['grow', 'lab', 'pack', 'pc', 'customers', 'cartel']);
  assert.deepEqual([...BUNKER_STATION_IDS].sort(), [...BUNKER_FEATURES, 'stash'].sort());
});

test('every station has its own spot in the room, clear of the others and the ladder, with room to stand in front', () => {
  for (const id of BUNKER_STATION_IDS) {
    const b = stationBox(BUNKER_STATIONS[id]);
    assert.ok(b.minX >= R.minX - 1e-9 && b.maxX <= R.maxX + 1e-9 && b.minZ >= R.minZ - 1e-9 && b.maxZ <= R.maxZ + 1e-9, `${id} is inside the room`);
    assert.ok(!overlap(box(b), box(ladderBox(), 0.3)), `${id} is clear of the ladder`);
    for (const other of BUNKER_STATION_IDS) if (other !== id) assert.ok(!overlap(box(b, 0.2), box(stationBox(BUNKER_STATIONS[other]))), `${id} and ${other} don't overlap`);
    // Where you stand to use it: on the floor, outside its spot, and within reach of it.
    const front = stationFront(BUNKER_STATIONS[id]);
    assert.ok(bunkerWalkable(front.x, front.z), `you can stand in front of ${id}`);
    assert.ok(front.x < b.minX || front.x > b.maxX || front.z < b.minZ || front.z > b.maxZ, `${id}'s front is outside it`);
    assert.ok(STATION_REACH > 0.7);
  }
  // The grow area is the long one, a row of pots down a wall.
  assert.ok(BUNKER_STATIONS.grow.w >= 5);
});

test('you can walk round the bunker, but not into its walls or the ladder', () => {
  assert.ok(bunkerWalkable(0, 0));
  assert.ok(bunkerWalkable(BUNKER_LADDER.foot.x, BUNKER_LADDER.foot.z), 'at the foot of the ladder');
  assert.ok(atBunkerLadder(BUNKER_LADDER.foot.x, BUNKER_LADDER.foot.z), 'near enough to climb it from there');
  assert.ok(!atBunkerLadder(0, 0));
  assert.ok(!bunkerWalkable(R.maxX - 0.1, 0));
  assert.ok(!bunkerWalkable(0, R.minZ + 0.1));
  assert.ok(!bunkerWalkable(BUNKER_LADDER.x, R.minZ + 0.2), 'not through the ladder');
  assert.ok(!bunkerWalkable(NaN, 0));
});

test("the hatch is in the secret room's floor, clear of its door, and you can walk up to it but not into it", () => {
  const K = SECRET_HATCH;
  const Q = SECRET_ROOM;
  assert.ok(K.x - K.size / 2 > Q.minX && K.x + K.size / 2 < Q.maxX && K.z - K.size / 2 > Q.minZ && K.z + K.size / 2 < Q.maxZ, 'inside the room');
  // Not where the door swings, either way.
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) assert.ok(!inDoorway(K.x + (dx * K.size) / 2, K.z + (dz * K.size) / 2, 1, 0), 'clear of the door');
  assert.ok(Math.abs(K.x - SECRET_DOOR.x) > K.size / 2);
  assert.equal(casinoWalkable(K.x, K.z, 0.3, true), false, 'not into the hole');
  // In the room, right in front of it, near enough to climb down.
  const at = { x: K.x + 0.35, z: K.z - K.size / 2 - 0.55 };
  assert.ok(casinoWalkable(at.x, at.z, 0.3, true));
  assert.ok(Math.hypot(at.x - K.x, at.z - K.z) < K.reach);
});

// ---- What's in it -------------------------------------------------------------------------------------

test('the catalog: every item and product has an id of its own, names, a price, and seeds grow a product', () => {
  const ids = new Set<string>();
  for (const i of ITEMS) {
    assert.ok(!ids.has(i.id), `${i.id} once`);
    ids.add(i.id);
    assert.ok(i.name.en && i.name.de && i.icon);
    assert.ok(Number.isSafeInteger(i.price) && i.price > 0, `${i.id} has a price in whole chips`);
    if (i.kind === 'seed') assert.ok(productKind(i.grows), `${i.id} grows something`);
    if (i.kind === 'packaging') assert.ok((i.holds ?? 0) > 0);
  }
  for (const p of PRODUCTS) {
    assert.ok(!ids.has(p.id), `${p.id} once`);
    ids.add(p.id);
    assert.ok(p.basePrice > 0 && p.addictiveness >= 0 && p.addictiveness <= 1);
  }
  assert.ok(PRODUCTS.filter((p) => p.source === 'lab').length >= 2, 'a few lab products');
  assert.ok(PRODUCTS.filter((p) => p.source === 'grow').length >= 2, 'weed of a few strains');
  assert.equal(bunkerItem('nope'), undefined);
  assert.equal(bunkerItem(3), undefined);
  const kush = productKind('weed-kush')!;
  assert.equal(productValue(kush, 1, 10), kush.basePrice * 10);
  assert.equal(productValue(kush, 0, 10), Math.round(kush.basePrice * 5));
  assert.equal(productValue(kush, 7, 10), productValue(kush, 1, 10), 'quality tops out at 1');
});

test('the inventory: whole numbers in, never more out than there is', () => {
  const inv: Record<string, number> = {};
  assert.equal(addItem(inv, 'soil', 3), true);
  assert.equal(addItem(inv, 'soil', 0), false);
  assert.equal(addItem(inv, 'soil', 1.5), false);
  assert.equal(countItem(inv, 'soil'), 3);
  assert.equal(countItem(inv, 'toString'), 0, "nothing's there by accident");
  assert.equal(takeItem(inv, 'soil', 4), false);
  assert.equal(takeItem(inv, 'soil', 3), true);
  assert.deepEqual(inv, {});
  const me = { products: [], nextUnit: 1 } as unknown as BunkerPerson;
  const a = addUnit(me, { product: 'weed-kush', quality: 1.4, grams: 5 })!;
  const b = addUnit(me, { product: 'glimmer', quality: 0.5, grams: 1, pack: 'bag' })!;
  assert.deepEqual([a.id, b.id, a.quality], ['u1', 'u2', 1]);
  assert.equal(addUnit(me, { product: 'weed-kush', quality: 1, grams: 0 }), null);
  assert.equal(takeUnit(me, 'u1')?.product, 'weed-kush');
  assert.equal(takeUnit(me, 'u1'), null);
  assert.deepEqual(me.products.map((u) => u.id), ['u2']);
});

test("the chips ledger's reasons for the bunker say what was bought, or who it was sold to", () => {
  assert.equal(bunkerBuyReason('seed-kush'), 'bunker:buy:seed-kush');
  assert.equal(bunkerSaleReason('c7'), 'bunker:sale:c7');
  assert.deepEqual(bunkerReasonOf('bunker:buy:seed-kush'), { what: 'buy', of: 'seed-kush' });
  assert.deepEqual(bunkerReasonOf('bunker:sale:c7'), { what: 'sale', of: 'c7' });
  assert.equal(bunkerReasonOf('shop:crown'), undefined);
  assert.ok(bunkerBuyReason('brick').length <= 40, 'short enough for the ledger');
});

// ---- On the server --------------------------------------------------------------------------------------

const A = 'account:ada';
const B = 'browser:0123456789abcdef0123';

/** A bunker and the chips in a fresh folder, with `handlers` swapped in and every message it sent. */
function office(handlers: Partial<typeof BUNKER_HANDLERS> = {}, dir = mkdtempSync(path.join(os.tmpdir(), 'agent-office-bunker-'))) {
  const chips = new Chips(dir, { saveAfter: 0 });
  const sent: { id: string; msg: ServerMsg }[] = [];
  const bunker = new Bunker(dir, { chips, saveAfter: 0, handlers, send: (id, msg) => sent.push({ id, msg }) });
  return { dir, chips, bunker, sent };
}

/** A grow handler for the tests: "plant" plants seeds, "sell" sells a unit, ticks water the plants. */
interface TestGrow {
  planted: string[];
  water: number;
}
const testGrow: BunkerFeatureHandler<TestGrow> = {
  initial: () => ({ planted: [], water: 0 }),
  load: (raw) => {
    const r = raw as Partial<TestGrow>;
    return { planted: Array.isArray(r.planted) ? r.planted.filter((x) => typeof x === 'string') : [], water: typeof r.water === 'number' ? r.water : 0 };
  },
  act(ctx, state, action, args) {
    if (action === 'buy') {
      if (!ctx.spend(40, bunkerBuyReason('seed-kush'))) return false;
      return addItem(ctx.me.inventory, 'seed-kush', 1);
    }
    if (action === 'plant' && typeof args === 'string' && takeItem(ctx.me.inventory, args, 1)) {
      state.planted.push(args);
      ctx.event('grow.planted', { seed: args });
      return true;
    }
    if (action === 'harvest') return !!addUnit(ctx.me, { product: 'weed-kush', quality: 0.8, grams: 10 });
    if (action === 'sell') {
      const unit = takeUnit(ctx.me, String(args));
      return !!unit && ctx.pay(100, bunkerSaleReason('c1'));
    }
    if (action === 'boom') throw new Error('boom');
    return false;
  },
  tick(_ctx, state) {
    if (!state.planted.length) return false;
    state.water++;
    return true;
  },
};

test('someone new has an empty bunker, with every feature starting from its own initial state', () => {
  const { bunker } = office();
  const s = bunker.state(A);
  assert.deepEqual(s.inventory, {});
  assert.deepEqual(s.products, []);
  for (const f of BUNKER_FEATURES) assert.deepEqual(s[f], BUNKER_HANDLERS[f].initial(), `${f} starts as it says`);
  assert.equal(bunker.has(A), false, "nothing's kept until they do something");
});

test('bunker.act goes to its feature, and only a real feature and a plain action name get there', () => {
  const { bunker, sent } = office({ grow: testGrow });
  const before = bunker.state(A);
  before.inventory.x = 9; // a copy: theirs doesn't change
  assert.equal(bunker.state(A).inventory.x, undefined);
  // Through the stub features nothing happens.
  for (const f of BUNKER_FEATURES.filter((f) => f !== 'grow')) assert.equal(bunker.act(A, { feature: f, action: 'anything' }), false);
  assert.equal(bunker.act(A, { feature: 'casino', action: 'buy' }), false);
  assert.equal(bunker.act(A, { feature: 'grow', action: '' }), false);
  assert.equal(bunker.act(A, { feature: 'grow', action: { toString: () => 'buy' } }), false);
  assert.equal(bunker.act(A, { feature: 'grow', action: 'x'.repeat(80) }), false);
  assert.equal(sent.length, 0);
  // The feature's own: it changes their state, and their pages are sent it.
  assert.equal(bunker.act(A, { feature: 'grow', action: 'buy' }), true);
  assert.equal(bunker.act(A, { feature: 'grow', action: 'plant', args: 'seed-kush' }), true);
  assert.equal(bunker.act(A, { feature: 'grow', action: 'plant', args: 'seed-kush' }), false, 'no seeds left');
  const s = bunker.state(A) as BunkerPerson & { grow: TestGrow };
  assert.deepEqual(s.grow.planted, ['seed-kush']);
  assert.deepEqual(s.inventory, {});
  assert.deepEqual(
    sent.map((m) => [m.id, m.msg.t]),
    [
      [A, 'bunker.state'],
      [A, 'bunker.event'],
      [A, 'bunker.state'],
    ],
  );
  assert.deepEqual((sent[1].msg as Extract<ServerMsg, { t: 'bunker.event' }>).event, { key: 'grow.planted', params: { seed: 'seed-kush' } });
  // Someone else's is their own.
  assert.deepEqual(bunker.state(B).inventory, {});
  // A feature that throws changes nothing and stops nothing.
  assert.equal(bunker.act(A, { feature: 'grow', action: 'boom' }), false);
});

test('buying and selling down here goes through the chips ledger, with bunker reasons', () => {
  const { bunker, chips, sent } = office({ grow: testGrow });
  assert.equal(bunker.act(A, { feature: 'grow', action: 'buy' }), true);
  assert.equal(chips.balance(A), START_CHIPS - 40);
  assert.equal(chips.ledger(A)[0].reason, 'bunker:buy:seed-kush');
  bunker.act(A, { feature: 'grow', action: 'harvest' });
  const unit = bunker.state(A).products[0];
  assert.deepEqual([unit.product, unit.grams, unit.quality], ['weed-kush', 10, 0.8]);
  assert.equal(bunker.act(A, { feature: 'grow', action: 'sell', args: unit.id }), true);
  assert.equal(chips.balance(A), START_CHIPS - 40 + 100);
  assert.deepEqual(chips.ledger(A).map((e) => [e.amount, e.reason]), [
    [100, 'bunker:sale:c1'],
    [-40, 'bunker:buy:seed-kush'],
  ]);
  assert.deepEqual(bunker.state(A).products, []);
  // Never more than they have: a purchase they can't pay for changes nothing.
  assert.equal(bunker.spendChips(B, START_CHIPS + 1, bunkerBuyReason('lamp')), false);
  assert.equal(chips.balance(B), START_CHIPS);
  assert.equal(bunker.payChips(B, 0, bunkerSaleReason('c1')), false);
  assert.equal(bunker.payChips(B, 25, bunkerSaleReason('c1')), true);
  assert.equal(chips.balance(B), START_CHIPS + 25);
  assert.ok(sent.every((m) => m.id === A));
});

test("time passes for everyone's features on the tick, and only who changed is sent it", () => {
  const { bunker, sent } = office({ grow: testGrow });
  bunker.act(A, { feature: 'grow', action: 'buy' });
  bunker.act(A, { feature: 'grow', action: 'plant', args: 'seed-kush' });
  bunker.act(B, { feature: 'grow', action: 'buy' });
  sent.length = 0;
  bunker.tick();
  bunker.tick();
  assert.equal((bunker.state(A) as BunkerPerson & { grow: TestGrow }).grow.water, 2);
  assert.equal((bunker.state(B) as BunkerPerson & { grow: TestGrow }).grow.water, 0);
  assert.deepEqual(sent.map((m) => m.id), [A, A]);
});

test("everyone's bunker is saved in bunker.json and comes back after a restart, made safe", () => {
  const first = office({ grow: testGrow });
  first.bunker.act(A, { feature: 'grow', action: 'buy' });
  first.bunker.act(A, { feature: 'grow', action: 'plant', args: 'seed-kush' });
  first.bunker.act(A, { feature: 'grow', action: 'harvest' });
  first.bunker.act(A, { feature: 'grow', action: 'buy' });
  first.bunker.act('conn:abc', { feature: 'grow', action: 'buy' });
  first.bunker.flush();
  const file = path.join(first.dir, 'bunker.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(saved.people), [A], "a page that couldn't keep a key isn't saved");
  const again = office({ grow: testGrow }, first.dir).bunker;
  const s = again.state(A) as BunkerPerson & { grow: TestGrow };
  assert.deepEqual(s.inventory, { 'seed-kush': 1 });
  assert.deepEqual(s.grow.planted, ['seed-kush']);
  assert.deepEqual(s.products.map((u) => u.id), ['u1']);
  // The next unit doesn't take an id that's there already.
  again.act(A, { feature: 'grow', action: 'harvest' });
  assert.deepEqual(again.state(A).products.map((u) => u.id), ['u1', 'u2']);
  for (const f of BUNKER_FEATURES.filter((f) => f !== 'grow')) assert.deepEqual(s[f], BUNKER_HANDLERS[f].initial());

  // A hand-edited file: what doesn't make sense is dropped, the rest kept.
  writeFileSync(
    file,
    JSON.stringify({
      people: {
        [B]: {
          inventory: { soil: 2, pot: -1, lamp: 1.5, bag: 'x' },
          products: [{ id: 'u5', product: 'fizz', quality: 3, grams: 2 }, { id: 'u5', product: 'fizz', quality: 1, grams: 2 }, { id: 'u6', product: 'fizz', quality: 1, grams: -2 }, null],
          nextUnit: 2,
          grow: 'nonsense',
        },
        'conn:x': { inventory: { soil: 1 } },
      },
    }),
  );
  const edited = office({ grow: testGrow }, first.dir).bunker;
  const e = edited.state(B) as BunkerPerson & { grow: TestGrow };
  assert.deepEqual(e.inventory, { soil: 2 });
  assert.deepEqual(e.products, [{ id: 'u5', product: 'fizz', quality: 1, grams: 2 }]);
  assert.equal(e.nextUnit, 6);
  assert.deepEqual(e.grow, { planted: [], water: 0 });
  assert.equal(edited.has('conn:x'), false);
});

test("a bunker.json that can't be read is never written over", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-office-bunker-'));
  const file = path.join(dir, 'bunker.json');
  writeFileSync(file, '{ not json');
  const error = console.error;
  console.error = () => {};
  try {
    const { bunker } = office({ grow: testGrow }, dir);
    bunker.act(A, { feature: 'grow', action: 'buy' });
    bunker.flush();
  } finally {
    console.error = error;
  }
  assert.equal(readFileSync(file, 'utf8'), '{ not json');
});

// ---- On the page ----------------------------------------------------------------------------------------

const { buildDrugBunker, STATION_BUILDERS } = await import('../src/client/world/drugbunker/index.js');
const { buildCasino } = await import('../src/client/world/casino.js');

test('the room: walls all round, the ladder up, and every station at its marked spot with E there', () => {
  const built: string[] = [];
  const builders = Object.fromEntries(
    BUNKER_FEATURES.map((f) => [
      f,
      (spot: (typeof BUNKER_STATIONS)[typeof f]) => {
        built.push(f);
        return STATION_BUILDERS[f](spot);
      },
    ]),
  ) as typeof STATION_BUILDERS;
  const b = buildDrugBunker(undefined, builders);
  assert.deepEqual(built, [...BUNKER_FEATURES], "each feature's own builder");
  for (const f of BUNKER_FEATURES) {
    const g = b.stations[f].group;
    assert.ok(g.parent === b.group, `${f} is in the room`);
    assert.deepEqual([g.position.x, g.position.z, g.rotation.y], [BUNKER_STATIONS[f].x, BUNKER_STATIONS[f].z, BUNKER_STATIONS[f].rotY], `${f} stands at its spot`);
  }
  // E at every station, from in front of it, and at the ladder.
  for (const id of BUNKER_STATION_IDS) {
    const it = b.interactables.find((i) => i.kind === 'bunker' && i.station === id);
    assert.ok(it, `E at ${id}`);
    const front = stationFront(BUNKER_STATIONS[id]);
    assert.ok(Math.hypot(it.x - front.x, it.z - front.z) < it.radius);
    // And the crosshair finds it.
    assert.ok(b.group.children.some((o) => o.userData.interact === it));
  }
  assert.equal(b.ladder.kind, 'hatch');
  assert.ok(Math.hypot(b.ladder.x - BUNKER_LADDER.foot.x, b.ladder.z - BUNKER_LADDER.foot.z) < b.ladder.radius, 'you arrive within reach of the ladder');
  // The walls keep you in, the floor holds you up.
  const solid = (x: number, z: number) => b.colliders.some((c) => c.top > 1 && (c.bottom ?? 0) < 1 && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ);
  assert.ok(solid(R.maxX + 0.1, 0) && solid(R.minX - 0.1, 0) && solid(0, R.maxZ + 0.1) && solid(0, R.minZ - 0.1));
  assert.ok(solid(BUNKER_LADDER.x, R.minZ + 0.15), 'the ladder');
  assert.ok(!solid(BUNKER_LADDER.foot.x, BUNKER_LADDER.foot.z), 'its foot is clear');
  assert.ok(!solid(0, -2), 'the middle of the room is clear');
  assert.ok(b.colliders.some((c) => c.top === 0 && c.minX <= R.minX && c.maxX >= R.maxX));
  // Every frame, every station's update (the stubs have none) and the tube's flicker.
  b.update(0, 0.016, null);
  b.update(100, 0.016, null);
});

test('the casino has the hatch in its secret room, with E there and nobody falling in', () => {
  const casino = buildCasino();
  const it = casino.interactables.find((i) => i.kind === 'hatch');
  assert.ok(it);
  assert.equal(it.x, SECRET_HATCH.x);
  assert.ok(casino.colliders.some((c) => c.top > 1 && SECRET_HATCH.x > c.minX && SECRET_HATCH.x < c.maxX && SECRET_HATCH.z > c.minZ && SECRET_HATCH.z < c.maxZ), 'the hole is fenced off');
  assert.ok(casino.group.getObjectByName('secret-hatch'));
});

test("the panels: each station's title in both languages, the PC's apps, the bunker's help", async () => {
  const { openStation, stationTitle, stationMark, bunkerHelp, PC_APPS } = await import('../src/client/ui/bunker/index.js');
  const { setLang } = await import('../src/client/i18n/index.js');
  const { stashRows } = await import('../src/client/ui/bunker/stash.js');
  assert.equal(typeof openStation, 'function');
  for (const lang of ['en', 'de'] as const) {
    setLang(lang);
    for (const id of BUNKER_STATION_IDS) {
      assert.doesNotMatch(stationTitle(id), /^bunker\./, `${id} has a title in ${lang}`);
      assert.doesNotMatch(stationMark(id), /^bunker\./, `${id} has a mark in ${lang}`);
    }
    assert.match(bunkerHelp(), lang === 'en' ? /ladder/ : /Leiter/);
  }
  setLang('en');
  assert.deepEqual(
    PC_APPS.map((a) => a.id),
    ['shop', 'customers', 'cartel'],
  );
  // The stash lists the supplies, then the product.
  const me = { inventory: { soil: 2 }, products: [{ id: 'u1', product: 'weed-kush', quality: 0.5, grams: 10, pack: 'bag-big' }], nextUnit: 2 } as unknown as BunkerPerson;
  assert.deepEqual(
    stashRows(me).map((r) => [r.section, r.name, r.amount]),
    [
      ['items', 'Bag of soil', '×2'],
      ['products', 'Bunker Kush', '10 g · quality 50 %'],
    ],
  );
  assert.deepEqual(stashRows(null), []);
});

// ---- In the running office ------------------------------------------------------------------------

const bundled = ['public', 'dist/public'].some((d) => existsSync(path.join(import.meta.dirname, '..', d, 'index.html')));

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  await new Promise((r) => srv.close(r));
  return port;
}

test('down the ladder from the secret room and back up: others see you in the bunker, and only there can you act in it', { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'drugbunker-office-'));
  process.env.AGENT_OFFICE_HOME = path.join(root, 'home');
  const project = path.join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: project });
  const { loadConfig } = await import('../src/server/config.js');
  const { startServer } = await import('../src/server/server.js');
  const port = await freePort();
  const office = await startServer(loadConfig([project, '--port', String(port), '--password', 'dev', '--no-open']));
  const origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password: 'dev' }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const sockets: WebSocket[] = [];
  const join = async (name: string, floor?: string) => {
    const key = Buffer.from(name.padEnd(16, '_')).toString('hex');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&chips=${key}${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`, { headers: { cookie, origin } });
    sockets.push(ws);
    const msgs: any[] = [];
    const waiting: (() => void)[] = [];
    ws.on('message', (d) => {
      msgs.push(JSON.parse(String(d)));
      for (const w of waiting.splice(0)) w();
    });
    let seen = 0;
    /** The next message `t` (that `ok` likes) after the ones already looked at. */
    const next = async (t: string, ok: (m: any) => boolean = () => true, ms = 4000): Promise<any> => {
      const until = Date.now() + ms;
      for (;;) {
        while (seen < msgs.length) {
          const m = msgs[seen++];
          if (m.t === t && ok(m)) return m;
        }
        if (Date.now() > until) throw new Error(`${name}: no ${t}`);
        await new Promise<void>((r) => {
          waiting.push(r);
          setTimeout(r, 100);
        });
      }
    };
    const send = (msg: object) => ws.send(JSON.stringify(msg));
    const welcome = await next('welcome');
    return { ws, msgs, next, send, welcome };
  };
  try {
    const ann = await join('Ann', CASINO);
    const bob = await join('Bob', CASINO);
    assert.equal(ann.welcome.floor, CASINO);
    // From out in the hall it's no way down: that's the ladder's.
    ann.send({ t: 'move', x: 0, y: 0, z: 0, rotY: 0, moving: false });
    ann.send({ t: 'floor.go', floor: BUNKER });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!ann.msgs.some((m) => m.t === 'floor.enter'), 'not from the hall');
    // Nor acting in the bunker from up there.
    ann.send({ t: 'bunker.act', feature: 'grow', action: 'anything' });
    // At the hatch in the secret room, down she goes, with her bunker.
    ann.send({ t: 'move', x: SECRET_HATCH.x + 0.35, y: 0, z: SECRET_HATCH.z - 0.95, rotY: Math.PI, moving: false });
    await new Promise((r) => setTimeout(r, 150));
    ann.send({ t: 'floor.go', floor: BUNKER });
    const enter = await ann.next('floor.enter');
    assert.equal(enter.floor, BUNKER);
    const mine = await ann.next('bunker.state');
    assert.deepEqual(mine.state.inventory, {});
    // Bob, up in the casino, sees she's down there.
    await bob.next('peer.update', (m) => m.peer.name === 'Ann' && m.peer.floor === BUNKER);
    // Bob can't follow by asking the elevator either: only by the ladder.
    bob.send({ t: 'floor.go', floor: BUNKER });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!bob.msgs.some((m) => m.t === 'floor.enter'));
    // A reload down there brings her back to the bunker, her bunker with it.
    const again = await join('Ann', BUNKER);
    assert.equal(again.welcome.floor, BUNKER);
    await again.next('bunker.state');
    assert.ok(again.welcome.peers.some((p: any) => p.name === 'Ann' && p.floor === BUNKER));
    again.ws.close();
    // And back up the ladder into the casino.
    ann.send({ t: 'floor.go', floor: CASINO });
    const up = await ann.next('floor.enter', (m) => m.floor === CASINO);
    assert.equal(up.floor, CASINO);
    await bob.next('peer.update', (m) => m.peer.name === 'Ann' && m.peer.floor === CASINO);
  } finally {
    for (const ws of sockets) ws.close();
    office.shutdown();
  }
});
