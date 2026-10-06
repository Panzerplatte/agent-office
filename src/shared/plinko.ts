// Plinko, at the machine in the middle of the casino's main hall. You set a bet, how many rows of
// pegs (8 to 16) and the risk (low, medium, high), and drop a ball from the top: it bounces left or
// right off a peg in every row and lands in one of the slots along the bottom, rows + 1 of them, each
// with a multiplier (high at the edges, under 1× in the middle). You win bet × that multiplier. The
// office picks every bounce with a cryptographic random source (see server/plinko.ts) and pays when
// the ball lands; pages only animate the path it sent. Several balls can be falling at once, yours
// and everyone else's, and everyone in the casino sees them fall on the machine's screen. Here are
// the rules: the multiplier tables, what a ball pays, what a drop may be, and how long a ball falls.

// ---- Rows and risk -----------------------------------------------------------------------------------

/** How many rows of pegs a board can have. */
export const MIN_ROWS = 8;
export const MAX_ROWS = 16;
/** The boards the panel offers, fewest rows first. */
export const ROW_CHOICES: readonly number[] = Array.from({ length: MAX_ROWS - MIN_ROWS + 1 }, (_, i) => MIN_ROWS + i);

/** How wild the multipliers are: the higher the risk, the more the edges pay and the less the middle does. */
export type PlinkoRisk = 'low' | 'medium' | 'high';
export const RISKS: readonly PlinkoRisk[] = ['low', 'medium', 'high'];

/**
 * What every slot pays, per rows and risk, from an edge to the middle (the other half is the mirror
 * of it). Each table gives back about 99 % in the long run (see expectedReturn), so the house keeps
 * about 1 %, as at Crash.
 */
const HALVES: Record<number, Record<PlinkoRisk, readonly number[]>> = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5], medium: [13, 3, 1.3, 0.7, 0.4], high: [29, 4, 1.5, 0.3, 0.2] },
  9: { low: [5.6, 2, 1.6, 1, 0.7], medium: [18, 4, 1.7, 0.9, 0.5], high: [43, 7, 2, 0.6, 0.2] },
  10: { low: [8.9, 3, 1.4, 1.1, 1, 0.5], medium: [22, 5, 2, 1.4, 0.6, 0.4], high: [76, 10, 3, 0.9, 0.3, 0.2] },
  11: { low: [8.4, 3, 1.9, 1.3, 1, 0.7], medium: [24, 6, 3, 1.8, 0.7, 0.5], high: [120, 14, 5.2, 1.4, 0.4, 0.2] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5], medium: [33, 11, 4, 2, 1.1, 0.6, 0.3], high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2] },
  13: { low: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7], medium: [43, 13, 6, 3, 1.3, 0.7, 0.4], high: [260, 37, 11, 4, 1, 0.2, 0.2] },
  14: { low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5], medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2], high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2] },
  15: { low: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7], medium: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3], high: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2] },
  16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2] },
};

const TABLES = new Map<string, readonly number[]>();
for (const rows of ROW_CHOICES) {
  for (const risk of RISKS) {
    const half = HALVES[rows][risk];
    // An even number of rows has a slot in the very middle (the half's last); an odd number doesn't.
    const mirror = half.slice(0, rows % 2 ? half.length : half.length - 1).reverse();
    TABLES.set(`${rows}:${risk}`, Object.freeze([...half, ...mirror]));
  }
}

/** Every slot's multiplier on a board of `rows` at `risk`, left to right: rows + 1 of them. */
export function multipliers(rows: number, risk: PlinkoRisk): readonly number[] {
  const m = TABLES.get(`${rows}:${risk}`);
  if (!m) throw new Error(`no Plinko board with ${rows} rows at ${risk} risk`);
  return m;
}

/** n choose k. */
function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** How likely a ball is to land in `slot` on a board of `rows`: each bounce is a coin toss, so binomial. */
export function slotChance(rows: number, slot: number): number {
  return slot < 0 || slot > rows ? 0 : choose(rows, slot) / 2 ** rows;
}

/** What a board gives back in the long run, for every chip bet (0.99: the house keeps 1 %). */
export function expectedReturn(rows: number, risk: PlinkoRisk): number {
  return multipliers(rows, risk).reduce((sum, m, slot) => sum + slotChance(rows, slot) * m, 0);
}

