import * as THREE from 'three';
import { BALCONY } from '../shared/layout';
import { isTyping, type PlayerController } from './player';
import { t } from './i18n';
import { $, h, modalOpen } from './ui/dom';
import { IMPACT, type Person } from './world/character';
import { STANCE, pinText } from './world/golf';
import { CUP, CUP_DISTANCE, newPuttRound, puttLanded, puttRoundFromJson, puttRoundText, puttStroke, type Putt, type PuttRound, type Roll } from './world/minigolf';

// Putting in the bunker's smokers' room (world/minigolf.ts), where golf off the balcony is on an
// office floor: E at the tee (golf.ts's Golfer hands it to this while the bunker's on). The same
// controls as off the balcony, without the loft: the mouse (or A and D) aims, holding Space runs the
// power meter up and down, let go to putt. The ball's played where it lies until it drops, counting
// strokes; the camera stays low behind the ball, and watches it roll from there. Esc (or Leave)
// puts the putter back. Your round (strokes, where your ball lies) is kept across a reload.

/** The power meter runs from nothing to full in this long, then back down again. */
const METER = 1.3;
/** A and D (and the arrow keys) turn the aim this fast, in radians a second. */
const TURN = 0.3;
/** How far off line (radians) and off the power meter (a fraction of it) a putt can come off the putter, either way in all. */
const MISHIT_AIM = THREE.MathUtils.degToRad(1);
const MISHIT_POWER = 0.02;
/** One putt at a time, this far apart (ms), as the office takes them. */
const BETWEEN_PUTTS = 1000;
/** Let go with the meter under this and it's a practice stroke. */
const MIN_POWER = 0.02;
/** How long the camera stays on a ball that's stopped, or dropped. */
const LINGER = 1.4;
const LINGER_HOLED = 3;
/** The putting stroke is the golf swing, smaller. */
const BACKSWING = 0.35;
/** Behind the ball: back along the line, out to the side away from you, and up. */
const BACK = 1.5;
const SIDE = 0.3;
const UP = 1.05;
/** The camera stays this far inside the room's walls. */
const ROOM = { minX: BALCONY.minX + 0.15, maxX: BALCONY.maxX - 0.15, minZ: BALCONY.minZ + 0.15, maxZ: BALCONY.maxZ - 0.1 } as const;

export type PuttStage = 'aim' | 'charge' | 'swing' | 'watch';

export interface PutterHooks {
  /** At the tee with a putter, or put it back: everyone else sees it. */
  holding(on: boolean): void;
  /** You putted: off it goes, here and for everyone else. */
  hit(putt: Putt): void;
  /** Your ball rolling, or where it stopped (`still` seconds ago). */
  ball(): { at: THREE.Vector3; roll: Roll; still: number } | null;
  /** The putter's back. */
  done(): void;
}

const lookAt = new THREE.Matrix4();
const want = new THREE.Vector3();
const target = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** Your round, kept in this browser (see PuttRound). */
const ROUND_KEY = 'agent-office.minigolf.round';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Which way from (x, z) the cup is. */
export const toCup = (at: { x: number; z: number }) => Math.atan2(CUP.x - at.x, CUP.z - at.z);

export class Putter {
  private stage: PuttStage | null = null;
  /** Which way you aim (a heading: 0 is south, +z, turning toward +x). */
  aim = 0;
  private chargeAt = 0;
  private lastPower = -1;
  private putt: Putt | null = null;
  private swingT = 0;
  private hitAt = -Infinity;
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: HTMLElement;
  private readonly rest: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly info: HTMLElement;
  private readonly score: HTMLElement;
  private shown = '';
  private scored = '';
  private round: PuttRound;

