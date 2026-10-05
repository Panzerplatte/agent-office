import * as THREE from 'three';
import { BALCONY, GOLF_TEE } from '../../shared/layout';
import { BALL_R, golfBall, pinText, type Hit } from './golf';
import { mergeByMaterial, toon } from './toon';
import { t } from '../i18n';

// Mini golf in the bunker's smokers' room (world/bunker/balcony.ts), where the balcony was: one hole
// on a strip of green putting carpet along the room, from the tee's spot to a cup with a flag, in a
// low wooden border the ball banks off. A putt is only a heading and how hard it's hit, from where the
// ball lies; where it rolls from there is worked out the same way on every screen (see putt), so
// everyone on the floor sees the same ball drop. Playing it is client/minigolf.ts's (the Putter).

/** The carpet inside its border: where the ball rolls. Along the room, clear of the lounge at either end. */
export const CARPET = { minX: -7.6, maxX: -1.45, minZ: 14.15, maxZ: 15.35 } as const;
/** How thick the carpet is: the ball rolls on top of it. */
export const CARPET_H = 0.015;
/** The border round it: this high and this thick, outside CARPET. */
export const BORDER_H = 0.07;
export const BORDER_T = 0.07;
/** Where every round starts: the office's tee ball's spot. */
export const PUTT_TEE = { x: GOLF_TEE.ball.x, z: GOLF_TEE.ball.z } as const;
/** The cup near the far end, and how near its middle the ball's middle has to come to drop (it's wider than the ball). */
export const CUP = { x: -2.2, z: (CARPET.minZ + CARPET.maxZ) / 2 } as const;
export const CUP_R = 0.075;
/** Faster than this over the cup and it hops the hole instead of dropping. */
export const CUP_SPEED = 1.35;
/** From the tee to the cup. */
export const CUP_DISTANCE = Math.hypot(CUP.x - PUTT_TEE.x, CUP.z - PUTT_TEE.z);
/** Which way from the tee the cup is (a heading: 0 is south, +z, turning toward +x). */
export const CUP_YAW = Math.atan2(CUP.x - PUTT_TEE.x, CUP.z - PUTT_TEE.z);
/** How fast the ball leaves the putter at full power (m/s), how fast the carpet slows it (m/s²), and how much of its speed into the border it bounces back with. */
const PUTT_SPEED = 4.2;
const FRICTION = 1.15;
const BANK = 0.72;
/** A ball's middle stays this far inside the carpet's edge. */
const IN = { minX: CARPET.minX + BALL_R, maxX: CARPET.maxX - BALL_R, minZ: CARPET.minZ + BALL_R, maxZ: CARPET.maxZ - BALL_R } as const;
/** Steps a second, and every how many of them the path keeps a point (60 a second), as golf's fly. */
const STEPS = 240;
const KEEP = 4;
/** Longest a putt's followed. */
const MAX_SECONDS = 15;
/** The ball rolling on the carpet, and down in the cup. */
const ON_CARPET = CARPET_H + BALL_R;
const IN_CUP = CARPET_H + BALL_R - 0.1;

/** A putt: its heading (0 is south, +z, turning toward +x), how hard it's hit (0–1), and where the ball was lying. */
export interface Putt {
  yaw: number;
  power: number;
  from: { x: number; z: number };
}

export interface Roll {
  putt: Putt;
  /** Where the ball is, every 1/60 s from the moment it's hit: x, y, z. */
  path: Float32Array;
  /** Off the border ('rail') and into the cup. */
  hits: Hit[];
  seconds: number;
  rest: THREE.Vector3;
  holed: boolean;
  /** How far from the cup it stopped (0 in it). */
  fromCup: number;
}

/** Keeps a lie on the carpet (and a lie that's not a pair of numbers on the tee). */
export function onCarpet(at: { x: number; z: number } | null | undefined): { x: number; z: number } {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return { ...PUTT_TEE };
  return { x: THREE.MathUtils.clamp(at.x, IN.minX, IN.maxX), z: THREE.MathUtils.clamp(at.z, IN.minZ, IN.maxZ) };
}

