import * as THREE from 'three';
import { DART_COLORS, MAX_PLAYERS, dartOk, type DartsOptions, type DartsSeat, type DartsState } from '../shared/darts';
import { isTyping, type PlayerController } from './player';
import { modalOpen } from './ui/dom';
import { DartsPanel } from './ui/darts';
import type { Person } from './world/character';
import type { DartboardView } from './world/dartboard';
import { landing, ocheSpot, sway, type BoardDarts } from './world/darts';

// Darts at the board on the east wall (E at the oche): you step up to your own spot on the oche, and
// the camera comes in from the oche to the board, close enough to aim. Before a game there's the
// lobby (see ui/darts.ts); on your turn the mouse moves the aim over the board, never quite still,
// and holding Space runs the power meter up and down: let go in its sweet spot and the dart goes
// where you aimed, too early and it drops, too late and it flies high. The office scores it, and
// everyone on the floor sees it fly (see world/darts.ts). E, or walking off, steps away again.

/** The power meter runs from nothing to full in this long, then back down again. */
const METER = 1;
/** Let go with the meter under this and you didn't mean it: nothing happens. */
const MIN_POWER = 0.03;
/** The longer you hold Space, the more the aim wanders: this much more sway for every second. */
const TIRE = 0.35;
/** How far out from the bull you can aim (m): the board and a little round it. */
const AIM_REACH = 0.4;
/** Where the aim starts: the treble 20, where everyone goes first. */
const AIM_START = { x: 0, y: 0.103 };
/**
 * The camera, in the board's own frame: this far out in front of it, a little to the right and
 * below the bull (so the darts in it are seen side on, colours and all, not end on), looking at a
 * point a little above it, which leaves room over the board for the panel.
 */
const CAM_OUT = 1.15;
const CAM_SIDE = 0.3;
const CAM_UP = -0.08;
const LOOK_UP = 0.05;
/** Waiting for the office to say what your dart did: no other before it does, or this long (ms). */
const ANSWER_WAIT = 1500;
/** Keys that walk you off the oche. */
const WALK = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** What you're doing at the board: waiting for a game, watching someone else throw, aiming, the meter running, or a dart away. */
export type DartsStage = 'lobby' | 'watch' | 'aim' | 'charge' | 'thrown';

export interface DarterHooks {
  /** Step up to the board, or away from it: the office keeps who's at it. */
  join(): void;
  leave(): void;
  /** A dart that lands at board-local (x, y). */
  throw(x: number, y: number): void;
  options(o: Partial<DartsOptions>): void;
  start(): void;
  reset(): void;
  /** The board had four people at it already. */
  full(): void;
  /** You're back on your feet away from the board. */
  done(): void;
}

const lookAt = new THREE.Matrix4();
const want = new THREE.Vector3();
const target = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();

export class Darter {
  private on = false;
  /** Asked the office for a place at the board, and not heard yet whether there was one. */
  private joining = false;
  /** Your colour, once the office has given you one (until then, the one you'd get). */
  private color: string = DART_COLORS[0];
  /** Where you aim on the board, in its own meters, before the sway. */
  private aim = { ...AIM_START };
  /** When the power meter started running (performance.now()), while Space is held down. */
  private chargeAt = 0;
  private charging = false;
  /** How hard the last one was thrown, marked on the meter. */
  private lastPower = -1;
  /** When your last dart went (performance.now()), until the office says what it did. */
  private thrownAt = 0;
  /** The camera's own place and turn, while it's the darts camera. */
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: DartsPanel;
  /** Where your dart would go now: a ring in your colour on the board. */
  private readonly marker: THREE.Group;
  private state: DartsState | null = null;
  private you = '';

