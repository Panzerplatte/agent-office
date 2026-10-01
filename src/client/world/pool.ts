import * as THREE from 'three';
import { BALL_R, POCKETS, TABLE, ballColor, rack, type BallPos, type PoolPlayback, type PoolSeat, type PoolState, type Point, type ShotEvent } from '../../shared/pool';
import { POOL_TABLE } from '../../shared/layout';
import type { PoolTableView } from './pooltable';
import { mergeByMaterial, mesh, toon } from './toon';

// The balls on a floor's pool table, as everyone there sees them: where the office last said they came
// to rest, and every shot it rolled played back from its trajectory (see simulate in shared/pool.ts),
// the balls turning as they roll and dropping into the pockets, then snapped to where the office says
// they stopped. Also the cue, the aiming line and its ghost ball, and the cue ball in your hand.

// ---- Colours ----------------------------------------------------------------------------------------

/** Each side's colours, for its first and second player: warm for side A, cool for side B. */
export const TEAM_COLORS = [
  ['#ef476f', '#ff9f1c'],
  ['#1d8bf0', '#06d6a0'],
] as const;

/** The colour of the player `id` among `seats`: their side's, by the order they sat down on it. */
export function seatColor(seats: readonly PoolSeat[], id: string): string {
  const seat = seats.find((s) => s.id === id);
  if (!seat) return '#ffffff';
  const i = seats.filter((s) => s.team === seat.team).indexOf(seat);
  return TEAM_COLORS[seat.team][Math.max(0, i) % 2];
}

// ---- Playing a shot back ----------------------------------------------------------------------------

/** Where a ball with path keys `k` ([ms, x mm, y mm, …]) is `ms` into the shot: straight between keys, held before the first and after the last. */
export function pathAt(k: readonly number[], ms: number): Point {
  const n = k.length / 3;
  if (n === 0) return { x: 0, y: 0 };
  if (ms <= k[0]) return { x: k[1] / 1000, y: k[2] / 1000 };
  for (let i = 1; i < n; i++) {
    const t1 = k[i * 3];
    if (ms > t1) continue;
    const t0 = k[i * 3 - 3];
    const f = t1 > t0 ? (ms - t0) / (t1 - t0) : 1;
    return { x: (k[i * 3 - 2] + (k[i * 3 + 1] - k[i * 3 - 2]) * f) / 1000, y: (k[i * 3 - 1] + (k[i * 3 + 2] - k[i * 3 - 1]) * f) / 1000 };
  }
  return { x: k[n * 3 - 2] / 1000, y: k[n * 3 - 1] / 1000 };
}

/** The pocket nearest table-local (x, y): the one a ball there went into. */
export function nearestPocket(x: number, y: number): number {
  let best = 0;
  for (const p of POCKETS) if ((p.x - x) ** 2 + (p.y - y) ** 2 < (POCKETS[best].x - x) ** 2 + (POCKETS[best].y - y) ** 2) best = p.id;
  return best;
}

/**
 * The balls shot `pb` put in a pocket: which, into which pocket and when (ms in). A ball's path ends
 * where it went past the cushions, so that's when, and the pocket nearest there is where.
 */
export function drops(pb: Pick<PoolPlayback, 'pocketed' | 'path'>): { n: number; pocket: number; t: number; x: number; y: number }[] {
  return pb.pocketed.flatMap((n) => {
    const k = pb.path.find((p) => p.n === n)?.k;
    if (!k?.length) return [];
    const end = pathAt(k, Infinity);
    return [{ n, pocket: nearestPocket(end.x, end.y), t: k[k.length - 3], ...end }];
  });
}

/** Where the balls of shot `pb` are `ms` into it (those still on the table), and which have dropped by then. */
export function tableAt(pb: Pick<PoolPlayback, 'from' | 'path' | 'pocketed'>, ms: number): { balls: BallPos[]; dropped: ReturnType<typeof drops> } {
  const paths = new Map(pb.path.map((p) => [p.n, p.k]));
  const dropped = drops(pb).filter((d) => d.t <= ms);
  const balls = pb.from
    .filter((b) => !dropped.some((d) => d.n === b.n))
    .map((b) => {
      const k = paths.get(b.n);
      return k ? { n: b.n, ...pathAt(k, ms) } : { ...b };
    });
  return { balls, dropped };
}

// ---- Aiming -----------------------------------------------------------------------------------------

