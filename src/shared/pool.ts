// The pool table on every floor, and the game of 8-ball two (1 v 1) or four (2 v 2) people play on it.
// The office keeps the game (see server/pool.ts): a page says which way and how hard the cue ball is
// struck, and the office rolls every ball here, to rest, and scores the shot, so everyone on the floor
// sees the same balls go the same way. The simulation is plain arithmetic on a fixed timestep (no
// Math.random, no clock), so the same table and the same shot always end the same way; the office
// sends each shot's trajectory along with it, so a page only has to play it back.

// ---- The table --------------------------------------------------------------------------------------

/** A pool ball's diameter and radius (m): 2¼". */
export const BALL_D = 0.05715;
export const BALL_R = BALL_D / 2;

/**
 * A regulation 8-ft table, in table-local meters: the middle of the bed at (0, 0), x along its length
 * and y across it. The head of the table (where the break is from) is at -x, the foot (where the rack
 * is) at +x. `length` × `width` is the playing surface, measured between the cushions' noses: a ball's
 * centre stays at least BALL_R inside it. For the model: the bed is `height` above the floor, the
 * cushions' noses `cushionHeight` above the bed, the rubber `cushion` wide and the wooden rail round it
 * `rail` wide.
 */
export const TABLE = {
  length: 2.24,
  width: 1.12,
  height: 0.79,
  cushion: 0.05,
  cushionHeight: 0.036,
  rail: 0.11,
  /** A corner pocket's mouth, from one cushion's point to the other's, across the diagonal (m). */
  cornerMouth: 0.116,
  /** A side pocket's mouth, from one cushion's point to the other's (m). */
  sideMouth: 0.13,
  /**
   * The head string: the line across the table a quarter of the way from the head rail. Behind it
   * (x ≤ headString) is the kitchen, where the cue ball goes for the break.
   */
  headString: -0.56,
  /** Where the cue ball goes by default, for the break or after a scratch. */
  headSpot: { x: -0.56, y: 0 },
  /** Where the rack's apex ball sits, and where a ball is spotted. */
  footSpot: { x: 0.56, y: 0 },
} as const;

const HL = TABLE.length / 2;
const HW = TABLE.width / 2;
/** How far along each rail a corner pocket's mouth reaches from the corner. */
const CORNER_CUT = TABLE.cornerMouth / Math.SQRT2;
const SIDE_HALF = TABLE.sideMouth / 2;

export interface Point {
  x: number;
  y: number;
}

/**
 * The six pockets, in table-local meters, round the table from the head corner at -y: 0 head corner
 * (-x, -y), 1 side (-y), 2 foot corner (+x, -y), 3 foot corner (+x, +y), 4 side (+y), 5 head corner
 * (-x, +y). (x, y) is the middle of the hole and `r` its radius, for the model; `mouth` how wide the
 * way in is between the cushions' points. A ball drops once its centre is past the line of the
 * cushions' noses, which it can only get to through a mouth.
 */
export const POCKETS: readonly { id: number; x: number; y: number; r: number; mouth: number; corner: boolean }[] = [
  { id: 0, x: -HL, y: -HW, r: 0.06, mouth: TABLE.cornerMouth, corner: true },
  { id: 1, x: 0, y: -HW - 0.03, r: 0.065, mouth: TABLE.sideMouth, corner: false },
  { id: 2, x: HL, y: -HW, r: 0.06, mouth: TABLE.cornerMouth, corner: true },
  { id: 3, x: HL, y: HW, r: 0.06, mouth: TABLE.cornerMouth, corner: true },
  { id: 4, x: 0, y: HW + 0.03, r: 0.065, mouth: TABLE.sideMouth, corner: false },
  { id: 5, x: -HL, y: HW, r: 0.06, mouth: TABLE.cornerMouth, corner: true },
];

/**
 * The six cushions, each between two pockets: cushion k runs from pocket k to pocket k + 1 (0 and 1
 * along the -y rail, 2 the foot rail, 3 and 4 along the +y rail, 5 the head rail). `a` and `b` are the
 * ends of its nose (the points of the pockets' jaws), `n` the way it faces, into the table.
 */
