// ---- The jump & run course outside (#140) -----------------------------------------------------------
// Down on the street east of the building, between the side lot and the neighbour to the east: crates,
// pipes, scaffolding and containers climbing in steps from a start line by the sidewalk up to a flag.
// The client builds and plays it (world/jumprun.ts, client/jumprun.ts); the office keeps the times
// (server/jumprun.ts). Heights here are above the street, which is further down the higher your floor
// is (see streetBelow in layout.ts).

/** What a piece of the course is made of: how it looks, and whether there's anything under it. */
export type PieceKind = 'crate' | 'pipe' | 'scaffold' | 'container' | 'mover' | 'goal';

export interface Piece {
  kind: PieceKind;
  /** The middle of its top, and how wide (x) and deep (z) it is. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Its top, above the street. */
  h: number;
  /** How thick it is from the top down; omitted, it stands on the ground (or on the piece under it, `on`). */
  thick?: number;
  /** The piece it stands on (its index), for crates stacked on a container. */
  on?: number;
  /** A moving platform: it slides back and forth along x this far each way, once every `period` seconds. */
  move?: { amp: number; period: number };
  /** Landing on it saves your place: fall off after and you're back on it (its number, from 1). */
  checkpoint?: number;
}

/** The course, in the order you run it. Every gap and step is checked against the jump in tests/jumprun.test.ts. */
export const COURSE: readonly Piece[] = [
  { kind: 'crate', x: 35.5, z: 14.6, w: 1.2, d: 1.2, h: 0.7 },
  { kind: 'crate', x: 35.5, z: 12.8, w: 1.2, d: 1.2, h: 1.4 },
  { kind: 'pipe', x: 35.5, z: 10.8, w: 3, d: 0.7, h: 2, thick: 0.7 },
  { kind: 'scaffold', x: 35.5, z: 8.4, w: 2.2, d: 2, h: 2.6, thick: 0.15, checkpoint: 1 },
  { kind: 'mover', x: 35.5, z: 5.6, w: 1.4, d: 1.4, h: 2.6, thick: 0.25, move: { amp: 1.5, period: 6 } },
  { kind: 'container', x: 35.5, z: 2.4, w: 6, d: 2.4, h: 2.6 },
  { kind: 'crate', x: 35.5, z: 1.7, w: 1, d: 1, h: 3.4, on: 5 },
  { kind: 'scaffold', x: 35.5, z: -0.6, w: 2, d: 1.6, h: 4.2, thick: 0.15 },
  { kind: 'pipe', x: 35.5, z: -3, w: 3, d: 0.7, h: 4.8, thick: 0.7 },
  { kind: 'container', x: 35.5, z: -7.2, w: 2.4, d: 6, h: 5.2, checkpoint: 2 },
  { kind: 'mover', x: 35.5, z: -12.5, w: 1.4, d: 1.4, h: 5.2, thick: 0.25, move: { amp: 1.4, period: 5 } },
  { kind: 'scaffold', x: 35.5, z: -15.2, w: 2.2, d: 2, h: 5.9, thick: 0.15 },
  { kind: 'scaffold', x: 38.6, z: -15.2, w: 1.6, d: 1.6, h: 6.6, thick: 0.15 },
  { kind: 'goal', x: 39, z: -10.8, w: 2.4, d: 2.4, h: 7.3, thick: 0.2 },
];

/** How many checkpoints there are on the way. */
export const CHECKPOINTS = COURSE.filter((p) => p.checkpoint).length;
/** The last piece, with the flag on it. */
export const GOAL = COURSE[COURSE.length - 1];
/** The flagpole on the goal, toward its back corner; reach it (within `reach`) to stop the clock. */
export const FLAG = { x: GOAL.x + 0.6, z: GOAL.z - 0.6, reach: 1.2, height: 2.4 } as const;

