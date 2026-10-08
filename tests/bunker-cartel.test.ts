// The bunker's cartel (#124): offers on the phone, one contract at a time, handing over packed product
// for chips, the reputation that brings bigger offers, haggling once a contract, missed deadlines, the
// phone ringing, and its panel and texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addUnit, BUNKER_STATIONS, stationBox, stationFront, type BunkerPerson } from '../src/shared/bunker/index.js';
import { PRODUCTS, productKind, productValue } from '../src/shared/bunker/items.js';
import {
  OFFER_GAP,
  OFFER_TTL,
  REP_DONE,
  REP_FAILED,
  START_REP,
  TIER_REP,
  cartelTier,
  contractPay,
  fittingGrams,
  haggleChance,
  makeOffer,
  nextTierRep,
  ringing,
  tierProducts,
  unitsToDeliver,
  type CartelContract,
  type CartelState,
} from '../src/shared/bunker/cartel.js';
import { CARTEL_SALE, makeCartel } from '../src/server/bunker/cartel.js';
import type { BunkerCtx } from '../src/server/bunker/feature.js';
import { Bunker } from '../src/server/bunker/index.js';
import { Chips } from '../src/server/chips.js';
import type { ServerMsg } from '../src/shared/protocol.js';

/** Dice that roll what they're told, over and over. */
const dice = (...rolls: number[]) => {
  let i = 0;
  return () => rolls[i++ % rolls.length];
};

const MIN = 60_000;

/** A cartel handler and one person's bunker, with what it paid and said. */
function setup(rand = dice(0.5)) {
  const handler = makeCartel(rand);
  const me = { inventory: {}, products: [], nextUnit: 1, cartel: handler.initial() } as unknown as BunkerPerson;
  const paid: { amount: number; reason: string }[] = [];
  const events: { key: string; params?: Record<string, string | number>; level?: string }[] = [];
  let now = 1_000_000;
  const ctx = (): BunkerCtx => ({
    id: 'account:ada',
    now,
    me,
    balance: () => 0,
    pay: (amount, reason) => (paid.push({ amount, reason }), true),
    spend: () => false,
    event: (key, params, level) => events.push({ key, params, level }),
  });
  const s = me.cartel;
  // They've heard of you (see the test of that).
  s.known = true;
  return {
    handler,
    me,
    s,
    paid,
    events,
    keys: () => events.map((e) => e.key),
    at: (t: number) => (now = t),
    later: (ms: number) => (now += ms),
    now: () => now,
    act: (action: string, args?: unknown) => handler.act(ctx(), s, action, args),
    tick: () => handler.tick(ctx(), s),
  };
}

const pack = (me: BunkerPerson, product: string, grams: number, quality: number, packed = 'brick') => addUnit(me, { product, grams, quality, ...(packed ? { pack: packed } : {}) })!;

// ---- The rules ------------------------------------------------------------------------------------------

test('reputation puts you on a rung: nobody to family, and the next rung is in sight', () => {
  assert.equal(cartelTier(0), 0);
  assert.equal(cartelTier(START_REP), 0);
  assert.equal(cartelTier(20), 1);
  assert.equal(cartelTier(59), 2);
  assert.equal(cartelTier(100), 4);
  assert.equal(nextTierRep(10), 20);
  assert.equal(nextTierRep(85), null);
  assert.deepEqual([...TIER_REP], [0, 20, 40, 60, 80]);
  assert.ok(
    tierProducts(0).every((p) => p.source === 'grow'),
    'weed to start with',
  );
  assert.equal(tierProducts(2).length, PRODUCTS.length, "the lab's products from the third rung");
  assert.ok(haggleChance(0) < haggleChance(50) && haggleChance(50) < haggleChance(100));
  assert.ok(haggleChance(0) > 0 && haggleChance(100) < 1, 'never sure either way');
});

