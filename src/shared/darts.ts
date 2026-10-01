// The dartboard on every floor, and the game of 301 (or 501) up to four people play on it. The office
// keeps the game (see server/darts.ts); a page says where on the board each dart landed, and the
// office scores it here, so everyone on the floor sees the same darts and the same scores.

// ---- The board --------------------------------------------------------------------------------------

/**
 * A regulation board, in meters, as seen from the front: board-local coordinates have the bullseye
 * at (0, 0), x to the right and y up. The sectors, clockwise from the top (20 straight up, 3 straight
 * down, 6 to the right, 11 to the left); each is 18° wide, and 20 is centred on straight up.
 */
export const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

/**
 * How far from the middle each ring's wire is (m). Inside `bull` is the bullseye (50, a double);
 * out to `outerBull` the outer bull (25); then the inner singles, the triple ring from `tripleIn` to
 * `tripleOut`, the outer singles, and the double ring from `doubleIn` to `doubleOut`. Past that is
 * the black surround: a miss. A dart right on a wire counts for the side nearer the bull.
 */
export const RINGS = {
  bull: 0.00635,
  outerBull: 0.016,
  tripleIn: 0.099,
  tripleOut: 0.107,
  doubleIn: 0.162,
  doubleOut: 0.17,
} as const;

/** How wide one sector is, in radians. */
export const SECTOR_ANGLE = (2 * Math.PI) / SECTORS.length;

/**
 * Where a dart scored. `value` is all it's worth (a T20 is 60), `mult` what the sector was multiplied
 * by (0 a miss; the bullseye is a double: 2 × 25), `sector` the number it went in (25 for either bull,
 * 0 for a miss), and `label` how a scoreboard writes it: "T20", "D16", "7", "25", "BULL" or "MISS".
 */
export interface Hit {
  value: number;
  mult: 0 | 1 | 2 | 3;
  sector: number;
  label: string;
}

const MISS: Hit = { value: 0, mult: 0, sector: 0, label: 'MISS' };

/**
 * The sector at board-local (x, y): by the angle clockwise from straight up. A dart right on the wire
 * between two sectors counts for the one clockwise of it.
 */
export function sectorAt(x: number, y: number): number {
  const a = Math.atan2(x, y) + SECTOR_ANGLE / 2;
  const i = Math.floor(a / SECTOR_ANGLE);
  return SECTORS[((i % SECTORS.length) + SECTORS.length) % SECTORS.length];
}

/** What a dart that hit the board at board-local (x, y) meters scores. */
export function score(x: number, y: number): Hit {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return MISS;
  const r = Math.hypot(x, y);
  if (r <= RINGS.bull) return { value: 50, mult: 2, sector: 25, label: 'BULL' };
  if (r <= RINGS.outerBull) return { value: 25, mult: 1, sector: 25, label: '25' };
  if (r > RINGS.doubleOut) return MISS;
  const sector = sectorAt(x, y);
  const mult = r > RINGS.doubleIn ? 2 : r > RINGS.tripleIn && r <= RINGS.tripleOut ? 3 : 1;
  return { value: sector * mult, mult, sector, label: (mult === 3 ? 'T' : mult === 2 ? 'D' : '') + sector };
}

/** A throw from the page is somewhere near the board: on it, or on the wall round it, not miles off. */
export const THROW_REACH = 1;