/**
 * Where a putt goes: along the carpet from where the ball lies, slowing as it goes, banking off the
 * border, until it stops or drops in the cup (rolling over it slowly enough; any faster and it hops
 * the hole and runs on). The same putt always rolls the same way.
 */
export function putt(p: Putt): Roll {
  const power = THREE.MathUtils.clamp(Number.isFinite(p.power) ? p.power : 0, 0, 1);
  const yaw = Number.isFinite(p.yaw) ? p.yaw : CUP_YAW;
  const from = onCarpet(p.from);
  let x = from.x;
  let z = from.z;
  let vx = PUTT_SPEED * power * Math.sin(yaw);
  let vz = PUTT_SPEED * power * Math.cos(yaw);
  const dt = 1 / STEPS;
  const path: number[] = [x, ON_CARPET, z];
  const hits: Hit[] = [];
  let holed = false;
  let step = 0;
  const hit = (kind: Hit['kind'], speed: number) => hits.push({ t: step * dt, kind, at: new THREE.Vector3(x, ON_CARPET, z), speed });
  for (; step < MAX_SECONDS * STEPS; step++) {
    const speed = Math.hypot(vx, vz);
    const slow = FRICTION * dt;
    if (speed <= slow) break;
    vx *= (speed - slow) / speed;
    vz *= (speed - slow) / speed;
    x += vx * dt;
    z += vz * dt;
    if (x < IN.minX || x > IN.maxX) {
      x = x < IN.minX ? 2 * IN.minX - x : 2 * IN.maxX - x;
      hit('rail', Math.abs(vx));
      vx = -vx * BANK;
      vz *= 0.92;
    }
    if (z < IN.minZ || z > IN.maxZ) {
      z = z < IN.minZ ? 2 * IN.minZ - z : 2 * IN.maxZ - z;
      hit('rail', Math.abs(vz));
      vz = -vz * BANK;
      vx *= 0.92;
    }
    if (Math.hypot(x - CUP.x, z - CUP.z) < CUP_R && Math.hypot(vx, vz) < CUP_SPEED) {
      holed = true;
      step++;
      break;
    }
    if ((step + 1) % KEEP === 0) path.push(x, ON_CARPET, z);
  }
  if (holed) {
    // It runs to the middle and drops.
    path.push(x, ON_CARPET, z, CUP.x, ON_CARPET - 0.03, CUP.z, CUP.x, IN_CUP, CUP.z);
    x = CUP.x;
    z = CUP.z;
    hit('cup', 0);
  } else path.push(x, ON_CARPET, z);
  return {
    putt: { yaw, power, from },
    path: Float32Array.from(path),
    hits,
    seconds: (path.length / 3 - 1) / (STEPS / KEEP),
    rest: new THREE.Vector3(x, holed ? IN_CUP : ON_CARPET, z),
    holed,
    fromCup: holed ? 0 : Math.hypot(x - CUP.x, z - CUP.z),
  };
}

// ---- A round --------------------------------------------------------------------------------------

/**
 * Your round of mini golf: how many strokes so far, where your ball lies (the tee, before the first),
 * whether it's in, and your best (fewest strokes to hole out). Kept in this browser across a reload.
 * The first putt after holing out starts a new round from the tee.
 */
export interface PuttRound {
  strokes: number;
  lie: { x: number; z: number };
  holed: boolean;
  best: number | null;
}

export function newPuttRound(best: number | null = null): PuttRound {
  return { strokes: 0, lie: { ...PUTT_TEE }, holed: false, best };
}

/** You putted: it counts, and after holing out it's the first of a new round, from the tee. */
export function puttStroke(r: PuttRound): PuttRound {
  const fresh = r.holed ? newPuttRound(r.best) : r;
  return { ...fresh, strokes: fresh.strokes + 1 };
}

