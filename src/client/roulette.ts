import * as THREE from 'three';
import { MAX_SEATS, type RouletteBet, type RouletteState } from '../shared/roulette';
import { ROULETTE_TABLE, ROULETTE_WHEEL } from '../shared/casino';
import { isTyping, type PlayerController } from './player';
import { modalOpen } from './ui/dom';
import { RoulettePanel } from './ui/roulette';
import type { RouletteTableView } from './world/casino';
import type { RouletteWheelView } from './world/roulette';

// Roulette at the casino's table: sit down on one of its stools (E) and you're at the table. The
// mouse comes free for the betting layout at the bottom of the screen (see ui/roulette.ts), and the
// camera looks down over the felt and the wheel. Everyone's chips show on the felt in their colours
// (see world/roulette.ts). Pressing E again does nothing; getting up (walking off) keeps your place
// and any chips you have down, and sitting down again, after a reload too, puts you back in it. Only
// Esc, or Leave on the panel, takes you away from the table for good (with your chips, while bets are
// still open).

/** Waiting for the office to give you your place at the table: no answer in this long (ms), and there wasn't one. */
const JOIN_WAIT = 3000;
/**
 * The camera, in the felt's frame: up over your side of the table (from the end, lower, under the lamp
 * over it), pulled back a little behind your place, looking at the middle of what you play with (the
 * wheel and the layout), and further back along that line until all of it is in the strip of screen
 * between the hint at the top and the panel at the bottom.
 */
const CAM_UP = 1.75;
const CAM_UP_END = 1.15;
const CAM_BACK = 0.35;
/** How far toward your stool along the table the camera is, from straight across the middle (0) to over your stool (1). */
const CAM_ALONG = 0.35;
/** The middle of the wheel and the layout together, along the table. */
const LOOK_X = -0.07;
/** How far round the wheel's rim, how high, has to be in the picture: its whole bowl. */
const RIM = ROULETTE_WHEEL.r + 0.06;

export interface RoulettePlayerHooks {
  join(): void;
  away(): void;
  leave(): void;
  bet(spot: string, amount: number): void;
  unbet(spot?: string): void;
  /** The table was full. */
  full(): void;
  /** You're off the table: stand up, if you're still sitting. */
  done(): void;
  /** Your balance, as the office last said. */
  balance(): number;
}

const lookAt = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const eye = new THREE.Vector3();
const p = new THREE.Vector3();
const croupier = new THREE.Vector3();

export class RoulettePlayer {
  private on = false;
  private joining = false;
  private joinAt = 0;
  private you = '';
  /** Which stool you're on (0-based), for the camera. */
  private stool = 0;
  private state: RouletteState | null = null;
  private stateAt = 0;
  /** Your bets in the last round that was spun, to put down again (Rebet), and which round that was. */
  private lastBets: Omit<RouletteBet, 'seat'>[] = [];
  private lastRound = -1;
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  /** Where the camera's going, and what it looks at, for the stool and the screen it was worked out for. */
  private wantPos = new THREE.Vector3();
  private wantAim = new THREE.Vector3();
  private fitFor = '';
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly panel: RoulettePanel;

  constructor(
    private readonly player: PlayerController,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly table: () => RouletteTableView | null,
    private readonly wheel: () => RouletteWheelView | null,
    /** Reduce motion: the camera goes straight there. */
    private readonly still: () => boolean,
    private readonly hooks: RoulettePlayerHooks,
  ) {
    this.panel = new RoulettePanel({
      bet: (spot, amount) => this.bet(spot, amount),
      unbet: (spot) => hooks.unbet(spot),
      rebet: () => this.rebet(),
      leave: () => this.stop('leave'),
    });
    window.addEventListener('keydown', (e) => {
      if (!this.on || e.code !== 'Escape' || e.repeat || isTyping(e) || modalOpen()) return;
      e.preventDefault();
      this.stop('leave');
    });
  }

  get active(): boolean {
    return this.on;
  }

