// Jumping out of the building: out of a window or over the balcony railing, with a parachute down to
// the street (see client/skydive.ts). What's here is the part with no pictures in it: where you can
// jump from, what the glide has to keep clear of, how a glide moves, and where you can come down.
// Units and frame as in layout.ts: the floor you jump from is at y = 0, the street `street` below it.

import { ASHTRAY, BALCONY, EXIT_STAIRS, FLOOR, LOFT, PARACHUTE, WALL_T, WINDOWS, type Opening } from './layout.js';

/** Somewhere to jump from: a window's sill, or the top of the balcony railing. */
export interface JumpSpot {
  kind: 'window' | 'railing';
  /** Which window (its index in WINDOWS), for a window. */
  window?: number;
  /** Where you go out: the middle of the opening half you're at (or the spot on the rail), out at the wall's (rail's) outer face. */
  x: number;
  z: number;
  /** How high up there your feet are: on the sill, or on the rail's top. */
  y: number;
  /** The floor you stood on to get up there: the office's (0) or the loft's. */
  floor: number;
  /** The way out, as a unit vector on the ground. */
  nx: number;
  nz: number;
}

/** A box on the ground plan: something that goes all the way up from the street, as far as the glide's concerned. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** How near a window you have to be (from its inside face) to climb out, and how square on you have to look out of it. */
const REACH = 1.2;
const FACING = 0.5;
/** Not right by the window's sides, nor in its middle, where the mullion is. */
const EDGE = 0.35;

/** The outside of a wall, the way out through it, and where along it (`u`) a point is. */
function wallOf(o: Opening): { nx: number; nz: number; face: number; along: (x: number, z: number) => number; inward: (x: number, z: number) => number } {
  switch (o.wall) {
    case 'south':
      return { nx: 0, nz: 1, face: FLOOR.maxZ, along: (x) => x, inward: (_x, z) => FLOOR.maxZ - z };
    case 'north':
      return { nx: 0, nz: -1, face: FLOOR.minZ, along: (x) => x, inward: (_x, z) => z - FLOOR.minZ };
    case 'east':
      return { nx: 1, nz: 0, face: FLOOR.maxX, along: (_x, z) => z, inward: (x) => FLOOR.maxX - x };
    case 'west':
      return { nx: -1, nz: 0, face: FLOOR.minX, along: (_x, z) => z, inward: (x) => x - FLOOR.minX };
  }
}

/** Whether a window opens straight onto the balcony (there's nowhere to fall to from it). */
function overBalcony(o: Opening): boolean {
  return o.wall === 'south' && o.y0 < LOFT.y && o.u + o.width / 2 > BALCONY.minX && o.u - o.width / 2 < BALCONY.maxX;
}

/** The windows you can jump out of, by their index in WINDOWS: all but the ones onto the balcony. */
export const JUMP_WINDOWS: readonly number[] = WINDOWS.map((o, i) => (overBalcony(o) ? -1 : i)).filter((i) => i >= 0);

/** The floor you stand on to reach a window: the loft's, for the two up there. */
export function windowFloor(o: Opening): number {
  return o.y0 >= LOFT.y ? LOFT.y : 0;
}

/**
 * Where you could jump from, standing with your feet at (x, y, z) and looking along (lookX, lookZ):
 * a window you're up at and looking out of, or the balcony railing in front of you. Null if neither.
 */
export function jumpSpotNear(x: number, y: number, z: number, lookX: number, lookZ: number): JumpSpot | null {
  const len = Math.hypot(lookX, lookZ) || 1;
  const [lx, lz] = [lookX / len, lookZ / len];
  let best: JumpSpot | null = null;
  let bestD = Infinity;
  for (const i of JUMP_WINDOWS) {
    const o = WINDOWS[i];
    const floor = windowFloor(o);
    if (Math.abs(y - floor) > 0.35) continue;
    const w = wallOf(o);
    if (lx * w.nx + lz * w.nz < FACING) continue;
    const d = w.inward(x, z);
    if (d < -0.05 || d > REACH) continue;
    const off = w.along(x, z) - o.u;
    if (Math.abs(off) > o.width / 2 - EDGE + 0.2) continue;
    if (d >= bestD) continue;
    // Out through the half you're in front of: the mullion's in the middle.
    const u = o.u + (off < 0 ? -1 : 1) * (o.width / 4);
    const out = w.face + (w.nx + w.nz) * WALL_T;
    const at = w.nx ? { x: out, z: u } : { x: u, z: out };
    best = { kind: 'window', window: i, x: at.x, z: at.z, y: o.y0, floor, nx: w.nx, nz: w.nz };
    bestD = d;
  }
  if (best) return best;
  // At the balcony railing, looking out over it: not where the ashtray stands at it.
  const onBalcony = x > BALCONY.minX + 0.4 && x < BALCONY.maxX - 0.4 && z > BALCONY.maxZ - REACH && z < BALCONY.maxZ;
  if (onBalcony && Math.abs(y) < 0.35 && lz >= FACING && Math.abs(x - ASHTRAY.x) > 0.7) {
    return { kind: 'railing', x, z: BALCONY.maxZ - 0.06, y: PARACHUTE.railTop, floor: 0, nx: 0, nz: 1 };
  }
  return null;
}

/**
 * What a glide keeps clear of, on the ground plan: the building (the garage under it included), the
 * balconies off its floors, and the exit stairs down its west side. They all go up past any floor.
 */
