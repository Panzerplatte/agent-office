// The cartel, on the phone on the east wall: bulk contracts with deadlines, a better price per unit, and a reputation.
// Shared by the server (server/bunker/cartel.ts) and the client (world/drugbunker/cartel.ts, ui/bunker/cartel.ts).
//
// Once there's product in your stash, they've heard of you, and now and then the phone rings with an offer: so many grams of a product, at least so good, within so
// long, for so many chips (less a gram than customers pay, but a lot at once). Take it and it's your
// contract (one at a time): hand over packed product until it's all there, before it's due, and you're
// paid and your reputation goes up, which brings bigger, better-paying offers. Miss the deadline (or
// walk away) and it goes down, and they let you know. Once a contract you can ask for a better price or
// more time; whether they agree depends on your reputation. It's a game: the products are made up.
import { PRODUCTS, productKind, type ProductKind } from './items.js';
import type { ProductUnit } from './index.js';

/** A contract: offered on the phone, then (once taken) yours to deliver. */
export interface CartelContract {
  /** Its own id ("k1", "k2", …). */
  id: string;
  /** Which product (a ProductKind's id). */
  product: string;
  /** How much they want (grams). */
  grams: number;
  /** The worst they'll take, 0–1: every unit handed over must be at least this good. */
  minQuality: number;
  /** What they pay for all of it, on delivery (chips). */
  pay: number;
  /** How long you have to deliver once you take it (ms). */
  time: number;
  /** How far up the ladder it was offered (see cartelTier): bigger and better paid the higher. */
  tier: number;
  /** An offer: when it's off the table if nobody takes it. */
  expiresAt: number;
  /** Taken: when it's due. */
  dueAt?: number;
  /** Taken: how many grams you've handed over so far. */
  delivered: number;
  /** Whether you've already asked for a better price or more time (once a contract). */
  haggled: boolean;
}

/** What the cartel feature keeps for each person (BunkerPerson.cartel, saved in bunker.json). */
export interface CartelState {
  /** Whether they've heard of you: not until you've product in the stash, and they don't call till then. */
  known: boolean;
  /** Your reputation with them, 0–100 (see cartelTier). */
  rep: number;
  /** The offer on the table, if there is one. */
  offer: CartelContract | null;
  /** The contract you've taken, if you have one. */
  contract: CartelContract | null;
  /** The offer you've picked up the phone for (the phone rings until you do). */
  answered: string | null;
  /** When the phone rings with the next offer (ms, the office's clock). */
  nextOfferAt: number;
  /** The number the next contract's id gets. */
  nextId: number;
  /** Contracts delivered, and missed (or walked away from). */
  done: number;
  failed: number;
  /** Chips the cartel has paid you, all told. */
  earned: number;
}

/** Where you start with them. */
export const START_REP = 10;
export const MAX_REP = 100;
/** The reputation each rung of the ladder starts at (see cartelTier). */
export const TIER_REP = [0, 20, 40, 60, 80] as const;
/** What a contract's worth at each tier (chips, about): bigger the higher you are. */
export const TIER_VALUE: readonly (readonly [number, number])[] = [
  [150, 300],
  [400, 800],
  [1000, 2000],
  [2500, 5000],
  [5000, 9000],
];
/** What they pay a gram at each tier, of what it fetches at its base price (customers pay round all of it). */
export const TIER_RATE = [0.55, 0.6, 0.65, 0.7, 0.75] as const;
/** How long you get to deliver at each tier (minutes): a round or two of growing (see shared/bunker/grow.ts STRAINS), so it wants planning. */
export const TIER_MINUTES = [12, 18, 25, 35, 45] as const;
/** The least they want at each tier (quality 0–1, give or take 0.1). */
export const TIER_QUALITY = [0.3, 0.4, 0.5, 0.6, 0.7] as const;

const MIN = 60_000;
/** How long an offer stays on the table. */
export const OFFER_TTL = 10 * MIN;
/** How long till the phone rings again: after a contract's done or missed, or an offer's turned down or let go. */
export const OFFER_GAP = 3 * MIN;
/** Reputation for a contract delivered in time, for one missed (or walked away from), and for haggling that didn't go down well. */
export const REP_DONE = 8;
export const REP_FAILED = -12;
export const REP_HAGGLE_FAILED = -2;
/** A better price: this much more. More time: this much longer. */
export const HAGGLE_PRICE = 0.15;
export const HAGGLE_TIME = 0.5;