  /** Sitting on stool `stool` (0-based) at the table: ask the office for your place, and the camera over the felt. */
  start(state: RouletteState, at: number, you: string, stool: number) {
    if (this.on) return;
    this.on = true;
    this.joining = true;
    this.joinAt = performance.now();
    this.you = you;
    this.stool = stool;
    const p = this.player;
    // The mouse is for the layout now: let go of it.
    p.freeMouse = true;
    p.unlock();
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.hooks.join();
    this.panel.show(true);
    this.sync(state, at);
  }

  /**
   * Away from the table. `how` you let the office know: 'away' keeps your place and your chips on the
   * layout, 'leave' gives them up (your chips back while bets are open); null when it's the office
   * that let you go.
   */
  stop(how: 'away' | 'leave' | null = 'away') {
    if (!this.on) return;
    this.on = false;
    this.joining = false;
    const p = this.player;
    p.freeMouse = false;
    p.lookPitch = -0.08;
    if (p.canLock && p.enabled) p.lock();
    this.panel.show(false);
    this.camera.clearViewOffset();
    this.fitFor = '';
    const view = this.table();
    if (view) view.dealer.root.visible = true;
    if (how === 'leave') this.hooks.leave();
    else if (how === 'away') this.hooks.away();
    this.hooks.done();
  }

  /** The office's latest on the table, which came at `at` (performance.now()). */
  sync(state: RouletteState, at: number) {
    this.state = state;
    this.stateAt = at;
    // Remember your bets of a round once they can't change any more, for Rebet.
    const seat = state.seats.find((s) => s.peer === this.you);
    if (seat && state.phase === 'spinning' && state.round !== this.lastRound) {
      const mine = state.bets.filter((b) => b.seat === seat.id).map(({ spot, amount }) => ({ spot, amount }));
      if (mine.length) {
        this.lastBets = mine;
        this.lastRound = state.round;
      }
    }
    if (!this.on) return;
    if (seat) this.joining = false;
    else if (this.joining) {
      // Somebody else's news can come before the office has had your ask: only a full table is a no.
      if (state.seats.length >= MAX_SEATS && state.seats.every((s) => s.peer)) {
        this.stop(null);
        this.hooks.full();
        return;
      }
    } else return this.stop(null);
    this.render();
  }

  /** Asks the office again for your place (after a reconnect, which left it away, and comes back as `you`). */
  rejoin(you: string) {
    if (!this.on) return;
    this.you = you;
    this.joining = true;
    this.joinAt = performance.now();
    this.hooks.join();
  }

  /**
   * Whether someone at `pos` is between the camera and the table (sitting next to you, say), or stands
   * between it and the wheel (the croupier, from the croupier's side): they're hidden while you're at it.
   */
  inTheWay(pos: THREE.Vector3): boolean {
    if (!this.on) return false;
    const c = this.camera.position;
    if (Math.hypot(pos.x - c.x, pos.z - c.z) < 1.1) return true;
    const view = this.table();
    if (!view) return false;
    // How far off the line (on the floor) from the camera to the wheel they are, if they're along it.
    const w = view.toWorld(ROULETTE_WHEEL.x, ROULETTE_WHEEL.z, 0, p);
    const dx = w.x - c.x;
    const dz = w.z - c.z;
    const k = ((pos.x - c.x) * dx + (pos.z - c.z) * dz) / (dx * dx + dz * dz);
    return k > 0 && k < 1 && Math.hypot(pos.x - c.x - dx * k, pos.z - c.z - dz * k) < 0.8;
  }

  /** Every frame, once the player has moved: the clock, the panel and the camera. */
  update(dt: number) {
    if (!this.on) return;
    if (this.joining && performance.now() - this.joinAt > JOIN_WAIT) {
      this.stop(null);
      this.hooks.full();
      return;
    }
    this.render();
    this.placeCamera(dt);
    const view = this.table();
    if (view) view.dealer.root.visible = !this.inTheWay(view.dealer.root.getWorldPosition(croupier));
  }

  /** How long the phase has left (s), counting down from the office's news. */
  private left(): number {
    const s = this.state;
    if (!s) return 0;
    return Math.max(0, (s.left - (performance.now() - this.stateAt)) / 1000);
  }

