// The bunker: a concrete room under the casino, down the ladder in its secret room (SECRET_HATCH in
// shared/casino.ts). It's a production game played for the casino's chips: grow weed, make fictional
// products in the lab, pack them, and sell them to customers and the cartel, buying what that takes
// at the PC. Like the roof and the casino it's a place of its own (BUNKER) that people can be in, so
// everyone sees who's down there.
//
// This is the foundation every feature builds on (the features are each their own files, see
// BUNKER_FEATURES): the place and its layout, the station spots, the state the office keeps for
// each person, and the one generic message each way. Shared by the server (server/bunker/) and the
// client (world/drugbunker/, ui/bunker/).
import type { CartelState } from './cartel.js';
import type { CustomersState } from './customers.js';
import type { GrowState } from './grow.js';
import type { LabState } from './lab.js';
import type { PackState } from './pack.js';
import type { PcState } from './pc.js';

/**
 * Where you are while you're in the bunker (a peer's `floor`, and `floor.go`'s). Like ROOF and
 * CASINO, it can never be a project floor's id, which is only ever lowercase letters, digits and dashes.
 * The only way down is the ladder in the casino's secret room, and the only way up is back up it.
 */
export const BUNKER = '@bunker';
export const BUNKER_NAME = 'Bunker';

/** The bunker's features, each with its own files (shared/bunker/<f>.ts, server/bunker/<f>.ts, world/drugbunker/<f>.ts, ui/bunker/<f>.ts, i18n/bunker/<f>.ts). */
export const BUNKER_FEATURES = ['grow', 'lab', 'pack', 'pc', 'customers', 'cartel'] as const;
export type BunkerFeature = (typeof BUNKER_FEATURES)[number];

export function isBunkerFeature(v: unknown): v is BunkerFeature {
  return typeof v === 'string' && (BUNKER_FEATURES as readonly string[]).includes(v);
}

/** Somewhere in the bunker E opens a panel: each feature's spot, and the stash shelf (your inventory). */
export type BunkerStationId = BunkerFeature | 'stash';
export const BUNKER_STATION_IDS: readonly BunkerStationId[] = [...BUNKER_FEATURES, 'stash'];

// ---- The room ---------------------------------------------------------------------------------------

/** The room: bare concrete, 14 × 10 m under a low ceiling `height` up. Its own place, so its own coordinates. */
export const BUNKER_ROOM = { minX: -7, maxX: 7, minZ: -5, maxZ: 5, height: 2.7 } as const;

/**
 * The ladder against the north wall, down from a hatch in the ceiling: `x` its middle, `width` between
 * its rails, `depth` it stands off the wall; you arrive at its foot (`foot`, facing into the room) and
 * stand within `reach` of it to climb up.
 */
export const BUNKER_LADDER = { x: -5.6, width: 0.5, depth: 0.3, hatch: 0.8, foot: { x: -5.6, z: BUNKER_ROOM.minZ + 0.9 }, reach: 1.5 } as const;

/** The heavy metal door in the east wall that never opens (the customers come to its slot): `z` its middle. */
export const BUNKER_DOOR = { z: -1.2, width: 1.1, height: 2.1 } as const;

/**
 * A station's spot on the floor: its middle (`x`, `z`), turned `rotY` about +y the way everything is
 * (0: its front, where you stand to use it, faces +z), `w` wide along its front, `d` deep and about `h`
 * tall. The foundation marks it on the floor; the feature's model stands inside it.
 */
export interface StationSpot {
  x: number;
  z: number;
  rotY: number;
  w: number;
  d: number;
  h: number;
}

const R = BUNKER_ROOM;
const NORTH = 0;
const SOUTH = Math.PI;
const WEST = Math.PI / 2;
const EAST = -Math.PI / 2;

/**
 * Where everything stands: the grow area (a row of pots and tents down the west wall), the lab bench
 * on the north wall, the packing table in the middle, the PC's desk and the stash shelf on the south
 * wall, the customers' slot in the metal door and the cartel's phone on the east wall beside it.
 */