export const CUSHIONS: readonly { id: number; a: Point; b: Point; n: Point }[] = [
  { id: 0, a: { x: -HL + CORNER_CUT, y: -HW }, b: { x: -SIDE_HALF, y: -HW }, n: { x: 0, y: 1 } },
  { id: 1, a: { x: SIDE_HALF, y: -HW }, b: { x: HL - CORNER_CUT, y: -HW }, n: { x: 0, y: 1 } },
  { id: 2, a: { x: HL, y: -HW + CORNER_CUT }, b: { x: HL, y: HW - CORNER_CUT }, n: { x: -1, y: 0 } },
  { id: 3, a: { x: HL - CORNER_CUT, y: HW }, b: { x: SIDE_HALF, y: HW }, n: { x: 0, y: -1 } },
  { id: 4, a: { x: -SIDE_HALF, y: HW }, b: { x: -HL + CORNER_CUT, y: HW }, n: { x: 0, y: -1 } },
  { id: 5, a: { x: -HL, y: HW - CORNER_CUT }, b: { x: -HL, y: -HW + CORNER_CUT }, n: { x: 1, y: 0 } },
];

/** The cushions as the simulation wants them: which way each runs, between where, and the jaws' points at their ends. */
const RAILS = CUSHIONS.map((c) => {
  const alongX = c.n.x === 0;
  const [p, q] = alongX ? [c.a.x, c.b.x] : [c.a.y, c.b.y];
  return { id: c.id, alongX, lo: Math.min(p, q), hi: Math.max(p, q), ax: c.a.x, ay: c.a.y, nx: c.n.x, ny: c.n.y };
});
const JAWS = CUSHIONS.flatMap((c) => [{ id: c.id, ...c.a }, { id: c.id, ...c.b }]);

/** The balls' colours: 0 the cue ball, 1–8 solid, 9–15 striped in the colour of n − 8 on white. */
export const BALL_COLORS = [
  '#f8f4e8', // cue ball
  '#f2c200', // 1 yellow
  '#1f4fd1', // 2 blue
  '#d8261c', // 3 red
  '#5b2a86', // 4 purple
  '#f26b0f', // 5 orange
  '#138a3c', // 6 green
  '#7a1f1f', // 7 maroon
  '#111111', // 8 black
] as const;

export function ballColor(n: number): string {
  return BALL_COLORS[n > 8 ? n - 8 : n] ?? BALL_COLORS[0];
}

/** A ball on the table: its number (0 the cue ball) and where its centre is, in table-local meters. */
export interface BallPos {
  n: number;
  x: number;
  y: number;
}

/** A tiny gap between racked balls, so the break spreads them rather than settling who touches whom. */
const RACK_GAP = 0.0002;

/**
 * The rack's order, row by row from the apex on the foot spot to the back row toward the foot rail:
 * the 1 at the apex, the 8 in the middle of the third row, a solid and a stripe in the back corners.
 */
export const RACK_ORDER = [[1], [10, 2], [3, 8, 11], [12, 4, 13, 5], [6, 14, 7, 9, 15]] as const;

/** A fresh table: fifteen balls racked at the foot spot, and the cue ball on the head spot. */
export function rack(): BallPos[] {
  const balls: BallPos[] = [{ n: 0, ...TABLE.headSpot }];
  const d = BALL_D + RACK_GAP;
  RACK_ORDER.forEach((row, i) =>
    row.forEach((n, j) => balls.push({ n, x: round(TABLE.footSpot.x + (i * d * Math.sqrt(3)) / 2), y: round((j - i / 2) * d) })),
  );
  return balls.sort((a, b) => a.n - b.n);
}

/** Whether a ball's centre at (x, y) is on the bed, within the cushions. */
export function onTable(x: number, y: number): boolean {
  return Math.abs(x) <= HL - BALL_R && Math.abs(y) <= HW - BALL_R;
}

/** Whether a ball can be put down at (x, y): on the table, touching none of `balls` but `except`. */
export function free(balls: readonly BallPos[], x: number, y: number, except = -1): boolean {
  if (!onTable(x, y)) return false;
  return balls.every((b) => b.n === except || (b.x - x) ** 2 + (b.y - y) ** 2 >= BALL_D * BALL_D);
}

/**
 * Where ball `n` goes back on the table near (x, y): there if it's free, or the nearest free point on
 * the line along the table through it, `dir` first (toward the foot rail for +1, the head rail for -1).
 */
