import * as THREE from 'three';
import { BETS, isBet, type SlotBet, type SlotSpin, type SlotsState } from '../shared/slots';
import type { SeatPlace } from '../shared/layout';
import { isTyping, type PlayerController } from './player';
import { modalOpen } from './ui/dom';
import { SlotsPanel } from './ui/slots';
import type { Person } from './world/character';
import type { SlotMachineView } from './world/casino';
import type { SlotScreens } from './world/slots';

// At a slot machine in the casino: sit on its stool, then E (or sitting down) plays it. The camera comes
// in over your shoulder to the machine's screen, the panel on the right picks the bet, and Space (or
// Spin, or the lever) pulls it. The office spins and pays (see server/slots.ts); everyone in the casino
// sees the reels go round (see world/slots.ts). Walking off steps away, and the machine's kept for you
// a while (after a reload too: it goes by who you are to the chips bank); Esc, or Leave, gives it up.

/** Waiting for the office to give you the machine: no answer in this long (ms), and it wasn't to be had. */
const JOIN_WAIT = 2500;
/** Waiting for the office to spin after you pulled: none in this long (ms), and it didn't. */
const ANSWER_WAIT = 1500;
/** Where this browser keeps the bet you last picked. */
const BET_KEY = 'agent-office.slots-bet';
/** Keys that walk you off the stool. */
const WALK = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
/** The camera, in the machine's own frame (x to its right, y up, +z out of its front): over your shoulder, looking at the screen. */
const CAM = new THREE.Vector3(0.32, 1.62, 1.75);
const LOOK = new THREE.Vector3(0, 1.18, 0.15);

export interface SlotterHooks {
  /** Take machine `machine`, step away from it (it's kept for you a while), or leave it for anyone. */
  join(machine: number): void;
  away(): void;
  leave(): void;
  spin(bet: SlotBet): void;
  /** Someone else has the machine (`name`, or nobody known when it's just taken). */
  taken(name: string | null): void;
  /** You're done at the machine: `stand` up off the stool too (walking off has you up already). */
  done(stand: boolean): void;
}

