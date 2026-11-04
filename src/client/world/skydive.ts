import * as THREE from 'three';
import { WINDOWS } from '../../shared/layout';
import { clearance, type JumpSpot } from '../../shared/skydive';
import { parachute } from './leaving';
import { mesh, toon } from './toon';

// What jumping out of the building looks like (the moves are in client/skydive.ts): the parachute
// over a person (the one the leaving workers use, see leaving.ts), how it pops open, sways, flares and
// folds away once they're down, the window swinging open to climb out of, and the chutes over other
// people seen gliding down.

/** A worker's chute, made for its shoulders (0.88 up), sized up for a person's. */
const SHOULDERS = 1.22;
const SIZE = 1.35;
/** Seconds for the chute to pop open, and to sag down and be bundled away once you're down. */
export const POP = 0.45;
const FOLD = 1.2;

/** A chute over someone: open (0 → 1 as it pops), and folding away once they're down. */
export class Canopy {
  readonly group = new THREE.Group();
  private chute: { group: THREE.Group; dome: THREE.Group };
  private t = 0;
  /** Seconds since they came down, or -1 while they're still in the air. */
  private down = -1;

  constructor(color: string) {
    this.chute = parachute(color);
    // It's built to hang off a worker's origin, 0.88 up: here it hangs off the shoulders.
    this.chute.group.position.y = 0;
    this.group.add(this.chute.group);
    this.group.position.y = SHOULDERS;
    this.group.scale.setScalar(SIZE);
    this.chute.group.scale.setScalar(0.05);
  }

  /** Sways under the air, `flare` (0–1) pulling the canopy back as it brakes; true while there's anything left of it. */
  update(dt: number, flare = 0): boolean {
    this.t += dt;
    const c = this.chute;
    if (this.down < 0) {
      // Open with a pop that overshoots a little, then swaying a little on the way down.
      const p = Math.min(1, this.t / POP);
      const u = p - 1;
      c.group.scale.setScalar(Math.max(0.05, 1 + 2.7 * u * u * u + 1.7 * u * u));
      c.group.rotation.z = Math.sin(this.t * 1.9) * 0.08;
      c.group.rotation.x += (-0.35 * flare - c.group.rotation.x) * Math.min(1, dt * 5);
      return true;
    }
    // Down: it sags down behind, flattens and shrinks away.
    this.down += dt;
    const p = Math.min(1, this.down / FOLD);
    c.group.rotation.set(-1.35 * Math.min(1, p * 1.6), 0, 0);
    c.dome.scale.y = 0.62 * (1 - 0.65 * p);
    c.group.scale.setScalar(Math.max(0.001, 1 - Math.max(0, (p - 0.55) / 0.45) ** 2));
    return p < 1;
  }

  /** They're down: it starts folding away. */
  land() {
    if (this.down < 0) this.down = 0;
  }