/** Your ball stopped: where it lies now, or in the cup (and your best, if it is). */
export function puttLanded(r: PuttRound, roll: Pick<Roll, 'holed' | 'rest'>): PuttRound {
  if (!roll.holed) return { ...r, lie: onCarpet(roll.rest) };
  return { ...r, lie: { ...CUP }, holed: true, best: r.best === null ? r.strokes : Math.min(r.best, r.strokes) };
}

/** A kept round back, or a fresh one. */
export function puttRoundFromJson(text: string | null): PuttRound {
  try {
    const o = JSON.parse(text ?? 'null') as Partial<PuttRound> | null;
    if (!o || typeof o.strokes !== 'number' || !Number.isInteger(o.strokes) || o.strokes < 0) return newPuttRound();
    const best = typeof o.best === 'number' && Number.isInteger(o.best) && o.best > 0 ? o.best : null;
    return { strokes: o.strokes, lie: o.holed ? { ...CUP } : onCarpet(o.lie), holed: o.holed === true, best };
  } catch {
    return newPuttRound();
  }
}

/** Your round in a line: the strokes so far and how far from the cup, or how many it took. */
export function puttRoundText(r: PuttRound): string {
  if (r.holed) return r.strokes === 1 ? t('main.minigolfHoleInOne') : t('main.golfHoledIn', { n: r.strokes });
  if (!r.strokes) return t('main.minigolfFirst');
  return [t('main.minigolfStrokes', { n: r.strokes }), t('main.minigolfToCup', { distance: pinText(Math.hypot(r.lie.x - CUP.x, r.lie.z - CUP.z)) })].join(' · ');
}

// ---- The green ------------------------------------------------------------------------------------

export interface PuttingGreen {
  group: THREE.Group;
  /** The flag stirs in the extractor fan's draught. */
  update(t: number): void;
  dispose(): void;
}

/**
 * The hole: the carpet in its wooden border, the cup with a white rim and the flag in it, a rubber
 * mat at the tee, and a stand of putters against the wall. Its own materials (not toon()'s shared
 * ones), so it can all be disposed. Nothing in it is aimed at: E goes through to the office's
 * (hidden) tee.
 */