/**
 * The start line, painted across the way in at z, from x0 to x1: cross it northward (toward -z) on
 * the ground and the clock starts. The sign arches over it; the leaderboard stands beside it at
 * `board`, facing west toward the lot and the garage.
 */
export const START = { z: 16.8, x0: 33, x1: 38, board: { x: 40.2, z: 16.2, w: 3.2, h: 2.4 } } as const;

/** Where a piece is (its middle's x) `t` seconds in: a mover slides to and fro, the rest stay put. */
export function pieceX(p: Piece, t: number): number {
  return p.move ? p.x + p.move.amp * Math.sin((t / p.move.period) * Math.PI * 2) : p.x;
}

/** The piece whose top (x, z) is over, within `r` of its edge, `t` seconds in (moving ones where they are then); -1 if none. Highest first. */
export function pieceUnder(x: number, z: number, r = 0, t = 0): number {
  let best = -1;
  COURSE.forEach((p, i) => {
    const px = pieceX(p, t);
    if (Math.abs(x - px) > p.w / 2 + r || Math.abs(z - p.z) > p.d / 2 + r) return;
    if (best < 0 || p.h > COURSE[best].h) best = i;
  });
  return best;
}

/** The piece with checkpoint number `n` (from 1). */
export function checkpointPiece(n: number): Piece | undefined {
  return COURSE.find((p) => p.checkpoint === n);
}

/** Whether (x, z) is by the flag. */
export function atFlag(x: number, z: number, slack = 0): boolean {
  return Math.hypot(x - FLAG.x, z - FLAG.z) <= FLAG.reach + slack;
}

/** Whether a step from z0 to z1 at x crosses the start line on the way in. */
export function crossesStart(x: number, z0: number, z1: number): boolean {
  return x >= START.x0 && x <= START.x1 && z0 > START.z && z1 <= START.z;
}

/** The whole course stays in here: east of the side lot, clear of the trees and the neighbour to the east. */
export const COURSE_AREA = { minX: 32, maxX: 40.6, minZ: -17, maxZ: 18 } as const;

// ---- Times ----------------------------------------------------------------------------------------

/** A time on the board: who ran it (a name, their colour), how long it took (ms) and when. */
export interface JumpRunScore {
  name: string;
  color: string;
  ms: number;
  at: number;
}

/** Times on the board: the best of each person. */
export const BOARD_SIZE = 10;
/** No run is quicker than this (ms), whatever the coffee: anything faster didn't run it. */
export const QUICKEST_MS = 6000;
/** A run still on after this long (ms) is dropped. */
export const LONGEST_MS = 30 * 60_000;

/** A time as the board shows it: 1:02.35, or 42.07 under a minute. */
export function formatTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const two = (n: number) => String(n).padStart(2, '0');
  return m > 0 ? `${m}:${two(s)}.${two(c)}` : `${s}.${two(c)}`;
}

export type JumpRunClientMsg =
  /** You crossed the start line: the office's clock starts (again, if you were already running). */
  | { t: 'jumprun.start' }
  /** You landed on checkpoint `n` (they come in order). */
  | { t: 'jumprun.checkpoint'; n: number }
  /** You reached the flag: the office stops the clock and puts your time on the board if it's good enough. */
  | { t: 'jumprun.finish' }
  /** You gave up the run (fell off before the first checkpoint, walked away, left the floor). */
  | { t: 'jumprun.quit' }
  /** Send me the board. */
  | { t: 'jumprun.board' };

export type JumpRunServerMsg =
  /** The board; `record` when someone just took first place. */
  | { t: 'jumprun'; board: JumpRunScore[]; record?: { name: string; ms: number } }
  /** Your run is over: its time by the office's clock, your place on the board (null if it isn't on it), and whether it's your best. */
  | { t: 'jumprun.done'; ms: number; rank: number | null; best: boolean }
  /** The office didn't count that run (no start, a checkpoint skipped, not at the flag, impossibly quick). */
  | { t: 'jumprun.void' };
