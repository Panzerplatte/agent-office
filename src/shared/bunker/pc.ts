// The PC on the desk by the south wall: its apps (see the client's ui/bunker), and the supplier's shop that sells for chips.
// Shared by the server (server/bunker/pc.ts) and the client (world/drugbunker/pc.ts, ui/bunker/pc.ts).
//
// The shop sells everything in items.ts, delivered straight into your inventory, and the bunker's
// upgrades (kept here, in the PC's own section): a grow tent and shelves for a bigger stash. Every
// purchase goes through the chips ledger as "bunker:buy:<id>". The PC also keeps your bunker's
// numbers for its stats app: what you've spent and bought here, and what you've sold to whom (the
// customers and the cartel tell it with noteSale).
import type { BunkerPerson, Inventory } from './index.js';
import { ITEMS, type BunkerItem, type Words } from './items.js';

/** The most of one thing the shop sells in one go. */
export const PC_MAX_BUY = 999;

/** How many supplies (items in your inventory, all kinds together) the stash holds with no extra shelves. */
export const STASH_ROOM = 2000;
/** How much more each stash shelf (the "stash-shelf" upgrade) holds. */
export const STASH_ROOM_PER_SHELF = 2000;

/** Something the shop sells once (or a few times, a level each time) that makes the bunker bigger or better. */
export interface PcUpgrade {
  id: string;
  icon: string;
  name: Words;
  /** What each level costs, in order (chips): its length is how many levels there are. */
  prices: readonly number[];
}

/**
 * The upgrades. The grow tent is for the grow area to read (`upgradeLevel(me, 'grow-tent')`: its
 * plants do better under it); the shelves make the stash hold more supplies (see stashRoom), which
 * the shop keeps to. More pots are just more pots: they're in items.ts.
 */
export const PC_UPGRADES: readonly PcUpgrade[] = [
  { id: 'grow-tent', icon: '⛺', name: { en: 'Grow tent', de: 'Growzelt' }, prices: [1200] },
  { id: 'stash-shelf', icon: '🗄️', name: { en: 'Stash shelf', de: 'Vorratsregal' }, prices: [400, 900, 2000] },
];

export function pcUpgrade(id: unknown): PcUpgrade | undefined {
  return typeof id === 'string' ? PC_UPGRADES.find((u) => u.id === id) : undefined;
}

/** What you've sold to one customer (or the cartel), all told. */
export interface PcCustomerStats {
  /** What they're called, as the feature that sold to them said. */
  name?: string;
  chips: number;
  sales: number;
}

/** What you've sold of one product, all told. */
export interface PcProductStats {
  grams: number;
  chips: number;
}

/** What the pc feature keeps for each person (BunkerPerson.pc, saved in bunker.json). */
export interface PcState {
  /** Chips spent at the shop, all told. */
  spent: number;
  /** Item id (or upgrade id) → how many you've bought. */
  bought: Record<string, number>;
  /** Upgrade id → its level (0, or not there: not bought). */
  upgrades: Record<string, number>;
  /** Chips earned selling down here, all told (see noteSale). */
  earned: number;
  /** Customer id → what you've sold them. */
  customers: Record<string, PcCustomerStats>;
  /** Product id → what you've sold of it. */
  sold: Record<string, PcProductStats>;
}

/** How many different customers and products the stats keep (the first ones; plenty for a game). */
export const PC_STATS_KEYS = 200;

export function initialPc(): PcState {
  return { spent: 0, bought: {}, upgrades: {}, earned: 0, customers: {}, sold: {} };
}

/** A key the stats keep: short, plain, and nothing an object has already. */
export function statsKeyOk(k: unknown): k is string {
  return typeof k === 'string' && /^[\w:.-]{1,64}$/.test(k) && !(k in Object.prototype);
}

