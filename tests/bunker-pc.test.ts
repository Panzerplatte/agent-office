// The bunker's PC (#122): the supplier's shop (buying with chips through the ledger, delivered into
// the inventory, the stash's room and the upgrades), the stats it keeps, its apps and its desk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { BUNKER_STATIONS, countItem, stationFront, type BunkerPerson } from '../src/shared/bunker/index.js';
import { ITEMS } from '../src/shared/bunker/items.js';
import { PC_MAX_BUY, PC_UPGRADES, SHOP_SECTIONS, STASH_ROOM, STASH_ROOM_PER_SHELF, initialPc, loadPc, noteSale, pcStats, stashRoom, upgradeLevel } from '../src/shared/bunker/pc.js';
import { Chips } from '../src/server/chips.js';
import { Bunker } from '../src/server/bunker/index.js';
import { START_CHIPS } from '../src/shared/chips.js';
import type { ServerMsg } from '../src/shared/protocol.js';

// A canvas that draws nothing: enough for the CRT's picture to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

const A = 'account:ada';

function office() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-office-bunker-pc-'));
  const chips = new Chips(dir, { saveAfter: 0 });
  const sent: { id: string; msg: ServerMsg }[] = [];
  const bunker = new Bunker(dir, { chips, saveAfter: 0, send: (id, msg) => sent.push({ id, msg }) });
  const events = () => sent.flatMap((s) => (s.msg.t === 'bunker.event' ? [s.msg.event.key] : []));
  return { dir, chips, bunker, sent, events };
}

// ---- The shop ---------------------------------------------------------------------------------------------

test('the shop sells everything in the catalog, each item on one shelf', () => {
  const shelved = SHOP_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
  assert.deepEqual([...shelved].sort(), ITEMS.map((i) => i.id).sort());
  assert.equal(new Set(shelved).size, shelved.length);
  for (const up of PC_UPGRADES) {
    assert.ok(up.prices.length > 0 && up.prices.every((p) => Number.isSafeInteger(p) && p > 0), `${up.id} has prices`);
    assert.ok(!ITEMS.some((i) => i.id === up.id), `${up.id} isn't an item's id too`);
  }
});

test('buying takes the chips through the ledger as bunker:buy:<item> and delivers into the inventory', () => {
  const { chips, bunker, events } = office();
  assert.equal(bunker.act(A, { feature: 'pc', action: 'buy', args: { item: 'soil', n: 3 } }), true);
  assert.equal(chips.balance(A), START_CHIPS - 45);
  assert.deepEqual(
    chips.ledger(A).map((e) => [e.amount, e.reason]),
    [[-45, 'bunker:buy:soil']],
  );
  const me = bunker.state(A);
  assert.equal(countItem(me.inventory, 'soil'), 3);
  assert.equal(me.pc.spent, 45);
  assert.deepEqual(me.pc.bought, { soil: 3 });
  assert.deepEqual(events(), ['pc.delivered']);
  // Again: it adds up.
  bunker.act(A, { feature: 'pc', action: 'buy', args: { item: 'soil', n: 1 } });
  assert.equal(countItem(bunker.state(A).inventory, 'soil'), 4);
  assert.equal(bunker.state(A).pc.bought.soil, 4);
});

test("nothing's bought without the chips for it, or for a made-up item or amount", () => {
  const { chips, bunker, events } = office();
  // 3 × 600 = 1800, more than the 1000 to start with.
  assert.equal(bunker.act(A, { feature: 'pc', action: 'buy', args: { item: 'lamp-led', n: 3 } }), false);
  assert.deepEqual(events(), ['pc.broke']);
  assert.equal(chips.balance(A), START_CHIPS);
  for (const args of [
    { item: 'gold', n: 1 },
    { item: 'soil', n: 0 },
    { item: 'soil', n: -2 },
    { item: 'soil', n: 1.5 },
    { item: 'soil', n: PC_MAX_BUY + 1 },
    { item: 'soil', n: '2' },
    { item: '__proto__', n: 1 },
    null,
    'soil',
  ]) {
    assert.equal(bunker.act(A, { feature: 'pc', action: 'buy', args }), false, JSON.stringify(args));
  }
  assert.equal(bunker.act(A, { feature: 'pc', action: 'hack', args: {} }), false);
  assert.equal(chips.balance(A), START_CHIPS);
  assert.deepEqual(bunker.state(A).inventory, {});
});

