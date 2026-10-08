// Everything there is in the bunker (see shared/bunker/index.ts): what the PC's supplier sells for
// chips (seeds, soil, pots, lamps, the lab's made-up ingredients and kit, packaging) and the products
// made from it. It's a game: the strains are made up, the lab's products are fictional and so are
// their "ingredients". Every feature reads its ids and numbers from here; wave 2 may tune the values.

/** A name (or a line about something) in each of the office's languages. */
export interface Words {
  en: string;
  de: string;
}

/** What an item is for: the grow area's, the lab's or the packing table's. */
export type ItemKind = 'seed' | 'soil' | 'pot' | 'lamp' | 'ingredient' | 'equipment' | 'packaging';

/** Something the supplier sells (see the PC's shop), kept in your inventory by its id. */
export interface BunkerItem {
  id: string;
  kind: ItemKind;
  icon: string;
  name: Words;
  /** What it costs at the supplier, in chips (a whole number). */
  price: number;
  /** A seed's strain: the product its plant gives (see PRODUCTS). */
  grows?: string;
  /** Packaging: how many grams one holds. */
  holds?: number;
}

/** Where a product comes from: the grow area (weed of a strain) or the lab. */
export type ProductSource = 'grow' | 'lab';

/** A kind of product (what a ProductUnit is): weed of each strain, and the lab's few made-up ones. */
export interface ProductKind {
  id: string;
  source: ProductSource;
  icon: string;
  name: Words;
  /** What a gram of it fetches at quality 1 (chips); customers and the cartel pay round this. */
  basePrice: number;
  /** How hooked it gets a customer, 0–1 (see the customers' addiction). */
  addictiveness: number;
}

export const ITEMS: readonly BunkerItem[] = [
  // Seeds, one per strain.
  { id: 'seed-kush', kind: 'seed', icon: '🌱', name: { en: 'Bunker Kush seeds', de: 'Bunker-Kush-Samen' }, price: 40, grows: 'weed-kush' },
  { id: 'seed-haze', kind: 'seed', icon: '🌱', name: { en: 'Neon Haze seeds', de: 'Neon-Haze-Samen' }, price: 60, grows: 'weed-haze' },
  { id: 'seed-skunk', kind: 'seed', icon: '🌱', name: { en: 'Basement Skunk seeds', de: 'Keller-Skunk-Samen' }, price: 30, grows: 'weed-skunk' },
  // For growing them.
  { id: 'soil', kind: 'soil', icon: '🟫', name: { en: 'Bag of soil', de: 'Sack Erde' }, price: 15 },
  { id: 'soil-premium', kind: 'soil', icon: '🟤', name: { en: 'Premium soil', de: 'Premium-Erde' }, price: 45 },
  { id: 'pot', kind: 'pot', icon: '🪴', name: { en: 'Plant pot', de: 'Pflanztopf' }, price: 25 },
  { id: 'lamp', kind: 'lamp', icon: '💡', name: { en: 'Grow lamp', de: 'Pflanzenlampe' }, price: 250 },
  { id: 'lamp-led', kind: 'lamp', icon: '🔆', name: { en: 'LED grow panel', de: 'LED-Pflanzenpanel' }, price: 600 },
  // The lab's made-up ingredients and kit.
  { id: 'fizzium', kind: 'ingredient', icon: '🧂', name: { en: 'Fizzium salt', de: 'Fizzium-Salz' }, price: 30 },
  { id: 'moon-syrup', kind: 'ingredient', icon: '🍯', name: { en: 'Moon syrup', de: 'Mondsirup' }, price: 45 },
  { id: 'stardust', kind: 'ingredient', icon: '✨', name: { en: 'Stardust', de: 'Sternenstaub' }, price: 70 },
  { id: 'gloop', kind: 'ingredient', icon: '🫧', name: { en: 'Blue gloop', de: 'Blauer Glibber' }, price: 25 },
  { id: 'burner', kind: 'equipment', icon: '🔥', name: { en: 'Burner', de: 'Brenner' }, price: 300 },
  { id: 'flasks', kind: 'equipment', icon: '⚗️', name: { en: 'Flask set', de: 'Kolbenset' }, price: 400 },
  { id: 'press', kind: 'equipment', icon: '🗜️', name: { en: 'Tablet press', de: 'Tablettenpresse' }, price: 900 },
  // Packaging, for the packing table.
  { id: 'bag', kind: 'packaging', icon: '👝', name: { en: 'Little bag (1 g)', de: 'Tütchen (1 g)' }, price: 1, holds: 1 },
  { id: 'bag-big', kind: 'packaging', icon: '🛍️', name: { en: 'Bag (5 g)', de: 'Beutel (5 g)' }, price: 3, holds: 5 },
  { id: 'jar', kind: 'packaging', icon: '🫙', name: { en: 'Jar (20 g)', de: 'Glas (20 g)' }, price: 8, holds: 20 },
  { id: 'brick', kind: 'packaging', icon: '🧱', name: { en: 'Brick wrap (500 g)', de: 'Ziegel-Folie (500 g)' }, price: 60, holds: 500 },
  { id: 'pack-machine', kind: 'equipment', icon: '🏭', name: { en: 'Packing machine', de: 'Verpackungsmaschine' }, price: 1500 },
];

export const PRODUCTS: readonly ProductKind[] = [
  { id: 'weed-kush', source: 'grow', icon: '🥦', name: { en: 'Bunker Kush', de: 'Bunker-Kush' }, basePrice: 10, addictiveness: 0.15 },
  { id: 'weed-haze', source: 'grow', icon: '🥦', name: { en: 'Neon Haze', de: 'Neon-Haze' }, basePrice: 14, addictiveness: 0.2 },
  { id: 'weed-skunk', source: 'grow', icon: '🥦', name: { en: 'Basement Skunk', de: 'Keller-Skunk' }, basePrice: 8, addictiveness: 0.1 },
  { id: 'glimmer', source: 'lab', icon: '💎', name: { en: 'Glimmer', de: 'Glimmer' }, basePrice: 35, addictiveness: 0.55 },
  { id: 'fizz', source: 'lab', icon: '💊', name: { en: 'Fizz tabs', de: 'Fizz-Tabs' }, basePrice: 25, addictiveness: 0.4 },
  { id: 'nebula', source: 'lab', icon: '🧪', name: { en: 'Nebula', de: 'Nebula' }, basePrice: 45, addictiveness: 0.7 },
];

export const ITEM_BY_ID: ReadonlyMap<string, BunkerItem> = new Map(ITEMS.map((i) => [i.id, i]));
export const PRODUCT_BY_ID: ReadonlyMap<string, ProductKind> = new Map(PRODUCTS.map((p) => [p.id, p]));

/** The item with that id, or undefined for anything that isn't one. */
export function bunkerItem(id: unknown): BunkerItem | undefined {
  return typeof id === 'string' ? ITEM_BY_ID.get(id) : undefined;
}

/** The product kind with that id, or undefined. */
export function productKind(id: unknown): ProductKind | undefined {
  return typeof id === 'string' ? PRODUCT_BY_ID.get(id) : undefined;
}

/** The items of one kind, in catalog order. */
export function itemsOf(kind: ItemKind): BunkerItem[] {
  return ITEMS.filter((i) => i.kind === kind);
}

/** What `grams` of `product` at `quality` (0–1) fetch at its base price: at least half of it for the worst, all of it for the best. Whole chips. */
export function productValue(product: ProductKind, quality: number, grams: number): number {
  const q = Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 0));
  return Math.round(product.basePrice * grams * (0.5 + 0.5 * q));
}
