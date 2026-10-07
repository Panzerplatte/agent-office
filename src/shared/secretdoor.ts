// The secret door in the casino (see SECRET_DOOR, SECRET_ROOM in shared/casino.ts): a stretch of the
// hall's south wall that's a door, and nothing tells you so. Walk straight into exactly that spot and
// keep pushing for a moment, and it gives: it presses in a few centimeters, then swings away from you
// (either way, it's on a pivot), stays open while anyone's in its way, and swings shut and locks flush
// again once they're not. The office keeps whether it's open (so everyone sees the same door, and
// whoever comes down later sees it as it is); the pages play the motion (DoorMotion).
//
// Shared by the server (who may open it, when it shuts) and the client (the push, the motion).
import { CASINO, CASINO_ROOM, SECRET_DOOR, SECRET_ROOM } from './casino.js';

/** Which way the door was pushed, and so swings: 1 from the hall (into the room), -1 from the room (out into the hall). */
export type DoorSide = 1 | -1;

/** The door as the office keeps it. */
export interface SecretDoorState {
  open: boolean;
  /** The way it swings (or last swung). */
  side: DoorSide;
}

/** Someone's body, as the player has it: round, this many meters across the middle. */
const BODY = 0.32;

/**
 * Pushing it: you're up against it (your middle within `reach` meters of touching its face, and no
 * nearer than `inset` to either of its edges, so it's that spot and not the wall beside it), you face
 * it and you walk into it, each within `cone` radians of straight on, for `hold` seconds on end.
 */
export const SECRET_PUSH = { reach: 0.3, inset: 0.2, cone: (30 * Math.PI) / 180, hold: 0.35 } as const;

/**
 * How it moves (seconds, meters, radians): it presses in `depth` over `press`, then swings `angle`
 * open over `swing`; shutting, it swings back over `swingBack` and then settles out flush over
 * `pressBack`. The office keeps it open at least `minOpen` ms, and looks every `tick` ms for when it
 * can shut it.
 */
export const SECRET_MOTION = { depth: 0.04, press: 0.3, swing: 1.1, swingBack: 1.3, pressBack: 0.25, angle: (95 * Math.PI) / 180, minOpen: 2500, tick: 250 } as const;

const WALL_FACE = CASINO_ROOM.maxZ;
const ROOM_FACE = SECRET_ROOM.minZ;
const X0 = SECRET_DOOR.x - SECRET_DOOR.width / 2;
const X1 = SECRET_DOOR.x + SECRET_DOOR.width / 2;

/** Which side of the door (x, z) is right up against (`slack` meters more of leeway, for where the office last heard you were), or 0 for neither. */
export function doorFront(x: number, z: number, slack = 0): DoorSide | 0 {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  if (Math.abs(x - SECRET_DOOR.x) > SECRET_DOOR.width / 2 - SECRET_PUSH.inset + slack) return 0;
  const near = BODY + SECRET_PUSH.reach + slack;
  const hall = WALL_FACE - z;
  if (hall >= -0.01 && hall <= near) return 1;
  const room = z - ROOM_FACE;
  if (room >= -0.01 && room <= near) return -1;
  return 0;
}

/** Someone who might be pushing: where they are, which way they face (rotY: 0 faces +z) and which way they're trying to walk (0, 0 for not). */
export interface Pusher {
  x: number;
  z: number;
  facing: number;
  wishX: number;
  wishZ: number;
}

/** Whether `p` is walking straight into the door right now (from which side), or 0. Walking by, or into the wall beside it, isn't. */
export function pushingInto(p: Pusher): DoorSide | 0 {
  const side = doorFront(p.x, p.z);
  if (!side) return 0;
  const len = Math.hypot(p.wishX, p.wishZ);
  if (!(len > 0.1)) return 0;
  const cos = Math.cos(SECRET_PUSH.cone);
  // Into the wall is +z from the hall, -z from the room; facing rotY looks along (sin, cos).
  if ((p.wishZ / len) * side < cos) return 0;
  if (Math.cos(p.facing) * side < cos) return 0;
  return side;
}

/** Pushing for a moment, not just bumping into it: says the side once it's been pushed for SECRET_PUSH.hold seconds on end (and every frame after, while it still is). */
export class DoorPush {
  private held = 0;
  private side: DoorSide | 0 = 0;