test('offers: bigger and better paid up the ladder, but always less a gram than customers pay', () => {
  for (let tier = 0; tier <= 4; tier++) {
    for (const roll of [0, 0.3, 0.7, 0.999]) {
      const o = makeOffer(TIER_REP[tier], 0, 'k1', dice(roll));
      const kind = productKind(o.product)!;
      assert.ok(kind, 'a real product');
      assert.equal(o.tier, tier);
      assert.ok(o.grams >= 10 && o.grams % 10 === 0, 'in tens of grams');
      assert.ok(o.minQuality >= 0.1 && o.minQuality <= 0.9);
      assert.ok(Number.isSafeInteger(o.pay) && o.pay > 0);
      assert.ok(o.pay < productValue(kind, o.minQuality, o.grams), 'less than customers pay for it at that quality');
      assert.equal(o.expiresAt, OFFER_TTL);
      assert.deepEqual([o.delivered, o.haggled], [0, false]);
    }
  }
  const low = makeOffer(0, 0, 'k1', dice(0.5));
  const high = makeOffer(100, 0, 'k1', dice(0.5));
  assert.ok(high.pay > low.pay * 5, 'family contracts are worth a lot more');
  assert.ok(high.time > low.time, 'and give you longer');
  const kush = productKind('weed-kush')!;
  assert.ok(contractPay(kush, 100, 0.5, 4) / 100 > contractPay(kush, 100, 0.5, 0) / 100, 'a better rate a gram higher up');
});

test('what counts toward a contract: the right product, packed, good enough; the worst goes first', () => {
  const { me } = setup();
  const c = { product: 'weed-haze', grams: 250, minQuality: 0.6, delivered: 0 } as CartelContract;
  pack(me, 'weed-haze', 100, 0.9);
  pack(me, 'weed-haze', 100, 0.6);
  pack(me, 'weed-haze', 100, 0.7);
  pack(me, 'weed-haze', 100, 0.5); // too weak
  pack(me, 'weed-haze', 100, 0.95, ''); // loose
  pack(me, 'weed-kush', 100, 1); // the wrong product
  assert.equal(fittingGrams(c, me.products), 300);
  assert.deepEqual(
    unitsToDeliver(c, me.products).map((u) => u.quality),
    [0.6, 0.7, 0.9],
    'the worst first, until there is enough',
  );
  assert.deepEqual(
    unitsToDeliver({ ...c, delivered: 150 }, me.products).map((u) => u.quality),
    [0.6],
  );
});

// ---- On the server --------------------------------------------------------------------------------------

test('the phone rings with an offer, and stops once you pick up', () => {
  const x = setup();
  assert.equal(x.s.rep, START_REP);
  assert.equal(ringing(x.s), false);
  assert.equal(x.tick(), true, 'the first offer comes straight away');
  assert.ok(x.s.offer);
  assert.equal(x.s.offer!.id, 'k1');
  assert.equal(ringing(x.s), true);
  assert.equal(x.tick(), false, 'one offer at a time');
  assert.equal(x.act('answer'), true);
  assert.equal(ringing(x.s), false);
  assert.equal(x.act('answer'), false, 'already picked up');
  assert.deepEqual(x.events, [], 'no toasts for a ringing phone: it rings in the bunker');
});

test("nobody calls till there's product in the stash, and nothing changes for anyone till then", () => {
  const x = setup();
  x.s.known = false;
  assert.equal(x.tick(), false);
  x.later(60 * MIN);
  assert.equal(x.tick(), false);
  assert.equal(x.s.offer, null);
  pack(x.me, 'weed-kush', 5, 0.5, '');
  assert.equal(x.tick(), true);
  assert.equal(x.s.known, true);
  assert.ok(x.s.offer, 'the phone rings');
  // And they keep calling after it's all gone.
  x.me.products.length = 0;
  x.act('decline');
  x.later(OFFER_GAP);
  x.tick();
  assert.ok(x.s.offer);
});

