// The casino: a basement under the ground floor, one for the whole building. The elevator goes down
// there from every floor, the way it goes up to the roof. Nobody works down there: there's a poker
// table, a blackjack table, a roulette wheel, a bank of slot machines, the cashier's cage with a board
// of everyone's chips over it, and a little bar with a lounge. This is only the room; the games
// (and the chips they're played for) are their own. Shared by the server (who's down there, where
// they sit) and the client (which builds it).
//
// It only imports types from layout.ts, which takes CASINO_SEATING from here into SEATING.
import type { SeatDef } from './layout.js';

/**
 * Where you are while you're in the casino (a peer's `floor`, and `floor.go`'s). Like ROOF, it can
 * never be a project floor's id, which is only ever lowercase letters, digits and dashes.
 */
export const CASINO = '@casino';
export const CASINO_NAME = 'Casino';

/** The games on the casino floor, each at its own table or machines. */
export type CasinoGame = 'poker' | 'blackjack' | 'roulette' | 'slots';

/**
 * The room: the office floor's size (FLOOR, which the tests hold it to), so the elevator stops in
 * its usual spot on the north wall, under a lower ceiling `height` up.
 */
export const CASINO_ROOM = { minX: -18, maxX: 18, minZ: -13, maxZ: 13, height: 4.8 } as const;
/** The elevator's car on the north wall, as in the office (ELEVATOR, ELEVATOR_FRONT); the floor in front of its doors stays clear. */
export const CASINO_ELEVATOR = { x: 8.5, width: 2.6, door: 1.4, front: -10.6 } as const;

/** A point on the floor: x, z in meters. */
export interface Spot {
  x: number;
  z: number;
}

/**
 * A table on the casino floor. Its own frame: x along its length, z across it, with the dealer on
 * the -z side facing +z and the players round the +z side (at rotY 0 that's the world's axes,
 * from the table's middle). Turned by `rotY` about +y, like everything else (0 faces +z).
 */
export interface CasinoTable {
  game: Exclude<CasinoGame, 'slots'>;
  x: number;
  z: number;
  rotY: number;
  /** Its top: `length` along x, `width` across, the felt `height` up. */
  size: { length: number; width: number; height: number };
  /** Where the dealer (the croupier at the roulette wheel) stands, in the table's frame. */
  dealer: Spot;
  /** Each player's chair (or stool), in the table's frame, in seat order. Seat 1 is the dealer's left. */
  seats: readonly Spot[];
}

/** Where `p` in `table`'s own frame is on the floor. */
export function tableToWorld(table: { x: number; z: number; rotY: number }, p: Spot): Spot {
  const c = Math.cos(table.rotY);
  const s = Math.sin(table.rotY);
  return { x: table.x + p.x * c + p.z * s, z: table.z - p.x * s + p.z * c };
}

