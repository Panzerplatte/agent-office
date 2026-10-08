// The bunker's customers feature on the server (see shared/bunker/customers.ts): the customers' orders
// coming in and running out, your answers to them (accept, decline, a counter-offer), delivering from
// your packed stash for chips, free samples, how hooked they get, and new customers through happy ones.
import { bunkerSaleReason, takeUnit, type ProductUnit } from '../../shared/bunker/index.js';
import { PRODUCTS, productKind, productValue } from '../../shared/bunker/items.js';
import {
  DUE_MAX,
  DUE_MIN,
  HOOK,
  ORDER_EVERY,
  PROSPECTS,
  REFERRAL_EVERY,
  SAMPLE_EVERY,
  STARTERS,
  TROUBLE_AT,
  TROUBLE_FOR,
  addictionNow,
  customerCap,
  inTrouble,
  newCustomer,
  nextProspect,
  niceGrams,
  priceLimit,
  say,
  setAddiction,
  unitNominal,
  unitShort,
  type ChatLine,
  type Customer,
  type CustomersState,
  type Order,
} from '../../shared/bunker/customers.js';
import type { BunkerCtx, BunkerFeatureHandler } from './feature.js';

const MIN = 60_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
const str = (v: unknown, max = 40) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);

function initial(): CustomersState {
  return { list: [], nextId: 1, reputation: 10, nextReferralAt: 0 };
}

// ---- Loading what was saved -------------------------------------------------------------------------

function loadOrder(raw: unknown): Order | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (!productKind(o.product)) return undefined;
  const grams = num(o.grams, 0, 1000, 0);
  const price = num(o.price, 0, 1e7, 0);
  if (!(grams > 0) || !Number.isSafeInteger(price) || price <= 0) return undefined;
  return { product: o.product as string, grams, price, due: num(o.due, 0, 1e15, 0), haggles: Math.round(num(o.haggles, 0, 9, 0)), agreed: o.agreed === true };
}

function loadChat(raw: unknown): ChatLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: ChatLine[] = [];
  for (const l of raw.slice(-10)) {
    if (!l || typeof l !== 'object') continue;
    const { from, key, params, at } = l as Record<string, unknown>;
    if ((from !== 'them' && from !== 'me') || !str(key) || !/^[a-zA-Z]+$/.test(key as string)) continue;
    const p: Record<string, string | number> = {};
    if (params && typeof params === 'object') for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) p[k] = v;
    lines.push({ from, key: key as string, at: num(at, 0, 1e15, 0), ...(Object.keys(p).length ? { params: p } : {}) });
  }
  return lines;
}

function loadCustomer(raw: unknown): Customer | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const id = str(c.id);
  const name = str(c.name);
  if (!id || !/^c\d+$/.test(id) || !name || !productKind(c.favourite)) return undefined;
  const last = c.last && typeof c.last === 'object' ? (c.last as Record<string, unknown>) : undefined;
  const order = loadOrder(c.order);
  return {
    id,
    name,
    face: str(c.face, 16) ?? '🙂',
    favourite: c.favourite as string,
    budget: Math.round(num(c.budget, 1, 1e6, 100)),
    tolerance: num(c.tolerance, 0, 1, 0.2),
    appetite: num(c.appetite, 1, 100, 3),
    addiction: num(c.addiction, 0, 100, 0),
    addictionAt: num(c.addictionAt, 0, 1e15, 0),
    opinion: num(c.opinion, 0, 100, 50),
    mood: num(c.mood, 0, 1, 0.6),
    lastQuality: num(c.lastQuality, 0, 1, 0.5),
    ...(last && productKind(last.product)
      ? { last: { product: last.product as string, grams: num(last.grams, 0, 1e4, 0), price: Math.round(num(last.price, 0, 1e7, 0)), at: num(last.at, 0, 1e15, 0) } }
      : {}),
    ...(order ? { order } : {}),
    nextOrderAt: num(c.nextOrderAt, 0, 1e15, 0),
    ...(typeof c.troubleUntil === 'number' && Number.isFinite(c.troubleUntil) ? { troubleUntil: c.troubleUntil } : {}),
    ...(typeof c.sampleAt === 'number' && Number.isFinite(c.sampleAt) ? { sampleAt: c.sampleAt } : {}),
    ...(str(c.referredBy) ? { referredBy: c.referredBy as string } : {}),
    chat: loadChat(c.chat),
  };
}