export function spot(balls: readonly BallPos[], n: number, at: Point, dir: 1 | -1 = 1): Point {
  for (const d of [dir, -dir]) {
    for (let x = at.x; Math.abs(x) <= HL - BALL_R; x += d * 0.001) if (free(balls, round(x), at.y, n)) return { x: round(x), y: at.y };
  }
  // A table so full nothing fits on its long axis: somewhere across it, then.
  for (let y = at.y; Math.abs(y) <= HW - BALL_R; y += 0.002) if (free(balls, at.x, round(y), n)) return { x: at.x, y: round(y) };
  return { ...at };
}

// ---- The physics ------------------------------------------------------------------------------------

/**
 * A shot: which way the cue ball goes (`angle`, radians, counter-clockwise from +x, toward the foot),
 * how hard (`power`, 0–1, up to MAX_SPEED), and where on the ball the cue tip struck it: `top` above
 * (follow, up to 1) or below (draw, down to -1) the middle, and `side` right of it (+1, right english)
 * or left (-1). 1 is half the ball's radius off centre, about as far as a tip can go without a miscue.
 */
export interface Shot {
  angle: number;
  power: number;
  top?: number;
  side?: number;
}

/** How fast the cue ball leaves the tip at full power (m/s): a hard break. */
export const MAX_SPEED = 7;

/** Whether a shot from a page is one to take: real numbers, a direction, power over 0, spin within ±1. */
export function shotOk(s: { angle?: unknown; power?: unknown; top?: unknown; side?: unknown }): s is Shot {
  const real = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!real(s.angle) || Math.abs(s.angle as number) > 100) return false;
  if (!real(s.power) || (s.power as number) <= 0 || (s.power as number) > 1) return false;
  for (const v of [s.top, s.side]) if (v !== undefined && (!real(v) || Math.abs(v as number) > 1)) return false;
  return true;
}

/** The simulation's fixed step (s), and how long it runs at most before everything's stopped dead. */
export const SIM_DT = 0.001;
export const SIM_MAX = 60;
/** How often a moving ball's position goes in its trajectory, at least (ms). */
export const SAMPLE_MS = 50;

const G = 9.81;
/** Cloth friction while a ball slides (skids), and while it rolls. */
const MU_SLIDE = 0.2;
const MU_ROLL = 0.015;
/** How much speed a collision keeps along the line of centres, and a cushion off its face. */
const E_BALL = 0.95;
const E_CUSHION = 0.78;
/** How much sideways speed side spin gives off a cushion, per m/s into it, and how fast it wears off (/s). */
const SIDE_KICK = 0.3;
const SIDE_FADE = 0.4;
/** How much spin a tip 1 (half a radius) off centre gives: ωR = 5/2 · (b/R) · v. */
const SPIN = 1.25;

/**
 * Something that happened in a shot, `t` ms in: ball `a` hit ball `b` ('hit'), cushion `b` ('cushion')
 * or dropped in pocket `b` ('pocket'), at `v` m/s (how hard, for the sound).
 */
export interface ShotEvent {
  t: number;
  type: 'hit' | 'cushion' | 'pocket';
  a: number;
  b: number;
  v: number;
}

/**
 * Where ball `n` went: `k` is [ms, x mm, y mm, ms, x mm, y mm, …], from where it started to move to
 * where it stopped (or dropped), with a key at least every SAMPLE_MS and at every bounce, so drawing
 * straight lines between them is close enough. A ball with no path didn't move.
 */
export interface BallPath {
  n: number;
  k: number[];
}

/** Everything a shot did. */
export interface ShotResult {
  /** The balls still on the table, at rest. */
  balls: BallPos[];
  /** Every ball that dropped, in order: which, into which pocket, when (ms). */
  pocketed: { n: number; pocket: number; t: number }[];
  /** The first ball the cue ball touched, or null if it touched none. */
  firstHit: number | null;
  /** Every cushion a ball touched after the cue ball's first contact, in order. */
  cushions: { n: number; cushion: number; t: number }[];
  /** Hits, cushions and drops, in order, for the sounds (at most MAX_EVENTS). */
  events: ShotEvent[];
  /** Each ball that moved, and how. */
  path: BallPath[];
  /** How long until everything stopped (ms). */
  duration: number;
}

const MAX_EVENTS = 400;
const MAX_CUSHIONS = 100;

