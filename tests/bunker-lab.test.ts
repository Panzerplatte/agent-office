// The bunker's lab bench (#120): its recipes and their mini-games' scores, the server's batches (kit and
// ingredients, believing a score only once the game could have been played, resting, into the stash), the
// bench as the page builds it, and its texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUNKER_STATIONS, MAX_UNITS, addItem, addUnit, countItem, stationBox, type BunkerPerson } from '../src/shared/bunker/index.js';
import { bunkerItem, productKind } from '../src/shared/bunker/items.js';
import {
  DROPS,
  HEAT,
  LAB_ABANDON,
  PRESS,
  RECIPES,
  dropSequence,
  dropsQuality,
  heatQuality,
  heatStep,
  missingFor,
  mixScore,
  playing,
  pressHit,
  pressMarker,
  pressQuality,
  recipe,
  type LabState,
} from '../src/shared/bunker/lab.js';
import { lab } from '../src/server/bunker/lab.js';
import type { BunkerCtx } from '../src/server/bunker/feature.js';
import { Bunker } from '../src/server/bunker/index.js';
import { Chips } from '../src/server/chips.js';
import type { ServerMsg } from '../src/shared/protocol.js';

// A canvas that draws nothing: enough for the room's textures to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });
}

// ---- The recipes ------------------------------------------------------------------------------------------

test('three made-up recipes, each making a lab product from the supplier’s lab ingredients and kit', () => {
  assert.deepEqual(
    RECIPES.map((r) => r.id),
    ['glimmer', 'fizz', 'nebula'],
  );
  assert.equal(new Set(RECIPES.map((r) => r.game)).size, 3, 'each its own mini-game');
  for (const r of RECIPES) {
    assert.equal(productKind(r.product)?.source, 'lab', `${r.id} makes a lab product`);
    assert.ok(r.grams > 0 && r.minPlay > 0 && r.rest > 0);
    assert.ok(r.kit.length > 0);
    for (const k of r.kit) assert.equal(bunkerItem(k)?.kind, 'equipment', `${k} is kit`);
    for (const [i, n] of Object.entries(r.ingredients)) {
      assert.equal(bunkerItem(i)?.kind, 'ingredient', `${i} is an ingredient`);
      assert.ok(Number.isSafeInteger(n) && n > 0);
    }
    assert.equal(recipe(r.id), r);
  }
  assert.equal(recipe('weed-kush'), undefined);
  assert.equal(recipe({}), undefined);
});

test('what you are short of: the kit, then each ingredient by how many more', () => {
  const glimmer = recipe('glimmer')!;
  assert.deepEqual(missingFor(glimmer, {}), { burner: 1, flasks: 1, gloop: 2, fizzium: 1 });
  assert.deepEqual(missingFor(glimmer, { burner: 1, flasks: 1, gloop: 1, fizzium: 5 }), { gloop: 1 });
  assert.deepEqual(missingFor(glimmer, { burner: 1, flasks: 1, gloop: 2, fizzium: 1 }), {});
});

// ---- The mini-games' scores ----------------------------------------------------------------------------------

test('the burner: the needle climbs with the flame and sinks without it; time in the band makes the quality, boiling over ruins it', () => {
  assert.ok(heatStep(40, true, 0.1) > 40);
  assert.ok(heatStep(40, false, 0.1) < 40);
  assert.equal(heatStep(0, false, 1), 0, 'never below 0');
  assert.equal(heatStep(100, true, 1), 100, 'never above 100');
  // Holding the flame all the time boils it over before the time's up.
  let temp: number = HEAT.start;
  let s = 0;
  while (temp < HEAT.over && s < HEAT.seconds) {
    temp = heatStep(temp, true, 0.05);
    s += 0.05;
  }
  assert.ok(temp >= HEAT.over, 'full flame boils over');
  // Pulsing the flame (on below the band's middle, off above) keeps it in the band most of the time.
  temp = HEAT.start;
  let inBand = 0;
  const mid = (HEAT.band[0] + HEAT.band[1]) / 2;
  for (let t = 0; t < HEAT.seconds; t += 0.05) {
    temp = heatStep(temp, temp < mid, 0.05, Math.sin(t * 3));
    if (temp >= HEAT.band[0] && temp <= HEAT.band[1]) inBand += 0.05;
    assert.ok(temp < HEAT.over);
  }
  assert.ok(inBand / HEAT.seconds > 0.75, `in the band ${inBand}s`);
  assert.ok(heatQuality(inBand / HEAT.seconds, false)! > 0.85);
  assert.equal(heatQuality(0.9, true), null);
  assert.equal(heatQuality(0, false), 0);
  assert.equal(heatQuality(1, false), 1);
  assert.ok(heatQuality(0.3, false)! < heatQuality(0.6, false)!);
});