test('the stash holds only so many supplies, and a stash shelf makes room for more', () => {
  const { chips, bunker, events } = office();
  chips.award(A, 100_000, 'test');
  // Little bags are a chip each: fill the stash to the brim.
  for (let left = STASH_ROOM; left > 0; left -= Math.min(left, PC_MAX_BUY)) assert.ok(bunker.act(A, { feature: 'pc', action: 'buy', args: { item: 'bag', n: Math.min(left, PC_MAX_BUY) } }));
  assert.equal(countItem(bunker.state(A).inventory, 'bag'), STASH_ROOM);
  const before = chips.balance(A);
  assert.equal(bunker.act(A, { feature: 'pc', action: 'buy', args: { item: 'bag', n: 1 } }), false);
  assert.equal(events().at(-1), 'pc.full');
  assert.equal(chips.balance(A), before, 'a full stash costs nothing');
  // A shelf: through the ledger too, and then there's room.
  assert.ok(bunker.act(A, { feature: 'pc', action: 'upgrade', args: { id: 'stash-shelf' } }));
  assert.equal(chips.ledger(A)[0].reason, 'bunker:buy:stash-shelf');
  assert.equal(chips.balance(A), before - PC_UPGRADES.find((u) => u.id === 'stash-shelf')!.prices[0]);
  const me = bunker.state(A);
  assert.equal(upgradeLevel(me, 'stash-shelf'), 1);
  assert.equal(stashRoom(me), STASH_ROOM + STASH_ROOM_PER_SHELF);
  assert.ok(bunker.act(A, { feature: 'pc', action: 'buy', args: { item: 'bag', n: 1 } }));
});

test('upgrades go up a level at a time, each dearer, and stop at the top', () => {
  const { chips, bunker, events } = office();
  chips.award(A, 100_000, 'test');
  const shelf = PC_UPGRADES.find((u) => u.id === 'stash-shelf')!;
  for (let level = 1; level <= shelf.prices.length; level++) {
    const before = chips.balance(A);
    assert.ok(bunker.act(A, { feature: 'pc', action: 'upgrade', args: { id: 'stash-shelf' } }));
    assert.equal(before - chips.balance(A), shelf.prices[level - 1]);
    assert.equal(upgradeLevel(bunker.state(A), 'stash-shelf'), level);
  }
  const before = chips.balance(A);
  assert.equal(bunker.act(A, { feature: 'pc', action: 'upgrade', args: { id: 'stash-shelf' } }), false);
  assert.equal(events().at(-1), 'pc.maxed');
  assert.equal(chips.balance(A), before);
  assert.equal(bunker.act(A, { feature: 'pc', action: 'upgrade', args: { id: 'soil' } }), false, 'not an upgrade');
  assert.ok(bunker.act(A, { feature: 'pc', action: 'upgrade', args: { id: 'grow-tent' } }));
  assert.equal(upgradeLevel(bunker.state(A), 'grow-tent'), 1);
});

// ---- The stats --------------------------------------------------------------------------------------------