export const BUNKER_STATIONS: Readonly<Record<BunkerStationId, StationSpot>> = {
  grow: { x: R.minX + 0.75, z: 0.8, rotY: WEST, w: 6.2, d: 1.5, h: 2 },
  lab: { x: 1.4, z: R.minZ + 0.45, rotY: NORTH, w: 3.4, d: 0.9, h: 1.1 },
  pack: { x: 0.4, z: 0.6, rotY: NORTH, w: 2.2, d: 1.1, h: 0.95 },
  pc: { x: 4.3, z: R.maxZ - 0.45, rotY: SOUTH, w: 1.8, d: 0.9, h: 1.3 },
  customers: { x: R.maxX - 0.2, z: BUNKER_DOOR.z, rotY: EAST, w: BUNKER_DOOR.width + 0.2, d: 0.4, h: BUNKER_DOOR.height },
  cartel: { x: R.maxX - 0.15, z: 2.6, rotY: EAST, w: 0.6, d: 0.3, h: 1.8 },
  stash: { x: -2.2, z: R.maxZ - 0.35, rotY: SOUTH, w: 2.4, d: 0.7, h: 2 },
};

/** How far off a station's front you can be (m, from its middle) and still use it. */
export const STATION_REACH = 1.6;

/** Where `local` (x along the station's front, z out of its front) is in the room. */
export function stationToWorld(s: StationSpot, local: { x: number; z: number }): { x: number; z: number } {
  const c = Math.cos(s.rotY);
  const n = Math.sin(s.rotY);
  return { x: s.x + local.x * c + local.z * n, z: s.z - local.x * n + local.z * c };
}

/** Where you stand to use a station: `out` meters in front of the middle of its front. */
export function stationFront(s: StationSpot, out = 0.7): { x: number; z: number } {
  return stationToWorld(s, { x: 0, z: s.d / 2 + out });
}

/** A station's footprint on the floor, as a box along the room's axes. */
export function stationBox(s: StationSpot): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const along = Math.abs(Math.cos(s.rotY)) > 0.5;
  const hx = (along ? s.w : s.d) / 2;
  const hz = (along ? s.d : s.w) / 2;
  return { minX: s.x - hx, maxX: s.x + hx, minZ: s.z - hz, maxZ: s.z + hz };
}

/** The ladder's footprint (you walk round it, and climb it with E). */
export function ladderBox(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const L = BUNKER_LADDER;
  return { minX: L.x - L.width / 2 - 0.05, maxX: L.x + L.width / 2 + 0.05, minZ: R.minZ, maxZ: R.minZ + L.depth + 0.1 };
}

/**
 * Whether you can stand at (x, z) in the bunker, keeping `r` meters off its walls and the ladder.
 * (The stations' own furniture keeps you out with its colliders, if it has any.)
 */
export function bunkerWalkable(x: number, z: number, r = 0.3): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (x < R.minX + r || x > R.maxX - r || z < R.minZ + r || z > R.maxZ - r) return false;
  const l = ladderBox();
  return !(x > l.minX - r && x < l.maxX + r && z > l.minZ - r && z < l.maxZ + r);
}

/** Whether someone at (x, z) is at the foot of the ladder, near enough to climb it (`slack` more, for where the office last heard you were). */
export function atBunkerLadder(x: number, z: number, slack = 0): boolean {
  const L = BUNKER_LADDER;
  return Math.hypot(x - L.x, z - (R.minZ + L.depth)) <= L.reach + slack;
}

// ---- What the office keeps for each person ------------------------------------------------------------

/** Item id (see shared/bunker/items.ts) → how many you have. */
export type Inventory = Record<string, number>;

/** A unit of product: some of a product kind (PRODUCTS), of a quality, packed or loose. */
export interface ProductUnit {
  /** Its own id, unique for its owner ("u1", "u2", …: see addUnit). */
  id: string;
  /** Which product (a ProductKind's id). */
  product: string;
  /** How good it is, 0–1. */
  quality: number;
  /** How much of it there is (grams). */
  grams: number;
  /** What it's packed in (a packaging item's id), or loose. */
  pack?: string;
}