test('an offer nobody takes is gone after a while, and the next one comes later', () => {
  const x = setup();
  x.tick();
  x.later(OFFER_TTL);
  assert.equal(x.tick(), true);
  assert.equal(x.s.offer, null);
  assert.equal(x.s.nextOfferAt, x.now() + OFFER_GAP);
  x.later(OFFER_GAP - 1);
  assert.equal(x.tick(), false);
  x.later(1);
  x.tick();
  assert.equal(x.s.offer?.id, 'k2');
});

test('turning an offer down: no harm done, the phone just rings again later', () => {
  const x = setup();
  x.tick();
  assert.equal(x.act('decline'), true);
  assert.equal(x.s.offer, null);
  assert.equal(x.s.rep, START_REP);
  assert.deepEqual(x.keys(), ['cartel.declined']);
  assert.equal(x.act('decline'), false);
  assert.equal(x.act('accept'), false, 'nothing to take');
});

test('a contract taken, handed over in parts, and paid in chips through the ledger on the last', () => {
  const x = setup();
  x.tick();
  const offer = x.s.offer!;
  assert.equal(x.act('accept'), true);
  assert.equal(x.s.offer, null);
  assert.equal(x.s.contract?.id, offer.id);
  assert.equal(x.s.contract?.dueAt, x.now() + offer.time);
  assert.equal(x.tick(), false, 'no offers while you have a contract');

  assert.equal(x.act('deliver'), false, 'nothing that counts yet');
  assert.equal(x.events.at(-1)?.key, 'cartel.nothingFits');
  const q = offer.minQuality;
  const half = Math.ceil(offer.grams / 20) * 10;
  pack(x.me, offer.product, half, q);
  pack(x.me, offer.product, 5, Math.max(0, q - 0.1)); // too weak: stays
  assert.equal(x.act('deliver'), true);
  assert.equal(x.s.contract?.delivered, Math.min(offer.grams, half));
  assert.equal(x.me.products.length, 1, 'only what counted went');
  assert.deepEqual(x.paid, []);

  pack(x.me, offer.product, offer.grams, 1);
  x.later(offer.time - 1);
  assert.equal(x.act('deliver'), true);
  assert.equal(x.s.contract, null);
  assert.deepEqual(x.paid, [{ amount: offer.pay, reason: 'bunker:sale:cartel' }]);
  assert.equal(CARTEL_SALE, 'bunker:sale:cartel');
  assert.deepEqual([x.s.done, x.s.failed, x.s.earned, x.s.rep], [1, 0, offer.pay, START_REP + REP_DONE]);
  assert.equal(x.s.nextOfferAt, x.now() + OFFER_GAP);
  assert.equal(x.events.at(-1)?.key, 'cartel.paid');
  assert.equal(x.me.products.length, 1, 'the weak unit is still yours');
});

test('one contract at a time', () => {
  const x = setup();
  x.tick();
  x.act('accept');
  // (An offer can't come while you have one, but an old save could have both.)
  x.s.offer = makeOffer(10, x.now(), 'k9', dice(0.5));
  assert.equal(x.act('accept'), false);
  assert.equal(x.events.at(-1)?.key, 'cartel.busy');
});

test('a missed deadline costs reputation and brings a warning; walking away does too', () => {
  const x = setup();
  x.s.rep = 50;
  x.tick();
  const offer = x.s.offer!;
  x.act('accept');
  pack(x.me, offer.product, 10, 1);
  x.act('deliver');
  x.later(offer.time);
  assert.equal(x.tick(), true);
  assert.equal(x.s.contract, null);
  assert.deepEqual([x.s.failed, x.s.rep], [1, 50 + REP_FAILED]);
  assert.deepEqual(x.events.at(-1), { key: 'cartel.missed', params: { grams: offer.grams }, level: 'warn' });
  assert.deepEqual(x.paid, [], 'and nothing paid for what you did hand over');

  x.later(OFFER_GAP);
  x.tick();
  x.act('accept');
  assert.equal(x.act('abandon'), true);
  assert.deepEqual([x.s.failed, x.s.rep], [2, 50 + 2 * REP_FAILED]);
  assert.equal(x.events.at(-1)?.key, 'cartel.abandoned');
  assert.equal(x.act('abandon'), false);
  // Never under nothing.
  x.s.rep = 3;
  x.later(OFFER_GAP);
  x.tick();
  x.act('accept');
  x.act('abandon');
  assert.equal(x.s.rep, 0);
});

