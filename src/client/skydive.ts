import * as THREE from 'three';
import { WALL_T } from '../shared/layout';
import { flare, glideStep, landable, moveClear, type Glide, type JumpSpot } from '../shared/skydive';
import type { PlayerController } from './player';
import { Canopy, Sash, POP } from './world/skydive';

// Jumping out of the building (#138): E at a window or at the balcony railing (see jumpSpotNear),
// and you climb up, fall a moment, the parachute pops open and you glide down to the street, A and D
// turning, W and S faster and slower. Like the ladder, it has hold of you (PlayerController.rig)
// until you're down on your feet. Nothing else is sent: you're moving like any other time, and the
// others see a chute over you (world/skydive.ts' PeerChutes).

/** Seconds climbing up onto the sill or the railing, then a moment up there before you go. */
const CLIMB = 0.55;
const TEETER = 0.35;
/** How hard you push off (m/s, out and up), and gravity falling free. */
const LEAP = { out: 2.4, up: 2.0 };
const GRAVITY = 9.8;
/** Falling free this long at most before the chute opens, and at least; sooner, if the ground's coming up. */
const FREEFALL = { max: 0.6, min: 0.25, low: 3.2 };
/** Down on anything higher than this over the street (a car, a lamp), you can't land there: you slide off. */
const OBSTACLE = 0.25;

export interface SkydiveHooks {
  /** The top of whatever is under (x, z) for feet at `y`, never below the street. */
  ground(x: number, z: number, y: number): number;
  /** How far down the street is from this floor. */
  street(): number;
  /** Your color, for your canopy. */
  color(): string;
  /** Where your chute and the open window go. */
  scene: THREE.Object3D;
  /** The rush of air (0–1, 0 to stop it), the chute snapping open, landing. */
  wind(level: number): void;
  pop(): void;
  land(): void;
}

type Stage = 'climb' | 'teeter' | 'fall' | 'glide';

export class Skydiver {
  private stage: Stage | null = null;
  private spot: JumpSpot | null = null;
  private t = 0;
  private from = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private glide: Glide | null = null;
  private canopy: Canopy | null = null;
  /** Your chute, which follows you (it's not on your model, which first person hides). */
  private holder = new THREE.Group();
  /** Canopies folding away and windows swinging shut after you've gone. */
  private leftovers: { update(dt: number): boolean; dispose(): void }[] = [];
  private sash: Sash | null = null;

  constructor(
    private player: PlayerController,
    private hooks: SkydiveHooks,
  ) {
    this.holder.name = 'skydive';
  }

  get active(): boolean {
    return !!this.stage;
  }

  /** How far along you are: up on the sill, falling free, or under the chute. */
  get doing(): 'climb' | 'fall' | 'glide' | null {
    const s = this.stage;
    return s === 'teeter' ? 'climb' : s;
  }

  /** Climbs up at `spot` and jumps. */
  jump(spot: JumpSpot) {
    if (this.stage) return;
    const p = this.player;
    this.spot = spot;
    this.stage = 'climb';
    this.t = 0;
    this.from.copy(p.pos);
    p.stopWalking();
    p.moving = false;
    p.rig = (dt) => this.step(dt);
    const heading = Math.atan2(spot.nx, spot.nz);
    p.facing = heading;
    if (spot.kind === 'window') {
      this.sash = new Sash(spot);
      this.hooks.scene.add(this.sash.group);
    }
  }

  /** Stops it wherever you are (off to another floor): you're let go, and fall the rest of the way. */
  abort() {
    if (!this.stage) return;
    this.finish();
  }

  /** The things left behind: a chute folding away, a window swinging shut. Every frame. */
  update(dt: number) {
    if (this.sash && this.stage !== 'climb' && this.stage !== 'teeter') {
      this.sash.shut();
      this.leftovers.push(this.sash);
      this.sash = null;
    }
    this.sash?.update(dt);
    this.leftovers = this.leftovers.filter((l) => {
      if (l.update(dt)) return true;
      l.dispose();
      return false;
    });
  }

