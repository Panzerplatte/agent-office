// The packing table in the middle of the room: product weighed on its scale into units (bags, bricks).
// Shared by the server (server/bunker/pack.ts) and the client (world/drugbunker/pack.ts, ui/bunker/pack.ts).
//
// Packing is a little game on the scale. You pick a loose unit of product (from the grow area or the
// lab), a packaging and, once you have the packing machine, how many to do at once; then you scoop
// product onto the scale until it shows the target. The scoops are never quite the same size, and
// nothing comes back off the scale but all of it at once: a bit over is product given away, and under
// is a light unit that remembers its real weight (the customers notice). Sealing takes the product off
// its loose unit and the packaging out of the inventory, and gives packed units of the same product
// and quality, which customers and the cartel buy.
import { countItem, type BunkerPerson, type ProductUnit } from './index.js';
import { bunkerItem, productKind, type BunkerItem } from './items.js';

/** The packagings the table packs into, smallest first (items.ts's packaging, each `holds` grams). */
export const PACKS = ['bag', 'bag-big', 'jar', 'brick'] as const;
export type PackId = (typeof PACKS)[number];

/** Who buys what: bricks are for the cartel, the rest for customers at the door. */
export const CARTEL_PACKS: readonly PackId[] = ['brick'];

/** The packing machine (bought at the PC): with it, the table packs up to MACHINE_BATCH units at once. */
export const PACK_MACHINE = 'pack-machine';
export const MACHINE_BATCH = 10;

/** How you put product on the scale: a big scoop, a scoop or a pinch, each a share of the target (somewhere between `min` and `max`). */
export const SCOOPS = {
  big: { min: 0.25, max: 0.45 },
  scoop: { min: 0.06, max: 0.14 },
  pinch: { min: 0.01, max: 0.03 },
} as const;
export type ScoopId = keyof typeof SCOOPS;
export const SCOOP_IDS = Object.keys(SCOOPS) as ScoopId[];

/** Within this share of the target either way, a unit's spot on. */
export const SPOT_ON = 0.02;
/** Less than this share of the target won't seal: that's not a unit, that's a sample. */
export const MIN_FILL = 0.5;
/** The scale takes no more than this share of the target (it'd spill). */
export const MAX_FILL = 1.5;

/** What's on the table right now: the loose unit it's from, the packaging, how many at once, and what the scale shows (grams, for all of them). */
export interface PackBench {
  from: string;
  pack: PackId;
  count: number;
  grams: number;
}

/** What the pack feature keeps for each person (BunkerPerson.pack, saved in bunker.json): what's on the table, if anything. */
export interface PackState {
  bench: PackBench | null;
}

export function isPackId(v: unknown): v is PackId {
  return typeof v === 'string' && (PACKS as readonly string[]).includes(v);
}

export function isScoop(v: unknown): v is ScoopId {
  return typeof v === 'string' && Object.hasOwn(SCOOPS, v);
}

/** The packaging item of a pack id. */
export function packItem(pack: PackId): BunkerItem {
  return bunkerItem(pack)!;
}

/** How many grams one `pack` holds. */
export function packHolds(pack: PackId): number {
  return packItem(pack).holds ?? 1;
}

/** What the scale's aiming for: `count` of `pack`. */
export function benchTarget(bench: Pick<PackBench, 'pack' | 'count'>): number {
  return packHolds(bench.pack) * bench.count;
}

/** Grams to the hundredth, as the scale shows them (no float dust). */
export function roundGrams(g: number): number {
  return Math.round(g * 100) / 100;
}

/** How the scale reads against its target: not enough to seal, under, spot on, or over. */
export type Reading = 'low' | 'under' | 'on' | 'over';

export function reading(grams: number, target: number): Reading {
  if (grams < target * MIN_FILL) return 'low';
  if (grams < target * (1 - SPOT_ON)) return 'under';
  if (grams <= target * (1 + SPOT_ON)) return 'on';
  return 'over';
}

/** The loose units of product (what the table packs from): not packed, and of a product there is. */
export function looseUnits(me: Pick<BunkerPerson, 'products'>): ProductUnit[] {
  return me.products.filter((u) => !u.pack && productKind(u.product));
}

/** How many units of `pack` at once you can do: 1, or up to MACHINE_BATCH with the machine. */
export function maxBatch(me: Pick<BunkerPerson, 'inventory'>): number {
  return countItem(me.inventory, PACK_MACHINE) > 0 ? MACHINE_BATCH : 1;
}

/** What a packed unit says it holds (its packaging's grams), or undefined for a loose one. */
export function nominalGrams(u: ProductUnit): number | undefined {
  return bunkerItem(u.pack)?.holds;
}

/** How many grams a packed unit is short of what it says (0 for a full or loose one): what an unhappy customer weighs. */
export function shortBy(u: ProductUnit): number {
  const nominal = nominalGrams(u);
  return nominal === undefined ? 0 : roundGrams(Math.max(0, nominal - u.grams));
}

/** Packed units that look the same (product, packaging, quality to the percent), stacked: the ids and real weights of each stack. */
export interface PackStack {
  product: string;
  pack: string;
  quality: number;
  ids: string[];
  grams: number;
}

export function packedStacks(products: readonly ProductUnit[]): PackStack[] {
  const stacks = new Map<string, PackStack>();
  for (const u of products) {
    if (!u.pack) continue;
    const q = Math.round(u.quality * 100);
    const key = `${u.product}|${u.pack}|${q}`;
    let s = stacks.get(key);
    if (!s) stacks.set(key, (s = { product: u.product, pack: u.pack, quality: q / 100, ids: [], grams: 0 }));
    s.ids.push(u.id);
    s.grams = roundGrams(s.grams + u.grams);
  }
  return [...stacks.values()];
}

/** Why the table won't start with that (null: it will). */
export type StartProblem = 'noUnit' | 'noPack' | 'noBags' | 'noMachine' | 'badCount';

export function startProblem(me: Pick<BunkerPerson, 'inventory' | 'products'>, from: unknown, pack: unknown, count: unknown): StartProblem | null {
  if (typeof from !== 'string' || !looseUnits(me).some((u) => u.id === from)) return 'noUnit';
  if (!isPackId(pack)) return 'noPack';
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > MACHINE_BATCH) return 'badCount';
  if (count > maxBatch(me)) return 'noMachine';
  if (countItem(me.inventory, pack) < count) return 'noBags';
  return null;
}