const want = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class Slotter {
  private on = false;
  private joining = false;
  private joinAt = 0;
  private machine = -1;
  private you = '';
  private state: SlotsState | null = null;
  private seat: SeatPlace | null = null;
  /** When you last pulled (performance.now()), until the office's spin comes back. */
  private pulledAt = 0;
  /** The spin you pulled last, once its reels have stopped. */
  private result: SlotSpin | null = null;
  /** The number of the last spin the office said your machine did. */
  private lastN: number | undefined;
  private betNow: SlotBet = savedBet();
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: SlotsPanel;

  constructor(
    private readonly player: PlayerController,
    private readonly me: Person,
    private readonly camera: THREE.PerspectiveCamera,
    /** The machines and their screens, once the casino's been built. */
    private readonly casino: () => { views: SlotMachineView[]; screens: SlotScreens } | null,
    /** Your chips, to know which bets you can make. */
    private readonly balance: () => number,
    /** Reduce motion: the camera goes straight there. */
    private readonly still: () => boolean,
    private readonly hooks: SlotterHooks,
  ) {
    this.panel = new SlotsPanel({ spin: () => this.pull(), bet: (b) => this.pickBet(b), leave: () => this.stop('leave') });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  get active(): boolean {
    return this.on;
  }

  /** The machine you're at (0-based), or -1. */
  get at(): number {
    return this.on ? this.machine : -1;
  }

  get bet(): SlotBet {
    return this.betNow;
  }

  /** Whether your machine's reels are going (or you've pulled, and the office hasn't spun yet). */
  get spinning(): boolean {
    return this.on && (!!this.pulledAt || !!this.casino()?.screens.spinning(this.machine));
  }

  /** At machine `machine`, sitting on its stool (`seat`): ask the office for it, and the camera comes in. */
  start(machine: number, seat: SeatPlace, state: SlotsState, you: string) {
    if (this.on) return;
    this.on = true;
    this.joining = true;
    this.joinAt = performance.now();
    this.machine = machine;
    this.seat = seat;
    this.you = you;
    this.state = state;
    this.pulledAt = 0;
    this.result = null;
    const p = this.player;
    // Held on the stool: Space is for the lever now, not for getting up (walking off still does, see key).
    p.rig = () => this.sitStill();
    p.freeMouse = true;
    p.unlock();
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.hooks.join(machine);
    this.panel.show(true);
    this.sync(state);
  }

  /**
   * Away from the machine. `how` you let the office know: 'away' keeps it for you a while, 'leave'
   * gives it up; null when it's the office that said it isn't yours.
   */
  stop(how: 'away' | 'leave' | null = 'away', stand = how !== 'away') {
    if (!this.on) return;
    this.on = false;
    this.joining = false;
    this.pulledAt = 0;
    const p = this.player;
    p.rig = null;
    p.freeMouse = false;
    p.lookPitch = -0.08;
    if (p.canLock && p.enabled) p.lock();
    this.panel.show(false);
    if (how === 'leave') this.hooks.leave();
    else if (how === 'away') this.hooks.away();
    this.hooks.done(stand);
  }

  /** The office's latest on the machines: whether yours is still yours. */
  sync(state: SlotsState) {
    this.state = state;
    if (!this.on) return;
    const seat = state.machines[this.machine]?.seat;
    // The office has spun (or turned it down: it'll take no other till it says).
    if (state.machines[this.machine]?.spin?.n !== this.lastN) this.pulledAt = 0;
    this.lastN = state.machines[this.machine]?.spin?.n;
    if (seat?.peer === this.you) this.joining = false;
    else if (this.joining) {
      // Somebody else is at it: no. Kept for somebody who's away: no too, unless that's you (see update).
      if (seat?.peer) {
        this.stop(null);
        this.hooks.taken(seat.name);
      }
      return;
    } else return this.stop(null);
  }

  /** Asks the office again for your machine (after a reconnect, which left it kept for you, as `you`). */
  rejoin(you: string) {
    if (!this.on) return;
    this.you = you;
    this.joining = true;
    this.joinAt = performance.now();
    this.hooks.join(this.machine);
  }

  /** The reels on machine `machine` have stopped: if it's yours, the panel says what it won. */
  stopped(machine: number, spin: SlotSpin) {
    if (this.on && machine === this.machine) this.result = spin;
  }

  /** Every frame, once the player has moved: the panel, and the camera. */
  update(dt: number) {
    if (!this.on) return;
    const now = performance.now();
    if (this.joining && now - this.joinAt > JOIN_WAIT) {
      const kept = this.state?.machines[this.machine]?.seat;
      this.stop(null);
      this.hooks.taken(kept?.name ?? null);
      return;
    }
    if (this.pulledAt && now - this.pulledAt > ANSWER_WAIT) this.pulledAt = 0;
    const spinning = this.spinning;
    if (this.state) this.panel.render(this.state, this.machine, this.betNow, this.balance(), spinning, spinning ? null : this.result);
    this.placeCamera(dt);
  }

  /** Pulls the lever at the bet picked: not while the reels go round, nor for more than you've got. */
  pull() {
    if (!this.on || this.joining || this.spinning || this.betNow > this.balance()) return;
    this.pulledAt = performance.now();
    this.result = null;
    this.me.reach();
    this.hooks.spin(this.betNow);
  }

  pickBet(b: SlotBet) {
    this.betNow = b;
    try {
      localStorage.setItem(BET_KEY, String(b));
    } catch {
      // Just for this visit, then.
    }
  }

  private sitStill() {
    const s = this.seat;
    if (!s) return;
    const p = this.player;
    p.pos.set(s.x, s.y, s.z);
    p.facing = s.rotY;
    p.moving = false;
  }

  private key(e: KeyboardEvent) {
    if (!this.on) return;
    if (isTyping(e) || modalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    // Walking off steps you away from the machine (it's kept for you a while); Esc gives it up.
    // (The step itself gets you up off the stool, as it does off any seat.)
    if (WALK.includes(e.code)) return this.stop('away');
    if (e.code === 'Escape' && !e.repeat) return this.stop('leave');
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) this.pull();
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.code === 'Equal' || e.code === 'NumpadAdd') {
      const i = BETS.indexOf(this.betNow) + (e.code === 'Minus' || e.code === 'NumpadSubtract' ? -1 : 1);
      if (i >= 0 && i < BETS.length) this.pickBet(BETS[i]);
    }
  }

  /** Over your shoulder at the machine's screen. */
  private placeCamera(dt: number) {
    const view = this.casino()?.views[this.machine];
    if (!view) return;
    view.group.updateWorldMatrix(true, false);
    want.copy(CAM).applyMatrix4(view.group.matrixWorld);
    target.copy(LOOK).applyMatrix4(view.group.matrixWorld);
    const k = this.still() ? 1 : 1 - Math.exp(-dt * 6);
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }
}

/** The bet this browser picked last time, or the smallest. */
function savedBet(): SlotBet {
  try {
    const v = Number(localStorage.getItem(BET_KEY));
    if (isBet(v)) return v;
  } catch {
    // None kept.
  }
  return BETS[0];
}