/** Whether a dart from the page is one the office scores: two real numbers, within THROW_REACH of the bull. */
export function dartOk(d: { x: unknown; y: unknown }): d is { x: number; y: number } {
  if (typeof d.x !== 'number' || typeof d.y !== 'number' || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return false;
  return Math.hypot(d.x, d.y) <= THROW_REACH;
}

// ---- The players ------------------------------------------------------------------------------------

/**
 * Each player's colour, for their darts, their name on the scoreboard and their flights: in this
 * order, each new player getting the first one nobody has. Bright and far apart from each other, so
 * they stand out on the board's black, cream, red and green (the green is a lighter, bluer one than
 * the board's, the red a pinker one).
 */
export const DART_COLORS = [
  '#ff3d5a', // red
  '#3d8bff', // blue
  '#3ddc84', // green
  '#ffd23d', // yellow
] as const;

export const MAX_PLAYERS = DART_COLORS.length;

/** Someone at the board: a PeerInfo id, their name and their colour (one of DART_COLORS). */
export interface DartsSeat {
  id: string;
  name: string;
  color: string;
}

// ---- The game ---------------------------------------------------------------------------------------

export type DartsMode = 301 | 501;

export interface DartsOptions {
  /** What everyone starts on, and counts down to 0 from. */
  mode: DartsMode;
  /** The last dart has to be a double (or the bullseye) to finish. */
  doubleOut: boolean;
}

export const DEFAULT_OPTIONS: DartsOptions = { mode: 301, doubleOut: true };

/** A dart in the board: where it landed (board-local meters) and what it scored. */
export interface Dart extends Hit {
  x: number;
  y: number;
}

export interface DartsPlayer extends DartsSeat {
  /** What they have left to score. */
  score: number;
}

/** A turn someone's finished: up to three darts, and whether it went bust (and so scored nothing). */
export interface DartsTurn {
  player: string;
  /** Their score at the start of the turn, which a bust puts back. */
  from: number;
  darts: Dart[];
  bust: boolean;
}

/** Darts thrown in a turn, at most. */
export const DARTS_PER_TURN = 3;
/** Finished turns a game keeps (the oldest go first), so one that drags on doesn't grow forever. */
export const TURNS_KEPT = 200;

/** A game of 301 (or 501): who's playing in what order, whose turn it is, and every dart. */
export interface DartsGame extends DartsOptions {
  players: DartsPlayer[];
  /** Whose turn it is: an index into `players`. */
  up: number;
  /** The turn so far: the darts that player has thrown in it, and their score at its start. */
  darts: Dart[];
  from: number;
  /** Finished turns, oldest first (only the last TURNS_KEPT). */
  turns: DartsTurn[];
  /** Over: someone won (`winner`, their id), or everyone else left. Nobody throws any more. */
  over: boolean;
  winner: string | null;
}

/** What one dart did: what it hit, and whether it went bust, won the game or ended the turn. */
export interface DartResult {
  dart: Dart;
  bust: boolean;
  won: boolean;
  turnOver: boolean;
}

/** A new game for `seats`, who throw in that order, the first one first. */
export function newGame(options: DartsOptions, seats: readonly DartsSeat[]): DartsGame {
  const players = seats.map((s) => ({ id: s.id, name: s.name, color: s.color, score: options.mode }));
  return { mode: options.mode, doubleOut: options.doubleOut, players, up: 0, darts: [], from: options.mode, turns: [], over: players.length === 0, winner: null };
}

/**
 * Whether leaving `left` would bust: below 0, or with double-out on, at exactly 1 (no double finishes
 * that) or at 0 on anything but a double.
 */
export function busts(left: number, hit: Hit, doubleOut: boolean): boolean {
  if (left < 0) return true;
  if (!doubleOut) return false;
  return left === 1 || (left === 0 && hit.mult !== 2);
}

/**
 * The player who's up throws a dart that lands at board-local (x, y). It comes off their score; a
 * bust puts their score back to what it was at the start of the turn and ends it, as does the third
 * dart, and reaching exactly 0 wins. Null once the game is over.
 */
export function throwDart(g: DartsGame, x: number, y: number): DartResult | null {
  if (g.over) return null;
  const p = g.players[g.up];
  const dart: Dart = { x, y, ...score(x, y) };
  const left = p.score - dart.value;
  const bust = busts(left, dart, g.doubleOut);
  g.darts.push(dart);
  p.score = bust ? g.from : left;
  const won = !bust && left === 0;
  if (won) {
    g.over = true;
    g.winner = p.id;
  }
  const turnOver = bust || won || g.darts.length >= DARTS_PER_TURN;
  if (turnOver) endTurn(g, bust);
  return { dart, bust, won, turnOver };
}

/** Puts the turn so far with the finished ones and, unless the game's over, hands the darts on. */
function endTurn(g: DartsGame, bust: boolean) {
  const p = g.players[g.up];
  g.turns.push({ player: p.id, from: g.from, darts: g.darts, bust });
  if (g.turns.length > TURNS_KEPT) g.turns.splice(0, g.turns.length - TURNS_KEPT);
  g.darts = [];
  if (g.over) return;
  g.up = (g.up + 1) % g.players.length;
  g.from = g.players[g.up].score;
}

/**
 * `id` leaves the game: if it was their turn, the darts so far are pulled out and it's the next
 * player's. With one player left of several (or none of one), the game's over, with no winner.
 * Says whether they were playing.
 */
export function removePlayer(g: DartsGame, id: string): boolean {
  const i = g.players.findIndex((p) => p.id === id);
  if (i < 0) return false;
  const before = g.players.length;
  const theirTurn = i === g.up;
  g.players.splice(i, 1);
  if (i < g.up) g.up--;
  if (g.players.length === 0) {
    g.up = 0;
    g.darts = [];
  } else {
    g.up %= g.players.length;
    if (theirTurn) {
      g.darts = [];
      g.from = g.players[g.up].score;
    }
  }
  if (!g.over && (before > 1 ? g.players.length < 2 : g.players.length === 0)) g.over = true;
  return true;
}

// ---- On a floor -------------------------------------------------------------------------------------

/**
 * The darts on a floor: who's at the board (`lobby`, up to MAX_PLAYERS, each with their colour), the
 * options the next game starts with, and the game, if there is one (running, or over and still on
 * the scoreboard). Someone who joins while a game runs plays in the next one.
 */
export interface DartsState extends DartsOptions {
  lobby: DartsSeat[];
  game: DartsGame | null;
}

export function emptyDarts(): DartsState {
  return { lobby: [], ...DEFAULT_OPTIONS, game: null };
}
