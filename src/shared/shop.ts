// The casino's shop: things to spend chips on. Everything here is cosmetic, and everything you buy
// is yours for good (kept with your chips, see server/chips.ts), to wear or take off whenever you like.
//
// This is the whole catalogue, in one place to extend: add an item to SHOP_ITEMS (a new id, a slot,
// a price, its names in English and German) and it's in the shop, with its own look drawn by the
// client's world/shopitems.ts (one case per id there, which the tests check every item has).

/**
 * Where an item goes. `hat`: on your head, for everyone to see (one at a time). `face`: in front of
 * your eyes (one at a time). `desk`: on the desk of every worker you hired, each in its own spot (as
 * many as you like). `name`: the colour of your name on the casino's chip board (one at a time).
 */
export type ShopSlot = 'hat' | 'face' | 'desk' | 'name';

/** The slots in the order the shop shows them. */
export const SHOP_SLOTS: readonly ShopSlot[] = ['hat', 'face', 'desk', 'name'];

/** Slots where wearing one item takes off the one you had on. */
export const ONE_AT_A_TIME: ReadonlySet<ShopSlot> = new Set(['hat', 'face', 'name']);

export interface ShopItem {
  id: string;
  slot: ShopSlot;
  /** In chips. */
  price: number;
  /** For the shop's list. */
  icon: string;
  name: { en: string; de: string };
  /** One line about it. */
  about: { en: string; de: string };
  /** A name colour's colour (`name` items only), as #rrggbb. */
  color?: string;
  /** A desk item's place on the desk, in the desk's own frame (see DeskDef.rotY): along it, and out toward its chair. */
  spot?: { dx: number; dz: number };
}

/** Prices are whole chips in this range: a few cheap things, and some to save up for. */
export const SHOP_MIN_PRICE = 100;
export const SHOP_MAX_PRICE = 50_000;

export const SHOP_ITEMS: readonly ShopItem[] = [
  // ---- Hats ----
  { id: 'party-hat', slot: 'hat', price: 150, icon: '🥳', name: { en: 'Party hat', de: 'Partyhütchen' }, about: { en: 'A striped paper cone with a pompom.', de: 'Ein gestreifter Papierkegel mit Bommel.' } },
  { id: 'beanie', slot: 'hat', price: 400, icon: '🧶', name: { en: 'Beanie', de: 'Beanie' }, about: { en: 'A warm knitted hat in casino red.', de: 'Eine warme Strickmütze in Casino-Rot.' } },
  { id: 'cap', slot: 'hat', price: 800, icon: '🧢', name: { en: 'Baseball cap', de: 'Basecap' }, about: { en: 'Navy, with the visor to the front.', de: 'Dunkelblau, Schirm nach vorn.' } },
  { id: 'cowboy-hat', slot: 'hat', price: 2500, icon: '🤠', name: { en: 'Cowboy hat', de: 'Cowboyhut' }, about: { en: 'A wide brim for poker faces.', de: 'Breite Krempe fürs Pokerface.' } },
  { id: 'top-hat', slot: 'hat', price: 7500, icon: '🎩', name: { en: 'Top hat', de: 'Zylinder' }, about: { en: 'Black silk with a red band, for high rollers.', de: 'Schwarze Seide mit rotem Band, für High Roller.' } },
  { id: 'crown', slot: 'hat', price: 50_000, icon: '👑', name: { en: 'Golden crown', de: 'Goldene Krone' }, about: { en: 'Gold and rubies: the king of the casino.', de: 'Gold und Rubine: König des Casinos.' } },
  // ---- In front of your eyes ----
  { id: 'sunglasses', slot: 'face', price: 300, icon: '🕶️', name: { en: 'Sunglasses', de: 'Sonnenbrille' }, about: { en: 'Nobody reads your tells.', de: 'Niemand liest dein Pokerface.' } },
  { id: 'monocle', slot: 'face', price: 3000, icon: '🧐', name: { en: 'Gold monocle', de: 'Goldmonokel' }, about: { en: 'On a little gold chain.', de: 'An einem feinen Goldkettchen.' } },
  // ---- On your desk ----
  { id: 'rubber-duck', slot: 'desk', price: 100, icon: '🦆', name: { en: 'Rubber duck', de: 'Quietscheente' }, about: { en: 'For debugging out loud.', de: 'Zum Debuggen durch Erklären.' }, spot: { dx: -0.95, dz: 0.3 } },
  { id: 'cactus', slot: 'desk', price: 250, icon: '🌵', name: { en: 'Little cactus', de: 'Kleiner Kaktus' }, about: { en: 'In a terracotta pot. Hard to kill.', de: 'Im Terrakottatopf. Unkaputtbar.' }, spot: { dx: -0.45, dz: -0.36 } },
  { id: 'lava-lamp', slot: 'desk', price: 1200, icon: '🫧', name: { en: 'Lava lamp', de: 'Lavalampe' }, about: { en: 'Glows pink, day and night.', de: 'Leuchtet pink, Tag und Nacht.' }, spot: { dx: 0.45, dz: -0.36 } },
  { id: 'trophy', slot: 'desk', price: 10_000, icon: '🏆', name: { en: 'Golden trophy', de: 'Goldener Pokal' }, about: { en: 'Everyone on the floor will know.', de: 'Das ganze Stockwerk wird es wissen.' }, spot: { dx: -0.68, dz: 0.3 } },
  { id: 'gold-bars', slot: 'desk', price: 25_000, icon: '🪙', name: { en: 'Stack of gold bars', de: 'Goldbarren-Stapel' }, about: { en: 'Paperweights, technically.', de: 'Technisch gesehen Briefbeschwerer.' }, spot: { dx: -0.95, dz: -0.02 } },
  // ---- Your name on the chip board ----
  { id: 'name-mint', slot: 'name', price: 500, icon: '🟢', name: { en: 'Mint name', de: 'Name in Mint' }, about: { en: 'Your name in mint green on the chip board.', de: 'Dein Name in Mintgrün auf der Chip-Tafel.' }, color: '#5eead4' },
  { id: 'name-pink', slot: 'name', price: 1500, icon: '🩷', name: { en: 'Neon pink name', de: 'Name in Neonpink' }, about: { en: 'Your name in neon pink on the chip board.', de: 'Dein Name in Neonpink auf der Chip-Tafel.' }, color: '#ff5ca8' },
  { id: 'name-gold', slot: 'name', price: 5000, icon: '🟡', name: { en: 'Gold name', de: 'Name in Gold' }, about: { en: 'Your name in gold on the chip board.', de: 'Dein Name in Gold auf der Chip-Tafel.' }, color: '#ffd166' },
];

