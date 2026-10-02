import * as THREE from 'three';
import { BALL_R, MAX_PLAYERS, canPlace, type PoolPlayback, type PoolState, type PoolTeam, type Shot } from '../shared/pool';
import { POOL_TABLE } from '../shared/layout';
import { isTyping, type PlayerController } from './player';
import { modalOpen } from './ui/dom';
import { PoolPanel } from './ui/pool';
import type { PoolTableView } from './world/pooltable';
import { aimLine, seatColor, standSpot, type PoolBalls } from './world/pool';

// 8-ball at the pool table in front of the balcony doors (E at the table): you step up to it, and the
// camera comes up over it, from one long side (Q goes round to the other). Before a game there's the
// lobby (see ui/pool.ts). On your shot you walk round the table behind the cue ball as the mouse goes
// round it, with the cue in your colour, a faint line to the ghost ball where it would touch first,
// and the way that ball would go. Press on the cloth and drag back to draw the cue (or hold Space),
// and let go to strike: the further back, the harder. A dot on the cue ball in the panel puts spin on
// it. With ball in hand, drag the cue ball where you want it first. The office rolls every shot, and
// everyone on the floor sees it roll (see world/pool.ts). Esc or walking off steps away again, but
// your seat in a game that's running waits for you (shown as away): step up again with E, even after
// a reload, and you're back in it. Only Leave in the panel gives it up. E at the table does nothing.

/** Drag back this far (m, on the table) for the hardest shot. */
const FULL_DRAW = 0.45;
/** With Space, the power bar runs from nothing to full in this long, then back down. */
const METER = 1.4;
/** Let go with less than this and you didn't mean it: nothing happens. */
const MIN_POWER = 0.03;
/** Waiting for the office to roll your shot: no other before it does, or this long (ms). */
const ANSWER_WAIT = 2500;
/**
 * The camera: over this far out from the middle of the table, across it, and this high over the cloth,
 * looking at a point a little past the middle (`LOOK_IN` toward you), so the table sits under the panel.
 */
const CAM_OUT = 1.75;
const CAM_UP = 1.7;
const LOOK_IN = -0.1;
/** Keys that walk you off. */
const WALK = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** What you're doing at the table: in the lobby, watching someone else's shot, aiming, drawing the cue back, moving the cue ball, or a shot away. */
export type PoolStage = 'lobby' | 'watch' | 'aim' | 'draw' | 'place' | 'shot';

export interface CueistHooks {
  /** Up to the table, or back into your seat: `key` is this browser's (see browserKey). */
  join(key: string): void;
  /** Off the table, and out of its game, for good. */
  leave(): void;
  /** Away from the table, keeping your seat in a game that's running. */
  away(): void;
  /** Skip the shot of whoever's up while they're away. */
  skip(): void;
  shoot(shot: Shot): void;
  place(x: number, y: number): void;
  team(team: PoolTeam): void;
  start(): void;
  reset(): void;
  /** The table had four people at it already. */
  full(): void;
  /** You're back on your feet away from the table. */
  done(): void;
}

const KEY = 'agent-office.pool-key';
let memoryKey = '';
/**
 * This browser's own key at the pool table, kept across reloads, so the office knows it's you coming
 * back to your seat (when you're signed in with an account, it goes by that instead).
 */
export function browserKey(): string {
  try {
    const k = localStorage.getItem(KEY);
    if (k) return k;
  } catch {
    // No storage: this page's own key, then.
  }
  memoryKey ||= Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(KEY, memoryKey);
  } catch {
    // As above.
  }
  return memoryKey;
}

const lookAt = new THREE.Matrix4();
const want = new THREE.Vector3();
const target = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();
const stand = new THREE.Vector3();

export class Cueist {
  private on = false;
  private joining = false;
  private state: PoolState | null = null;
  private you = '';
  /** Which long side the camera's on: +1 the table's +y, -1 its -y. */
  private camSide = 1;
  /** Where you aim, radians from the table's +x. */
  private angle = 0;
  /** Drawing the cue back: how (the mouse or Space), since when, and where the mouse went down (table-local). */
  private drawing: 'mouse' | 'key' | null = null;
  private drawFrom = { x: 0, y: 0 };
  private drawAt = 0;
  private drawPower = 0;
  private lastPower = -1;
  /** Moving the cue ball, with ball in hand: where it would go. */
  private placing: { x: number; y: number } | null = null;
  /** When your shot went (performance.now()), until the office rolls it. */
  private shotAt = 0;
  private spin = { side: 0, top: 0 };
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: PoolPanel;

