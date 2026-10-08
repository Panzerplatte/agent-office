// The bunker's customers (#123): orders coming in and running out, accepting, declining and haggling,
// delivering from the packed stash for chips, how hooked they get and what that does, free samples,
// friends of happy customers, the saved state made safe, and what the panel and the door lamp show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addUnit, bunkerSaleReason, type BunkerPerson } from '../src/shared/bunker/index.js';
import { productKind } from '../src/shared/bunker/items.js';
import {
  HOOK,
  PROSPECTS,
  SAMPLE_EVERY,
  STARTERS,
  TROUBLE_AT,
  WEAR_OFF,
  addictionNow,
  customerCap,
  priceLimit,
  setAddiction,
  unitShort,
  unitsFor,
  type Customer,
  type CustomersState,
} from '../src/shared/bunker/customers.js';
import { customers, makeCustomers } from '../src/server/bunker/customers.js';
import type { BunkerCtx } from '../src/server/bunker/feature.js';
import { Bunker } from '../src/server/bunker/index.js';
import { Chips } from '../src/server/chips.js';
import { START_CHIPS } from '../src/shared/chips.js';
import type { ServerMsg } from '../src/shared/protocol.js';

const MIN = 60_000;
const T0 = 1_700_000_000_000;

/** Dice that always roll `v`. */
const fixed = (v: number) => () => v;

/** Someone's bunker with only the customers in it, and a ctx that records chips and toasts. */
function world(rand = fixed(0.5)) {
  const handler = makeCustomers(rand);
  const me = { inventory: {}, products: [], nextUnit: 1, customers: handler.initial() } as unknown as BunkerPerson;
  const paid: { amount: number; reason: string }[] = [];
  const events: { key: string; params?: Record<string, string | number>; level?: string }[] = [];
  let now = T0;
  const ctx = (): BunkerCtx => ({
    id: 'account:ada',
    now,
    me,
    balance: () => 0,
    pay: (amount, reason) => {
      if (!Number.isSafeInteger(amount) || amount <= 0) return false;
      paid.push({ amount, reason });
      return true;
    },
    spend: () => false,
    event: (key, params, level) => events.push({ key, params, level }),
  });
  const state = me.customers as CustomersState;
  return {
    handler,
    me,
    state,
    paid,
    events,
    ctx,
    act: (action: string, args?: unknown) => handler.act(ctx(), state, action, args),
    tick: () => handler.tick(ctx(), state),
    wait: (ms: number) => (now += ms),
    now: () => now,
  };
}

/** A world with the starters there and `c1` holding an order. */
function withOrder(rand = fixed(0.5)) {
  const w = world(rand);
  w.act('open');
  w.wait(2 * MIN);
  w.tick();
  const c = w.state.list[0];
  assert.ok(c.order, 'c1 sent an order');
  return { ...w, c };
}

/** Puts packed units of `product` in the stash: `n` bags holding `holds` grams with `grams` in each. */
function pack(me: BunkerPerson, product: string, n: number, opts: { grams?: number; quality?: number; pack?: string } = {}) {
  const pk = opts.pack ?? 'bag';
  const holds = pk === 'bag' ? 1 : pk === 'bag-big' ? 10 : 100;
  return Array.from({ length: n }, () => addUnit(me, { product, grams: opts.grams ?? holds, quality: opts.quality ?? 0.6, pack: pk })!.id);
}

// ---- Starting out -----------------------------------------------------------------------------------

test('someone new has no customers until they first look, then the few starters, each with all of theirs', () => {
  const w = world();
  assert.deepEqual(w.state.list, []);
  assert.equal(w.tick(), false, 'nothing happens before they look');
  assert.equal(w.act('open'), true);
  assert.equal(w.state.list.length, STARTERS);
  assert.equal(w.act('open'), false, 'only once');
  for (const c of w.state.list) {
    assert.match(c.id, /^c\d+$/);
    assert.ok(c.name && c.face);
    assert.ok(productKind(c.favourite), `${c.name} likes a real product`);
    assert.ok(c.budget > 0 && c.tolerance > 0 && c.tolerance <= 1);
    assert.equal(c.addiction, 0);
    assert.equal(c.opinion, 50);
    assert.equal(c.order, undefined);
  }
  assert.equal(new Set(w.state.list.map((c) => c.id)).size, STARTERS);
  // A cap that grows with the reputation.
  assert.equal(customerCap(0), STARTERS);
  assert.ok(customerCap(60) > customerCap(10));
  assert.equal(customerCap(1000), PROSPECTS.length);
});

