// Customers (made-up people) who order product: selling, negotiating price and amount, and how hooked they get.
// Shared by the server (server/bunker/customers.ts) and the client (world/drugbunker/customers.ts, ui/bunker/customers.ts).
//
// Each customer texts you orders (what, how much, what they offer, by when). You accept, decline or
// make a counter-offer, and deliver from your packed stash right in the app; the sale pays out in
// casino chips (bunkerSaleReason). What you sell them hooks them by the product's addictiveness: the
// more hooked, the more often and the more they order and the more they pay, until they get into
// trouble and lie low for a while. Happy customers bring their friends. It's a game: the people and
// the products are made up.
import type { BunkerPerson, ProductUnit } from './index.js';
import { bunkerItem } from './items.js';

/** A line in a customer's chat: from them or from you, by a key of the customers' texts (`customers.say.<key>`). */
export interface ChatLine {
  from: 'them' | 'me';
  key: string;
  params?: Record<string, string | number>;
  /** When (the office's clock, ms). */
  at: number;
}

/** What a customer wants: `grams` of `product` for `price` chips (all of it), by `due`. */
export interface Order {
  product: string;
  grams: number;
  price: number;
  due: number;
  /** How many counter-offers they've had to this one. */
  haggles: number;
  /** You've said yes to it (no more haggling: just deliver). */
  agreed: boolean;
}

/** One of your customers. */
export interface Customer {
  /** "c1", "c2", …: the chips ledger's `bunker:sale:<id>`. */
  id: string;
  name: string;
  /** Their picture (an emoji). */
  face: string;
  /** What they usually want (a product's id). */
  favourite: string;
  /** The most they'll ever pay for one order (chips). */
  budget: number;
  /** How far above their offer they'll go, 0–1. */
  tolerance: number;
  /** How many grams they usually order, before they're hooked. */
  appetite: number;
  /** How hooked they are (0–100) as of `addictionAt`: it wears off from there (see addictionNow). */
  addiction: number;
  addictionAt: number;
  /** What they think of you, 0–100. */
  opinion: number;
  /** How they feel today, 0–1 (a good mood haggles less). */
  mood: number;
  /** How good what they last got from you was, 0–1 (what they expect next time). */
  lastQuality: number;
  /** What they last bought (or got as a sample). */
  last?: { product: string; grams: number; price: number; at: number };
  /** Their open order. */
  order?: Order;
  /** When they'll next send one. */
  nextOrderAt: number;
  /** In trouble (too hooked): no orders until then. */
  troubleUntil?: number;
  /** When they last got a free sample (one now and then). */
  sampleAt?: number;
  /** Who sent them to you (a customer's name). */
  referredBy?: string;
  chat: ChatLine[];
}

/** What the customers feature keeps for each person (BunkerPerson.customers, saved in bunker.json). */
export interface CustomersState {
  list: Customer[];
  /** The number the next customer's id gets. */
  nextId: number;
  /** How your name goes round, 0–100: more of it, more customers (see customerCap). */
  reputation: number;
  /** When a happy customer may next bring a friend. */
  nextReferralAt: number;
}

/** Someone who might become a customer: everything that's theirs from the start. */
export interface Prospect {
  name: string;
  face: string;
  favourite: string;
  budget: number;
  tolerance: number;
  appetite: number;
}

/** Everyone who might ever come to the door, in the order they turn up: the first STARTERS are there from the start. */
export const PROSPECTS: readonly Prospect[] = [
  { name: 'Benny Bolt', face: '🧔', favourite: 'weed-kush', budget: 160, tolerance: 0.25, appetite: 3 },
  { name: 'Rita Rocket', face: '👩‍🎤', favourite: 'weed-haze', budget: 260, tolerance: 0.35, appetite: 4 },
  { name: 'Old Gus', face: '👴', favourite: 'weed-skunk', budget: 90, tolerance: 0.15, appetite: 5 },
  { name: 'Mo Glitter', face: '🕺', favourite: 'glimmer', budget: 420, tolerance: 0.3, appetite: 2 },
  { name: 'Dr. Fizzbang', face: '🧑‍🔬', favourite: 'fizz', budget: 380, tolerance: 0.4, appetite: 3 },
  { name: 'Lulu Lagoon', face: '👩‍🦰', favourite: 'weed-haze', budget: 320, tolerance: 0.3, appetite: 6 },
  { name: 'Captain Cosmo', face: '🧑‍🚀', favourite: 'nebula', budget: 700, tolerance: 0.45, appetite: 2 },
  { name: 'Sly Sid', face: '🕵️', favourite: 'fizz', budget: 300, tolerance: 0.2, appetite: 4 },
  { name: 'Big Bertha', face: '👩‍🍳', favourite: 'weed-kush', budget: 500, tolerance: 0.3, appetite: 10 },
  { name: 'Zed Zero', face: '🧛', favourite: 'nebula', budget: 900, tolerance: 0.35, appetite: 3 },
  { name: 'Duke Dollar', face: '🤵', favourite: 'weed-royal', budget: 800, tolerance: 0.3, appetite: 5 },
];
export const STARTERS = 3;