interface Body {
  n: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The velocity the ball's spin would roll it at: where it's rolling, this is (vx, vy). */
  ux: number;
  uy: number;
  side: number;
  on: boolean;
  keys: number[];
  lastKey: number;
}

const moving = (b: Body) => b.on && (b.vx !== 0 || b.vy !== 0 || b.ux !== 0 || b.uy !== 0);
const round = (v: number) => Math.round(v * 1e5) / 1e5;
const mm = (v: number) => Math.round(v * 1000);

/**
 * Strikes the cue ball (n 0 in `balls`) with `shot`, and rolls every ball to rest on a fixed timestep:
 * the cue ball skids, then rolls, with whatever follow or draw it was given; balls collide (elastically,
 * nearly), bounce off the cushions and their pockets' points (losing some speed, and the cue ball's side
 * spin kicking it along the cushion), slow on the cloth and drop in the pockets. Deterministic: the same
 * balls and shot give the same result, down to the last bit.
 */
export function simulate(balls: readonly BallPos[], shot: Shot): ShotResult {
  const bodies: Body[] = balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, ux: 0, uy: 0, side: 0, on: true, keys: [], lastKey: -Infinity }));
  const cue = bodies.find((b) => b.n === 0);
  const result: ShotResult = { balls: [], pocketed: [], firstHit: null, cushions: [], events: [], path: [], duration: 0 };
  if (!cue) return finish(bodies, result, 0);

  const speed = Math.min(1, Math.max(0, shot.power)) * MAX_SPEED;
  const dx = Math.cos(shot.angle);
  const dy = Math.sin(shot.angle);
  const top = clamp(shot.top ?? 0);
  cue.vx = speed * dx;
  cue.vy = speed * dy;
  cue.ux = SPIN * top * cue.vx;
  cue.uy = SPIN * top * cue.vy;
  cue.side = clamp(shot.side ?? 0);

  const key = (b: Body, ms: number) => {
    if (b.keys.length >= 3 && b.keys[b.keys.length - 3] === ms) b.keys.length -= 3;
    b.keys.push(ms, mm(b.x), mm(b.y));
    b.lastKey = ms;
  };
  const event = (e: ShotEvent) => {
    if (result.events.length < MAX_EVENTS) result.events.push(e);
  };

  const steps = Math.round(SIM_MAX / SIM_DT);
  const was = bodies.map(moving);
  const mv = was.slice();
  key(cue, 0);
  let step = 0;
  let any = true;
  for (; step < steps && any; step++) {
    const ms = Math.round((step + 1) * SIM_DT * 1000);
    for (const b of bodies) if (moving(b)) friction(b);
    for (const b of bodies) {
      if (!b.on) continue;
      b.x += b.vx * SIM_DT;
      b.y += b.vy * SIM_DT;
    }

    // Ball on ball (only where one of them is moving).
    for (let i = 0; i < bodies.length; i++) mv[i] = moving(bodies[i]);
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i];
      if (!p.on) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const q = bodies[j];
        if (!q.on || (!mv[i] && !mv[j])) continue;
        const ox = q.x - p.x;
        const oy = q.y - p.y;
        const d2 = ox * ox + oy * oy;
        if (d2 >= BALL_D * BALL_D) continue;
        const d = Math.sqrt(d2);
        const nx = d > 0 ? ox / d : 1;
        const ny = d > 0 ? oy / d : 0;
        const closing = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
        if (closing > 0) {
          const pn = p.vx * nx + p.vy * ny;
          const qn = q.vx * nx + q.vy * ny;
          const pn2 = ((1 - E_BALL) * pn + (1 + E_BALL) * qn) / 2;
          const qn2 = ((1 + E_BALL) * pn + (1 - E_BALL) * qn) / 2;
          p.vx += (pn2 - pn) * nx;
          p.vy += (pn2 - pn) * ny;
          q.vx += (qn2 - qn) * nx;
          q.vy += (qn2 - qn) * ny;
          if (result.firstHit === null && (p.n === 0 || q.n === 0)) result.firstHit = p.n === 0 ? q.n : p.n;
          event({ t: ms, type: 'hit', a: p.n, b: q.n, v: round(closing) });
          key(p, ms);
          key(q, ms);
          mv[i] = mv[j] = true;
        }
        const push = (BALL_D - d) / 2;
        p.x -= nx * push;
        p.y -= ny * push;
        q.x += nx * push;
        q.y += ny * push;
      }
    }

    for (const b of bodies) {
      if (!b.on || (b.vx === 0 && b.vy === 0)) continue;
      // Only near the edge can it touch a cushion or a pocket's jaw.
      if (Math.abs(b.x) < HL - BALL_R - 1e-3 && Math.abs(b.y) < HW - BALL_R - 1e-3) continue;
      // Cushions, along their noses.
      for (const c of RAILS) {
        const along = c.alongX ? b.x : b.y;
        if (along < c.lo || along > c.hi) continue;
        const dist = (b.x - c.ax) * c.nx + (b.y - c.ay) * c.ny;
        if (dist >= BALL_R) continue;
        bounce(b, c.nx, c.ny, c.id, ms);
        b.x += (BALL_R - dist) * c.nx;
        b.y += (BALL_R - dist) * c.ny;
      }
      // The points of the pockets' jaws.
      for (const k of JAWS) {
        const ox = b.x - k.x;
        const oy = b.y - k.y;
        const d2 = ox * ox + oy * oy;
        if (d2 >= BALL_R * BALL_R || d2 === 0) continue;
        const d = Math.sqrt(d2);
        bounce(b, ox / d, oy / d, k.id, ms);
        b.x = k.x + (ox / d) * BALL_R;
        b.y = k.y + (oy / d) * BALL_R;
      }
      // Past the cushions' line, which only a pocket's mouth lets it: it drops.
      if (Math.abs(b.x) > HL || Math.abs(b.y) > HW) {
        let pocket = POCKETS[0];
        for (const p of POCKETS) if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (pocket.x - b.x) ** 2 + (pocket.y - b.y) ** 2) pocket = p;
        event({ t: ms, type: 'pocket', a: b.n, b: pocket.id, v: round(Math.hypot(b.vx, b.vy)) });
        key(b, ms);
        b.on = false;
        b.vx = b.vy = b.ux = b.uy = 0;
        result.pocketed.push({ n: b.n, pocket: pocket.id, t: ms });
      }
    }

    any = false;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const now = moving(b);
      any ||= now;
      if (now && !was[i]) {
        if (b.lastKey !== ms) key(b, ms);
      }
      else if (now && ms - b.lastKey >= SAMPLE_MS) key(b, ms);
      else if (!now && was[i] && b.on) key(b, ms);
      was[i] = now;
    }
  }

  return finish(bodies, result, Math.round(step * SIM_DT * 1000));

  function bounce(b: Body, nx: number, ny: number, cushion: number, ms: number) {
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return;
    b.vx -= (1 + E_CUSHION) * vn * nx;
    b.vy -= (1 + E_CUSHION) * vn * ny;
    const un = b.ux * nx + b.uy * ny;
    b.ux -= (1 + E_CUSHION) * un * nx;
    b.uy -= (1 + E_CUSHION) * un * ny;
    if (b.side !== 0) {
      // Right english (spinning counter-clockwise from above) kicks it off to the right of the cushion's face.
      const kick = b.side * SIDE_KICK * -vn;
      b.vx += kick * -ny;
      b.vy += kick * nx;
      b.ux += kick * -ny;
      b.uy += kick * nx;
      b.side /= 2;
    }
    event({ t: ms, type: 'cushion', a: b.n, b: cushion, v: round(-vn) });
    if (result.firstHit !== null && result.cushions.length < MAX_CUSHIONS) result.cushions.push({ n: b.n, cushion, t: ms });
    key(b, ms);
  }
}