/** The other way: where world point `p` is in `table`'s own frame. */
export function worldToTable(table: { x: number; z: number; rotY: number }, p: Spot): Spot {
  const c = Math.cos(table.rotY);
  const s = Math.sin(table.rotY);
  const dx = p.x - table.x;
  const dz = p.z - table.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** Round an ellipse `a` × `b` from its middle, at each of `degrees` (0 is +x, 90 is +z, the players' side). */
function round(a: number, b: number, degrees: readonly number[]): Spot[] {
  return degrees.map((d) => ({ x: +(a * Math.cos((d * Math.PI) / 180)).toFixed(3), z: +(b * Math.sin((d * Math.PI) / 180)).toFixed(3) }));
}

/**
 * The poker table, Texas Hold'em for up to six: an oval, the dealer in the middle of its north side
 * and six chairs round the rest of it.
 */
export const POKER_TABLE: CasinoTable = {
  game: 'poker',
  x: -8.5,
  z: -6.6,
  rotY: 0,
  size: { length: 2.7, width: 1.5, height: 0.78 },
  dealer: { x: 0, z: -1.15 },
  // Round from the dealer's left (east, at rotY 0) to their right.
  seats: round(1.9, 1.32, [-25, 18, 62, 118, 162, 205]),
};

/**
 * The blackjack table: a half-moon for up to five, the dealer behind its straight north edge with
 * the shoe and the chip tray, five stools round the curve.
 */
export const BLACKJACK_TABLE: CasinoTable = {
  game: 'blackjack',
  x: 0.5,
  z: -7.4,
  rotY: 0,
  // The straight edge is at z = -width/2, and the curve a half circle round from it, `length` across.
  size: { length: 2.1, width: 1.05, height: 0.82 },
  dealer: { x: 0, z: -0.95 },
  // Round the curve from the dealer's left (first base, east at rotY 0) to their right (third base).
  seats: [18, 54, 90, 126, 162].map((d) => {
    const a = (d * Math.PI) / 180;
    return { x: +(1.62 * Math.cos(a)).toFixed(3), z: +(-0.52 + 1.5 * Math.sin(a)).toFixed(3) };
  }),
};

/**
 * Where things go on the blackjack felt, in the felt's own frame (x along the table, y across it
 * toward the players, from the middle of its top; the straight edge at y = -width/2), measured out
 * from the middle of the straight edge as on a real table: the chip tray along the straight edge, the
 * dealer's cards in a row just in front of it, the rules printed across the middle, and in front of
 * each stool its cards and then, nearer the rail, its betting circle. The seats' places are drawn in
 * a little toward the middle seat (SPREAD of the way round from it to the stool), so the end seats'
 * keep clear of the shoe and the discard holder in the corners.
 */
export const BLACKJACK_FELT = (() => {
  const edge = -BLACKJACK_TABLE.size.width / 2;
  /** How far out from the middle of the straight edge: the dealer's cards, a seat's cards, its bet. */
  const DEALER_OUT = 0.25;
  const CARDS_OUT = 0.62;
  const BET_OUT = 0.79;
  const SPREAD = 0.85;
  const at = (a: number, r: number) => ({ x: +(Math.cos(a) * r).toFixed(3), y: +(edge + Math.sin(a) * r).toFixed(3) });
  return {
    /** The dealer's row, its middle. */
    dealer: { x: 0, y: +(edge + DEALER_OUT).toFixed(3) },
    /** Each seat's places, in seat order: where its cards go, and its bet's circle behind them. */
    spots: BLACKJACK_TABLE.seats.map((s) => {
      const a = Math.PI / 2 + (Math.atan2(s.z - edge, s.x) - Math.PI / 2) * SPREAD;
      return { cards: at(a, CARDS_OUT), bet: at(a, BET_OUT) };
    }),
  };
})();

/**
 * The roulette table: the wheel at its west end (-x), the betting layout down the rest of it. The
 * croupier stands beside the wheel; six places round the layout.
 */
export const ROULETTE_TABLE: CasinoTable = {
  game: 'roulette',
  x: -8.2,
  z: 5.6,
  rotY: 0,
  size: { length: 3, width: 1.35, height: 0.8 },
  dealer: { x: -0.95, z: -1.05 },
  seats: [
    { x: -0.1, z: 1.12 },
    { x: 0.6, z: 1.12 },
    { x: 1.3, z: 1.12 },
    { x: 2.02, z: 0 },
    { x: 1.3, z: -1.12 },
    { x: 0.6, z: -1.12 },
  ],
};

/** The roulette wheel in the table's frame: its middle (on the felt), its bowl's radius and how high its rim stands. */
export const ROULETTE_WHEEL = { x: -0.92, z: 0, r: 0.46, rim: 0.12 } as const;

/**
 * The single-zero wheel, clockwise seen from above, from the zero: the order the numbers go round
 * it on every European wheel.
 */
export const WHEEL_ORDER: readonly number[] = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
/** The red numbers; the rest but the zero are black. */
export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function rouletteColor(n: number): 'green' | 'red' | 'black' {
  return n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black';
}

/**
 * The slot machines, in a bank along the west wall, facing into the room (+x), a stool in front of
 * each. `x, z` is the middle of the machine's foot.
 */
export const SLOT_MACHINES: readonly (Spot & { rotY: number })[] = [-2.9, -1.74, -0.58, 0.58, 1.74, 2.9].map((z) => ({ x: -17.45, z, rotY: Math.PI / 2 }));
/** A slot machine's cabinet: `width` across, `depth` front to back, `height` tall. */
export const SLOT_SIZE = { width: 0.86, depth: 0.7, height: 1.85 } as const;

/**
 * The cashier's cage in the north-east corner, where chips are counted out: its counter (`x` its
 * middle, `front` the side you stand at), with the cashier behind it.
 */
export const CASHIER = { x: 14.8, front: -10.9, length: 5, depth: 0.7, height: 1.1 } as const;
/**
 * The chip board over the cashier's cage: everyone's chips, most first. Its middle is at (x, y),
 * on the north wall facing +z; `width` × `height` meters.
 */
export const CHIP_BOARD = { x: 14.8, y: 3.72, z: CASINO_ROOM.minZ + 0.06, width: 4.4, height: 1.7 } as const;

/** The bar along the east wall, south of the cashier: its counter (`x` the middle of it), the bartender behind. */
export const CASINO_BAR = { x: 15.9, minZ: 1.2, maxZ: 8.4, depth: 0.7, height: 1.1 } as const;
/**
 * The casino's bartender: `x` where they stand behind the counter, and along it (`z`) the places in
 * front of it where E orders a drink, each `reach` meters round, as at the rooftop bar.
 */
export const CASINO_BARTENDER = { x: CASINO_BAR.x + CASINO_BAR.depth / 2 + 0.55, order: [2.4, 4.8, 7.2], reach: 1.6 } as const;
/** The lounge, in the south-east corner: sofas round a low table. */
export const CASINO_LOUNGE = { x: 8.6, z: 8.4 } as const;
/**
 * The standing ashtray at the lounge's north-east corner, by the end of its east sofa: smoke breaks
 * down here, as on the balcony (see shared/smoking.ts). You can keep smoking anywhere within `area`
 * meters of the lounge's middle (its rug and sofas), or `reach` of the ashtray itself.
 */
export const CASINO_ASHTRAY = { x: 10.9, z: 6.7, area: 3.4, reach: 1.6 } as const;
/**
 * The casino's jukebox: the office's (JUKEBOX in layout.ts, the same size), against the east wall in
 * the corner between the bar and the lounge, facing into the room (-x). `y` is its speaker.
 */
export const CASINO_JUKEBOX = { x: CASINO_ROOM.maxX - 0.42, y: 0.75, z: 10.4, width: 1.3, depth: 0.72, height: 1.85 } as const;

/**
 * The Crash screen (see shared/crash.ts): a big screen high on the west wall south of the slot
 * machines, facing into the room (+x), where the whole casino can watch the round. Its middle is at
 * (x, y, z), `width` × `height` meters; `reach` is how far out in front of it E opens the panel.
 */
export const CRASH_SCREEN = { x: CASINO_ROOM.minX + 0.07, y: 2.75, z: 8.3, width: 4.8, height: 2.7, reach: 7 } as const;

/** A box on the floor that nobody walks through: the tables, the machines, the counters. */
export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** How high it is, for what you can stand on (a table you can't). */
  top: number;
}

/** The tables, the machines, the counters and the lounge's low table: where you can't walk. Chairs and stools you walk past (and sit on). */
export function casinoFootprints(): Footprint[] {
  const out: Footprint[] = [];
  const table = (t: CasinoTable, pad = 0) => {
    const turned = Math.abs(Math.sin(t.rotY)) > 0.5;
    const hl = (turned ? t.size.width : t.size.length) / 2 + pad;
    const hw = (turned ? t.size.length : t.size.width) / 2 + pad;
    out.push({ minX: t.x - hl, maxX: t.x + hl, minZ: t.z - hw, maxZ: t.z + hw, top: t.size.height });
  };
  table(POKER_TABLE, 0.08);
  table(BLACKJACK_TABLE, 0.06);
  table(ROULETTE_TABLE, 0.06);
  for (const m of SLOT_MACHINES) out.push({ minX: m.x - SLOT_SIZE.depth / 2, maxX: m.x + SLOT_SIZE.depth / 2, minZ: m.z - SLOT_SIZE.width / 2, maxZ: m.z + SLOT_SIZE.width / 2, top: 9 });
  // The cashier's counter, and the cage behind it up to the wall.
  out.push({ minX: CASHIER.x - CASHIER.length / 2, maxX: CASHIER.x + CASHIER.length / 2, minZ: CASINO_ROOM.minZ, maxZ: CASHIER.front, top: 9 });
  // The bar's counter, and the bartender's side of it up to the wall.
  out.push({ minX: CASINO_BAR.x - CASINO_BAR.depth / 2, maxX: CASINO_ROOM.maxX, minZ: CASINO_BAR.minZ, maxZ: CASINO_BAR.maxZ, top: 9 });
  out.push({ minX: CASINO_LOUNGE.x - 0.6, maxX: CASINO_LOUNGE.x + 0.6, minZ: CASINO_LOUNGE.z - 0.4, maxZ: CASINO_LOUNGE.z + 0.4, top: 0.42 });
  out.push({ minX: CASINO_ASHTRAY.x - 0.2, maxX: CASINO_ASHTRAY.x + 0.2, minZ: CASINO_ASHTRAY.z - 0.2, maxZ: CASINO_ASHTRAY.z + 0.2, top: 1 });
  out.push({ minX: CASINO_JUKEBOX.x - CASINO_JUKEBOX.depth / 2 - 0.05, maxX: CASINO_ROOM.maxX, minZ: CASINO_JUKEBOX.z - CASINO_JUKEBOX.width / 2 - 0.05, maxZ: CASINO_JUKEBOX.z + CASINO_JUKEBOX.width / 2 + 0.05, top: CASINO_JUKEBOX.height });
  return out;
}

/** Whether you can stand at (x, z) in the casino, keeping `r` meters off the walls and everything in it. */
export function casinoWalkable(x: number, z: number, r = 0.3): boolean {
  const R = CASINO_ROOM;
  if (x < R.minX + r || x > R.maxX - r || z < R.minZ + r || z > R.maxZ - r) return false;
  // The elevator's shaft, either side of its doorway (you ride in its car).
  const E = CASINO_ELEVATOR;
  const off = Math.abs(x - E.x);
  if (z < E.front + r && off > E.door / 2 - r && off < E.width / 2 + r) return false;
  return !casinoFootprints().some((f) => x > f.minX - r && x < f.maxX + r && z > f.minZ - r && z < f.maxZ + r);
}

// ---- Where you can sit ----------------------------------------------------------------------------

/** Facing from (x, z) toward `to`: the rotY of a seat there. */
function facing(from: Spot, to: Spot): number {
  return +Math.atan2(to.x - from.x, to.z - from.z).toFixed(4);
}

/** Each place at a table: a chair facing the table's middle (its own frame's line to it, for a long table's ends). */
function tableSeats(t: CasinoTable, kind: SeatDef['kind'], label: string, hips: number): SeatDef[] {
  return t.seats.map((local, i) => {
    const at = tableToWorld(t, local);
    // A chair at the side of a long table faces straight across it; at its end, along it.
    const aim = tableToWorld(t, { x: Math.max(-t.size.length / 2 + 0.4, Math.min(t.size.length / 2 - 0.4, local.x * 0.55)), z: 0 });
    return { id: `${t.game}-${i + 1}`, kind, label, x: at.x, y: 0, z: at.z, rotY: facing(at, aim), places: [0], hips, depth: 0, out: -0.7, casino: true, play: t.game, spot: i };
  });
}

/**
 * Where people sit in the casino: a chair at each place at the tables, a stool at each slot
 * machine, the bar's stools and the lounge's sofas. Taken into SEATING (shared/layout), so you sit
 * on them like any other seat; `casino` keeps them to the casino (see seatHere), and `play` and
 * `spot` say which game and which place at it (seat 1 is spot 0).
 */
export const CASINO_SEATING: SeatDef[] = [
  ...tableSeats(POKER_TABLE, 'pokerChair', '🃏 Poker table', 0.5),
  ...tableSeats(BLACKJACK_TABLE, 'blackjackStool', '🂡 Blackjack table', 0.55),
  ...tableSeats(ROULETTE_TABLE, 'rouletteStool', '🎡 Roulette table', 0.55),
  ...SLOT_MACHINES.map((m, i): SeatDef => ({ id: `slots-${i + 1}`, kind: 'slotStool', label: '🎰 Slot machine', x: m.x + 0.95, y: 0, z: m.z, rotY: -Math.PI / 2, places: [0], hips: 0.6, depth: 0, out: -0.7, casino: true, play: 'slots', spot: i })),
  ...[0, 1, 2, 3, 4].map((i): SeatDef => ({ id: `casino-stool-${i + 1}`, kind: 'barStool', label: '🪑 Bar stool', x: CASINO_BAR.x - CASINO_BAR.depth / 2 - 0.45, y: 0, z: CASINO_BAR.minZ + 0.8 + i * 1.4, rotY: Math.PI / 2, places: [0], hips: 0.78, depth: 0, out: -0.75, casino: true, bar: true })),
  // Round the lounge's low table: one on its south side facing north, one either end.
  { id: 'casino-sofa-1', kind: 'sofa', label: '🛋️ Sofa', x: CASINO_LOUNGE.x, y: 0, z: CASINO_LOUNGE.z + 1.5, rotY: Math.PI, places: [-0.7, 0.7], hips: 0.5, depth: -0.05, out: 0.8, casino: true },
  { id: 'casino-sofa-2', kind: 'sofa', label: '🛋️ Sofa', x: CASINO_LOUNGE.x - 2.1, y: 0, z: CASINO_LOUNGE.z, rotY: Math.PI / 2, places: [-0.5, 0.5], hips: 0.5, depth: -0.05, out: 0.8, casino: true },
  { id: 'casino-sofa-3', kind: 'sofa', label: '🛋️ Sofa', x: CASINO_LOUNGE.x + 2.1, y: 0, z: CASINO_LOUNGE.z, rotY: -Math.PI / 2, places: [-0.5, 0.5], hips: 0.5, depth: -0.05, out: 0.8, casino: true },
];

/** The game and the place at it a seat in the casino is for (a peer's `seat` like "poker-3:0"), or undefined for anywhere else. */
export function casinoSpotOf(seatKey: string | undefined): { game: CasinoGame; spot: number } | undefined {
  const id = seatKey?.replace(/:\d+$/, '');
  const seat = CASINO_SEATING.find((s) => s.id === id);
  return seat?.play !== undefined && seat.spot !== undefined ? { game: seat.play, spot: seat.spot } : undefined;
}