test('the press: the mix against the card, each tablet by how near the zone’s middle it was pressed', () => {
  assert.equal(pressMarker(0), 0);
  assert.equal(pressMarker(PRESS.period / 2), 1);
  assert.ok(Math.abs(pressMarker(PRESS.period / 4) - 0.5) < 1e-9);
  for (let t = 0; t < 10; t += 0.13) assert.ok(pressMarker(t) >= 0 && pressMarker(t) <= 1);
  assert.equal(pressHit(0.5, 0.5), 1);
  assert.equal(pressHit(0.5 + PRESS.zone, 0.5), 0);
  assert.ok(pressHit(0.55, 0.5) > 0 && pressHit(0.55, 0.5) < 1);
  assert.equal(mixScore(0.4, 0.4), 1);
  assert.equal(mixScore(0, 0.6), 0);
  assert.equal(pressQuality(1, Array(PRESS.tablets).fill(1)), 1);
  assert.equal(pressQuality(0, []), 0);
  assert.ok(Math.abs(pressQuality(1, []) - 1 / 3) < 1e-9, 'the mix is a third');
  assert.equal(pressQuality(1, Array(PRESS.tablets * 3).fill(1)), 1, 'extra presses count for nothing');
});

test('the drops: sequences from the three bottles, the quality the share of drops put in right', () => {
  const seq = dropSequence(5, () => 0.999);
  assert.deepEqual(seq, [2, 2, 2, 2, 2]);
  assert.ok(dropSequence(40).every((b) => b >= 0 && b < DROPS.bottles.length));
  for (const b of DROPS.bottles) assert.equal(bunkerItem(b)?.kind, 'ingredient');
  assert.equal(dropsQuality([...DROPS.rounds]), 1);
  assert.equal(dropsQuality([]), 0);
  assert.equal(dropsQuality([99, 99, 99]), 1, 'never more than a round has');
  assert.equal(dropsQuality([3, 0, 0]), 3 / 12);
});

// ---- On the server ------------------------------------------------------------------------------------------

function person(): BunkerPerson {
  return { inventory: {}, products: [], nextUnit: 1, lab: lab.initial() } as unknown as BunkerPerson;
}

function ctxFor(me: BunkerPerson, now: number, events: string[]): BunkerCtx {
  return { id: 'a', now, me, balance: () => 0, pay: () => false, spend: () => false, event: (key) => events.push(key) };
}

test('a batch: needs its kit and ingredients, uses up only the ingredients, one at a time', () => {
  const me = person();
  const s = me.lab as LabState;
  const events: string[] = [];
  assert.equal(lab.act(ctxFor(me, 0, events), s, 'start', 'glimmer'), false);
  assert.deepEqual(events, ['lab.missing']);
  assert.equal(lab.act(ctxFor(me, 0, events), s, 'start', 'nope'), false);
  for (const [i, n] of Object.entries({ burner: 1, flasks: 1, gloop: 4, fizzium: 2, press: 1, 'moon-syrup': 1 })) addItem(me.inventory, i, n);
  assert.equal(lab.act(ctxFor(me, 1000, events), s, 'start', 'glimmer'), true);
  assert.deepEqual(me.inventory, { burner: 1, flasks: 1, gloop: 2, fizzium: 1, press: 1, 'moon-syrup': 1 });
  assert.ok(playing(s.batch));
  assert.equal(s.batch?.startedAt, 1000);
  assert.equal(lab.act(ctxFor(me, 1000, events), s, 'start', 'glimmer'), false);
  assert.equal(events.at(-1), 'lab.busy');
  // Nothing to collect while it's being played.
  assert.equal(lab.act(ctxFor(me, 1000, events), s, 'collect', undefined), false);
});