/** One step of the cloth on a moving ball: skidding until its spin matches its speed, then rolling to a stop. */
function friction(b: Body) {
  const sx = b.vx - b.ux;
  const sy = b.vy - b.uy;
  const slip = Math.sqrt(sx * sx + sy * sy);
  const a = MU_SLIDE * G * SIM_DT;
  if (slip > 1e-9) {
    // The slip shrinks 7/2 as fast as the ball slows (a solid sphere): once it's gone, it rolls at (5v + 2u) / 7.
    if (slip <= 3.5 * a) {
      b.vx = b.ux = (5 * b.vx + 2 * b.ux) / 7;
      b.vy = b.uy = (5 * b.vy + 2 * b.uy) / 7;
    } else {
      b.vx -= (a * sx) / slip;
      b.vy -= (a * sy) / slip;
      b.ux += (2.5 * a * sx) / slip;
      b.uy += (2.5 * a * sy) / slip;
    }
  } else {
    const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    const r = MU_ROLL * G * SIM_DT;
    const k = v <= r ? 0 : (v - r) / v;
    b.vx = b.ux = b.vx * k;
    b.vy = b.uy = b.vy * k;
  }
  b.side = Math.abs(b.side) < 1e-3 ? 0 : b.side * (1 - SIDE_FADE * SIM_DT);
}