export function buildPuttingGreen(): PuttingGreen {
  const group = new THREE.Group();
  group.name = 'putting-green';
  const grad = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const owned: { dispose(): void }[] = [];
  const mat = (color: THREE.ColorRepresentation, opts: THREE.MeshToonMaterialParameters = {}) => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: grad, ...opts });
    owned.push(m);
    return m;
  };
  // What doesn't move goes in here, merged by material at the end: a few draw calls.
  const parts = new THREE.Group();
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = false, into: THREE.Group = parts) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = shadow;
    o.receiveShadow = true;
    into.add(o);
    return o;
  };
  const { minX, maxX, minZ, maxZ } = CARPET;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // The carpet: mown-looking stripes across it, and the cup cut in it.
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#3f9a4a' : '#47a853';
    g.fillRect((i * 512) / 16, 0, 512 / 16 + 1, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  owned.push(tex);
  const carpet = put(new THREE.BoxGeometry(w, CARPET_H, d), mat('#ffffff', { map: tex }), cx, CARPET_H / 2, cz, false, group);
  carpet.name = 'putting-carpet';
  // The border: four wooden rails, the long ones running past the short ones' ends.
  const wood = mat('#8a5a3b');
  const cap = mat('#c98b5a');
  for (const s of [-1, 1]) {
    put(new THREE.BoxGeometry(w + 2 * BORDER_T, BORDER_H, BORDER_T), wood, cx, BORDER_H / 2, cz + s * (d / 2 + BORDER_T / 2), true);
    put(new THREE.BoxGeometry(BORDER_T, BORDER_H, d), wood, cx + s * (w / 2 + BORDER_T / 2), BORDER_H / 2, cz, true);
    put(new THREE.BoxGeometry(w + 2 * BORDER_T + 0.02, 0.012, BORDER_T + 0.02), cap, cx, BORDER_H + 0.006, cz + s * (d / 2 + BORDER_T / 2));
    put(new THREE.BoxGeometry(BORDER_T + 0.02, 0.012, d), cap, cx + s * (w / 2 + BORDER_T / 2), BORDER_H + 0.006, cz);
  }
  // The cup: a white rim and the dark hole in it, just over the carpet.
  const flat = (geo: THREE.BufferGeometry) => geo.rotateX(-Math.PI / 2);
  put(flat(new THREE.RingGeometry(CUP_R + 0.005, CUP_R + 0.03, 24)), mat('#fffaf3'), CUP.x, CARPET_H + 0.002, CUP.z);
  const hole = new THREE.MeshBasicMaterial({ color: '#111111' });
  owned.push(hole);
  put(flat(new THREE.CircleGeometry(CUP_R + 0.005, 24)), hole, CUP.x, CARPET_H + 0.003, CUP.z);
  // The tee: a black rubber mat with a white spot where the ball goes down.
  put(new THREE.BoxGeometry(0.5, 0.008, 0.5), mat('#26282c'), PUTT_TEE.x, CARPET_H + 0.004, PUTT_TEE.z);
  put(flat(new THREE.CircleGeometry(0.045, 16)), mat('#fffaf3'), PUTT_TEE.x, CARPET_H + 0.009, PUTT_TEE.z);
  // The flagstick, in the cup's middle, and the flag on it.
  const STICK = 1.25;
  put(new THREE.CylinderGeometry(0.012, 0.012, STICK, 8), mat('#fffaf3'), CUP.x, STICK / 2, CUP.z, true);
  put(new THREE.SphereGeometry(0.025, 8, 6), mat('#ffd166'), CUP.x, STICK + 0.01, CUP.z);
  const flagGeo = new THREE.PlaneGeometry(0.36, 0.22, 6, 1);
  flagGeo.translate(0.18, 0, 0);
  const rest = Float32Array.from(flagGeo.getAttribute('position').array);
  const flag = put(flagGeo, mat('#ef476f', { side: THREE.DoubleSide }), CUP.x + 0.012, STICK - 0.13, CUP.z, false, group);
  flag.rotation.y = Math.PI / 2 + 0.3;
  // A stand of putters by the tee, against the wall behind it.
  const sx = PUTT_TEE.x - 0.4;
  const sz = BALCONY.minZ + 0.18;
  put(new THREE.BoxGeometry(0.34, 0.05, 0.16), mat('#3a3d42'), sx, 0.025, sz, true);
  for (const k of [-1, 0, 1]) {
    const shaft = put(new THREE.CylinderGeometry(0.008, 0.008, 0.85, 6), mat('#adb5bd'), sx + k * 0.1, 0.47, sz + 0.03, true);
    shaft.rotation.z = k * 0.06;
    put(new THREE.BoxGeometry(0.03, 0.09, 0.03), mat('#2b2d42'), sx + k * 0.1 - k * 0.025, 0.86, sz + 0.03);
    put(new THREE.BoxGeometry(0.09, 0.025, 0.035), mat('#8d99ae'), sx + k * 0.1 + 0.03, 0.06, sz + 0.03);
  }
  group.add(mergeByMaterial(parts));
  parts.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
  // Never aimed at: E goes through to the office's tee, hidden under it.
  group.traverse((o) => (o.raycast = () => {}));

  return {
    group,
    update(time: number) {
      const pos = flagGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = rest[i * 3];
        pos.setZ(i, Math.sin(time * 3 - u * 12) * 0.025 * u * 3);
      }
      pos.needsUpdate = true;
    },
    dispose() {
      group.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
      for (const o of owned) o.dispose();
      group.removeFromParent();
    },
  };
}

// ---- Balls on their way ---------------------------------------------------------------------------