test("a score is believed only once the game could have been played, then it rests, then it's a unit in the stash", () => {
  const me = person();
  const s = me.lab as LabState;
  const events: string[] = [];
  for (const [i, n] of Object.entries({ press: 1, fizzium: 2, 'moon-syrup': 1 })) addItem(me.inventory, i, n);
  const fizz = recipe('fizz')!;
  assert.equal(lab.act(ctxFor(me, 0, events), s, 'start', 'fizz'), true);
  // Too quick, or no real score: not believed, and the batch stays to be played.
  assert.equal(lab.act(ctxFor(me, fizz.minPlay - 1, events), s, 'finish', { quality: 1 }), false);
  assert.equal(lab.act(ctxFor(me, fizz.minPlay, events), s, 'finish', { quality: 'lots' }), false);
  assert.equal(lab.act(ctxFor(me, fizz.minPlay, events), s, 'finish', null), false);
  // Only the burner's batch can boil over.
  assert.equal(lab.act(ctxFor(me, fizz.minPlay, events), s, 'finish', { ruined: true }), false);
  assert.ok(playing(s.batch));
  assert.equal(lab.act(ctxFor(me, fizz.minPlay, events), s, 'finish', { quality: 7 }), true, 'a score over 1 is 1');
  assert.equal(s.batch?.quality, 1);
  assert.equal(s.batch?.readyAt, fizz.minPlay + fizz.rest);
  assert.equal(events.at(-1), 'lab.resting.fizz');
  assert.equal(lab.act(ctxFor(me, fizz.minPlay, events), s, 'finish', { quality: 0.2 }), false, 'played once');
  // Resting: not yet.
  assert.equal(lab.act(ctxFor(me, fizz.minPlay + fizz.rest - 1, events), s, 'collect', undefined), false);
  assert.equal(events.at(-1), 'lab.notYet');
  assert.equal(lab.act(ctxFor(me, fizz.minPlay + fizz.rest, events), s, 'collect', undefined), true);
  assert.deepEqual(me.products, [{ id: 'u1', product: 'fizz', quality: 1, grams: fizz.grams }]);
  assert.equal(s.batch, null);
  assert.equal(s.made, 1);
  assert.equal(events.at(-1), 'lab.collected');
});

test('boiling over, throwing out, a full stash, and a batch left unplayed spoiling', () => {
  const me = person();
  const s = me.lab as LabState;
  const events: string[] = [];
  for (const [i, n] of Object.entries({ burner: 1, flasks: 1, gloop: 10, fizzium: 10, stardust: 5, 'moon-syrup': 5 })) addItem(me.inventory, i, n);
  // Boiled over: lost, whenever it happens.
  lab.act(ctxFor(me, 0, events), s, 'start', 'glimmer');
  assert.equal(lab.act(ctxFor(me, 10, events), s, 'finish', { ruined: true }), true);
  assert.equal(s.batch, null);
  assert.equal(events.at(-1), 'lab.ruined');
  // Thrown out mid-game.
  lab.act(ctxFor(me, 0, events), s, 'start', 'nebula');
  assert.equal(lab.act(ctxFor(me, 10, events), s, 'abandon', undefined), true);
  assert.equal(s.batch, null);
  assert.equal(lab.act(ctxFor(me, 10, events), s, 'abandon', undefined), false);
  // Left unplayed: the clock spoils it.
  lab.act(ctxFor(me, 0, events), s, 'start', 'nebula');
  assert.equal(lab.tick(ctxFor(me, LAB_ABANDON, events), s), false);
  assert.equal(lab.tick(ctxFor(me, LAB_ABANDON + 1, events), s), true);
  assert.equal(s.batch, null);
  // A rested batch with a full stash stays on the bench.
  const nebula = recipe('nebula')!;
  lab.act(ctxFor(me, 0, events), s, 'start', 'nebula');
  lab.act(ctxFor(me, nebula.minPlay, events), s, 'finish', { quality: 0.5 });
  while (me.products.length < MAX_UNITS) addUnit(me, { product: 'weed-kush', quality: 1, grams: 1 });
  assert.equal(lab.act(ctxFor(me, 1e9, events), s, 'collect', undefined), false);
  assert.equal(events.at(-1), 'lab.full');
  assert.ok(s.batch);
  assert.equal(lab.tick(ctxFor(me, 1e9, events), s), false, "a rested batch doesn't spoil");
  assert.equal(lab.act(ctxFor(me, 0, events), s, 'jump', undefined), false);
});

test('what was saved is made safe: unknown recipes, bad numbers and junk come back as nothing', () => {
  assert.deepEqual(lab.load(undefined), { batch: null, made: 0 });
  assert.deepEqual(lab.load('x'), { batch: null, made: 0 });
  assert.deepEqual(lab.load({ batch: { recipe: 'unobtainium', startedAt: 1 }, made: -3 }), { batch: null, made: 0 });
  assert.deepEqual(lab.load({ batch: { recipe: 'fizz', startedAt: 'now' }, made: 2.5 }), { batch: null, made: 0 });
  assert.deepEqual(lab.load({ batch: { recipe: 'fizz', startedAt: 5 }, made: 4 }), { batch: { recipe: 'fizz', startedAt: 5 }, made: 4 });
  assert.deepEqual(lab.load({ batch: { recipe: 'glimmer', startedAt: 5, quality: 3, readyAt: 9 } }), { batch: { recipe: 'glimmer', startedAt: 5, quality: 1, readyAt: 9 }, made: 0 });
});