test('delivering raises your reputation up the ladder to bigger offers, with a word when you go up a rung', () => {
  const x = setup();
  x.s.rep = 18;
  x.tick();
  const small = x.s.offer!;
  x.act('accept');
  pack(x.me, small.product, small.grams, 1);
  x.act('deliver');
  assert.equal(cartelTier(x.s.rep), 1);
  assert.ok(x.keys().includes('cartel.promoted.1'));
  x.later(OFFER_GAP);
  x.tick();
  assert.equal(x.s.offer?.tier, 1);
  assert.ok(x.s.offer!.pay > small.pay, 'a bigger offer');
});

test('haggling: once a contract, for more chips or more time, and a no costs a little reputation', () => {
  // Yes to the price.
  let x = setup(dice(0.5, 0));
  x.tick();
  const pay = x.s.offer!.pay;
  assert.equal(x.act('haggle', 'price'), true);
  assert.ok(x.s.offer!.pay > pay);
  assert.equal(x.s.offer!.haggled, true);
  assert.equal(ringing(x.s), false, 'haggling is talking to them');
  assert.equal(x.act('haggle', 'time'), false, 'once a contract');
  assert.equal(x.events.at(-1)?.key, 'cartel.haggledAlready');

  // Yes to more time, on a contract you've taken: its deadline moves.
  x = setup(dice(0.5, 0));
  x.tick();
  x.act('accept');
  const due = x.s.contract!.dueAt!;
  assert.equal(x.act('haggle', 'time'), true);
  assert.ok(x.s.contract!.dueAt! > due);
  assert.equal(x.events.at(-1)?.key, 'cartel.haggleYes.time');

  // No: the offer stands as it was, and your reputation takes a knock.
  x = setup(dice(0.5, 0.99));
  x.tick();
  const before = { ...x.s.offer! };
  assert.equal(x.act('haggle', 'price'), true);
  assert.deepEqual([x.s.offer!.pay, x.s.offer!.time], [before.pay, before.time]);
  assert.ok(x.s.rep < START_REP);
  assert.equal(x.events.at(-1)?.key, 'cartel.haggleNo.price');

  // Nonsense isn't haggling.
  x = setup();
  x.tick();
  assert.equal(x.act('haggle', 'friendship'), false);
  assert.equal(x.act('haggle'), false);
  assert.equal(x.s.offer!.haggled, false);
  assert.equal(x.act('nonsense'), false);
});

test('a saved cartel comes back as it was, and a damaged one is made safe', () => {
  const x = setup();
  x.tick();
  x.act('accept');
  const saved = JSON.parse(JSON.stringify(x.s));
  assert.deepEqual(x.handler.load(saved), x.s);
  const fresh = x.handler.initial();
  assert.deepEqual(x.handler.load(null), fresh);
  assert.deepEqual(x.handler.load('junk'), fresh);
  const bad = x.handler.load({ rep: 900, offer: { id: 'k3', product: 'unobtainium' }, contract: { ...saved.contract, dueAt: 'soon' }, done: -4, failed: 1.5, nextId: 1 });
  assert.equal(bad.rep, 100);
  assert.equal(bad.offer, null);
  assert.equal(bad.contract, null);
  assert.deepEqual([bad.done, bad.failed], [0, 0]);
  const kept = x.handler.load({ ...saved, nextId: 1 });
  assert.ok(kept.nextId > Number(saved.contract.id.slice(1)), "a new contract never takes an old one's id");
});