  constructor(
    private readonly player: PlayerController,
    private readonly me: Person,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly hooks: PutterHooks,
  ) {
    this.rest = h('span.golf-rest');
    this.mark = h('span.golf-last');
    this.info = h('div.golf-info');
    this.score = h('div.golf-score');
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(ROUND_KEY);
    } catch {
      // private window: a fresh round
    }
    this.round = puttRoundFromJson(stored);
    const button = (cls: string, text: string, click: () => void) => {
      const b = h(`button.btn${cls}`, { type: 'button' }, text);
      // Never focused, or Space (which putts) would press it again.
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        b.blur();
        click();
      });
      return b;
    };
    this.panel = h(
      'div.golf.panel.hidden',
      { id: 'minigolf', 'aria-label': 'Mini golf' },
      h('div.golf-title', {}, t('main.minigolfHole', { distance: pinText(CUP_DISTANCE) })),
      this.score,
      h('div.golf-meter', {}, this.rest, this.mark),
      this.info,
      h('div.golf-actions', {}, button('.golf-new', t('main.golfNewRound'), () => this.newRound()), button('.golf-leave', t('main.golfLeave'), () => this.stop())),
    );
    $('hud').append(this.panel);
    window.addEventListener('keydown', (e) => this.escape(e));
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.stage === 'charge' && this.putBack());
  }

  get active(): boolean {
    return this.stage !== null;
  }

  get doing(): PuttStage | null {
    return this.stage;
  }

  get power(): number {
    if (this.stage !== 'charge') return 0;
    const p = ((performance.now() - this.chargeAt) / 1000 / METER) % 2;
    return p > 1 ? 2 - p : p;
  }

  get card(): Readonly<PuttRound> {
    return this.round;
  }

  /** Where your next putt's from: where your ball lies, or the tee once it's in. */
  get lie(): { x: number; z: number } {
    return this.round.holed ? newPuttRound().lie : this.round.lie;
  }

  /** Up to your ball with a putter, aimed at the cup. */
  start(): void {
    if (this.stage) return;
    this.stage = 'aim';
    this.aim = toCup(this.lie);
    const p = this.player;
    p.rig = () => this.stand();
    this.stand();
    p.camYaw = this.aim + Math.PI;
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.me.setGolf(true);
    this.hooks.holding(true);
    this.panel.classList.remove('hidden');
    this.shown = '';
    this.scored = '';
  }

  stop(): void {
    if (!this.stage) return;
    this.stage = null;
    this.putt = null;
    this.keep();
    const p = this.player;
    p.rig = null;
    p.lookPitch = -0.08;
    if (p.view === 'third') p.camYaw = p.facing + Math.PI;
    this.me.setGolf(false);
    this.hooks.holding(false);
    this.panel.classList.add('hidden');
    this.hooks.done();
  }

  update(dt: number): void {
    if (!this.stage) return;
    const p = this.player;
    if (this.stage === 'aim' || this.stage === 'charge') {
      let aim = wrap(p.camYaw - Math.PI);
      if (p.holding('KeyA', 'ArrowLeft')) aim += TURN * dt;
      if (p.holding('KeyD', 'ArrowRight')) aim -= TURN * dt;
      this.aim = wrap(aim);
    }
    p.camYaw = this.aim + Math.PI;
    if (this.stage === 'charge') this.me.golfBack(this.power * BACKSWING);
    if (this.stage === 'swing') {
      this.swingT += dt;
      if (this.swingT >= IMPACT && this.putt) {
        this.hitAt = performance.now();
        this.round = puttStroke(this.round);
        this.keep();
        this.hooks.hit(this.putt);
        this.putt = null;
        this.stage = 'watch';
      }
    }
    if (this.stage === 'watch') {
      const b = this.hooks.ball();
      if (!b || b.still > (b.roll.holed ? LINGER_HOLED : LINGER)) this.backToBall();
    }
    this.placeCamera(dt);
    this.render();
  }

  /** Your ball stopped, or dropped. */
  landed(roll: Roll): void {
    this.round = puttLanded(this.round, roll);
    this.keep();
  }

  /** Back to the tee, counting from nothing. */
  newRound(): void {
    this.round = newPuttRound(this.round.best);
    this.lastPower = -1;
    this.keep();
    if (this.stage === 'aim') {
      this.aim = toCup(this.lie);
      this.stand();
    }
  }

  private keep() {
    try {
      localStorage.setItem(ROUND_KEY, JSON.stringify(this.round));
    } catch {
      // private window: it's only for this visit then
    }
  }

  private escape(e: KeyboardEvent) {
    if (!this.stage || e.code !== 'Escape' || e.repeat || isTyping(e) || modalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (this.stage === 'charge') return this.putBack();
    this.stop();
  }

  /** Square to the line, over the ball where it lies. */
  private stand() {
    const { x, z } = this.lie;
    const p = this.player;
    p.pos.set(x + Math.cos(this.aim) * STANCE, 0, z - Math.sin(this.aim) * STANCE);
    p.facing = this.aim - Math.PI / 2;
    p.moving = false;
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.stage || e.code !== 'Space') return;
    if (down && (e.repeat || isTyping(e) || modalOpen() || e.metaKey || e.ctrlKey || e.altKey)) return;
    if (down && this.stage === 'aim') {
      if (performance.now() - this.hitAt < BETWEEN_PUTTS) return;
      this.stage = 'charge';
      this.chargeAt = performance.now();
    } else if (down && this.stage === 'watch') this.backToBall();
    else if (!down && this.stage === 'charge') {
      const power = this.power;
      if (power < MIN_POWER) return this.putBack();
      const yaw = this.aim + (Math.random() - 0.5) * MISHIT_AIM;
      this.putt = { yaw, power: Math.min(1, power * (1 + (Math.random() - 0.5) * MISHIT_POWER)), from: { ...this.lie } };
      this.lastPower = power;
      this.stage = 'swing';
      this.swingT = 0;
      this.me.golfHit();
    }
  }

  private putBack() {
    this.stage = 'aim';
    this.me.golfBack(0);
  }

  /** Over to where the ball stopped (or the tee, once it's in), aimed at the cup again. */
  private backToBall() {
    this.stage = 'aim';
    this.aim = toCup(this.lie);
    this.player.camYaw = this.aim + Math.PI;
    this.stand();
  }

  private placeCamera(dt: number) {
    const b = this.stage === 'watch' ? this.hooks.ball() : null;
    const from = b ? b.roll.putt.from : this.lie;
    const yaw = b ? b.roll.putt.yaw : this.aim;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // Low behind the ball, looking down the line; watching, up a little higher, following the ball.
    want.set(from.x - sin * BACK - cos * SIDE, UP + (b ? 0.45 : 0), from.z - cos * BACK + sin * SIDE);
    want.x = THREE.MathUtils.clamp(want.x, ROOM.minX, ROOM.maxX);
    want.z = THREE.MathUtils.clamp(want.z, ROOM.minZ, ROOM.maxZ);
    if (b) target.copy(b.at);
    else target.set(from.x + sin * 1.6, 0, from.z + cos * 1.6);
    const k = 1 - Math.exp(-dt * 6);
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP_AXIS);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }

  private render() {
    const power = this.stage === 'charge' ? this.power : this.stage === 'aim' ? 0 : this.lastPower;
    this.rest.style.width = `${(1 - Math.max(0, power)) * 100}%`;
    this.mark.style.left = `${this.lastPower * 100}%`;
    this.mark.classList.toggle('hidden', this.lastPower < 0);
    const off = THREE.MathUtils.radToDeg(wrap(this.aim - toCup(this.lie)));
    const n = Math.abs(off).toFixed(0);
    const aim = Math.abs(off) < 0.5 ? t('main.golfAtPin') : t(off > 0 ? 'main.golfLeft' : 'main.golfRight', { n });
    const text = t('main.minigolfAim', { aim });
    if (text !== this.shown) {
      this.shown = text;
      this.info.textContent = text;
    }
    const score = puttRoundText(this.round);
    if (score === this.scored) return;
    this.scored = score;
    this.score.textContent = score;
  }
}