const count = (n: unknown): number => (typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0);
const amount = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** The pc section as saved (anything at all), made safe. */
export function loadPc(raw: unknown): PcState {
  const pc = initialPc();
  if (!raw || typeof raw !== 'object') return pc;
  const r = raw as Record<string, unknown>;
  const entries = (v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.entries(v as Record<string, unknown>)
          .filter(([k]) => statsKeyOk(k))
          .slice(0, PC_STATS_KEYS)
      : [];
  pc.spent = count(r.spent);
  pc.earned = count(r.earned);
  for (const [k, n] of entries(r.bought)) if (count(n)) pc.bought[k] = count(n);
  for (const [k, n] of entries(r.upgrades)) {
    const up = pcUpgrade(k);
    if (up && count(n)) pc.upgrades[k] = Math.min(count(n), up.prices.length);
  }
  for (const [k, v] of entries(r.customers)) {
    if (!v || typeof v !== 'object') continue;
    const c = v as Record<string, unknown>;
    pc.customers[k] = { chips: count(c.chips), sales: count(c.sales), ...(typeof c.name === 'string' && c.name ? { name: c.name.slice(0, 40) } : {}) };
  }
  for (const [k, v] of entries(r.sold)) {
    if (!v || typeof v !== 'object') continue;
    const s = v as Record<string, unknown>;
    pc.sold[k] = { grams: amount(s.grams), chips: count(s.chips) };
  }
  return pc;
}

/** The level `me` has of upgrade `id` (0: none). */
export function upgradeLevel(me: Pick<BunkerPerson, 'pc'>, id: string): number {
  return Object.hasOwn(me.pc.upgrades, id) ? me.pc.upgrades[id] : 0;
}

/** What the next level of upgrade `up` costs at level `level`, or null when there's none left. */
export function upgradePrice(up: PcUpgrade, level: number): number | null {
  return level < up.prices.length ? up.prices[level] : null;
}

/** How many supplies `me`'s stash holds, with their shelves. */
export function stashRoom(me: Pick<BunkerPerson, 'pc'>): number {
  return STASH_ROOM + STASH_ROOM_PER_SHELF * upgradeLevel(me, 'stash-shelf');
}

/** How many supplies are in `inv`, all kinds together. */
export function suppliesHeld(inv: Inventory): number {
  return Object.values(inv).reduce((n, v) => n + (v > 0 ? v : 0), 0);
}

/** What `n` of `item` cost, or null if that's not something the shop sells that many of. */
export function buyPrice(item: BunkerItem | undefined, n: number): number | null {
  if (!item || !Number.isSafeInteger(n) || n < 1 || n > PC_MAX_BUY) return null;
  return item.price * n;
}

/** The shop's shelves, in the order it shows them: its sections and what's in each. */
export const SHOP_SECTIONS: readonly { id: 'seeds' | 'grow' | 'lab' | 'packaging'; items: readonly BunkerItem[] }[] = [
  { id: 'seeds', items: ITEMS.filter((i) => i.kind === 'seed') },
  { id: 'grow', items: ITEMS.filter((i) => i.kind === 'soil' || i.kind === 'pot' || i.kind === 'lamp') },
  { id: 'lab', items: ITEMS.filter((i) => i.kind === 'ingredient' || i.kind === 'equipment') },
  { id: 'packaging', items: ITEMS.filter((i) => i.kind === 'packaging') },
];

/** A sale, as the customers' or the cartel's feature tells the PC about it (see noteSale). */
export interface PcSale {
  /** Who bought: the customer's id, or the cartel's ("cartel"). */
  customer: string;
  /** What they're called, for the stats. */
  name?: string;
  /** The product's id (a ProductKind's). */
  product: string;
  grams: number;
  /** What it paid (chips). */
  chips: number;
}

/**
 * Notes a sale in `me`'s stats (for the customers' and the cartel's features to call when they pay
 * out a sale, so the PC's stats app can tell who your best customer is and what sells best). Says
 * whether it did.
 */
export function noteSale(me: Pick<BunkerPerson, 'pc'>, sale: PcSale): boolean {
  if (!statsKeyOk(sale.customer) || !statsKeyOk(sale.product) || !count(sale.chips) || !amount(sale.grams)) return false;
  const pc = me.pc;
  pc.earned += sale.chips;
  const c = Object.hasOwn(pc.customers, sale.customer) ? pc.customers[sale.customer] : Object.keys(pc.customers).length < PC_STATS_KEYS ? (pc.customers[sale.customer] = { chips: 0, sales: 0 }) : null;
  if (c) {
    c.chips += sale.chips;
    c.sales += 1;
    if (sale.name) c.name = sale.name.slice(0, 40);
  }
  const p = Object.hasOwn(pc.sold, sale.product) ? pc.sold[sale.product] : Object.keys(pc.sold).length < PC_STATS_KEYS ? (pc.sold[sale.product] = { grams: 0, chips: 0 }) : null;
  if (p) {
    p.grams += sale.grams;
    p.chips += sale.chips;
  }
  return true;
}

/** The stats app's numbers: spent and earned, the best customer and the best seller (by chips), and what you've bought most of. */
export function pcStats(pc: PcState): {
  spent: number;
  earned: number;
  net: number;
  bestCustomer?: { id: string } & PcCustomerStats;
  bestProduct?: { id: string } & PcProductStats;
  mostBought?: { id: string; n: number };
} {
  const best = <T>(rec: Record<string, T>, by: (v: T) => number) => {
    let top: [string, T] | undefined;
    for (const e of Object.entries(rec)) if (by(e[1]) > 0 && (!top || by(e[1]) > by(top[1]))) top = e;
    return top;
  };
  const c = best(pc.customers, (v) => v.chips);
  const p = best(pc.sold, (v) => v.chips);
  const b = best(pc.bought, (v) => v);
  return {
    spent: pc.spent,
    earned: pc.earned,
    net: pc.earned - pc.spent,
    ...(c ? { bestCustomer: { id: c[0], ...c[1] } } : {}),
    ...(p ? { bestProduct: { id: p[0], ...p[1] } } : {}),
    ...(b ? { mostBought: { id: b[0], n: b[1] } } : {}),
  };
}