function load(raw: unknown): CustomersState {
  if (!raw || typeof raw !== 'object') return initial();
  const r = raw as Record<string, unknown>;
  const list: Customer[] = [];
  const ids = new Set<string>();
  for (const c of Array.isArray(r.list) ? r.list : []) {
    const made = loadCustomer(c);
    if (!made || ids.has(made.id) || list.length >= PROSPECTS.length) continue;
    ids.add(made.id);
    list.push(made);
  }
  const highest = list.reduce((n, c) => Math.max(n, Number(c.id.slice(1))), 0);
  const nextId = typeof r.nextId === 'number' && Number.isSafeInteger(r.nextId) && r.nextId > highest ? r.nextId : highest + 1;
  return { list, nextId, reputation: num(r.reputation, 0, 100, 10), nextReferralAt: num(r.nextReferralAt, 0, 1e15, 0) };
}

// ---- The rules --------------------------------------------------------------------------------------

/** The customers feature, with its own dice (tests pass their own). */
export function makeCustomers(rand: () => number = Math.random): BunkerFeatureHandler<CustomersState> {
  const between = (lo: number, hi: number) => lo + (hi - lo) * rand();

  /** The first few customers, the first time you open the app. */
  function seed(state: CustomersState, now: number): boolean {
    if (state.list.length) return false;
    for (const p of PROSPECTS.slice(0, STARTERS)) state.list.push(newCustomer(p, `c${state.nextId++}`, now, between(0.3, 1.5) * MIN));
    return true;
  }

  /** How long until `c` next orders: sooner the more hooked, later the less they like you. */
  function orderGap(c: Customer, now: number): number {
    const hooked = addictionNow(c, now);
    return (ORDER_EVERY * between(0.7, 1.3) * (c.opinion < 20 ? 3 : 1.4 - c.opinion / 100)) / (1 + hooked / 40);
  }

  /** `c` sends an order (or, too hooked, gets into trouble instead). Whether either happened. */
  function order(c: Customer, now: number) {
    const hooked = addictionNow(c, now);
    if (hooked > TROUBLE_AT && rand() < 0.2 + (hooked - TROUBLE_AT) / 30) {
      c.troubleUntil = now + TROUBLE_FOR;
      setAddiction(c, now, hooked - 30);
      delete c.order;
      say(c, 'them', 'trouble', now);
      c.nextOrderAt = c.troubleUntil;
      return;
    }
    c.mood = between(0.25, 1);
    // Mostly their favourite; the more hooked, the likelier what you last gave them.
    let product = c.favourite;
    if (c.last && c.last.product !== product && rand() < hooked / 100) product = c.last.product;
    else if (rand() < 0.15) product = PRODUCTS[Math.floor(rand() * PRODUCTS.length)].id;
    const kind = productKind(product)!;
    let grams = niceGrams(c.appetite * (1 + hooked / 50) * between(0.7, 1.3));
    const priceOf = (g: number) => Math.max(1, Math.round(productValue(kind, 0.6, g) * between(0.85, 1.1) * (1 + hooked / 200)));
    let price = priceOf(grams);
    while (price > c.budget && grams > 1) price = priceOf((grams = niceGrams(grams * 0.7)));
    price = Math.min(price, c.budget);
    c.order = { product, grams, price, due: now + between(DUE_MIN, DUE_MAX), haggles: 0, agreed: false };
    say(c, 'them', 'order', now, { product, grams, price });
  }

  function find(state: CustomersState, args: unknown): Customer | undefined {
    const id = args && typeof args === 'object' ? (args as Record<string, unknown>).customer : undefined;
    return typeof id === 'string' ? state.list.find((c) => c.id === id) : undefined;
  }

  const like = (state: CustomersState, c: Customer, opinion: number, reputation = 0) => {
    c.opinion = Math.round(clamp(c.opinion + opinion, 0, 100));
    state.reputation = Math.round(clamp(state.reputation + reputation, 0, 100) * 10) / 10;
  };

  function closeOrder(c: Customer, now: number) {
    delete c.order;
    c.nextOrderAt = now + orderGap(c, now);
  }

  function counter(ctx: BunkerCtx, state: CustomersState, c: Customer, price: unknown): boolean {
    const o = c.order;
    if (!o || o.agreed) return false;
    if (typeof price !== 'number' || !Number.isSafeInteger(price) || price <= 0 || price > 1e7) return false;
    const now = ctx.now;
    say(c, 'me', 'counter', now, { price });
    if (price <= o.price) {
      // Less than they offered: gladly.
      like(state, c, price < o.price * 0.9 ? 3 : 1);
      o.price = price;
      o.agreed = true;
      say(c, 'them', 'deal', now, { price });
      return true;
    }
    const limit = priceLimit(c, o, now);
    if (price <= limit) {
      o.price = price;
      o.agreed = true;
      like(state, c, -1);
      say(c, 'them', 'deal', now, { price });
      return true;
    }
    o.haggles++;
    const hooked = addictionNow(c, now) >= 60;
    // Too greedy, or too often: they walk off, unless they're hooked, then they just grumble and stay at their offer.
    if (price > limit * 1.35 || o.haggles > 2) {
      if (hooked) {
        like(state, c, -4);
        say(c, 'them', 'grumble', now, { price: o.price });
        return true;
      }
      like(state, c, -8, -2);
      say(c, 'them', 'walk', now);
      closeOrder(c, now);
      ctx.event('customers.walked', { name: c.name }, 'warn');
      return true;
    }
    // Somewhere in between: they come up part of the way.
    o.price = Math.max(o.price + 1, Math.round(o.price + (limit - o.price) * between(0.4, 0.7)));
    o.price = Math.min(o.price, limit);
    like(state, c, -2);
    say(c, 'them', 'meet', now, { price: o.price });
    return true;
  }

  function takeUnits(ctx: BunkerCtx, ids: unknown, product: string, max = 50): ProductUnit[] | undefined {
    if (!Array.isArray(ids) || !ids.length || ids.length > max || new Set(ids).size !== ids.length) return undefined;
    const units = ids.map((id) => ctx.me.products.find((u) => u.id === id));
    if (units.some((u) => !u || !u.pack || u.product !== product)) return undefined;
    return units as ProductUnit[];
  }

  function deliver(ctx: BunkerCtx, state: CustomersState, c: Customer, ids: unknown): boolean {
    const o = c.order;
    if (!o) return false;
    const units = takeUnits(ctx, ids, o.product);
    if (!units) {
      ctx.event('customers.wrongUnits', { name: c.name }, 'warn');
      return false;
    }
    const nominal = units.reduce((n, u) => n + unitNominal(u), 0);
    if (nominal < o.grams) {
      ctx.event('customers.tooLittle', { grams: o.grams }, 'warn');
      return false;
    }
    const now = ctx.now;
    const grams = units.reduce((n, u) => n + u.grams, 0);
    const quality = units.reduce((n, u) => n + u.quality * u.grams, 0) / grams;
    if (!ctx.pay(o.price, bunkerSaleReason(c.id))) return false;
    for (const u of units) takeUnit(ctx.me, u.id);
    const kind = productKind(o.product)!;
    setAddiction(c, now, addictionNow(c, now) + HOOK * kind.addictiveness * Math.min(2, Math.sqrt(grams / Math.max(1, c.appetite))));
    c.lastQuality = Math.round(quality * 100) / 100;
    c.last = { product: o.product, grams: Math.round(grams * 10) / 10, price: o.price, at: now };
    say(c, 'me', 'delivered', now, { product: o.product, grams: Math.round(grams * 10) / 10 });
    // What they make of it: light bags and weak stuff they mind, a bit extra and good stuff they like.
    const short = units.some(unitShort) || grams < o.grams * 0.97;
    if (short) {
      like(state, c, -7, -2);
      say(c, 'them', 'short', now);
    } else if (quality < 0.35) {
      like(state, c, -6, -1);
      say(c, 'them', 'weak', now);
    } else if (quality >= 0.75) {
      like(state, c, nominal >= o.grams * 1.5 ? 8 : 5, 3);
      say(c, 'them', 'great', now);
    } else {
      like(state, c, nominal >= o.grams * 1.5 ? 5 : 2, 2);
      say(c, 'them', 'thanks', now);
    }
    closeOrder(c, now);
    ctx.event('customers.sold', { name: c.name, chips: o.price });
    return true;
  }

  function sample(ctx: BunkerCtx, state: CustomersState, c: Customer, unitId: unknown): boolean {
    const now = ctx.now;
    if (c.sampleAt !== undefined && now - c.sampleAt < SAMPLE_EVERY) {
      ctx.event('customers.sampleSoon', { name: c.name }, 'warn');
      return false;
    }
    const u = typeof unitId === 'string' ? ctx.me.products.find((p) => p.id === unitId) : undefined;
    if (!u || !u.pack || u.grams > 10) return false;
    takeUnit(ctx.me, u.id);
    const kind = productKind(u.product);
    setAddiction(c, now, addictionNow(c, now) + HOOK * (kind?.addictiveness ?? 0) * 0.6);
    c.sampleAt = now;
    c.lastQuality = Math.round(u.quality * 100) / 100;
    c.last = { product: u.product, grams: Math.round(u.grams * 10) / 10, price: 0, at: now };
    like(state, c, u.quality < 0.35 ? 1 : 6);
    say(c, 'me', 'sample', now, { product: u.product });
    say(c, 'them', 'sampled', now);
    // Hooked on it, they'll want more soon.
    if (!c.order && !inTrouble(c, now)) c.nextOrderAt = Math.min(c.nextOrderAt, now + between(1, 2.5) * MIN);
    ctx.event('customers.sampleGiven', { name: c.name });
    return true;
  }

  /** A happy customer brings a friend, if there's room for one more. */
  function referral(ctx: BunkerCtx, state: CustomersState): boolean {
    const now = ctx.now;
    if (now < state.nextReferralAt || state.list.length >= customerCap(state.reputation)) return false;
    const happy = state.list.filter((c) => c.opinion >= 60 && !inTrouble(c, now));
    const p = nextProspect(state);
    if (!happy.length || !p) return false;
    const by = happy[Math.floor(rand() * happy.length)];
    const c = newCustomer(p, `c${state.nextId++}`, now, between(0.5, 2) * MIN);
    c.referredBy = by.name;
    say(c, 'them', 'hello', now, { by: by.name });
    state.list.push(c);
    state.nextReferralAt = now + REFERRAL_EVERY * between(1, 1.5);
    ctx.event('customers.referred', { name: c.name, by: by.name });
    return true;
  }

  return {
    initial,
    load,
    act(ctx, state, action, args) {
      if (action === 'open') return seed(state, ctx.now);
      const c = find(state, args);
      if (!c) return false;
      const a = args as Record<string, unknown>;
      const now = ctx.now;
      switch (action) {
        case 'accept':
          if (!c.order || c.order.agreed) return false;
          c.order.agreed = true;
          say(c, 'me', 'accept', now);
          return true;
        case 'decline':
          if (!c.order) return false;
          say(c, 'me', 'decline', now);
          like(state, c, c.order.agreed ? -10 : -2, c.order.agreed ? -2 : 0);
          closeOrder(c, now);
          return true;
        case 'counter':
          return counter(ctx, state, c, a.price);
        case 'deliver':
          return deliver(ctx, state, c, a.units);
        case 'sample':
          return sample(ctx, state, c, a.unit);
      }
      return false;
    },
    tick(ctx, state) {
      if (!state.list.length) return false;
      const now = ctx.now;
      let changed = false;
      for (const c of state.list) {
        if (c.order && now >= c.order.due) {
          // Too late: they've gone elsewhere, and mind it more if you'd said yes.
          like(state, c, c.order.agreed ? -10 : -2, c.order.agreed ? -3 : 0);
          say(c, 'them', 'late', now);
          closeOrder(c, now);
          changed = true;
        }
        if (c.troubleUntil !== undefined && now >= c.troubleUntil) {
          delete c.troubleUntil;
          say(c, 'them', 'back', now);
          changed = true;
        }
        if (!c.order && !inTrouble(c, now) && now >= c.nextOrderAt) {
          order(c, now);
          changed = true;
        }
      }
      if (referral(ctx, state)) changed = true;
      return changed;
    },
  };
}

export const customers: BunkerFeatureHandler<CustomersState> = makeCustomers();