test('customers text orders after a while: what, how much, for how much (within their budget) and by when', () => {
  const w = world();
  w.act('open');
  assert.equal(w.tick(), false, 'not straight away');
  w.wait(2 * MIN);
  assert.equal(w.tick(), true);
  for (const c of w.state.list) {
    const o = c.order!;
    assert.ok(o, `${c.name} ordered`);
    assert.equal(o.product, c.favourite);
    assert.ok(o.grams >= 1 && Number.isInteger(o.grams));
    assert.ok(Number.isSafeInteger(o.price) && o.price > 0 && o.price <= c.budget, `${c.name} offers within their budget`);
    assert.ok(o.due > w.now() + 5 * MIN);
    assert.equal(o.agreed, false);
    assert.deepEqual(c.chat.at(-1), { from: 'them', key: 'order', at: w.now(), params: { product: o.product, grams: o.grams, price: o.price } });
  }
  assert.deepEqual(w.events, [], 'orders come in quietly (no toast wherever you are): the list and the door lamp show them');
});

test('an order nobody answers runs out, and they mind it more if you had said yes', () => {
  const w = withOrder();
  const [a, b] = w.state.list;
  b.order!.agreed = true;
  const before = [a.opinion, b.opinion];
  w.wait(20 * MIN);
  w.tick();
  assert.equal(a.chat.at(-1)!.key, 'late');
  assert.equal(a.order, undefined);
  assert.ok(a.opinion < before[0]);
  assert.ok(before[1] - b.opinion > before[0] - a.opinion, 'a broken promise costs more');
  assert.ok(a.nextOrderAt > w.now(), 'and they order again later');
});

// ---- Answering an order -----------------------------------------------------------------------------

test('accept agrees on their price, decline turns them down', () => {
  const w = withOrder();
  const [a, b] = w.state.list;
  assert.equal(w.act('accept', { customer: a.id }), true);
  assert.equal(a.order!.agreed, true);
  assert.equal(w.act('accept', { customer: a.id }), false, 'once');
  assert.equal(w.act('counter', { customer: a.id, price: 1 }), false, 'no haggling after a deal');
  const was = b.opinion;
  assert.equal(w.act('decline', { customer: b.id }), true);
  assert.equal(b.order, undefined);
  assert.ok(b.opinion < was);
  assert.equal(w.act('decline', { customer: b.id }), false);
  assert.equal(w.act('accept', { customer: 'c99' }), false, 'nobody of that id');
  assert.equal(w.act('accept', 'c1'), false);
  assert.equal(w.act('dance', { customer: a.id }), false);
});

test('a counter-offer up to what they can stretch to they take; more and they come part of the way; far more and they walk off', () => {
  const w = withOrder();
  const [a, b, c] = w.state.list;
  // Asking less: gladly.
  const less = a.order!.price - 1;
  assert.equal(w.act('counter', { customer: a.id, price: less }), true);
  assert.deepEqual([a.order!.price, a.order!.agreed, a.chat.at(-1)!.key], [less, true, 'deal']);
  // Up to their limit: a deal at your price.
  const limit = priceLimit(b, b.order!, w.now());
  assert.ok(limit > b.order!.price, 'they have some room');
  assert.equal(w.act('counter', { customer: b.id, price: limit }), true);
  assert.deepEqual([b.order!.price, b.order!.agreed], [limit, true]);
  // A bit over: they come up some of the way, not all of it.
  const offer = c.order!.price;
  const cl = priceLimit(c, c.order!, w.now());
  assert.equal(w.act('counter', { customer: c.id, price: cl + 1 }), true);
  assert.equal(c.order!.agreed, false);
  assert.ok(c.order!.price > offer && c.order!.price <= cl, 'they meet you part of the way');
  assert.equal(c.chat.at(-1)!.key, 'meet');
  // Far over: gone, and they think less of you.
  const was = c.opinion;
  assert.equal(w.act('counter', { customer: c.id, price: cl * 3 }), true);
  assert.equal(c.order, undefined);
  assert.equal(c.chat.at(-1)!.key, 'walk');
  assert.ok(c.opinion < was);
  assert.deepEqual(w.events.at(-1), { key: 'customers.walked', params: { name: c.name }, level: 'warn' });
  // Nonsense prices change nothing.
  for (const price of [0, -5, 1.5, 'lots', null, 1e9]) assert.equal(w.act('counter', { customer: a.id, price }), false);
});