/** Where the cue ball struck at `angle` first touches something: a ball (`hit`, with the way it goes off), or a cushion. */
export interface AimLine {
  /** The cue ball's centre at the touch: the ghost ball. */
  x: number;
  y: number;
  /** The ball it touches first, or null for a cushion. */
  hit: number | null;
  /** Which way the ball it touches goes off (a unit vector), when it touches one. */
  dir?: Point;
}

/** The ghost ball for `angle`: the first ball the cue ball would touch rolling straight that way, or where it would meet a cushion. */
export function aimLine(balls: readonly BallPos[], angle: number): AimLine | null {
  const cue = balls.find((b) => b.n === 0);
  if (!cue) return null;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Off the cushions' noses: a straight line out to the first one.
  const hx = TABLE.length / 2 - BALL_R;
  const hy = TABLE.width / 2 - BALL_R;
  let best = Math.min(dx > 0 ? (hx - cue.x) / dx : dx < 0 ? (-hx - cue.x) / dx : Infinity, dy > 0 ? (hy - cue.y) / dy : dy < 0 ? (-hy - cue.y) / dy : Infinity);
  best = Math.max(0, best);
  let hit: number | null = null;
  const D = 2 * BALL_R;
  for (const b of balls) {
    if (b.n === 0) continue;
    // |cue + t·d − b| = 2R, the nearer root ahead.
    const ox = cue.x - b.x;
    const oy = cue.y - b.y;
    const p = ox * dx + oy * dy;
    const q = ox * ox + oy * oy - D * D;
    const disc = p * p - q;
    if (disc < 0) continue;
    const t = -p - Math.sqrt(disc);
    if (t >= -1e-9 && t < best) {
      best = Math.max(0, t);
      hit = b.n;
    }
  }
  const x = cue.x + dx * best;
  const y = cue.y + dy * best;
  if (hit === null) return { x, y, hit };
  const b = balls.find((o) => o.n === hit)!;
  const len = Math.hypot(b.x - x, b.y - y) || 1;
  return { x, y, hit, dir: { x: (b.x - x) / len, y: (b.y - y) / len } };
}

/** How far out from the table's frame a shooter stands (m): their belly at the rail. */
const STAND_OUT = 0.32;

/**
 * Where the shooter stands to strike the cue ball at `cue` toward `angle`, in table-local meters: back
 * along the line of the shot, just outside the table's frame, facing the cue ball (`facing` is the
 * table-local angle they look along).
 */
export function standSpot(cue: Point, angle: number): Point & { facing: number } {
  const bx = -Math.cos(angle);
  const by = -Math.sin(angle);
  const X = POOL_TABLE.outer.length / 2 + STAND_OUT;
  const Y = POOL_TABLE.outer.width / 2 + STAND_OUT;
  // Out of the rectangle round the frame, going back from the cue ball.
  const t = Math.min(bx > 0 ? (X - cue.x) / bx : bx < 0 ? (-X - cue.x) / bx : Infinity, by > 0 ? (Y - cue.y) / by : by < 0 ? (-Y - cue.y) / by : Infinity);
  return { x: cue.x + bx * t, y: cue.y + by * t, facing: angle };
}

// ---- The balls --------------------------------------------------------------------------------------

/** The cue going through the ball: drawn back this long (s), then forward through it this long, before the balls go. */
const BACKSWING = 0.32;
const STROKE = 0.1;
/** How long a ball takes to drop from the cushion line into its pocket's net (s). */
const DROP = 0.28;
/** How far it falls in that time (m), into the net. */
const DROP_DEPTH = 0.11;
/** The cue: this long, from the tip. */
const CUE_LENGTH = 1.47;