/** Each feature's own section, kept for each person (and each is that feature's alone to change). */
export interface BunkerSections {
  grow: GrowState;
  lab: LabState;
  pack: PackState;
  pc: PcState;
  customers: CustomersState;
  cartel: CartelState;
}

/** Everything the office keeps for one person down here (saved in .agent-office/bunker.json), and what their page is sent. */
export interface BunkerPerson extends BunkerSections {
  inventory: Inventory;
  products: ProductUnit[];
  /** The number the next product unit's id gets. */
  nextUnit: number;
}

/** How many of an item anyone can have (and how many units of product): plenty, but not unbounded. */
export const MAX_STACK = 100_000;
export const MAX_UNITS = 500;

/** How many of `item` there are in `inv`. */
export function countItem(inv: Inventory, item: string): number {
  return Object.hasOwn(inv, item) ? inv[item] : 0;
}

/** Puts `n` (a positive whole number) of `item` in `inv`, up to MAX_STACK. Says whether it did. */
export function addItem(inv: Inventory, item: string, n: number): boolean {
  if (!Number.isSafeInteger(n) || n <= 0) return false;
  const have = countItem(inv, item);
  if (have + n > MAX_STACK) return false;
  inv[item] = have + n;
  return true;
}

/** Takes `n` of `item` out of `inv`, if there are that many (else changes nothing). Says whether it did. */
export function takeItem(inv: Inventory, item: string, n: number): boolean {
  if (!Number.isSafeInteger(n) || n <= 0) return false;
  const have = countItem(inv, item);
  if (have < n) return false;
  if (have === n) delete inv[item];
  else inv[item] = have - n;
  return true;
}

/** Adds a unit of product to `me`'s stash with a new id, unless they have MAX_UNITS already. The unit, or null. */
export function addUnit(me: BunkerPerson, unit: Omit<ProductUnit, 'id'>): ProductUnit | null {
  if (me.products.length >= MAX_UNITS || !(unit.grams > 0) || !Number.isFinite(unit.grams)) return null;
  const made: ProductUnit = { ...unit, quality: Math.min(1, Math.max(0, unit.quality)), id: `u${me.nextUnit++}` };
  me.products.push(made);
  return made;
}

/** Takes the unit with id `id` out of `me`'s stash. The unit, or null if there's no such. */
export function takeUnit(me: BunkerPerson, id: string): ProductUnit | null {
  const i = me.products.findIndex((u) => u.id === id);
  return i < 0 ? null : me.products.splice(i, 1)[0];
}

// ---- Messages -----------------------------------------------------------------------------------------

/**
 * Client → server, while you're in the bunker: do `action` at `feature` with `args` (what they are is
 * that feature's business). The office answers with `bunker.state` when it changed anything, and
 * `bunker.event` for anything to say.
 */
export interface BunkerAct {
  feature: BunkerFeature;
  action: string;
  args?: unknown;
}

/** Server → client: something to tell you (a toast), by a key of the bunker's texts ("grow.harvested": `t('bunker.grow.harvested', params)`). */
export interface BunkerEvent {
  key: string;
  params?: Record<string, string | number>;
  level?: 'info' | 'warn';
}

// ---- Chips --------------------------------------------------------------------------------------------

/** The chips ledger's reason for buying `item` for the bunker (see ChipsReason): "bunker:buy:<item>". */
export function bunkerBuyReason(item: string): string {
  return `bunker:buy:${item}`;
}

/** The ledger's reason for a sale to `customer` (a customer's id, or the cartel's contract): "bunker:sale:<customer>". */
export function bunkerSaleReason(customer: string): string {
  return `bunker:sale:${customer}`;
}

/** What a ledger reason says about the bunker ("bunker:<what>:<of>"), or undefined for any other. */
export function bunkerReasonOf(reason: string): { what: string; of: string } | undefined {
  const m = /^bunker:([a-z]+):(.*)$/.exec(reason);
  return m ? { what: m[1], of: m[2] } : undefined;
}