test('haggling too often makes them walk off too, but a hooked customer just grumbles and stays', () => {
  const w = withOrder();
  const [a, b] = w.state.list;
  for (let i = 0; i < 3; i++) w.act('counter', { customer: a.id, price: priceLimit(a, a.order!, w.now()) + 1 });
  assert.equal(a.order, undefined, 'walked off after the third');
  setAddiction(b, w.now(), 80);
  const offer = b.order!.price;
  w.act('counter', { customer: b.id, price: offer * 10 });
  assert.ok(b.order, 'still there');
  assert.equal(b.chat.at(-1)!.key, 'grumble');
});

test("what they'll pay goes up with how hooked they are, their mood and your quality, never past their budget", () => {
  const w = withOrder();
  const c = w.state.list[0];
  const o = c.order!;
  const base = priceLimit(c, o, w.now());
  setAddiction(c, w.now(), 90);
  assert.ok(priceLimit(c, o, w.now()) > base, 'hooked: more');
  setAddiction(c, w.now(), 0);
  c.lastQuality = 1;
  assert.ok(priceLimit(c, o, w.now()) > base, 'good stuff last time: more');
  c.lastQuality = 0.5;
  c.mood = 0.1;
  assert.ok(priceLimit(c, o, w.now()) < base, 'a bad day: less');
  c.mood = 1;
  setAddiction(c, w.now(), 100);
  c.lastQuality = 1;
  c.budget = o.price + 3;
  assert.equal(priceLimit(c, o, w.now()), o.price + 3, 'the budget caps it');
});

// ---- Delivering -------------------------------------------------------------------------------------

test('delivering from the packed stash pays the price in chips as a sale to that customer, and hooks them', () => {
  const w = withOrder();
  const c = w.c;
  const o = c.order!;
  const units = pack(w.me, o.product, o.grams);
  pack(w.me, o.product, 1);
  const loose = addUnit(w.me, { product: o.product, grams: 5, quality: 0.6 })!.id;
  assert.deepEqual(unitsFor(w.me, o).length, o.grams + 1, 'only packed units of what they want');
  assert.equal(w.act('deliver', { customer: c.id, units: [loose] }), false, 'not loose product');
  assert.equal(w.act('deliver', { customer: c.id, units: units.slice(1) }), false, 'not too little');
  assert.equal(w.events.at(-1)!.key, 'customers.tooLittle');
  assert.equal(w.act('deliver', { customer: c.id, units: [units[0], units[0]] }), false, 'not a unit twice');
  assert.equal(w.act('deliver', { customer: c.id, units: 'u1' }), false);
  const price = o.price;
  assert.equal(w.act('deliver', { customer: c.id, units }), true);
  assert.deepEqual(w.paid, [{ amount: price, reason: bunkerSaleReason(c.id) }]);
  assert.equal(w.me.products.length, 2, 'the delivered units are gone from the stash');
  assert.equal(c.order, undefined);
  assert.deepEqual(c.last, { product: o.product, grams: o.grams, price, at: w.now() });
  const kind = productKind(o.product)!;
  assert.ok(c.addiction > 0 && c.addiction <= HOOK * kind.addictiveness * 2 + 1e-9, 'hooked by how addictive it is');
  assert.ok(c.opinion > 50, 'decent stuff, the right weight: happy');
  assert.deepEqual(w.events.at(-1), { key: 'customers.sold', params: { name: c.name, chips: price }, level: undefined });
  assert.equal(w.act('deliver', { customer: c.id, units: w.me.products.map((u) => u.id) }), false, 'no order, no sale');
});