test('through the real bunker and chips: paid into the same chips as the casino, saved in bunker.json', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-office-cartel-'));
  const chips = new Chips(dir, { saveAfter: 0 });
  const sent: { id: string; msg: ServerMsg }[] = [];
  let now = 5_000_000;
  const A = 'account:ada';
  const bunker = new Bunker(dir, { chips, saveAfter: 0, now: () => now, send: (id, msg) => sent.push({ id, msg }), handlers: { cartel: makeCartel(dice(0.5)) } });
  const start = chips.balance(A);
  bunker.act(A, { feature: 'cartel', action: 'answer' }); // somebody new: nothing to pick up yet
  bunker.tick();
  assert.equal(bunker.state(A).cartel.offer, null, "they haven't heard of you");
  const me = (bunker as unknown as { people: Map<string, BunkerPerson> }).people.get(A)!;
  addUnit(me, { product: 'weed-kush', grams: 1, quality: 0, pack: 'bag' });
  bunker.tick();
  const offer = bunker.state(A).cartel.offer!;
  assert.ok(offer);
  assert.equal(bunker.act(A, { feature: 'cartel', action: 'accept' }), true);
  // Handing over packed product they made (straight in, as the packing table would).
  bunker.act(A, { feature: 'cartel', action: 'deliver' });
  addUnit(me, { product: offer.product, grams: offer.grams, quality: 1, pack: 'brick' });
  now += MIN;
  assert.equal(bunker.act(A, { feature: 'cartel', action: 'deliver' }), true);
  assert.equal(chips.balance(A), start + offer.pay);
  assert.equal(chips.ledger(A).at(-1)?.reason, 'bunker:sale:cartel');
  assert.ok(sent.some((m) => m.msg.t === 'bunker.event' && m.msg.event.key === 'cartel.paid'));
  bunker.flush();
  const again = new Bunker(dir, { chips, saveAfter: 0, now: () => now });
  const back = again.state(A).cartel;
  assert.deepEqual([back.done, back.rep, back.earned], [1, START_REP + REP_DONE, offer.pay]);
});

// ---- On the page ----------------------------------------------------------------------------------------

// A canvas that draws nothing: enough for the room's textures to be built in Node.
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) =>
      k === 'measureText'
        ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
        : k === 'createLinearGradient' || k === 'createRadialGradient'
          ? () => ({ addColorStop() {} })
          : noop(),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
if (typeof document === 'undefined')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

test('the phone on the wall: inside its spot, clear in front, and it rings, blinks and rattles for an offer', async () => {
  const THREE = await import('three');
  const { buildCartel, RING_EVERY } = await import('../src/client/world/drugbunker/cartel.js');
  const spot = BUNKER_STATIONS.cartel;
  const view = buildCartel(spot);
  view.group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(view.group);
  const s = stationBox(spot);
  assert.ok(b.min.x >= s.minX - 0.02 && b.max.x <= s.maxX + 0.02 && b.min.z >= s.minZ - 0.02 && b.max.z <= s.maxZ + 0.02, 'inside its spot');
  assert.ok(b.max.y <= spot.h + 0.01);
  const front = stationFront(spot);
  for (const c of view.colliders ?? []) assert.ok(!(front.x > c.minX && front.x < c.maxX && front.z > c.minZ && front.z < c.maxZ), 'you can stand in front of it');

  const offer = makeOffer(10, 0, 'k1', dice(0.5));
  const mine = (cartel: Partial<CartelState>) => ({ cartel: { ...setup().s, ...cartel } }) as unknown as BunkerPerson;
  const dark = view.lamp.color.getHex();
  view.update!(0, 0.016, mine({ offer, answered: null }));
  assert.equal(view.isRinging(), true);
  assert.equal(view.bell.rings, 1, 'it rings at once…');
  assert.notEqual(view.lamp.color.getHex(), dark, 'the lamp is lit');
  view.update!(0.01, 0.01, mine({ offer, answered: null }));
  assert.notEqual(view.handset.rotation.z, 0, 'the handset rattles');
  view.update!(RING_EVERY / 2, 0.016, mine({ offer, answered: null }));
  assert.equal(view.bell.rings, 1);
  view.update!(RING_EVERY + 0.1, 0.016, mine({ offer, answered: null }));
  assert.equal(view.bell.rings, 2, '…and again every so often');
  view.update!(RING_EVERY + 0.2, 0.016, mine({ offer, answered: 'k1' }));
  assert.equal(view.isRinging(), false, 'picked up: quiet');
  assert.equal(view.lamp.color.getHex(), dark);
  assert.equal(view.handset.rotation.z, 0);
  view.update!(99, 0.016, null);
  assert.equal(view.bell.rings, 2);
});