test("through the whole bunker: a batch from what's in the inventory, kept across a save, into the stash", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-office-lab-'));
  let now = 0;
  const sent: ServerMsg[] = [];
  const chips = new Chips(dir, { saveAfter: 0 });
  const bunker = new Bunker(dir, { chips, saveAfter: 0, now: () => now, send: (_id, msg) => sent.push(msg) });
  const A = 'account:ada';
  // Nothing yet: a toast, no change.
  assert.equal(bunker.act(A, { feature: 'lab', action: 'start', args: 'nebula' }), false);
  assert.ok(sent.some((m) => m.t === 'bunker.event' && m.event.key === 'lab.missing'));
  bunker.flush();
  // Kit and ingredients, as the supplier would have put them there, then through a save.
  const raw = { people: { [A]: { inventory: { flasks: 1, stardust: 1, 'moon-syrup': 1, gloop: 1 }, products: [], nextUnit: 1 } } };
  writeFileSync(path.join(dir, 'bunker.json'), JSON.stringify(raw));
  const b2 = new Bunker(dir, { chips, saveAfter: 0, now: () => now, send: (_id, msg) => sent.push(msg) });
  assert.equal(b2.act(A, { feature: 'lab', action: 'start', args: 'nebula' }), true);
  assert.deepEqual(b2.state(A).inventory, { flasks: 1 });
  now = recipe('nebula')!.minPlay;
  assert.equal(b2.act(A, { feature: 'lab', action: 'finish', args: { quality: 0.75 } }), true);
  b2.flush();
  const b3 = new Bunker(dir, { chips, saveAfter: 0, now: () => now });
  assert.equal(b3.state(A).lab.batch?.quality, 0.75);
  now += recipe('nebula')!.rest;
  assert.equal(b3.act(A, { feature: 'lab', action: 'collect' }), true);
  const s = b3.state(A);
  assert.equal(s.products.length, 1);
  assert.equal(s.products[0].product, 'nebula');
  assert.equal(countItem(s.inventory, 'flasks'), 1, 'the kit stays');
});

// ---- On the page --------------------------------------------------------------------------------------------

test('the bench: your kit shows once you have it, the flame and steam while a batch is on it', async () => {
  const { buildLab } = await import('../src/client/world/drugbunker/lab.js');
  const spot = BUNKER_STATIONS.lab;
  const view = buildLab(spot);
  assert.equal(view.group.position.x, spot.x);
  assert.ok(view.colliders?.length);
  const b = stationBox(spot);
  for (const c of view.colliders!) assert.ok(c.minX >= b.minX - 1e-9 && c.maxX <= b.maxX + 1e-9 && c.minZ >= b.minZ - 1e-9 && c.maxZ <= b.maxZ + 1e-9, 'inside its spot');
  const visibleMeshes = () => {
    let n = 0;
    view.group.traverseVisible((o) => {
      if ((o as { isMesh?: boolean }).isMesh) n++;
    });
    return n;
  };
  view.update!(0, 0.016, null);
  const bare = visibleMeshes();
  const me = person();
  for (const i of ['burner', 'flasks', 'press']) addItem(me.inventory, i, 1);
  view.update!(1, 0.016, me);
  const kitted = visibleMeshes();
  assert.ok(kitted > bare, 'the kit shows');
  (me.lab as LabState).batch = { recipe: 'glimmer', startedAt: 0 };
  view.update!(2, 0.016, me);
  assert.ok(visibleMeshes() > kitted, 'flame and steam');
  (me.lab as LabState).batch = { recipe: 'glimmer', startedAt: 0, quality: 1, readyAt: 10 };
  view.update!(3, 0.016, me);
  view.update!(4, 0.016, { ...me, lab: undefined } as unknown as BunkerPerson);
});

test('its texts: the title, the mark, the help, every toast the server sends, in both languages', async () => {
  const { t, setLang } = await import('../src/client/i18n/index.js');
  const { bunkerHelp } = await import('../src/client/ui/bunker/index.js');
  const keys = ['title', 'mark', 'busy', 'missing', 'ruined', 'abandoned', 'full', 'notYet', 'collected', ...RECIPES.flatMap((r) => [`resting.${r.id}`, `rest.${r.id}`, `take.${r.id}`])];
  for (const lang of ['en', 'de'] as const) {
    setLang(lang);
    for (const k of keys) assert.doesNotMatch(t(`bunker.lab.${k}` as Parameters<typeof t>[0]), /^bunker\./, `${k} in ${lang}`);
    assert.match(bunkerHelp(), /Glimmer/, 'in the bunker’s help');
    assert.match(t('bunker.lab.help'), lang === 'en' ? /boils over/ : /kocht es über/);
  }
  setLang('en');
});