interface Rolling {
  roll: Roll;
  t: number;
  ball: THREE.Mesh;
  next: number;
  who: string;
  /** Whose it is, to forget their ball by (see forget()). */
  key: string;
  mine: boolean;
  /** Seconds since it stopped, or -1 while it's rolling. */
  still: number;
}

/** How long a stopped ball stays lying there, yours or someone else's (yours then lies where `lie` says). */
export const LIE_SECONDS = 3;

/**
 * The balls rolling (or lying where they stopped) on the carpet, everyone's, played back along their
 * rolls; and your own ball where it lies between putts. Lives in the bunker's group, so it shows only
 * with the bunker.
 */
export class PuttBalls {
  readonly group = new THREE.Group();
  private balls: Rolling[] = [];
  /** Your ball where it lies, between putts. */
  private lie = golfBall();
  onHit: ((hit: Hit, mine: boolean) => void) | null = null;
  onRest: ((roll: Roll, who: string, mine: boolean) => void) | null = null;

  constructor() {
    this.group.name = 'putt-balls';
    this.lie.raycast = () => {};
    this.group.add(this.lie);
  }

  /** `key`: whose it is, for forget() (their peer id); the name, if not given. */
  launch(roll: Roll, who: string, mine: boolean, key = who): void {
    const ball = golfBall();
    ball.raycast = () => {};
    ball.position.set(roll.path[0], roll.path[1], roll.path[2]);
    this.group.add(ball);
    // Theirs, from where it was lying: that one's this one now.
    for (const b of [...this.balls]) if (b.key === key && b.mine === mine) this.drop(b);
    this.balls.push({ roll, t: 0, ball, next: 0, who, key, mine, still: -1 });
  }

  /** Your ball still rolling (or just stopped), for the camera to follow. */
  get mine(): { at: THREE.Vector3; roll: Roll; still: number } | null {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.mine) return { at: b.ball.position, roll: b.roll, still: b.still };
    }
    return null;
  }

  /** `lie`: where your own ball lies between putts (in the cup: nothing to show). */
  update(dt: number, lie: { x: number; z: number } | null): void {
    for (const b of [...this.balls]) {
      const r = b.roll;
      if (b.still < 0) {
        b.t = Math.min(b.t + dt, r.seconds);
        const n = r.path.length / 3 - 1;
        const i = b.t * (STEPS / KEEP);
        const i0 = Math.min(Math.floor(i), n);
        const i1 = Math.min(i0 + 1, n);
        const k = i - i0;
        const p = r.path;
        b.ball.position.set(p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * k, p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * k, p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * k);
        while (b.next < r.hits.length && r.hits[b.next].t <= b.t) this.onHit?.(r.hits[b.next++], b.mine);
        if (b.t >= r.seconds) {
          b.still = 0;
          b.ball.visible = !r.holed;
          this.onRest?.(r, b.who, b.mine);
        }
        continue;
      }
      b.still += dt;
      if (b.still > LIE_SECONDS) this.drop(b);
    }
    // Your ball lying there, unless it's the one rolling (or still lying where it stopped).
    const m = this.mine;
    this.lie.visible = !!lie && !m;
    if (lie) this.lie.position.set(lie.x, ON_CARPET, lie.z);
  }

  /** Someone else's balls lying there, gone: they've put the putter down or left the floor. One still rolling finishes its roll. */
  forget(key: string): void {
    for (const b of [...this.balls]) if (!b.mine && b.key === key && b.still >= 0) this.drop(b);
  }

  /** How many balls are out on the carpet (rolling or lying where they stopped), not counting your lie. */
  get count(): number {
    return this.balls.length;
  }

  clear(): void {
    for (const b of [...this.balls]) this.drop(b);
  }

  private drop(b: Rolling) {
    this.balls = this.balls.filter((o) => o !== b);
    this.group.remove(b.ball);
    b.ball.geometry.dispose();
  }
}