export const SHOP_BY_ID: ReadonlyMap<string, ShopItem> = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

/** The item with that id, or undefined for anything that isn't one. */
export function shopItem(id: unknown): ShopItem | undefined {
  return typeof id === 'string' ? SHOP_BY_ID.get(id) : undefined;
}

/** The ledger's reason for buying `item` (see ChipsReason): "shop:<id>". */
export function shopReason(item: ShopItem): string {
  return `shop:${item.id}`;
}

/** The item a ledger reason is for, if it's a purchase. */
export function shopItemOfReason(reason: string): ShopItem | undefined {
  return reason.startsWith('shop:') ? shopItem(reason.slice('shop:'.length)) : undefined;
}

/**
 * What's worn, kept tidy: only items, no repeats, only ones in `owned`, and one at a time in the
 * slots that take one (the last one wins). Catalogue order, so two pages agree on it.
 */
export function tidyWorn(worn: readonly unknown[], owned: readonly string[]): string[] {
  const have = new Set(owned);
  const bySlot = new Map<ShopSlot, string>();
  const many = new Set<string>();
  for (const id of worn) {
    const item = shopItem(id);
    if (!item || !have.has(item.id)) continue;
    if (ONE_AT_A_TIME.has(item.slot)) bySlot.set(item.slot, item.id);
    else many.add(item.id);
  }
  const keep = new Set([...bySlot.values(), ...many]);
  return SHOP_ITEMS.filter((i) => keep.has(i.id)).map((i) => i.id);
}

/** What you're wearing in `slot`, the first (or only) one. */
export function wornIn(worn: readonly string[] | undefined, slot: ShopSlot): ShopItem | undefined {
  for (const id of worn ?? []) {
    const item = shopItem(id);
    if (item?.slot === slot) return item;
  }
  return undefined;
}

/** The colour your name is on the chip board, from what you're wearing (none: the usual). */
export function nameColorOf(worn: readonly string[] | undefined): string | undefined {
  return wornIn(worn, 'name')?.color;
}