test('the panel: your standing, the offer or the contract in words, the clocks, in both languages', async () => {
  const { setLang, t } = await import('../src/client/i18n/index.js');
  const { clock, minutes, contractTerms, standing } = await import('../src/client/ui/bunker/cartel.js');
  const { bunkerHelp, PC_APPS } = await import('../src/client/ui/bunker/index.js');
  assert.equal(clock(65_000), '1:05');
  assert.equal(clock(3_723_000), '1:02:03');
  assert.equal(clock(-5), '0:00');
  assert.equal(minutes(30 * MIN), '30 min');
  assert.equal(minutes(1), '1 min');
  assert.ok(PC_APPS.some((a) => a.id === 'cartel'));
  const c = { ...makeOffer(10, 0, 'k1', dice(0.5)), product: 'weed-haze', grams: 400, minQuality: 0.6, pay: 2016 };
  setLang('en');
  const en = contractTerms(c);
  assert.equal(en.want, '400 g Neon Haze');
  assert.ok(en.terms.includes('quality at least 60 %'));
  assert.ok(en.terms.includes('packed'));
  assert.match(en.pay, /2,016 chips/);
  assert.match(bunkerHelp(), /cartel/i);
  const s = { ...setup().s, rep: 45, done: 3, failed: 1, earned: 5000 };
  assert.deepEqual(standing(s), { rank: 'Supplier', rep: 45, next: '60 for Partner', record: '3 delivered · 1 missed · 5,000 chips' });
  assert.equal(standing({ ...s, rep: 90 }).next, 'As high as it goes');
  setLang('de');
  const de = contractTerms(c);
  assert.equal(de.want, '400 g Neon-Haze');
  assert.ok(de.terms.includes('Qualität mindestens 60 %'));
  assert.equal(standing(s).rank, 'Lieferant');
  assert.match(t('bunker.cartel.missed', { grams: 400 }), /400 Gramm/);
  setLang('en');
});

test('every toast the server sends is a text, in both languages', async () => {
  const { tables } = await import('../src/client/i18n/index.js');
  const cartelTexts = (await import('../src/client/i18n/bunker/cartel.js')).default;
  const x = setup(dice(0.5, 0));
  x.s.rep = 18;
  x.tick();
  x.act('decline');
  x.later(OFFER_GAP);
  x.tick();
  x.act('haggle', 'price');
  x.act('haggle', 'time');
  x.act('accept');
  x.act('deliver');
  const c = x.s.contract!;
  pack(x.me, c.product, 10, 1);
  x.act('deliver');
  pack(x.me, c.product, c.grams, 1);
  x.act('deliver');
  x.later(OFFER_GAP);
  x.tick();
  x.act('accept');
  x.act('abandon');
  x.later(OFFER_GAP);
  x.tick();
  x.act('accept');
  x.later(x.s.contract!.time);
  x.tick();
  const keys = new Set([...x.keys(), 'cartel.busy', 'cartel.haggleNo.price', 'cartel.haggleNo.time', 'cartel.haggleYes.time', ...[1, 2, 3, 4].map((n) => `cartel.promoted.${n}`)]);
  assert.ok(keys.size >= 14);
  for (const key of keys) {
    assert.ok(Object.hasOwn(cartelTexts.en, key), `${key} in English`);
    assert.ok(Object.hasOwn(cartelTexts.de, key), `${key} in German`);
  }
  assert.ok(tables.bunker, 'the bunker has its table');
});