/** A ball's face, as a picture wrapped round it: solid colour, or white with a band, and its number twice in a white disc. */
function ballTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const color = ballColor(n);
  const stripe = n > 8;
  g.fillStyle = stripe || n === 0 ? BALLS_WHITE : color;
  g.fillRect(0, 0, c.width, c.height);
  if (stripe) {
    g.fillStyle = color;
    g.fillRect(0, c.height * 0.27, c.width, c.height * 0.46);
  }
  if (n === 0) {
    // The cue ball's red dot (a measle or two), so you can see it spin.
    g.fillStyle = '#c0262d';
    for (const [u, v] of [
      [0.25, 0.5],
      [0.75, 0.5],
      [0.5, 0.15],
    ]) {
      g.beginPath();
      g.arc(u * c.width, v * c.height, 5, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    for (const u of [0.25, 0.75]) {
      const x = u * c.width;
      const y = c.height / 2;
      // The disc is drawn wider than high: the wrap squeezes it round the ball's middle.
      g.fillStyle = BALLS_WHITE;
      g.beginPath();
      g.ellipse(x, y, 20, 24, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111111';
      g.font = `900 ${n > 9 ? 24 : 28}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), x, y + 1);
      if (n === 6 || n === 9) g.fillRect(x - 7, y + 14, 14, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const BALLS_WHITE = '#f8f4e8';

/** The cue the shooter strikes with: from its tip (at the origin) back along -z, the butt in their colour. */
function buildCue(): { group: THREE.Group; butt: THREE.MeshToonMaterial } {
  const parts = new THREE.Group();
  const butt = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const seg = (r0: number, r1: number, z0: number, z1: number, mat: THREE.Material) =>
    parts.add(mesh(new THREE.CylinderGeometry(r0, r1, z1 - z0, 10).rotateX(Math.PI / 2), mat, 0, 0, -(z0 + z1) / 2, false));
  seg(0.0062, 0.0066, 0, 0.008, toon('#3a6ea5'));
  seg(0.0066, 0.0066, 0.008, 0.02, toon('#f7f4ec'));
  seg(0.0066, 0.0127, 0.02, 0.73, toon('#e7cf9b'));
  seg(0.0127, 0.0128, 0.73, 0.75, toon('#d8d2c4'));
  seg(0.0128, 0.0138, 0.75, 1.15, butt);
  seg(0.0138, 0.0145, 1.15, CUE_LENGTH, toon('#20201f'));
  const group = new THREE.Group();
  group.add(mergeByMaterial(parts));
  group.visible = false;
  return { group, butt };
}

/** A shot being played back: since when (performance.now(), ms, the cue's backswing starting), and what the table's like after it. */
interface Playing {
  pb: PoolPlayback;
  start: number;
  after: PoolState;
  /** The cue's struck the ball, and the events up to `next` have been heard. */
  struck: boolean;
  next: number;
  color: string;
}

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const axis = new THREE.Vector3();
const spin = new THREE.Quaternion();

export class PoolBalls {
  /** Everything here, in the world (positions from the table's toWorld). */
  readonly group = new THREE.Group();
  private readonly balls = new Map<number, THREE.Mesh>();
  /** Where each ball was drawn last frame, in the world, to turn it by how far it rolled. */
  private readonly last = new Map<number, THREE.Vector3>();
  private readonly cue: THREE.Group;
  private readonly cueButt: THREE.MeshToonMaterial;
  private readonly line: THREE.Line;
  private readonly offLine: THREE.Line;
  private readonly ghost: THREE.Mesh;
  /** The cue ball in your hand, where you'd put it (see hand()). */
  private readonly inHand: THREE.Mesh;
  private playing: Playing | null = null;
  /** The table as it's shown: the office's latest, or the one before while a shot's still rolling. */
  private state: PoolState = { lobby: [], game: null };
  /** A ball's been struck (`at`: the cue ball, in the world), at the end of the backswing. */
  onStrike: ((pb: PoolPlayback, at: THREE.Vector3) => void) | null = null;
  /** A ball hit another, a cushion, or dropped (see ShotEvent), at `at` in the world. */
  onEvent: ((e: ShotEvent, at: THREE.Vector3) => void) | null = null;
  /** A shot's finished rolling, and the table's as the office says it is now. */
  onSettle: ((pb: PoolPlayback) => void) | null = null;

  constructor(private readonly table: PoolTableView) {
    const geo = new THREE.SphereGeometry(BALL_R, 28, 18);
    const gradientMap = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
    for (let n = 0; n <= 15; n++) {
      const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ map: ballTexture(n), gradientMap }));
      m.castShadow = true;
      m.userData.outlineParameters = { thickness: 0.002 };
      // A random-ish turn to start with, so the numbers don't all face the same way.
      m.quaternion.setFromEuler(new THREE.Euler(n * 1.3, n * 2.1, n * 0.7));
      this.balls.set(n, m);
      this.group.add(m);
    }
    const c = buildCue();
    this.cue = c.group;
    this.cueButt = c.butt;
    this.group.add(this.cue);
    const lineMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false });
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
    this.offLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat.clone());
    (this.offLine.material as THREE.LineBasicMaterial).opacity = 0.3;
    const ghostMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false, wireframe: true });
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 14, 10), ghostMat);
    this.inHand = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }));
    for (const o of [this.line, this.offLine, this.ghost, this.inHand]) {
      o.visible = false;
      o.renderOrder = 3;
      o.userData.outlineParameters = { visible: false };
      this.group.add(o);
    }
    this.show(this.state);
  }

  /** The table as shown (see `state`): the game before the shot that's rolling, until it's stopped. */
  get shown(): PoolState {
    return this.state;
  }

  /** A shot's still rolling (or the cue's going back for it). */
  get busy(): boolean {
    return !!this.playing;
  }

  /** The balls at rest as shown: the game's, or a fresh rack. */
  get positions(): BallPos[] {
    return this.state.game?.balls ?? rack();
  }

  /**
   * The office's latest on the table, with `shot` if it's just been taken: that's rolled out from where
   * the balls were, and the rest waits till it's stopped. `fresh`: it's all just there (you've only
   * just come to the floor), nothing to play.
   */
  follow(state: PoolState, shot: PoolPlayback | undefined, fresh: boolean, color = '#ffffff') {
    if (this.playing) {
      // Another shot before the last one's done (it shouldn't be): finish that one now.
      if (shot && !fresh) this.finish();
      else {
        this.playing.after = state;
        return;
      }
    }
    if (shot && !fresh && shot.from.length) {
      this.playing = { pb: shot, start: performance.now(), after: state, struck: false, next: 0, color };
      this.place(shot.from);
      return;
    }
    this.show(state);
  }

  /** Every frame: the cue's stroke, the balls rolling, and the drops. */
  update() {
    const p = this.playing;
    if (!p) return;
    const ms = performance.now() - p.start - (BACKSWING + STROKE) * 1000;
    const cue = p.pb.from.find((b) => b.n === 0);
    if (ms < 0) {
      // Drawn back, then through the ball.
      const s = (ms + (BACKSWING + STROKE) * 1000) / 1000;
      const pull = s < BACKSWING ? 0.04 + 0.18 * Math.sin((s / BACKSWING) * (Math.PI / 2)) : 0.22 * (1 - (s - BACKSWING) / STROKE);
      if (cue) this.aimCue(cue, p.pb.shot.angle, pull * (0.4 + p.pb.shot.power * 0.6), p.color);
      return;
    }
    if (!p.struck && cue) {
      p.struck = true;
      this.onStrike?.(p.pb, this.table.toWorld(cue.x, cue.y));
    }
    // The cue follows through, then it's put down.
    if (ms < 250 && cue) this.aimCue(cue, p.pb.shot.angle, -0.05 * Math.min(1, ms / 60), p.color);
    else this.cue.visible = false;

    const { balls, dropped } = tableAt(p.pb, ms);
    this.place(balls);
    for (const d of dropped) this.drop(d.n, d.pocket, d, (ms - d.t) / 1000);
    const events = p.pb.events;
    for (; p.next < events.length && events[p.next].t <= ms; p.next++) {
      const e = events[p.next];
      const at = balls.find((b) => b.n === e.a) ?? p.pb.from.find((b) => b.n === e.a)!;
      const pk = e.type === 'pocket' ? POCKETS[e.b] : null;
      this.onEvent?.(e, this.table.toWorld(pk ? pk.x : at.x, pk ? pk.y : at.y));
    }
    if (ms > p.pb.duration + DROP * 1000 + 150) this.finish();
  }

  /** Done rolling: the table as the office says it is now. */
  private finish() {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    this.cue.visible = false;
    this.show(p.after);
    this.onSettle?.(p.pb);
  }

  /** The table as `state` has it, all at rest: the game's balls, or a fresh rack while there's no game. */
  private show(state: PoolState) {
    this.state = state;
    this.place(state.game?.balls ?? rack(), true);
  }

  /** The balls at these spots (table-local), turned by how far each has rolled; the rest out of sight. `snap`: put there, no rolling. */
  private place(balls: readonly BallPos[], snap = false) {
    const on = new Set<number>();
    for (const b of balls) {
      const m = this.balls.get(b.n);
      if (!m) continue;
      on.add(b.n);
      this.table.toWorld(b.x, b.y, BALL_R, v1);
      const was = this.last.get(b.n);
      if (was && !snap && m.visible) {
        v2.subVectors(v1, was);
        v2.y = 0;
        const d = v2.length();
        if (d > 1e-6 && d < 0.5) {
          axis.crossVectors(UP, v2).normalize();
          m.quaternion.premultiply(spin.setFromAxisAngle(axis, d / BALL_R));
        }
      }
      m.position.copy(v1);
      m.visible = true;
      if (was) was.copy(v1);
      else this.last.set(b.n, v1.clone());
    }
    for (const [n, m] of this.balls) if (!on.has(n) && !(this.playing && this.dropping(n))) m.visible = false;
  }

  /** Whether ball `n` is on its way into a pocket in the shot that's rolling (drawn by drop()). */
  private dropping(n: number): boolean {
    return !!this.playing?.pb.pocketed.includes(n);
  }

  /** Ball `n`, `s` seconds after it went past the cushions at `from` into `pocket`: over the hole and down into the net, then out of sight. */
  private drop(n: number, pocket: number, from: Point, s: number) {
    const m = this.balls.get(n);
    const pk = POCKETS[pocket];
    if (!m || !pk) return;
    if (s > DROP) {
      m.visible = false;
      return;
    }
    const f = Math.min(1, s / (DROP * 0.45));
    const x = from.x + (pk.x - from.x) * f;
    const y = from.y + (pk.y - from.y) * f;
    const fall = Math.max(0, (s - DROP * 0.25) / (DROP * 0.75));
    this.table.toWorld(x, y, BALL_R - DROP_DEPTH * fall * fall, v1);
    m.position.copy(v1);
    m.visible = true;
    this.last.get(n)?.copy(v1);
  }

  /** The cue, its tip `pull` meters back from the cue ball at `at`, pointing along `angle`, the butt in `color`, raised a little at the back. */
  aimCue(at: Point, angle: number, pull: number, color: string) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const tip = BALL_R + 0.008 + pull;
    this.table.toWorld(at.x - dx * tip, at.y - dy * tip, BALL_R, v1);
    // The butt up off the rail, so it clears it: about 8°.
    const back = CUE_LENGTH;
    this.table.toWorld(at.x - dx * (tip + back), at.y - dy * (tip + back), BALL_R + back * 0.14, v2);
    this.cue.position.copy(v1);
    // The cue's own -z runs from the tip to the butt.
    this.cue.lookAt(v1.clone().multiplyScalar(2).sub(v2));
    this.cueButt.color.set(color);
    this.cue.visible = true;
  }

  hideCue() {
    if (!this.playing) this.cue.visible = false;
  }

  /** The aiming line from the cue ball to its ghost ball, and the way the ball it hits goes off; null hides it. */
  aim(line: AimLine | null) {
    const cue = this.state.game?.balls.find((b) => b.n === 0);
    const on = !!line && !!cue && !this.playing;
    this.line.visible = this.ghost.visible = on;
    this.offLine.visible = on && !!line?.dir;
    if (!on || !line || !cue) return;
    const h = BALL_R * 0.3;
    this.setLine(this.line, cue, line, h);
    this.table.toWorld(line.x, line.y, BALL_R, this.ghost.position);
    if (line.dir && line.hit !== null) {
      const b = this.state.game!.balls.find((o) => o.n === line.hit)!;
      this.setLine(this.offLine, b, { x: b.x + line.dir.x * 0.3, y: b.y + line.dir.y * 0.3 }, h);
    }
  }

  private setLine(l: THREE.Line, a: Point, b: Point, h: number) {
    const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.table.toWorld(a.x, a.y, h, v1);
    this.table.toWorld(b.x, b.y, h, v2);
    pos.setXYZ(0, v1.x, v1.y, v1.z);
    pos.setXYZ(1, v2.x, v2.y, v2.z);
    pos.needsUpdate = true;
    l.geometry.computeBoundingSphere();
  }

  /** The cue ball in your hand at (x, y), white where it can go and red where it can't; null puts it away. */
  hand(at: Point | null, ok = true) {
    this.inHand.visible = !!at;
    if (!at) return;
    this.table.toWorld(at.x, at.y, BALL_R, this.inHand.position);
    (this.inHand.material as THREE.MeshBasicMaterial).color.set(ok ? '#ffffff' : '#ff4d4d');
  }
}