test('the wrong product is turned away; short bags and weak stuff they mind, the good stuff they love', () => {
  const run = (opts: { grams?: number; quality?: number }) => {
    const w = withOrder();
    const o = w.c.order!;
    const ids = pack(w.me, o.product, o.grams, opts);
    assert.equal(w.act('deliver', { customer: w.c.id, units: ids }), true);
    return { w, c: w.c };
  };
  {
    const w = withOrder();
    const other = w.c.order!.product === 'nebula' ? 'glimmer' : 'nebula';
    const ids = pack(w.me, other, w.c.order!.grams);
    assert.equal(w.act('deliver', { customer: w.c.id, units: ids }), false);
    assert.equal(w.events.at(-1)!.key, 'customers.wrongUnits');
  }
  const short = run({ grams: 0.8 });
  assert.ok(unitShort({ id: 'x', product: 'fizz', grams: 0.8, quality: 1, pack: 'bag' }));
  assert.ok(!unitShort({ id: 'x', product: 'fizz', grams: 1, quality: 1, pack: 'bag' }));
  assert.equal(short.c.chat.at(-1)!.key, 'short');
  assert.ok(short.c.opinion < 50);
  const weak = run({ quality: 0.1 });
  assert.equal(weak.c.chat.at(-1)!.key, 'weak');
  assert.ok(weak.c.opinion < 50);
  assert.equal(weak.c.lastQuality, 0.1, 'and expect less next time');
  const great = run({ quality: 0.95 });
  assert.equal(great.c.chat.at(-1)!.key, 'great');
  assert.ok(great.c.opinion > run({ quality: 0.6 }).c.opinion);
  assert.ok(great.w.state.reputation > short.w.state.reputation);
});

// ---- Hooked -----------------------------------------------------------------------------------------

test('being hooked wears off without anything, and makes them order more, more often, for more', () => {
  const c = { addiction: 50, addictionAt: T0 } as Customer;
  assert.equal(addictionNow(c, T0), 50);
  assert.equal(addictionNow(c, T0 + 10 * MIN), 50 - 10 * WEAR_OFF);
  assert.equal(addictionNow(c, T0 + 10_000 * MIN), 0);
  assert.equal(addictionNow(c, T0 - MIN), 50, 'not up before it happened');

  const orderOf = (hooked: number) => {
    const w = world();
    w.act('open');
    const c = w.state.list[1];
    c.budget = 1e6;
    setAddiction(c, w.now(), hooked);
    w.wait(2 * MIN);
    w.tick();
    const o = c.order!;
    w.act('decline', { customer: c.id });
    return { grams: o.grams, perGram: o.price / o.grams, gap: c.nextOrderAt - w.now() };
  };
  const clean = orderOf(0);
  const hooked = orderOf(80);
  assert.ok(hooked.grams > clean.grams, 'more');
  assert.ok(hooked.perGram > clean.perGram, 'for more a gram');
  assert.ok(hooked.gap < clean.gap, 'and sooner again');
});

test('too hooked, they may get into trouble: no orders for a while, then they are back', () => {
  const w = world(fixed(0));
  w.act('open');
  const c = w.state.list[0];
  setAddiction(c, w.now(), TROUBLE_AT + 10);
  w.wait(2 * MIN);
  w.tick();
  assert.equal(c.order, undefined);
  assert.ok(c.troubleUntil && c.troubleUntil > w.now());
  assert.equal(c.chat.at(-1)!.key, 'trouble');
  assert.ok(addictionNow(c, w.now()) < TROUBLE_AT, 'it knocks them down a bit');
  w.wait(10 * MIN);
  w.tick();
  assert.equal(c.order, undefined, 'still lying low');
  assert.equal(w.act('sample', { customer: c.id, unit: pack(w.me, 'fizz', 1)[0] }), true, 'though a sample still reaches them');
  w.wait(15 * MIN);
  w.tick();
  assert.equal(c.troubleUntil, undefined);
  assert.ok(c.chat.some((l) => l.key === 'back'));
  assert.ok(c.order, 'and ordering again');
});

test('a free sample hooks them and brings an order on soon, but only now and then', () => {
  const w = world();
  w.act('open');
  const c = w.state.list[2];
  const [bag, other] = pack(w.me, 'nebula', 2, { quality: 0.8 });
  const brick = pack(w.me, 'nebula', 1, { pack: 'brick' })[0];
  assert.equal(w.act('sample', { customer: c.id, unit: brick }), false, 'not a whole brick');
  assert.equal(w.act('sample', { customer: c.id, unit: 'u999' }), false);
  assert.equal(w.act('sample', { customer: c.id, unit: bag }), true);
  assert.ok(c.addiction > 0);
  assert.equal(
    w.me.products.some((u) => u.id === bag),
    false,
    'given away',
  );
  assert.deepEqual(w.paid, [], 'for nothing');
  assert.equal(c.last?.price, 0);
  assert.ok(c.nextOrderAt <= w.now() + 2.5 * MIN);
  assert.ok(c.opinion > 50);
  assert.equal(w.act('sample', { customer: c.id, unit: other }), false, 'not again straight away');
  assert.equal(w.events.at(-1)!.key, 'customers.sampleSoon');
  w.wait(SAMPLE_EVERY);
  assert.equal(w.act('sample', { customer: c.id, unit: other }), true);
});