  constructor(
    private readonly player: PlayerController,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLElement,
    private readonly table: PoolTableView,
    private readonly balls: PoolBalls,
    /** Where the mouse is over the scene (normalized device coordinates), or null when it's off it. */
    private readonly pointer: () => THREE.Vector2 | null,
    /** Reduce motion: the camera goes straight there. */
    private readonly still: () => boolean,
    private readonly hooks: CueistHooks,
  ) {
    this.panel = new PoolPanel({
      team: (s) => hooks.team(s),
      start: () => hooks.start(),
      reset: () => hooks.reset(),
      leave: () => this.leave(),
      skip: () => hooks.skip(),
      spin: (side, top) => (this.spin = { side, top }),
    });
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    canvas.addEventListener('pointerdown', (e) => this.press(e));
    window.addEventListener('pointerup', (e) => this.release(e));
    window.addEventListener('blur', () => this.cancel());
    canvas.addEventListener('contextmenu', (e) => this.on && e.preventDefault());
  }

  get active(): boolean {
    return this.on;
  }

  /** What you're doing at the table, or null when you're not at it. */
  get doing(): PoolStage | null {
    if (!this.on) return null;
    const g = this.state?.game;
    if (!g || g.over) return 'lobby';
    if (this.shotAt || (this.balls.busy && this.myTurn(true))) return 'shot';
    if (!this.myTurn()) return 'watch';
    if (this.placing) return 'place';
    return this.drawing ? 'draw' : 'aim';
  }

  /** Whether you've the cue ball in hand on this shot (`'kitchen'` for the break). */
  get ballInHand(): 'kitchen' | 'table' | null {
    const g = this.state?.game;
    return this.myTurn() && g?.ballInHand ? g.ballInHand : null;
  }

  /** Whose shot it is, when it isn't yours: on the table as it's shown, so it changes when the panel does, once the balls stop. */
  get shooter(): { id: string; name: string } | null {
    const g = this.balls.shown.game;
    const up = g && !g.over ? g.players[g.up] : undefined;
    return up && up.id !== this.you ? up : null;
  }

  /** How hard the shot is drawn back right now (0–1). */
  get power(): number {
    if (this.drawing === 'key') {
      const p = ((performance.now() - this.drawAt) / 1000 / METER) % 2;
      return p > 1 ? 2 - p : p;
    }
    return this.drawing === 'mouse' ? this.drawPower : 0;
  }

  /** Up to the table, on the long side you're nearest, and the camera up over it. */
  start(state: PoolState, you: string) {
    if (this.on) return;
    this.on = true;
    this.joining = true;
    this.you = you;
    this.state = state;
    this.camSide = this.table.toTable(this.player.pos).y >= 0 ? 1 : -1;
    this.angle = this.camSide > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.drawing = null;
    this.placing = null;
    this.shotAt = 0;
    this.lastPower = -1;
    const p = this.player;
    p.rig = () => this.stand();
    p.freeMouse = true;
    p.unlock();
    this.canvas.classList.add('aiming');
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.hooks.join(browserKey());
    this.panel.show(true);
    // Not sync: whether there's room (or a seat that's yours, under the id you had before a reload) is the office's to say.
    this.render();
  }

  /** Leave the table and its game for good (Leave in the panel). */
  leave() {
    if (!this.on) return;
    this.hooks.leave();
    this.stop(false);
  }

  /**
   * Away from the table. `tell`: let the office know you've stepped away (not when it's the one who let
   * you go); a seat of yours in a game that's running waits for you.
   */
  stop(tell = true) {
    if (!this.on) return;
    this.on = false;
    this.joining = false;
    this.cancel();
    this.shotAt = 0;
    const p = this.player;
    p.rig = null;
    p.freeMouse = false;
    p.lookPitch = -0.08;
    p.camYaw = p.facing - Math.PI;
    this.canvas.classList.remove('aiming');
    if (p.canLock && p.enabled) p.lock();
    this.balls.aim(null);
    this.balls.hand(null);
    this.balls.hideCue();
    this.panel.show(false);
    if (tell) this.hooks.away();
    this.hooks.done();
  }