test("the stats: what's spent, what's earned, the best customer, what sells best", () => {
  const me = { pc: initialPc() };
  assert.deepEqual(pcStats(me.pc), { spent: 0, earned: 0, net: 0 });
  assert.ok(noteSale(me, { customer: 'c1', name: 'Jonas', product: 'weed-kush', grams: 10, chips: 80 }));
  assert.ok(noteSale(me, { customer: 'c2', product: 'glimmer', grams: 2, chips: 60 }));
  assert.ok(noteSale(me, { customer: 'c1', product: 'glimmer', grams: 1, chips: 30 }));
  assert.ok(noteSale(me, { customer: 'cartel', name: 'Cartel', product: 'weed-kush', grams: 100, chips: 70 }));
  me.pc.spent = 50;
  me.pc.bought = { soil: 3, bag: 20 };
  const s = pcStats(me.pc);
  assert.equal(s.earned, 240);
  assert.equal(s.net, 190);
  assert.deepEqual(s.bestCustomer, { id: 'c1', name: 'Jonas', chips: 110, sales: 2 });
  assert.deepEqual(s.bestProduct, { id: 'weed-kush', grams: 110, chips: 150 });
  assert.deepEqual(s.mostBought, { id: 'bag', n: 20 });
  // Nonsense isn't noted.
  for (const bad of [
    { customer: '', product: 'x', grams: 1, chips: 1 },
    { customer: 'c1', product: 'x', grams: 0, chips: 1 },
    { customer: 'c1', product: 'x', grams: 1, chips: 1.5 },
    { customer: '__proto__', product: 'x', grams: 1, chips: 1 },
  ]) {
    assert.equal(noteSale(me, bad), false);
  }
  assert.equal(pcStats(me.pc).earned, 240);
});

test("the PC's section as saved is made safe, and survives a restart", () => {
  assert.deepEqual(loadPc(null), initialPc());
  assert.deepEqual(
    loadPc({
      spent: -5,
      earned: 'lots',
      bought: { soil: 2, bag: -1, __proto__: 3 },
      upgrades: { 'stash-shelf': 99, 'grow-tent': 1, rocket: 2 },
      customers: { c1: { chips: 10, sales: 1, name: 'Jonas' }, c2: 'x' },
      sold: { 'weed-kush': { grams: 5, chips: 20 } },
    }),
    {
      spent: 0,
      earned: 0,
      bought: { soil: 2 },
      upgrades: { 'stash-shelf': PC_UPGRADES.find((u) => u.id === 'stash-shelf')!.prices.length, 'grow-tent': 1 },
      customers: { c1: { chips: 10, sales: 1, name: 'Jonas' } },
      sold: { 'weed-kush': { grams: 5, chips: 20 } },
    },
  );
  const { dir, chips, bunker } = office();
  chips.award(A, 1000, 'test');
  bunker.act(A, { feature: 'pc', action: 'buy', args: { item: 'pot', n: 2 } });
  bunker.act(A, { feature: 'pc', action: 'upgrade', args: { id: 'grow-tent' } });
  bunker.flush();
  const again = new Bunker(dir, { chips, saveAfter: 0 });
  const me = again.state(A);
  assert.equal(countItem(me.inventory, 'pot'), 2);
  assert.deepEqual(me.pc.upgrades, { 'grow-tent': 1 });
  assert.equal(me.pc.spent, 50 + 1200);
});

// ---- On the page ------------------------------------------------------------------------------------------

test("the PC's desktop: its own shop, stash and stats, then the others' apps; the shop's and the stats' rows", async () => {
  const { setLang } = await import('../src/client/i18n/index.js');
  const { desktopApps, shopApp, shopSections, statsLines } = await import('../src/client/ui/bunker/pc.js');
  const { PC_APPS } = await import('../src/client/ui/bunker/index.js');
  setLang('en');
  assert.deepEqual(
    desktopApps(PC_APPS).map((a) => a.id),
    ['shop', 'stash', 'stats', 'customers', 'cartel'],
  );
  assert.equal(desktopApps(PC_APPS)[0], shopApp);
  const me = { inventory: { soil: 2, bag: 10 }, products: [], nextUnit: 1, pc: { ...initialPc(), upgrades: { 'stash-shelf': 1 } } } as unknown as BunkerPerson;
  const shop = shopSections(me, 50);
  assert.equal(shop.used, 12);
  assert.equal(shop.room, STASH_ROOM + STASH_ROOM_PER_SHELF);
  assert.deepEqual(
    shop.sections.map((s) => s.id),
    ['seeds', 'grow', 'lab', 'packaging', 'upgrades'],
  );
  const soil = shop.sections[1].rows.find((r) => r.id === 'soil')!;
  assert.deepEqual([soil.name, soil.have, soil.price, soil.affordable], ['Bag of soil', 2, 15, true]);
  assert.equal(shop.sections[1].rows.find((r) => r.id === 'lamp')!.affordable, false);
  const shelf = shop.sections[4].rows.find((r) => r.id === 'stash-shelf')!;
  assert.ok(shelf.kind === 'upgrade' && shelf.level === 1 && shelf.price === PC_UPGRADES[1].prices[1]);
  // The stats, in both languages, never blank.
  noteSale(me, { customer: 'c1', name: 'Jonas', product: 'glimmer', grams: 2, chips: 60 });
  for (const lang of ['en', 'de'] as const) {
    setLang(lang);
    const lines = statsLines(me);
    assert.equal(lines.length, 6);
    for (const l of lines) assert.ok(l.label && l.value && !/^bunker\./.test(l.label) && !/^bunker\./.test(l.value));
    assert.equal(lines[3].value, 'Jonas');
    assert.match(lines[4].value, /Glimmer/);
  }
  setLang('en');
  assert.deepEqual(
    statsLines(null).map((l) => l.value),
    ['0', '0', '0', 'Nothing yet', 'Nothing yet', 'Nothing yet'],
  );
});