/** How far up their ladder a reputation puts you: 0 (nobody) to 4 (family). */
export function cartelTier(rep: number): number {
  let tier = 0;
  for (let i = 0; i < TIER_REP.length; i++) if (rep >= TIER_REP[i]) tier = i;
  return tier;
}

/** The reputation the next rung starts at, or null at the top. */
export function nextTierRep(rep: number): number | null {
  const tier = cartelTier(rep);
  return tier + 1 < TIER_REP.length ? TIER_REP[tier + 1] : null;
}

/** A reputation kept in 0–100. */
export function clampRep(rep: number): number {
  return Math.min(MAX_REP, Math.max(0, Math.round(rep)));
}

/** The premium weed (25 minutes a plant without a lamp), which they only ask for from the third rung up, like the lab's products. */
export const PREMIUM_WEED = 'weed-royal';

/** What they'll offer at a tier: weed to start with, the premium weed and the lab's products too from the third rung up. */
export function tierProducts(tier: number): ProductKind[] {
  return PRODUCTS.filter((p) => (p.source === 'grow' && p.id !== PREMIUM_WEED) || tier >= 2);
}

/** The chance (0–1) they agree to a better price or more time: better the more they trust you. */
export function haggleChance(rep: number): number {
  return 0.25 + 0.5 * (clampRep(rep) / MAX_REP);
}

/**
 * What they pay for `grams` of `product` at least `minQuality` good, at `tier`: under what customers pay
 * a gram (TIER_RATE of its value at that quality), but for a lot at once. Whole chips.
 */
export function contractPay(product: ProductKind, grams: number, minQuality: number, tier: number): number {
  const rate = TIER_RATE[Math.min(TIER_RATE.length - 1, Math.max(0, tier))];
  return Math.max(1, Math.round(product.basePrice * grams * (0.5 + 0.5 * minQuality) * rate));
}

/** A new offer for someone of reputation `rep`, made at `now` with `rand` (0–1, like Math.random). */
export function makeOffer(rep: number, now: number, id: string, rand: () => number): CartelContract {
  const tier = cartelTier(rep);
  const products = tierProducts(tier);
  const product = products[Math.min(products.length - 1, Math.floor(rand() * products.length))];
  const q = TIER_QUALITY[tier] + (rand() - 0.5) * 0.2;
  const minQuality = Math.min(0.9, Math.max(0.1, Math.round(q * 20) / 20));
  const [lo, hi] = TIER_VALUE[tier];
  const value = lo + rand() * (hi - lo);
  const perGram = contractPay(product, 1000, minQuality, tier) / 1000;
  const grams = Math.max(10, Math.round(value / perGram / 10) * 10);
  return {
    id,
    product: product.id,
    grams,
    minQuality,
    pay: contractPay(product, grams, minQuality, tier),
    time: TIER_MINUTES[tier] * MIN,
    tier,
    expiresAt: now + OFFER_TTL,
    delivered: 0,
    haggled: false,
  };
}

/** Whether a unit of product counts toward `c`: the right product, packed, and good enough. */
export function fitsContract(c: CartelContract, u: ProductUnit): boolean {
  return u.product === c.product && !!u.pack && u.quality >= c.minQuality - 1e-9;
}

/** How many grams of what you have would count toward `c` (all of it, before what's still wanted). */
export function fittingGrams(c: CartelContract, products: readonly ProductUnit[]): number {
  return products.filter((u) => fitsContract(c, u)).reduce((sum, u) => sum + u.grams, 0);
}

/** How many grams `c` still wants. */
export function gramsLeft(c: CartelContract): number {
  return Math.max(0, c.grams - c.delivered);
}

/**
 * The units to hand over toward `c`: the ones that count, the worst first (you keep your best), until
 * there's enough or there's no more. Whole units: the last can go over.
 */
export function unitsToDeliver(c: CartelContract, products: readonly ProductUnit[]): ProductUnit[] {
  const fitting = products.filter((u) => fitsContract(c, u)).sort((a, b) => a.quality - b.quality || b.grams - a.grams);
  const out: ProductUnit[] = [];
  let left = gramsLeft(c);
  for (const u of fitting) {
    if (left <= 1e-9) break;
    out.push(u);
    left -= u.grams;
  }
  return out;
}

/** Whether the phone's ringing: there's an offer you haven't picked up for. */
export function ringing(s: CartelState | null | undefined): boolean {
  return !!s?.offer && s.answered !== s.offer.id;
}

/** The product a contract's for, or undefined if it's none (an old save). */
export function contractProduct(c: CartelContract): ProductKind | undefined {
  return productKind(c.product);
}