// ---- Bets and payouts --------------------------------------------------------------------------------

/** The least and the most one ball can be for (high-roller stakes, see #82), never more than you have. */
export const MIN_BET = 1;
export const MAX_BET = 10_000;
/** The amounts the panel offers to click, smallest first. */
export const BET_CHOICES = [10, 50, 100, 500, 1000, 5000, 10_000] as const;

/** Whether `amount` can be bet on a ball: a whole number of chips within the limits. */
export function betOk(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= MIN_BET && amount <= MAX_BET;
}

export function rowsOk(rows: unknown): rows is number {
  return typeof rows === 'number' && Number.isInteger(rows) && rows >= MIN_ROWS && rows <= MAX_ROWS;
}

export function riskOk(risk: unknown): risk is PlinkoRisk {
  return typeof risk === 'string' && (RISKS as readonly string[]).includes(risk);
}

/** A ball to drop: what it's for and on which board. */
export interface PlinkoDrop {
  bet: number;
  rows: number;
  risk: PlinkoRisk;
}

/** Whether `d` (off the wire) is a drop the office takes: a bet within the limits on a board there is. */
export function dropOk(d: unknown): d is PlinkoDrop {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return betOk(o.bet) && rowsOk(o.rows) && riskOk(o.risk);
}

/** What a ball for `bet` brings back landing at `m`: the stake times the multiplier, down to the whole chip. */
export function payout(bet: number, m: number): number {
  return Math.floor((bet * Math.round(m * 100)) / 100);
}

/** A multiplier the way the slots write it: "0.2×", "5.6×", "1000×". */
export function multText(m: number): string {
  return `${m}×`;
}

// ---- A ball ------------------------------------------------------------------------------------------

/** Which way a ball bounces off each row's peg, top to bottom: 0 left, 1 right. */
export type PlinkoPath = (0 | 1)[];

/** The slot a path lands in, counted from the left: how many times it went right. */
export function slotOf(path: readonly number[]): number {
  return path.reduce((n, b) => n + (b ? 1 : 0), 0);
}

/** Whether `path` is one a board of `rows` can have: a 0 or a 1 for every row. */
export function pathOk(path: unknown, rows: number): path is PlinkoPath {
  return Array.isArray(path) && path.length === rows && path.every((b) => b === 0 || b === 1);
}

/** How long a ball takes from the top to the first row of pegs, and from each row to the next (ms). */
export const ENTER_MS = 300;
export const ROW_MS = 190;

/** How long a ball falls on a board of `rows`, from the drop to landing in its slot (ms): the office pays then. */
export function fallMs(rows: number): number {
  return ENTER_MS + rows * ROW_MS;
}

/** How many of your balls can be falling at once, and how many there can be on the machine altogether. */
export const MAX_YOURS = 20;
export const MAX_BALLS = 120;
/** The least time between two of your drops (ms): auto-drop goes a little slower than this. */
export const DROP_GAP = 120;
/** How often auto-drop drops a ball (ms). */
export const AUTO_EVERY = 400;

/** A ball on the machine: whose, for what, on which board, and where it lands (the office picked it on the drop). */
export interface PlinkoBall {
  id: number;
  /** The page that dropped it (a peer id): it's "you" there. */
  peer: string;
  name: string;
  color?: string;
  bet: number;
  rows: number;
  risk: PlinkoRisk;
  path: PlinkoPath;
  slot: number;
  /** The slot's multiplier, and what it pays (bet × m, down to the chip). */
  m: number;
  won: number;
  /** How long ago it was dropped (ms) when the office sent it: 0 for a new one. */
  age: number;
}

/** A ball that's landed, for the strip of the last ones on the machine. */
export interface PlinkoLanding {
  name: string;
  color?: string;
  bet: number;
  rows: number;
  risk: PlinkoRisk;
  m: number;
  won: number;
}

/** How many landings the machine remembers. */
export const RECENT = 12;

/** The machine as a page that comes down to the casino gets it: the balls still falling, and the last ones that landed, newest first. */
export interface PlinkoState {
  balls: PlinkoBall[];
  recent: PlinkoLanding[];
}

export function emptyPlinko(): PlinkoState {
  return { balls: [], recent: [] };
}