function finish(bodies: Body[], result: ShotResult, duration: number): ShotResult {
  result.duration = duration;
  result.balls = bodies.filter((b) => b.on).map((b) => ({ n: b.n, x: round(b.x), y: round(b.y) }));
  result.path = bodies.filter((b) => b.keys.length).map((b) => ({ n: b.n, k: b.keys }));
  return result;
}

function clamp(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

// ---- The players ------------------------------------------------------------------------------------

export type PoolTeam = 0 | 1;
/** Seats at the table: 2 (1 v 1) or 4 (2 v 2), two to a team. */
export const MAX_PLAYERS = 4;
export const TEAM_SIZE = 2;

/** Someone at the table: a PeerInfo id, their name and their team. */
export interface PoolSeat {
  id: string;
  name: string;
  team: PoolTeam;
}

/** Whether `seats` can start a game: one a side, or two a side. */
export function teamsOk(seats: readonly PoolSeat[]): boolean {
  const a = seats.filter((s) => s.team === 0).length;
  const b = seats.length - a;
  return a === b && (a === 1 || a === 2);
}

// ---- The game ---------------------------------------------------------------------------------------

export type PoolGroup = 'solids' | 'stripes';

/** Which group ball `n` is in: 1–7 solids, 9–15 stripes; the cue ball and the 8 neither. */
export function groupOf(n: number): PoolGroup | null {
  return n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null;
}

/**
 * Why a shot was a foul: the cue ball went in ('scratch'), touched nothing ('noHit'), touched the
 * wrong ball first ('wrongBall': the other side's, or the 8 before your group's cleared, or anything
 * but the 8 once it is), or nothing went in and no ball touched a cushion after it ('noRail').
 */
export type PoolFoul = 'scratch' | 'noHit' | 'wrongBall' | 'noRail';

/**
 * How a shot ended: the same player goes again ('again'), it's the other side's turn ('turn'), the
 * other side's turn with ball in hand ('foul'), or the game's over ('won' or 'lost', for the shooter's side).
 */
export type PoolOutcome = 'again' | 'turn' | 'foul' | 'won' | 'lost';

/** A shot that's been played, and what it came to (without its trajectory: that's PoolPlayback). */
export interface PoolShot {
  /** The game's shot count, from 1 for the break. */
  n: number;
  player: string;
  team: PoolTeam;
  shot: Shot;
  break: boolean;
  firstHit: number | null;
  /** Balls that went in, in order (the cue ball as 0). */
  pocketed: number[];
  /** Whether any ball touched a cushion after the cue ball's first contact. */
  rail: boolean;
  foul: PoolFoul | null;
  /** The 8 went in on the break and was put back on the foot spot. */
  spotted8: boolean;
  /** This shot settled who has which group. */
  assigned: boolean;
  outcome: PoolOutcome;
  /** How long it took to come to rest (ms). */
  duration: number;
}

/** A shot to play back: everything about it, how every ball moved, and when the office took it (ms epoch). */
export interface PoolPlayback extends PoolShot {
  at: number;
  /** Where every ball was before it. */
  from: BallPos[];
  path: BallPath[];
  events: ShotEvent[];
}

/** A game of 8-ball. */
export interface PoolGame {
  /** Who's playing, in the order they shoot: each side's first player, then each side's second. */
  players: PoolSeat[];
  /** Whose shot it is: an index into `players`. */
  up: number;
  /** How many turns each side has had, which picks which of its players shoots next. */
  rota: [number, number];
  /** The side that broke. */
  breaker: PoolTeam;
  /** The balls on the table, the cue ball (0) always among them (back on the head spot after a scratch: see ballInHand). */
  balls: BallPos[];
  /** Object balls that have gone in, in order. */
  pocketed: number[];
  /** Which side has the solids (the other has the stripes), or null while the table's open. */
  solids: PoolTeam | null;
  /**
   * Whether the shooter may put the cue ball where they like first: 'kitchen' (behind the head string)
   * for the break, 'table' (anywhere) after the other side's foul. The cue ball's on the table either
   * way (on the head spot, or near it, after a scratch), and can be moved until they shoot.
   */
  ballInHand: 'kitchen' | 'table' | null;
  /** Whether the break's been played. */
  broken: boolean;
  /** Shots played so far. */
  shots: number;
  last: PoolShot | null;
  /** Over: a side won (`winner`), or one side left. Nobody shoots any more. */
  over: boolean;
  winner: PoolTeam | null;
}

/** Each side's players, in the order they take their turns. */
export function team(g: { players: readonly PoolSeat[] }, t: PoolTeam): PoolSeat[] {
  return g.players.filter((p) => p.team === t);
}

/** The group side `t` is on, or null while the table's open. */
export function groupFor(g: PoolGame, t: PoolTeam): PoolGroup | null {
  if (g.solids === null) return null;
  return g.solids === t ? 'solids' : 'stripes';
}

/**
 * A new game for `seats` (one or two a side, see teamsOk), with side `breaker` to break: the balls
 * racked, the cue ball in the kitchen in the breaker's hand. Players shoot alternating sides, each side
 * taking its turns in the order its players sat down.
 */
export function newGame(seats: readonly PoolSeat[], breaker: PoolTeam = 0): PoolGame {
  const first = seats.filter((s) => s.team === breaker);
  const second = seats.filter((s) => s.team !== breaker);
  const players: PoolSeat[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) players.push({ ...first[i] });
    if (second[i]) players.push({ ...second[i] });
  }
  return {
    players,
    up: 0,
    rota: [0, 0],
    breaker,
    balls: rack(),
    pocketed: [],
    solids: null,
    ballInHand: 'kitchen',
    broken: false,
    shots: 0,
    last: null,
    over: !teamsOk(seats),
    winner: null,
  };
}