  update(dt: number, p: Pusher): DoorSide | 0 {
    const side = pushingInto(p);
    if (side !== this.side) this.held = 0;
    this.side = side;
    if (!side) return 0;
    this.held += Math.max(0, dt);
    return this.held >= SECRET_PUSH.hold ? side : 0;
  }
}

/**
 * Whether someone at (x, z) is in the door's way: in the doorway, or where it swings on `side` (or so
 * near either that a body would be). It stays open while anyone is.
 */
export function inDoorway(x: number, z: number, side: DoorSide, pad = BODY): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (x < X0 - pad || x > X1 + pad) return false;
  if (z > WALL_FACE - pad && z < ROOM_FACE + pad) return true;
  return side === 1 ? z >= ROOM_FACE && z < ROOM_FACE + SECRET_DOOR.width + pad : z <= WALL_FACE && z > WALL_FACE - SECRET_DOOR.width - pad;
}

/** Someone in the office, as the door sees them. */
export interface DoorPerson {
  floor?: string;
  x: number;
  z: number;
  /** Sitting somewhere (nobody pushes a wall sitting down). */
  seat?: string;
}

/**
 * The office's door: shut until someone pushes it from where they stand (`push`), then open until
 * it's been open SECRET_MOTION.minOpen and nobody's in its way (`tick`, on a timer).
 */
export class SecretDoor {
  private open = false;
  private side: DoorSide = 1;
  private at = -Infinity;

  state(): SecretDoorState {
    return { open: this.open, side: this.side };
  }

  /** `p` pushes it: it opens away from them, if they're really at it. Whether it opened. */
  push(p: DoorPerson, now: number): boolean {
    if (this.open || p.floor !== CASINO || p.seat) return false;
    // Where the office last heard they were is a moment old: a little leeway.
    const side = doorFront(p.x, p.z, 0.3);
    if (!side) return false;
    this.open = true;
    this.side = side;
    this.at = now;
    return true;
  }

  /** Shuts it once it's been open long enough and nobody's in its way. Whether it shut. */
  tick(now: number, people: Iterable<DoorPerson>): boolean {
    if (!this.open || now - this.at < SECRET_MOTION.minOpen) return false;
    for (const p of people) if (p.floor === CASINO && inDoorway(p.x, p.z, this.side)) return false;
    this.open = false;
    this.at = now;
    return true;
  }
}

/** Eases in and out. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The door's motion on a page, from the office's state: pressed in (`press`, 0–1), then swung
 * (`swing`, 0–1), the way `side` says. Shut, both are exactly 0: it's `locked`, and then it's the wall
 * again (see world/casinosecret.ts), not a door left a hair ajar.
 */
export class DoorMotion {
  press = 0;
  swing = 0;
  side: DoorSide = 1;

  get locked(): boolean {
    return this.press === 0 && this.swing === 0;
  }

  /** Straight to how it is, no motion (coming down while it's open). */
  snap(state: SecretDoorState) {
    this.side = state.side;
    this.press = this.swing = state.open ? 1 : 0;
  }

  /** A frame toward `state`. True on the frame it locks shut. */
  update(dt: number, state: SecretDoorState): boolean {
    dt = Math.max(0, dt);
    let open = state.open;
    if (this.locked) this.side = state.side;
    // Pushed the other way while it's still open this way: shut first, then open that way.
    else if (state.side !== this.side) open = false;
    const M = SECRET_MOTION;
    if (open) {
      if (this.press < 1) this.press = Math.min(1, this.press + dt / M.press);
      else this.swing = Math.min(1, this.swing + dt / M.swing);
      return false;
    }
    if (this.locked) return false;
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt / M.swingBack);
      return false;
    }
    this.press = Math.max(0, this.press - dt / M.pressBack);
    // The last bit snaps home: exactly 0, not a float a hair off it.
    if (this.press < 1e-3) this.press = 0;
    return this.press === 0;
  }

  /** How far in it's pressed (m), toward where it swings. */
  get depth(): number {
    return smooth(this.press) * SECRET_MOTION.depth;
  }

  /** How far it's swung open (radians, 0 shut). */
  get angle(): number {
    return smooth(this.swing) * SECRET_MOTION.angle;
  }

  /** Far enough open to walk through. */
  get passable(): boolean {
    return this.swing >= 0.6;
  }
}