test("the PC's toasts and help are there in both languages", async () => {
  const { setLang, t } = await import('../src/client/i18n/index.js');
  const { bunkerHelp } = await import('../src/client/ui/bunker/index.js');
  for (const lang of ['en', 'de'] as const) {
    setLang(lang);
    for (const key of ['pc.delivered', 'pc.upgraded', 'pc.broke', 'pc.full', 'pc.maxed'] as const) {
      const text = t(`bunker.${key}`, { icon: '🪴', n: 3, chips: 40, room: 2000, level: 2 });
      assert.doesNotMatch(text, /^bunker\.|\{/, `${key} in ${lang}`);
    }
    assert.match(bunkerHelp(), lang === 'en' ? /Supplier/ : /Lieferanten/);
  }
  setLang('en');
});

test('the desk: a beige computer with a glowing CRT, a keyboard and a chair, inside its spot, that you walk round', async () => {
  const { buildPc, PC_DESK } = await import('../src/client/world/drugbunker/pc.js');
  const spot = BUNKER_STATIONS.pc;
  const view = buildPc(spot);
  assert.deepEqual([view.group.position.x, view.group.position.z, view.group.rotation.y], [spot.x, spot.z, spot.rotY]);
  const screen = view.group.getObjectByName('bunker-pc-screen') as THREE.Mesh;
  assert.ok(screen, 'the CRT has a picture');
  assert.ok((screen.material as THREE.Material).type === 'MeshBasicMaterial', 'that glows');
  // Everything stands inside its spot along its front, on the floor, under the ceiling.
  const box = new THREE.Box3().setFromObject(view.group.getObjectByName('bunker-pc-furniture')!);
  view.group.updateMatrixWorld(true);
  const local = new THREE.Box3().setFromObject(view.group.getObjectByName('bunker-pc-furniture')!).applyMatrix4(view.group.matrixWorld.clone().invert());
  assert.ok(box.min.y >= -1e-6 && box.max.y < 2, 'on the floor');
  assert.ok(local.min.x >= -spot.w / 2 - 1e-6 && local.max.x <= spot.w / 2 + 1e-6, 'within its width');
  assert.ok(local.min.z >= -spot.d / 2 - 1e-6, 'off the wall');
  // The desk keeps you out; where you stand to use it doesn't.
  const [c] = view.colliders!;
  assert.ok(c.top >= PC_DESK.top - 1e-6);
  const front = stationFront(spot);
  assert.ok(!(front.x > c.minX && front.x < c.maxX && front.z > c.minZ && front.z < c.maxZ), 'its front is clear');
  assert.ok(spot.x > c.minX && spot.x < c.maxX, 'the desk is there');
  // It hums along every frame.
  view.update!(0, 0.016, null);
  view.update!(10.7, 0.016, null);
});