  constructor(
    private readonly player: PlayerController,
    private readonly me: Person,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLElement,
    private readonly board: DartboardView,
    private readonly darts: BoardDarts,
    /** Where the mouse is over the scene (normalized device coordinates), or null when it's off it. */
    private readonly pointer: () => THREE.Vector2 | null,
    /** Reduce motion: the aim holds still, and the camera goes straight there. */
    private readonly still: () => boolean,
    private readonly hooks: DarterHooks,
  ) {
    this.panel = new DartsPanel({ options: (o) => hooks.options(o), start: () => hooks.start(), reset: () => hooks.reset() });
    this.marker = new THREE.Group();
    // A white ring with your colour inside it, and a dot in the middle: it shows on any part of the board.
    const ring = (r0: number, r1: number, z: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false, transparent: true, opacity: 0.95 }));
      m.position.z = z;
      m.renderOrder = 2;
      return m;
    };
    this.marker.add(ring(0.008, 0.013, 0), ring(0.0093, 0.0117, 0.0005), ring(0, 0.0018, 0.0005));
    this.marker.visible = false;
    board.group.add(this.marker);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    // Tabbed away mid-throw: the key never comes back up, so it's no throw.
    window.addEventListener('blur', () => (this.charging = false));
  }

  get active(): boolean {
    return this.on;
  }

  /** What you're doing at the board, or null when you're not at it. */
  get doing(): DartsStage | null {
    if (!this.on) return null;
    const g = this.state?.game;
    if (!g || g.over) return 'lobby';
    if (this.thrownAt) return 'thrown';
    if (!this.myTurn()) return 'watch';
    return this.charging ? 'charge' : 'aim';
  }

  /** How far the power meter is up right now (0–1), while Space is held. */
  get power(): number {
    if (!this.charging) return 0;
    const p = ((performance.now() - this.chargeAt) / 1000 / METER) % 2;
    return p > 1 ? 2 - p : p;
  }

  /** Up to the oche, in the spot of the colour you'd get, and the camera in at the board. */
  start(state: DartsState, you: string) {
    if (this.on) return;
    this.on = true;
    this.joining = true;
    this.you = you;
    this.state = state;
    this.color = state.lobby.find((s) => s.id === you)?.color ?? DART_COLORS.find((c) => !state.lobby.some((s) => s.color === c)) ?? DART_COLORS[0];
    this.aim = { ...AIM_START };
    this.charging = false;
    this.thrownAt = 0;
    this.lastPower = -1;
    const p = this.player;
    p.rig = () => this.stand();
    this.stand();
    p.camYaw = p.facing - Math.PI;
    // The mouse is for aiming now, and for the buttons on the panel: let go of it.
    p.freeMouse = true;
    p.unlock();
    this.canvas.classList.add('aiming');
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.hooks.join();
    this.panel.show(true);
    this.sync(state);
  }

  /** Away from the board, back on your feet behind the oche. `tell`: let the office know (not when it's the one who let you go). */
  stop(tell = true) {
    if (!this.on) return;
    this.on = false;
    this.joining = false;
    this.charging = false;
    this.thrownAt = 0;
    const p = this.player;
    p.rig = null;
    p.freeMouse = false;
    p.lookPitch = -0.08;
    p.camYaw = p.facing - Math.PI;
    this.canvas.classList.remove('aiming');
    // Back to looking around with it (E, or walking off, is the key press the browser wants for that).
    if (p.canLock && p.enabled) p.lock();
    this.marker.visible = false;
    this.panel.show(false);
    if (tell) this.hooks.leave();
    this.hooks.done();
  }

  /** The office's latest on the board (or one of its darts landed): whether you're still at it, your colour, and the panel. */
  sync(state: DartsState) {
    this.state = state;
    if (!this.on) return;
    // The office has said what your dart did (or something else happened, and it'll take no other before its turn).
    this.thrownAt = 0;
    const seat = state.lobby.find((s) => s.id === this.you);
    if (seat) {
      this.joining = false;
      this.color = seat.color;
      ((this.marker.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(seat.color);
    } else if (this.joining) {
      // Somebody else's news can come before the office has had your ask: only a full board is a no.
      if (state.lobby.length >= MAX_PLAYERS) {
        this.stop(false);
        this.hooks.full();
        return;
      }
    } else return this.stop(false);
    this.panel.render(state, this.you, this.shownTurn());
  }

  /** Asks the office again for your place (after a reconnect, which lets go of it, and comes back as `you`). */
  rejoin(you: string) {
    if (!this.on) return;
    this.you = you;
    this.joining = true;
    this.hooks.join();
  }

  /** The turn the panel and the chalkboards show: the darts in the board, or the player who's up with none yet. */
  shownTurn() {
    const g = this.state?.game;
    if (this.darts.shown) return this.darts.shown;
    const up = g && !g.over ? g.players[g.up] : undefined;
    return up ? { player: up.id, darts: [], bust: false, done: false } : null;
  }

  /** Who's up, when it isn't you. */
  get thrower(): DartsSeat | null {
    const g = this.state?.game;
    const up = g && !g.over ? g.players[g.up] : undefined;
    return up && up.id !== this.you ? up : null;
  }

  /** Whether the last turn's darts are still in the board, about to be pulled out. */
  get pulling(): boolean {
    return this.darts.pulling;
  }

  /** Every frame, once the player has moved: aiming, the meter, and the camera. */
  update(dt: number) {
    if (!this.on) return;
    if (this.thrownAt && performance.now() - this.thrownAt > ANSWER_WAIT) this.thrownAt = 0;
    const mine = this.myTurn();
    if (!mine) this.charging = false;
    if (mine) this.aimAt();
    const spot = this.swayed();
    this.marker.visible = mine;
    this.marker.position.set(spot.x, spot.y, 0.004);
    this.panel.meter(mine ? this.power : null, this.lastPower);
    this.placeCamera(dt);
  }

  /** Your turn, with the board clear and nothing of yours still in the air. */
  private myTurn(): boolean {
    const g = this.state?.game;
    return !!g && !g.over && g.players[g.up]?.id === this.you && !this.darts.busy && !this.thrownAt;
  }

  /** You, at your spot on the oche, facing the board. */
  private stand() {
    const s = ocheSpot(this.color);
    const p = this.player;
    p.pos.set(s.x, 0, s.z);
    p.facing = s.facing;
    p.moving = false;
  }

  /** The aim follows the mouse over the board (and a little round it). */
  private aimAt() {
    const ndc = this.pointer();
    if (!ndc) return;
    raycaster.setFromCamera(ndc, this.camera);
    plane.setFromNormalAndCoplanarPoint(this.board.normal, this.board.toWorld(0, 0, 0, target));
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const b = this.board.toBoard(hit);
    const r = Math.hypot(b.x, b.y);
    const k = r > AIM_REACH ? AIM_REACH / r : 1;
    this.aim.x = b.x * k;
    this.aim.y = b.y * k;
  }

  /** Where the aim is with the sway on it: wandering more the longer you hold the meter. */
  private swayed(): { x: number; y: number } {
    if (this.still()) return this.aim;
    const held = this.charging ? (performance.now() - this.chargeAt) / 1000 : 0;
    const s = sway(performance.now() / 1000, 1 + held * TIRE);
    return { x: this.aim.x + s.x, y: this.aim.y + s.y };
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.on) return;
    const mine = !isTyping(e) && !modalOpen() && !e.metaKey && !e.ctrlKey && !e.altKey;
    // Walking off steps you away from the board.
    if (down && mine && WALK.includes(e.code)) return this.stop();
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (down && (e.repeat || !mine)) return;
    if (down && this.myTurn()) {
      this.charging = true;
      this.chargeAt = performance.now();
    } else if (!down && this.charging) {
      const power = this.power;
      const at = this.swayed();
      this.charging = false;
      if (power < MIN_POWER || !this.myTurn()) return;
      // With reduce motion on the aim holds still, but the hand isn't any steadier: the sway's there, unseen.
      const s = this.still() ? sway(Math.random() * 1000) : { x: 0, y: 0 };
      const land = landing({ x: at.x + s.x, y: at.y + s.y }, power);
      this.lastPower = power;
      if (!dartOk(land)) return;
      this.thrownAt = performance.now();
      this.me.reach();
      this.hooks.throw(land.x, land.y);
    }
  }

  /** Out in front of the board, a little up, looking at it: close enough to aim, with room above it for the panel. */
  private placeCamera(dt: number) {
    this.board.toWorld(CAM_SIDE, CAM_UP, CAM_OUT, want);
    this.board.toWorld(0, LOOK_UP, 0, target);
    const k = this.still() ? 1 : 1 - Math.exp(-dt * 6);
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }
}