/** How many customers you can have with `reputation`: a few to start with, more as your name goes round. */
export function customerCap(reputation: number): number {
  return Math.min(PROSPECTS.length, STARTERS + Math.floor(Math.max(0, reputation) / 15));
}

const MIN = 60_000;
/** How hooked someone gets (in points of 100) from a sale of a product with addictiveness 1. */
export const HOOK = 25;
/** How fast it wears off without anything (points per minute). */
export const WEAR_OFF = 0.4;
/** Above this they may get into trouble when they'd next order. */
export const TROUBLE_AT = 85;
/** How long trouble keeps them away (ms). */
export const TROUBLE_FOR = 20 * MIN;
/** Their usual wait between orders (ms), before they're hooked. */
export const ORDER_EVERY = 6 * MIN;
/** How long an order's open (ms): somewhere between these. */
export const DUE_MIN = 8 * MIN;
export const DUE_MAX = 16 * MIN;
/** How often someone can have a free sample (ms). */
export const SAMPLE_EVERY = 30 * MIN;
/** How often a happy customer brings a friend, at most (ms). */
export const REFERRAL_EVERY = 12 * MIN;
/** How many lines each customer's chat keeps. */
export const CHAT_KEEP = 10;
/** A unit is short if it weighs less than this much of what its packaging says. */
export const SHORT_BY = 0.97;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How hooked `c` is at `now`: what it was, worn off since. */
export function addictionNow(c: Pick<Customer, 'addiction' | 'addictionAt'>, now: number): number {
  return clamp(c.addiction - (WEAR_OFF * Math.max(0, now - c.addictionAt)) / MIN, 0, 100);
}

/** Sets how hooked `c` is at `now`. */
export function setAddiction(c: Customer, now: number, value: number) {
  c.addiction = Math.round(clamp(value, 0, 100) * 10) / 10;
  c.addictionAt = now;
}

/** Whether `c` is in trouble (lying low) at `now`. */
export function inTrouble(c: Pick<Customer, 'troubleUntil'>, now: number): boolean {
  return c.troubleUntil !== undefined && now < c.troubleUntil;
}

/** What a unit says it holds (its packaging's size), or its weight if it's loose. */
export function unitNominal(u: ProductUnit): number {
  return bunkerItem(u.pack)?.holds ?? u.grams;
}

/** Whether a unit weighs less than its packaging says. */
export function unitShort(u: ProductUnit): boolean {
  return !!u.pack && u.grams < unitNominal(u) * SHORT_BY;
}

/** The units of yours `c`'s order can be delivered from: packed, of the product they want. */
export function unitsFor(me: Pick<BunkerPerson, 'products'>, order: Pick<Order, 'product'>): ProductUnit[] {
  return me.products.filter((u) => !!u.pack && u.product === order.product);
}

/**
 * The most `c` will pay for their order at `now` (a counter-offer up to this they take): their offer,
 * plus as much again as their tolerance lets them, more for a good mood, being hooked and what they
 * know of your quality; never more than their budget.
 */
export function priceLimit(c: Customer, order: Order, now: number): number {
  const hooked = addictionNow(c, now) / 100;
  const stretch = c.tolerance * (0.5 + c.mood) * (1 + 1.5 * hooked) * (0.6 + 0.8 * c.lastQuality);
  return Math.max(order.price, Math.min(Math.max(c.budget, order.price), Math.round(order.price * (1 + stretch))));
}

/** The order sizes customers ask for (grams). */
const SIZES = [1, 2, 3, 4, 5, 7, 10, 15, 20, 25, 30, 40, 50];

/** The order size nearest `g`. */
export function niceGrams(g: number): number {
  let best = SIZES[0];
  for (const s of SIZES) if (Math.abs(s - g) < Math.abs(best - g)) best = s;
  return best;
}

/** Adds a line to `c`'s chat, keeping the last CHAT_KEEP. */
export function say(c: Customer, from: ChatLine['from'], key: string, now: number, params?: ChatLine['params']) {
  c.chat.push({ from, key, at: now, ...(params ? { params } : {}) });
  if (c.chat.length > CHAT_KEEP) c.chat.splice(0, c.chat.length - CHAT_KEEP);
}

/** A new customer from `p`, with id `id`, sending a first order soon after `now`. */
export function newCustomer(p: Prospect, id: string, now: number, firstOrderIn: number): Customer {
  return { id, ...p, addiction: 0, addictionAt: now, opinion: 50, mood: 0.6, lastQuality: 0.5, nextOrderAt: now + firstOrderIn, chat: [] };
}

/** Which prospect comes next (none left: undefined). */
export function nextProspect(state: CustomersState): Prospect | undefined {
  const taken = new Set(state.list.map((c) => c.name));
  return PROSPECTS.find((p) => !taken.has(p.name));
}