  /** Whether someone standing at world `pos` is between the camera and the table, where they'd block the view. */
  inTheWay(pos: THREE.Vector3): boolean {
    if (!this.on) return false;
    const p = this.table.toTable(pos);
    return p.y * this.camSide > POOL_TABLE.outer.width / 2 - 0.1 && Math.abs(p.x) < POOL_TABLE.outer.length / 2 + 0.7 && Math.abs(p.y) < CAM_OUT + 0.5;
  }

  /** Swings the camera round to the other long side of the table. */
  flip() {
    this.camSide = -this.camSide;
  }

  /** The office's latest on the table: whether you're still at it, and the panel. */
  sync(state: PoolState, shot?: PoolPlayback) {
    this.state = state;
    if (!this.on) return;
    if (shot || !state.game || state.game.over) this.shotAt = 0;
    const seat = state.lobby.find((s) => s.id === this.you);
    if (seat?.away && !this.joining) {
      // The office thinks you're gone (your connection dropped and came back): you're right here.
      this.joining = true;
      this.hooks.join(browserKey());
    } else if (seat && !seat.away) this.joining = false;
    else if (seat) {
      // Still waiting to be back.
    } else if (this.joining) {
      if (state.lobby.length >= MAX_PLAYERS) {
        this.stop(false);
        this.hooks.full();
        return;
      }
    } else return this.stop(false);
    this.render();
  }

  /** The panel, from the table as it's shown (it waits for a shot to stop rolling). */
  render() {
    if (this.on) this.panel.render(this.balls.shown, this.you);
  }

  /** Asks the office again for your place (after a reconnect, which lets go of it). */
  rejoin(you: string) {
    if (!this.on) return;
    this.you = you;
    this.joining = true;
    this.hooks.join(browserKey());
  }

  /** Every frame: aiming, the cue, the ball in your hand, where you stand, and the camera. */
  update(dt: number) {
    if (!this.on) return;
    if (this.shotAt && performance.now() - this.shotAt > ANSWER_WAIT) this.shotAt = 0;
    const stage = this.doing;
    const mine = stage === 'aim' || stage === 'draw' || stage === 'place';
    if (!mine) this.cancel();
    // The camera first: the mouse points into the scene as it's seen from there (the player's moved it since).
    this.placeCamera(dt);
    const cue = this.cueBall();
    const at = this.pointAt();
    if (stage === 'place' && at && this.placing) {
      this.placing = at;
    } else if (stage === 'aim' && at && cue && Math.hypot(at.x - cue.x, at.y - cue.y) > BALL_R * 1.5) {
      this.angle = Math.atan2(at.y - cue.y, at.x - cue.x);
    } else if (stage === 'draw' && this.drawing === 'mouse' && at) {
      // How far back the mouse has come from where it went down, along the line of the shot.
      const back = -((at.x - this.drawFrom.x) * Math.cos(this.angle) + (at.y - this.drawFrom.y) * Math.sin(this.angle));
      this.drawPower = Math.max(0, Math.min(1, back / FULL_DRAW));
    }
    const g = this.state?.game;
    this.balls.hand(this.placing, !!g && !!this.placing && canPlace(g, this.placing.x, this.placing.y));
    if ((stage === 'aim' || stage === 'draw') && cue) {
      this.balls.aim(aimLine(this.balls.positions, this.angle));
      const g = this.state!.game!;
      this.balls.aimCue(cue, this.angle, 0.03 + this.power * 0.3, seatColor(g.players, this.you));
    } else {
      this.balls.aim(null);
      if (!this.balls.busy) this.balls.hideCue();
    }
    this.panel.meter(mine ? this.power : null, this.lastPower);
  }

  private myTurn(evenWhileRolling = false): boolean {
    const g = this.state?.game;
    return !!g && !g.over && g.players[g.up]?.id === this.you && (evenWhileRolling || (!this.balls.busy && !this.shotAt));
  }

  private cueBall() {
    return this.balls.positions.find((b) => b.n === 0);
  }