// ---- Word of mouth ----------------------------------------------------------------------------------

test('a happy customer brings a friend, up to the cap the reputation allows', () => {
  const w = world();
  w.act('open');
  w.tick();
  assert.equal(w.state.list.length, STARTERS, 'nobody happy enough yet');
  w.state.list[0].opinion = 80;
  w.tick();
  assert.equal(w.state.list.length, STARTERS, 'and no room with a small reputation');
  w.state.reputation = 30;
  assert.equal(w.tick(), true);
  assert.equal(w.state.list.length, STARTERS + 1);
  const friend = w.state.list.at(-1)!;
  assert.equal(friend.referredBy, w.state.list[0].name);
  assert.equal(friend.name, PROSPECTS[STARTERS].name);
  assert.equal(friend.id, `c${STARTERS + 1}`);
  assert.equal(friend.chat[0].key, 'hello');
  assert.equal(w.events.at(-1)!.key, 'customers.referred');
  w.tick();
  assert.equal(w.state.list.length, STARTERS + 1, 'not another one straight away');
  w.wait(60 * MIN);
  w.tick();
  assert.equal(w.state.list.length, customerCap(30), 'up to the cap');
  w.wait(60 * MIN);
  w.tick();
  assert.equal(w.state.list.length, customerCap(30));
});

// ---- Saved --------------------------------------------------------------------------------------------

test('what was saved comes back as it was, and anything broken in it is made safe', () => {
  const w = withOrder();
  w.c.chat.push({ from: 'me', key: 'counter', at: 1, params: { price: 5 } });
  const back = customers.load(JSON.parse(JSON.stringify(w.state)));
  assert.deepEqual(back, w.state);
  for (const raw of [null, 3, 'x', [], { list: 'no' }]) assert.deepEqual(customers.load(raw), customers.initial());
  const messy = customers.load({
    list: [
      {
        id: 'c1',
        name: 'Benny Bolt',
        favourite: 'weed-kush',
        opinion: 900,
        addiction: -4,
        order: { product: 'nope', grams: 3, price: 10 },
        chat: [
          { from: 'you', key: 'x' },
          { from: 'them', key: 'order', params: { price: 3, bad: {} } },
        ],
      },
      { id: 'c1', name: 'Twice', favourite: 'weed-kush' },
      { id: 'zz', name: 'Bad id', favourite: 'weed-kush' },
      { id: 'c4', name: 'No such product', favourite: 'plutonium' },
      { id: 'c7', name: 'Rita Rocket', favourite: 'weed-haze', order: { product: 'weed-haze', grams: 2, price: 30, due: 5, agreed: 'yes' } },
    ],
    nextId: 2,
    reputation: 'high',
  });
  assert.deepEqual(
    messy.list.map((c) => c.id),
    ['c1', 'c7'],
  );
  assert.equal(messy.list[0].opinion, 100);
  assert.equal(messy.list[0].addiction, 0);
  assert.equal(messy.list[0].order, undefined, 'an order of nothing real is dropped');
  assert.deepEqual(messy.list[0].chat, [{ from: 'them', key: 'order', at: 0, params: { price: 3 } }]);
  assert.deepEqual(messy.list[1].order, { product: 'weed-haze', grams: 2, price: 30, due: 5, haggles: 0, agreed: false });
  assert.equal(messy.nextId, 8, 'new ids never clash with old ones');
  assert.equal(messy.reputation, 10);
});

