import * as THREE from 'three';
import { MAX_SEATS, type RouletteBet, type RouletteState } from '../shared/roulette';
import { ROULETTE_TABLE } from '../shared/casino';
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
 * The camera, in the felt's frame: up over your place, pulled back a little behind it, looking at a
 * point on your side of the layout, so the whole table (the wheel, the layout, everyone's chips) is in
 * the top of the screen over the panel.
 */
const CAM_UP = 1.75;
const CAM_BACK = 0.35;
const LOOK_AT = { x: 0.15, y: 0.42 };

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
const want = new THREE.Vector3();
const target = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

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

  /** Whether someone at `pos` is between the camera and the table (sitting next to you, say): they're hidden while you're at it. */
  inTheWay(pos: THREE.Vector3): boolean {
    return this.on && Math.hypot(pos.x - this.camera.position.x, pos.z - this.camera.position.z) < 1.1;
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

  /** Over the felt from your place, looking down at the layout and the wheel. */
  private placeCamera(dt: number) {
    const view = this.table();
    if (!view) return;
    const seat = ROULETTE_TABLE.seats[this.stool] ?? ROULETTE_TABLE.seats[0];
    // Which side of the table you're on: the players' (+y), the croupier's (-y), or its end (+x).
    const side = seat.z > 0.5 ? 1 : seat.z < -0.5 ? -1 : 0;
    if (side) {
      view.toWorld(Math.max(-0.3, Math.min(seat.x, 1)), side * (Math.abs(seat.z) + CAM_BACK), CAM_UP, want);
      view.toWorld(LOOK_AT.x, side * LOOK_AT.y, 0, target);
    } else {
      view.toWorld(seat.x + CAM_BACK, 0, CAM_UP, want);
      view.toWorld(1.0, 0, 0, target);
    }
    const k = this.still() ? 1 : 1 - Math.exp(-dt * 5);
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }
}