  /** You, round the table behind the cue ball on your shot, otherwise along your side of it; facing the cue ball. */
  private stand() {
    const cue = this.cueBall() ?? { x: 0, y: 0 };
    const mine = this.myTurn(true) && !!this.state?.game;
    const s = mine ? standSpot(cue, this.angle) : standSpot({ x: this.spotAlong(), y: 0 }, this.camSide > 0 ? -Math.PI / 2 : Math.PI / 2);
    this.table.toWorld(s.x, s.y, 0, stand);
    this.table.toWorld(cue.x, cue.y, 0, target);
    const p = this.player;
    // Walk round, rather than jump, as the aim swings.
    const k = this.still() ? 1 : 0.2;
    p.pos.x += (stand.x - p.pos.x) * k;
    p.pos.z += (stand.z - p.pos.z) * k;
    p.pos.y = 0;
    const moved = Math.hypot(stand.x - p.pos.x, stand.z - p.pos.z) > 0.05;
    p.moving = moved;
    p.facing = Math.atan2(target.x - p.pos.x, target.z - p.pos.z);
  }

  /** Where along the table you wait for your shot: your place in the lobby, spread out so nobody stands on anyone. */
  private spotAlong(): number {
    const i = Math.max(0, this.state?.lobby.findIndex((s) => s.id === this.you) ?? 0);
    return [-0.7, 0.7, -0.2, 0.2][i % 4];
  }

  /** The point on the table (table-local, at a ball's height) under the mouse, or null. */
  private pointAt(): { x: number; y: number } | null {
    const ndc = this.pointer();
    if (!ndc) return null;
    raycaster.setFromCamera(ndc, this.camera);
    const o = this.table.toWorld(0, 0, BALL_R, target);
    plane.setFromNormalAndCoplanarPoint(UP, o);
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    const b = this.table.toTable(hit);
    return { x: b.x, y: b.y };
  }

  /** The mouse down on the table: pick up the cue ball (with ball in hand), or start drawing the cue back. */
  private press(e: PointerEvent) {
    if (!this.on || e.button !== 0 || modalOpen()) return;
    const stage = this.doing;
    const at = this.pointAt();
    const cue = this.cueBall();
    if (!at) return;
    if (stage === 'aim' && this.ballInHand && cue && Math.hypot(at.x - cue.x, at.y - cue.y) < BALL_R * 2.2) {
      this.placing = at;
      return;
    }
    if (stage !== 'aim') return;
    this.drawing = 'mouse';
    this.drawFrom = at;
    this.drawPower = 0;
  }

  private release(e: PointerEvent) {
    if (!this.on || e.button !== 0) return;
    if (this.placing) return this.putDown();
    if (this.drawing === 'mouse') this.strike();
  }

  /** With ball in hand: the cue ball down where it's held, if it can go there. */
  private putDown() {
    const at = this.placing;
    const g = this.state?.game;
    this.placing = null;
    if (!at || !g || !canPlace(g, at.x, at.y)) return;
    // Shown where it went at once; the office says so in a moment (or puts it back).
    const cue = g.balls.find((b) => b.n === 0);
    if (cue) {
      cue.x = at.x;
      cue.y = at.y;
    }
    this.balls.follow(this.state!, undefined, true);
    this.hooks.place(at.x, at.y);
  }

  /** Let go of the cue: the shot, as hard as it's drawn back. */
  private strike() {
    const power = this.power;
    this.drawing = null;
    this.drawPower = 0;
    if (power < MIN_POWER || !this.myTurn()) return;
    this.lastPower = power;
    this.shotAt = performance.now();
    this.hooks.shoot({ angle: this.angle, power, top: this.spin.top, side: this.spin.side });
  }

  private cancel() {
    this.drawing = null;
    this.drawPower = 0;
    this.placing = null;
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.on) return;
    const mine = !isTyping(e) && !modalOpen() && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (down && mine && WALK.includes(e.code)) return this.stop();
    if (down && mine && e.code === 'KeyQ' && !e.repeat) return this.flip();
    // Esc lets go of a cue that's drawn back (or the cue ball in your hand), and otherwise steps away (your seat waits).
    if (down && mine && e.code === 'Escape') {
      e.preventDefault();
      if (this.drawing || this.placing) return this.cancel();
      return this.stop();
    }
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (down && (e.repeat || !mine)) return;
    if (down && this.doing === 'aim') {
      this.drawing = 'key';
      this.drawAt = performance.now();
    } else if (!down && this.drawing === 'key') this.strike();
  }

  /** Up over the table from your side of it, looking down at the cloth. */
  private placeCamera(dt: number) {
    this.table.toWorld(0, this.camSide * CAM_OUT, CAM_UP, want);
    this.table.toWorld(0, this.camSide * LOOK_IN, 0, target);
    const k = this.still() ? 1 : 1 - Math.exp(-dt * 5);
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
    this.camera.updateMatrixWorld();
  }
}