test('in the real bunker: a sale goes through the chips ledger as bunker:sale:<customer>, and is saved', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-office-customers-'));
  const chips = new Chips(dir, { saveAfter: 0 });
  const sent: ServerMsg[] = [];
  let now = T0;
  const A = 'account:ada';
  const bunker = new Bunker(dir, { chips, saveAfter: 0, now: () => now, send: (_id, msg) => sent.push(msg) });
  assert.equal(bunker.act(A, { feature: 'customers', action: 'open' }), true);
  now += 2 * MIN;
  bunker.tick();
  const c = bunker.state(A).customers.list[0];
  assert.ok(c.order);
  // Some packed product of theirs, the way the packing table leaves it (straight into the stash here).
  const me = (bunker as unknown as { people: Map<string, BunkerPerson> }).people.get(A)!;
  const ids = pack(me, c.order.product, c.order.grams);
  assert.equal(bunker.act(A, { feature: 'customers', action: 'deliver', args: { customer: c.id, units: ids } }), true);
  assert.equal(chips.balance(A), START_CHIPS + c.order.price);
  assert.deepEqual(
    chips.ledger(A).map((e) => [e.amount, e.reason]),
    [[c.order.price, `bunker:sale:${c.id}`]],
  );
  assert.ok(sent.some((m) => m.t === 'bunker.event' && m.event.key === 'customers.sold'));
  bunker.flush();
  const again = new Bunker(dir, { chips, saveAfter: 0, now: () => now });
  assert.deepEqual(again.state(A).customers, bunker.state(A).customers);
  assert.equal(again.state(A).products.length, 0);
});

// ---- On the page --------------------------------------------------------------------------------------

test('every text a customer (or you) can say, and every toast, is there in both languages', async () => {
  const { setLang, t } = await import('../src/client/i18n/index.js');
  const { chatText, customerRow } = await import('../src/client/ui/bunker/customers.js');
  const keys = ['order', 'counter', 'accept', 'decline', 'deal', 'meet', 'grumble', 'walk', 'delivered', 'thanks', 'great', 'weak', 'short', 'sample', 'sampled', 'hello', 'late', 'trouble', 'back'];
  const toasts = ['sold', 'walked', 'wrongUnits', 'tooLittle', 'sampleSoon', 'sampleGiven', 'referred'];
  for (const lang of ['en', 'de'] as const) {
    setLang(lang);
    for (const k of keys) assert.doesNotMatch(chatText({ key: k, params: { product: 'nebula', grams: 3, price: 40, by: 'Gus' } }), /^bunker\.|\{/, `${k} in ${lang}`);
    for (const k of toasts) assert.doesNotMatch(t(`bunker.customers.${k}` as never, { name: 'Gus', by: 'Mo', chips: 3, grams: 2 }), /^bunker\.|\{/, `${k} in ${lang}`);
    assert.doesNotMatch(t('bunker.customers.help'), /^bunker\./);
  }
  setLang('en');
  assert.equal(chatText({ key: 'order', params: { product: 'nebula', grams: 3, price: 40 } }), "Hey, got 3 g of Nebula? I'd pay 40 chips.");
  // The list: how hooked, what they think of you, what they last bought, their order.
  const w = withOrder();
  const ids = pack(w.me, w.c.order!.product, w.c.order!.grams);
  const row = customerRow(w.c, w.now());
  assert.equal(row.last, 'Never bought yet');
  assert.match(row.order, /chips$/);
  assert.ok(row.minutes! >= 8);
  w.act('deliver', { customer: w.c.id, units: ids });
  const after = customerRow(w.c, w.now());
  assert.match(after.last, new RegExp(`^Last: ${w.c.last!.grams} g `));
  assert.equal(after.order, 'No order');
  assert.ok(after.addiction > 0);
  w.c.troubleUntil = w.now() + MIN;
  assert.equal(customerRow(w.c, w.now()).order, 'In trouble, lying low');
});

test("the lamp over the door shows when an order's waiting, and blinks when one's about to run out", async () => {
  const { ordersWaiting } = await import('../src/client/world/drugbunker/customers.js');
  assert.deepEqual(ordersWaiting(null, T0), { waiting: 0, hurry: false });
  const w = withOrder();
  assert.deepEqual(ordersWaiting(w.me, w.now()), { waiting: STARTERS, hurry: false });
  w.state.list[0].order!.due = w.now() + MIN;
  w.state.list[1].troubleUntil = w.now() + MIN;
  assert.deepEqual(ordersWaiting(w.me, w.now()), { waiting: STARTERS - 1, hurry: true });
});