  private render() {
    const s = this.state;
    if (!s) return;
    this.panel.render(s, {
      you: this.you,
      balance: this.hooks.balance(),
      left: this.left(),
      settled: this.wheel()?.settled ?? s.phase === 'result',
      canRebet: this.lastBets.length > 0 && !s.bets.some((b) => s.seats.find((x) => x.id === b.seat)?.peer === this.you),
    });
  }

  private bet(spot: string, amount: number) {
    const s = this.state;
    if (!s || (s.phase !== 'idle' && s.phase !== 'betting')) return;
    if (amount > this.hooks.balance()) return;
    this.hooks.bet(spot, amount);
  }

  /** Last round's bets again, as far as your balance goes. */
  private rebet() {
    let left = this.hooks.balance();
    for (const b of this.lastBets) {
      if (b.amount > left) break;
      left -= b.amount;
      this.hooks.bet(b.spot, b.amount);
    }
  }

  /** Over the felt from your place, looking down at the layout and the wheel, all of it between the hint and the panel. */
  private placeCamera(dt: number) {
    const view = this.table();
    if (!view) return;
    // The free strip of screen: under the hint (up top while you're at the table), over the panel.
    const W = window.innerWidth;
    const H = window.innerHeight;
    const hint = document.getElementById('hint');
    const hr = hint && !hint.classList.contains('hidden') ? hint.getBoundingClientRect() : null;
    const top = hr && hr.bottom < H / 2 ? hr.bottom + 6 : 8;
    const bottom = Math.max(top + H * 0.3, this.panel.el.getBoundingClientRect().top - 6);
    const key = `${this.stool} ${W} ${H} ${Math.round(top)} ${Math.round(bottom)}`;
    if (key !== this.fitFor) {
      this.fitFor = key;
      // The middle of the picture goes in the middle of that strip.
      this.camera.setViewOffset(W, H, 0, Math.round(H / 2 - (top + bottom) / 2), W, H);
      this.fit(view, 1 - (2 * top) / H, 1 - (2 * bottom) / H);
    }
    const k = this.still() ? 1 : 1 - Math.exp(-dt * 5);
    this.camPos.lerp(this.wantPos, k);
    lookAt.lookAt(this.camPos, this.wantAim, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }

  /**
   * Where the camera goes from your stool: from over your place, back along the line to the middle of
   * the table until the wheel's bowl and the layout fit across the screen and between `yTop` and
   * `yBottom` (the free strip, in the picture's -1..1).
   */
  private fit(view: RouletteTableView, yTop: number, yBottom: number) {
    const seat = ROULETTE_TABLE.seats[this.stool] ?? ROULETTE_TABLE.seats[0];
    // Which side of the table you're on: the players' (+y), the croupier's (-y), or its end (+x).
    const side = seat.z > 0.5 ? 1 : seat.z < -0.5 ? -1 : 0;
    if (side) view.toWorld(LOOK_X + (seat.x - LOOK_X) * CAM_ALONG, side * (Math.abs(seat.z) + CAM_BACK), CAM_UP, eye);
    else view.toWorld(seat.x + CAM_BACK, 0, CAM_UP_END, eye);
    view.toWorld(LOOK_X, 0, 0, this.wantAim);
    // What has to be in the picture: round the wheel's rim, and the layout's ends and corners.
    const show: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      show.push(view.toWorld(ROULETTE_WHEEL.x + Math.cos(a) * RIM, ROULETTE_WHEEL.z + Math.sin(a) * RIM, ROULETTE_WHEEL.rim));
    }
    for (const s of [view.numberSpot(0), view.numberSpot(3), view.numberSpot(1), view.betSpot('column3'), view.betSpot('column1'), view.betSpot('low'), view.betSpot('high')]) show.push(view.toWorld(s.x, s.y));
    const probe = this.probe;
    probe.copy(this.camera);
    for (let s = 1; s <= 2.6; s += 0.05) {
      probe.position.copy(eye).sub(this.wantAim).multiplyScalar(s).add(this.wantAim);
      probe.lookAt(this.wantAim);
      probe.updateMatrixWorld();
      this.wantPos.copy(probe.position);
      if (show.every((q) => (p.copy(q).project(probe), Math.abs(p.x) < 0.94 && p.y < yTop - 0.02 && p.y > yBottom + 0.02))) break;
    }
  }
}