  get open(): boolean {
    return this.t >= POP && this.down < 0;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** A canopy's color: picked by someone's own color, so everyone sees the same one over them. */
export function canopyColor(personColor: string): string {
  return personColor || '#ef476f';
}

const SASH_GLASS = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

/**
 * The half of a window you climb out of, swinging open outward on its hinge at the side, and shut
 * again a little after you've gone. The window's own glass stays put (it's merged with the others):
 * this is the open sash, standing out from the wall.
 */
export class Sash {
  readonly group = new THREE.Group();
  private leaf = new THREE.Group();
  private t = 0;
  /** How open it is, 0–1, and whether it's shutting. */
  private open = 0;
  private shutting = false;

  constructor(spot: JumpSpot) {
    const o = WINDOWS[spot.window ?? 0];
    const w = o.width / 2 - 0.13;
    const h = o.y1 - o.y0 - 0.18;
    // Turned so that its local +z points out of the wall; its local +x then runs along the wall one
    // way (+1) or the other (-1), measured the way the window's `u` is.
    const yaw = Math.atan2(spot.nx, spot.nz);
    const s = Math.round(spot.nx ? -Math.sin(yaw) : Math.cos(yaw));
    const along = spot.nx ? spot.z : spot.x;
    // The half you go out through, hinged at its outer side jamb: the leaf reaches in from there (-x·lean).
    const side = along < o.u ? -1 : 1;
    const lean = side * s;
    const frame = toon('#ffffff');
    const F = 0.05;
    const leaf = this.leaf;
    const cx = (-lean * w) / 2;
    for (const y of [F / 2, h - F / 2]) leaf.add(mesh(new THREE.BoxGeometry(w, F, 0.05), frame, cx, y, 0, false));
    for (const x of [F / 2, w - F / 2]) leaf.add(mesh(new THREE.BoxGeometry(F, h, 0.05), frame, -lean * x, h / 2, 0, false));
    leaf.add(mesh(new THREE.PlaneGeometry(w - 2 * F, h - 2 * F), SASH_GLASS, cx, h / 2, 0, false));
    this.group.add(leaf);
    this.group.rotation.y = yaw;
    const hinge = o.u + side * (o.width / 2 - 0.09);
    this.group.position.set(spot.nx ? spot.x : hinge, o.y0 + 0.09, spot.nx ? hinge : spot.z);
    this.swing = lean;
  }

  /** Which way round its hinge it swings out. */
  private swing: number;

  shut() {
    this.shutting = true;
  }

  /** True while it's still there. */
  update(dt: number): boolean {
    this.t += dt;
    this.open = this.shutting ? Math.max(0, this.open - dt * 1.2) : Math.min(1, this.open + dt * 2.6);
    const e = this.open * this.open * (3 - 2 * this.open);
    // Out from the wall, swinging round its hinge.
    this.leaf.rotation.y = this.swing * e * 1.25;
    return !(this.shutting && this.open <= 0);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** Seconds someone has to be out in the air before their chute shows: they fall a moment first. */
const OPENS_AFTER = 0.5;
/** This high over the street, out clear of the building, they can't be standing on anything: they're under a chute. */
const AIRBORNE = 1.6;

interface Watched {
  /** Seconds they've been out in the air (or -1 once they're down again). */
  out: number;
  canopy: Canopy | null;
}

/**
 * Chutes over the other people on the floor while they're gliding down. Nothing is sent for it: if
 * they're up in the air out clear of the building, they've jumped, and a chute opens over them; it
 * folds away once they're down. So someone who comes in late sees one over whoever's on the way down.
 */
export class PeerChutes {
  private watched = new Map<string, Watched>();

  /** `people`: everyone else on the floor, their model's root and color; `street`: how far down the street is. */
  update(dt: number, people: Iterable<{ id: string; root: THREE.Object3D; color: string }>, street: number) {
    const seen = new Set<string>();
    for (const p of people) {
      seen.add(p.id);
      const pos = p.root.position;
      let w = this.watched.get(p.id);
      const up = pos.y > street + AIRBORNE && clearance(pos.x, pos.z) > 0.4;
      if (!w) {
        if (!up) continue;
        w = { out: 0, canopy: null };
        this.watched.set(p.id, w);
      }
      if (up && !w.canopy) {
        w.out += dt;
        if (w.out >= OPENS_AFTER) {
          w.canopy = new Canopy(canopyColor(p.color));
          p.root.add(w.canopy.group);
        }
      }
      const landed = pos.y < street + 0.15 || (!up && pos.y < street + AIRBORNE && clearance(pos.x, pos.z) < 0.4);
      if (w.canopy) {
        if (landed) w.canopy.land();
        if (!w.canopy.update(dt)) {
          w.canopy.dispose();
          this.watched.delete(p.id);
        }
      } else if (!up) this.watched.delete(p.id);
    }
    for (const [id, w] of this.watched) {
      if (seen.has(id)) continue;
      w.canopy?.dispose();
      this.watched.delete(id);
    }
  }

  /** Off to another floor: none of these are here any more. */
  clear() {
    for (const w of this.watched.values()) w.canopy?.dispose();
    this.watched.clear();
  }

  /** Whether someone has a chute over them, for tests and scripts. */
  has(id: string): boolean {
    return !!this.watched.get(id)?.canopy;
  }
}