export const KEEP_OUT: readonly Box[] = [
  { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T },
  { minX: BALCONY.minX - 0.12, maxX: BALCONY.maxX + 0.12, minZ: BALCONY.minZ, maxZ: BALCONY.maxZ + 0.12 },
  { minX: EXIT_STAIRS.minX, maxX: EXIT_STAIRS.maxX, minZ: EXIT_STAIRS.landingZ0, maxZ: EXIT_STAIRS.landingZ1 + EXIT_STAIRS.steps * EXIT_STAIRS.run },
];

/** How far the glide stays from all that: room for the canopy, which is wider than you are. */
export const CLEARANCE = 1.8;

/**
 * Where you can come down: the lot round the building, the street and its sidewalks, the grass. Not
 * so far out that the neighbours' buildings are in it (see outside.ts' NEIGHBOURS), nor past the
 * far sidewalk (ROAD.maxZ + 2) across the street.
 */
export const LANDING = { minX: -38, maxX: 38, minZ: -34, maxZ: 33.5 } as const;

/** How far (x, z) is from the nearest of KEEP_OUT: 0 inside one. */
export function clearance(x: number, z: number): number {
  let d = Infinity;
  for (const b of KEEP_OUT) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    d = Math.min(d, Math.hypot(dx, dz));
  }
  return d;
}

/** Whether you can come down at (x, z): out in the open, clear of the building and the balconies. */
export function landable(x: number, z: number): boolean {
  return x >= LANDING.minX && x <= LANDING.maxX && z >= LANDING.minZ && z <= LANDING.maxZ && clearance(x, z) >= 0.5;
}

/** A glide under an open chute, in the floor's frame. */
export interface Glide {
  x: number;
  y: number;
  z: number;
  /** Which way you're flying (rotation around y; 0 is +z), and how fast along it (m/s). */
  heading: number;
  speed: number;
  /** Up (+) or down (-), m/s. */
  vy: number;
}

/** What the keys say: turn left (-1) or right (+1), and pull forward (+1, W) or brake (-1, S). */
export interface Steer {
  turn: number;
  push: number;
}

/** Forward speed under the chute (m/s), and how much W or S changes it. */
export const GLIDE_SPEED = { base: 2.4, push: 1.6 } as const;
/** How fast you sink under it (m/s): a little faster pulling forward, slower braking. */
export const SINK = { base: 2.6, push: 0.7 } as const;
/** How fast you turn (rad/s). */
export const TURN = 1.15;
/** Down to this high over the ground you flare: the chute brakes you to a soft landing. */
export const FLARE = 1.3;
const FLARE_SINK = 0.9;

/** How hard you're braked in a flare, 0 (not at all) to 1, at `h` over the ground. */
export function flare(h: number): number {
  return Math.min(1, Math.max(0, 1 - h / FLARE));
}

/**
 * One step of a glide: you turn, speed up or slow down as the keys say, sink (slower in the flare
 * near the ground) and fly on, never closer to the building than CLEARANCE (or than you already
 * are, just out of the window) and never off the edge of LANDING. `ground` is the street's height.
 */
export function glideStep(g: Glide, steer: Steer, dt: number, ground: number): void {
  const turn = Math.max(-1, Math.min(1, steer.turn));
  const push = Math.max(-1, Math.min(1, steer.push));
  const f = flare(g.y - ground);
  // You fly along (sin, cos) of the heading: turning right (D, +1) takes it down.
  g.heading -= turn * TURN * dt * (1 - 0.6 * f);
  const speed = (GLIDE_SPEED.base + push * GLIDE_SPEED.push) * (1 - 0.55 * f);
  g.speed += (speed - g.speed) * Math.min(1, dt * 2);
  const sink = (SINK.base + push * SINK.push) * (1 - f) + FLARE_SINK * f;
  g.vy += (-sink - g.vy) * Math.min(1, dt * (3 + 5 * f));
  g.y = Math.max(ground, g.y + g.vy * dt);
  let dx = Math.sin(g.heading) * g.speed * dt;
  let dz = Math.cos(g.heading) * g.speed * dt;
  // Still close in by the wall: drift on out, away from it.
  const here = clearance(g.x, g.z);
  if (here < CLEARANCE) {
    const e = 0.05;
    const gx = clearance(g.x + e, g.z) - clearance(g.x - e, g.z);
    const gz = clearance(g.x, g.z + e) - clearance(g.x, g.z - e);
    const n = Math.hypot(gx, gz);
    if (n > 1e-6) {
      const away = 1.6 * dt * (1 - here / CLEARANCE);
      dx += (gx / n) * away;
      dz += (gz / n) * away;
    }
  }
  moveClear(g, dx, dz);
}

/** Moves (x, z) by (dx, dz), sliding along whatever's in the way: no nearer the building than CLEARANCE (or than it already is), inside LANDING. */
export function moveClear(p: { x: number; z: number }, dx: number, dz: number): void {
  const floor = Math.min(clearance(p.x, p.z), CLEARANCE);
  const ok = (x: number, z: number) => clearance(x, z) >= floor - 1e-9;
  const clampX = (x: number) => Math.max(LANDING.minX, Math.min(LANDING.maxX, x));
  const clampZ = (z: number) => Math.max(LANDING.minZ, Math.min(LANDING.maxZ, z));
  const [x1, z1] = [clampX(p.x + dx), clampZ(p.z + dz)];
  if (ok(x1, z1)) [p.x, p.z] = [x1, z1];
  else if (ok(x1, p.z)) p.x = x1;
  else if (ok(p.x, z1)) p.z = z1;
}