  private step(dt: number) {
    const p = this.player;
    const s = this.spot!;
    this.t += dt;
    if (this.stage === 'climb' || this.stage === 'teeter') {
      // Up onto the sill (in the wall's middle) or the rail, in a little hop, then out to its edge.
      const sill = { x: s.x - s.nx * (s.kind === 'window' ? WALL_T / 2 : 0), z: s.z - s.nz * (s.kind === 'window' ? WALL_T / 2 : 0) };
      if (this.stage === 'climb') {
        const k = Math.min(1, this.t / CLIMB);
        const e = k * k * (3 - 2 * k);
        p.pos.set(THREE.MathUtils.lerp(this.from.x, sill.x, e), THREE.MathUtils.lerp(this.from.y, s.y, e) + Math.sin(k * Math.PI) * 0.3, THREE.MathUtils.lerp(this.from.z, sill.z, e));
        if (k < 1) return;
        this.stage = 'teeter';
        this.t = 0;
        return;
      }
      const k = Math.min(1, this.t / TEETER);
      p.pos.set(THREE.MathUtils.lerp(sill.x, s.x, k), s.y, THREE.MathUtils.lerp(sill.z, s.z, k));
      if (k < 1) return;
      this.stage = 'fall';
      this.t = 0;
      this.vel.set(s.nx * LEAP.out, LEAP.up, s.nz * LEAP.out);
      this.hooks.wind(1);
      return;
    }
    if (this.stage === 'fall') {
      this.vel.y -= GRAVITY * dt;
      moveClear(p.pos, this.vel.x * dt, this.vel.z * dt);
      p.pos.y += this.vel.y * dt;
      const ground = this.hooks.ground(p.pos.x, p.pos.z, p.pos.y);
      if (p.pos.y <= ground) {
        // Down before it opened (it can't, from a floor, but just in case).
        p.pos.y = ground;
        this.hooks.land();
        this.finish();
        return;
      }
      const h = p.pos.y - this.hooks.street();
      if (this.t < FREEFALL.min || (this.t < FREEFALL.max && !(this.vel.y < 0 && h < FREEFALL.low))) return;
      // The chute pops open.
      this.canopy = new Canopy(this.hooks.color());
      this.holder.add(this.canopy.group);
      this.hooks.scene.add(this.holder);
      this.glide = { x: p.pos.x, y: p.pos.y, z: p.pos.z, heading: p.facing, speed: Math.hypot(this.vel.x, this.vel.z), vy: this.vel.y };
      this.stage = 'glide';
      this.t = 0;
      this.hooks.pop();
      this.place();
      return;
    }
    const g = this.glide!;
    const turn = (p.holding('KeyD', 'ArrowRight') ? 1 : 0) - (p.holding('KeyA', 'ArrowLeft') ? 1 : 0);
    const push = (p.holding('KeyW', 'ArrowUp') ? 1 : 0) - (p.holding('KeyS', 'ArrowDown') ? 1 : 0);
    const before = g.heading;
    const street = this.hooks.street();
    const ground = this.hooks.ground(g.x, g.z, g.y);
    glideStep(g, { turn, push }, dt, ground);
    // The view turns with you, so A and D steer the way you're looking.
    p.camYaw += g.heading - before;
    p.facing = g.heading;
    p.pos.set(g.x, g.y, g.z);
    const f = flare(g.y - street);
    this.canopy!.update(dt, f);
    this.hooks.wind(this.t < POP ? 0.8 : 0.25 + 0.12 * push - 0.15 * f);
    this.place();
    const under = this.hooks.ground(g.x, g.z, g.y);
    if (g.y > under + 1e-3) return;
    // Down on a car or a lamp: you can't stay up there, so you slide off it.
    if (under > street + OBSTACLE || !landable(g.x, g.z)) {
      g.y = under + 0.01;
      g.speed = Math.max(g.speed, 1.6);
      return;
    }
    // Down: a soft landing on your feet, and the chute folds away behind you.
    p.pos.y = under;
    this.hooks.land();
    this.finish();
  }

  /** Your chute over you, the way you're flying. */
  private place() {
    this.holder.position.copy(this.player.pos);
    this.holder.rotation.set(0, this.player.facing, 0);
  }

  private finish() {
    const p = this.player;
    p.rig = null;
    p.vy = 0;
    this.stage = null;
    this.spot = null;
    this.glide = null;
    this.hooks.wind(0);
    const c = this.canopy;
    if (c) {
      // It folds away where you came down; the next jump gets a holder of its own.
      c.land();
      const holder = this.holder;
      this.leftovers.push({ update: (dt) => c.update(dt), dispose: () => (c.dispose(), holder.removeFromParent()) });
      this.holder = new THREE.Group();
      this.holder.name = 'skydive';
      this.canopy = null;
    }
  }

  /** Gone for good (the page is going): nothing's left lying around. */
  dispose() {
    this.abort();
    if (this.sash) this.leftovers.push(this.sash);
    for (const l of this.leftovers) l.dispose();
    this.leftovers = [];
    this.sash = null;
  }
}