/** Whether the cue ball can go at (x, y) with the ball in hand `g` has: on the table, clear of every ball, and in the kitchen for the break. */
export function canPlace(g: PoolGame, x: number, y: number): boolean {
  if (g.over || !g.ballInHand || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (g.ballInHand === 'kitchen' && x > TABLE.headString) return false;
  return free(g.balls, x, y, 0);
}

/** With ball in hand, puts the cue ball at (x, y). Says whether it could (see canPlace). */
export function placeCue(g: PoolGame, x: number, y: number): boolean {
  if (!canPlace(g, x, y)) return false;
  const cue = g.balls.find((b) => b.n === 0);
  if (!cue) return false;
  cue.x = round(x);
  cue.y = round(y);
  return true;
}

/**
 * The player who's up takes `shot`: the office rolls it (see simulate) and scores it by the rules of
 * 8-ball, kept simple:
 *
 * - The break: from the kitchen. Any ball going in keeps the breaker at the table; the table stays open
 *   either way. The 8 going in on the break is spotted (back on the foot spot), never a loss. (The
 *   four-cushion rule for a legal break isn't enforced.)
 * - Open table: hit any ball but the 8 first. The first ball legally pocketed decides the groups: its
 *   group goes to the shooter's side, the other to theirs.
 * - After that: hit a ball of your own group first (the 8, once your group's all gone), and after that
 *   contact something has to go in or some ball has to touch a cushion.
 * - A foul (see PoolFoul) ends the turn and gives the other side ball in hand anywhere on the table
 *   (after a scratch on the break too).
 * - A side keeps shooting while it legally pockets a ball of its own group (any ball, on the break).
 * - The 8 going in after the break: a win if the side's group was all gone before the shot and it was
 *   no foul; otherwise (too early, or with a foul, a scratch included) a loss.
 *
 * Returns the shot and its trajectory (without `at`), or null if the game's over.
 */
export function takeShot(g: PoolGame, shot: Shot): Omit<PoolPlayback, 'at'> | null {
  if (g.over || !g.players.length) return null;
  const player = g.players[g.up];
  const side = player.team;
  const isBreak = !g.broken;
  const mine = groupFor(g, side);
  const onEight = !!mine && !g.balls.some((b) => groupOf(b.n) === mine);
  const from = g.balls.map((b) => ({ ...b }));

  const res = simulate(g.balls, shot);
  const potted = res.pocketed.map((p) => p.n);
  const scratch = potted.includes(0);
  let objects = potted.filter((n) => n !== 0);
  const eight = objects.includes(8);
  const rail = res.cushions.length > 0;
  const hit = res.firstHit;

  let foul: PoolFoul | null = null;
  if (hit === null) foul = 'noHit';
  else if (scratch) foul = 'scratch';
  else if (!isBreak && (onEight ? hit !== 8 : mine ? groupOf(hit) !== mine : hit === 8)) foul = 'wrongBall';
  else if (!isBreak && objects.length === 0 && !rail) foul = 'noRail';

  g.balls = res.balls;
  g.shots++;
  let outcome: PoolOutcome;
  let assigned = false;
  let spotted8 = false;

  if (isBreak) {
    g.broken = true;
    if (eight) {
      spotted8 = true;
      objects = objects.filter((n) => n !== 8);
      g.balls.push({ n: 8, ...spot(g.balls, 8, TABLE.footSpot) });
      g.balls.sort((a, b) => a.n - b.n);
    }
    outcome = foul ? 'foul' : objects.length ? 'again' : 'turn';
  } else if (eight) {
    outcome = !foul && onEight ? 'won' : 'lost';
  } else {
    let group = mine;
    if (!foul && !group) {
      const first = objects.map(groupOf).find((x) => x);
      if (first) {
        g.solids = first === 'solids' ? side : ((1 - side) as PoolTeam);
        group = first;
        assigned = true;
      }
    }
    outcome = foul ? 'foul' : group && objects.some((n) => groupOf(n) === group) ? 'again' : 'turn';
  }
  g.pocketed.push(...objects);

  if (outcome === 'won' || outcome === 'lost') {
    g.over = true;
    g.winner = outcome === 'won' ? side : ((1 - side) as PoolTeam);
    g.ballInHand = null;
  } else {
    if (scratch) g.balls.unshift({ n: 0, ...spot(g.balls, 0, TABLE.headSpot, -1) });
    g.ballInHand = outcome === 'foul' ? 'table' : null;
    if (outcome !== 'again') passTurn(g);
  }

  const last: PoolShot = {
    n: g.shots,
    player: player.id,
    team: side,
    shot: { angle: shot.angle, power: shot.power, top: shot.top ?? 0, side: shot.side ?? 0 },
    break: isBreak,
    firstHit: hit,
    pocketed: potted,
    rail,
    foul,
    spotted8,
    assigned,
    outcome,
    duration: res.duration,
  };
  g.last = last;
  return { ...last, from, path: res.path, events: res.events };
}

/** The other side's turn: its next player in its own order. */
function passTurn(g: PoolGame) {
  const was = g.players[g.up].team;
  g.rota[was]++;
  const next = (1 - was) as PoolTeam;
  const theirs = team(g, next);
  if (!theirs.length) return;
  g.up = g.players.indexOf(theirs[g.rota[next] % theirs.length]);
}

/**
 * `id` leaves the game. If it was their shot, it's their partner's (if they have one), with whatever
 * ball in hand they had. With nobody left on one side, the game's over, with no winner. Says whether
 * they were playing.
 */
export function removePlayer(g: PoolGame, id: string): boolean {
  const i = g.players.findIndex((p) => p.id === id);
  if (i < 0) return false;
  const current = g.players[g.up];
  const [gone] = g.players.splice(i, 1);
  const left = team(g, gone.team);
  if (!g.players.length) {
    g.up = 0;
  } else if (current.id === id) {
    g.up = left.length ? g.players.indexOf(left[g.rota[gone.team] % left.length]) : 0;
  } else {
    g.up = g.players.indexOf(current);
  }
  if (!g.over && (!left.length || !team(g, (1 - gone.team) as PoolTeam).length)) {
    g.over = true;
    g.ballInHand = null;
  }
  return true;
}

// ---- On a floor -------------------------------------------------------------------------------------

/**
 * The pool table on a floor: who's at it (`lobby`, up to MAX_PLAYERS, each on a side), and the game,
 * if there is one (running, or over and still on the table). Someone who joins while a game runs
 * plays in the next one.
 */
export interface PoolState {
  lobby: PoolSeat[];
  game: PoolGame | null;
}

export function emptyPool(): PoolState {
  return { lobby: [], game: null };
}
