import * as THREE from 'three';
import { emptyBlackjack, type BjAction, type BlackjackState } from '../shared/blackjack';
import type { PlayerController } from './player';
import { BlackjackPanel } from './ui/blackjack';
import type { BlackjackTableView } from './world/casino';
import { TableCards, type CardSpot } from './world/cards';
import { mesh, toon } from './world/toon';

// Blackjack at the casino's table. You sit down on one of its five stools (E, like any seat), and
// you're at the table in that place: the office deals you in (see server/blackjack.ts). The camera
// comes up behind your stool over the felt, the mouse is free for the panel (see ui/blackjack.ts),
// and 1–4 are Hit, Stand, Double and Split. E again does nothing, so it can't take you out of a
// round; Esc or walking off gets you up, and your seat (with your hands in a round) waits for you,
// shown as away. Only Leave in the panel gives it up. Everyone in the casino sees the cards dealt
// onto the felt, one at a time from the shoe, and the stakes in front of each seat.

/**
 * The camera at your seat: this far out behind your cards from the middle of the curve, and this high
 * over the felt, looking at a point this far toward the dealer from there, so it takes in your cards,
 * the dealer's and your neighbours'.
 */
const CAM_BACK = 0.75;
const CAM_UP = 0.85;
const LOOK_AT = { x: 0, y: -0.2 };
/** Keys that get you up off the stool. */
const GET_UP = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
/** A card's overlap in a hand: each next one this far along and this far in toward the dealer (m). */
const FAN_ALONG = 0.02;
const FAN_IN = 0.028;
/** Two hands after a split: this far apart, either side of the seat's place. */
const SPLIT_GAP = 0.09;

export interface BlackjackHooks {
  bet(amount: number): void;
  deal(): void;
  act(action: BjAction): void;
  insure(take: boolean): void;
  skip(): void;
  /** Give up your seat for good. */
  leave(): void;
  /** Get up off the stool (Esc, walking off, or after Leave). */
  getUp(): void;
}

const want = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** The chips' colours by what they're worth, biggest first (as on the panel's chips). */
const CHIP_VALUES = [
  [500, '#7b3fbf'],
  [100, '#22232e'],
  [25, '#2a9d4b'],
  [5, '#d0263a'],
  [1, '#f4f1ea'],
] as const;

/** The chips that make up `amount`, biggest first: at most `max` of them, in a stack. */
export function chipStack(amount: number, max = 12): string[] {
  const out: string[] = [];
  let left = Math.max(0, Math.floor(amount));
  for (const [v, c] of CHIP_VALUES) {
    while (left >= v && out.length < max) {
      out.push(c);
      left -= v;
    }
  }
  return out;
}

/**
 * Where each card on the table goes, in the felt's frame (x along the table, y toward the players):
 * the dealer's in a row in front of the tray, each player's fanned on their place, a split's two
 * hands side by side. A player's cards are named by the card and how many of it they've had this
 * round, so after a split the card that moves to the second hand slides there, not dealt anew.
 */
export function cardSpots(d: BlackjackState, view: Pick<BlackjackTableView, 'spots' | 'dealerSpot' | 'table'>): CardSpot[] {
  const r = d.round;
  if (!r) return [];
  const out: CardSpot[] = [];
  const n = r.dealer.length;
  // Dealt in order: each player's first card, the dealer's up card, the seconds, the hole card, then the rest.
  const first: CardSpot[] = [];
  const second: CardSpot[] = [];
  const rest: CardSpot[] = [];
  r.dealer.forEach((c, i) => {
    const s: CardSpot = { key: `d${i}`, card: c, x: view.dealerSpot.x + (i - (n - 1) / 2) * 0.06, z: view.dealerSpot.y, y: 0.0015 + i * 0.0003 };
    (i === 0 ? first : i === 1 ? second : rest).push(s);
  });
  const centre = -view.table.size.width / 2;
  for (const p of r.players) {
    const place = view.spots[p.seat];
    if (!place) continue;
    const ux = place.cards.x;
    const uy = place.cards.y - centre;
    const len = Math.hypot(ux, uy) || 1;
    const u = { x: ux / len, y: uy / len };
    const along = { x: -u.y, y: u.x };
    const rot = Math.atan2(u.x, u.y);
    const seen = new Map<string, number>();
    p.hands.forEach((h, hi) => {
      const off = p.hands.length > 1 ? (hi - 0.5) * SPLIT_GAP : 0;
      h.cards.forEach((c, i) => {
        const k = seen.get(c) ?? 0;
        seen.set(c, k + 1);
        const s: CardSpot = {
          key: `s${p.seat}:${c}:${k}`,
          card: c,
          x: place.cards.x + along.x * (off + i * FAN_ALONG) - u.x * i * FAN_IN,
          z: place.cards.y + along.y * (off + i * FAN_ALONG) - u.y * i * FAN_IN,
          rot,
          y: 0.0015 + i * 0.0003,
        };
        (p.hands.length === 1 && i === 0 ? first : p.hands.length === 1 && i === 1 ? second : rest).push(s);
      });
    });
  }
  // The dealer's up card comes after the players' first ones, the hole card after their seconds.
  const up = first.shift();
  const hole = second.shift();
  out.push(...first, ...(up ? [up] : []), ...second, ...(hole ? [hole] : []), ...rest);
  return out;
}

/**
 * Blackjack at the casino table: the cards and stakes on the felt for everyone down there, and, while
 * you sit at it, the panel and the camera.
 */
export class BlackjackPlayer {
  readonly panel: BlackjackPanel;
  private view: BlackjackTableView | null = null;
  private cards: TableCards | null = null;
  private stakes = new THREE.Group();
  private stakesShown = '';
  private state: BlackjackState = emptyBlackjack();
  private you = '';
  private balance: number | null = null;
  /** The stool you sit on (its place at the table), while you do. */
  private at: number | null = null;
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private fresh = true;
  /** Each card as it lands, and turns over (for sounds). */
  onCard?: (at: THREE.Vector3, flip: boolean) => void;

  constructor(
    private readonly player: PlayerController,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: BlackjackHooks,
  ) {
    this.panel = new BlackjackPanel({
      bet: (n) => hooks.bet(n),
      deal: () => hooks.deal(),
      act: (a) => hooks.act(a),
      insure: (y) => hooks.insure(y),
      skip: () => hooks.skip(),
      leave: () => {
        hooks.leave();
        this.stop();
        hooks.getUp();
      },
    });
  }

  /** The table to play at, once the casino's built: the cards and stakes go on its felt. */
  attach(view: BlackjackTableView) {
    if (this.view) return;
    this.view = view;
    const local = (x: number, y: number, h = 0) => view.group.worldToLocal(view.toWorld(x, y, h));
    const felt = new THREE.Group();
    const o = local(0, 0);
    const ax = local(1, 0).sub(o);
    felt.position.copy(o);
    felt.rotation.y = Math.atan2(-ax.z, ax.x);
    view.group.add(felt);
    const shoe = new THREE.Vector3(view.shoeMouth.x, 0.06, view.shoeMouth.y);
    const discard = new THREE.Vector3(view.discard.position.x, 0.12, view.discard.position.z);
    this.cards = new TableCards(shoe, discard);
    this.cards.onLand = (_, at) => this.onCard?.(at, false);
    this.cards.onFlip = (_, at) => this.onCard?.(at, true);
    felt.add(this.cards.group, this.stakes);
    this.fresh = true;
    this.show();
  }

  /** Whether you're at the table now (sitting on one of its stools). */
  get active(): boolean {
    return this.at !== null;
  }

  /** Whether your stool's place is kept for someone else who's away (so you're only watching). */
  get reserved(): string | null {
    if (this.at === null) return null;
    const s = this.state.seats.find((o) => o.seat === this.at);
    return s && s.peer !== this.you && !this.state.seats.some((o) => o.peer === this.you) ? s.name : null;
  }

  /** You sat down on the stool at place `at`: the office seats you there (or back in your own place). */
  sit(at: number) {
    if (this.at === at) return;
    this.at = at;
    const p = this.player;
    p.freeMouse = true;
    p.unlock();
    p.rig = () => this.rig();
    this.canvas.classList.add('bj-on');
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.panel.show(true);
    this.render();
  }

  /** Off the stool (the office already knows: getting up says so). */
  stop() {
    if (this.at === null) return;
    this.at = null;
    const p = this.player;
    p.rig = null;
    p.freeMouse = false;
    p.lookPitch = -0.08;
    p.camYaw = p.facing - Math.PI;
    if (p.canLock && p.enabled) p.lock();
    this.canvas.classList.remove('bj-on');
    this.panel.show(false);
  }

  /** The table as the office says: `fresh` when you've just come down (no dealing what was there already). */
  sync(state: BlackjackState, you: string, balance: number | null, fresh = false) {
    this.state = state;
    this.you = you;
    this.balance = balance;
    if (fresh) this.fresh = true;
    this.show();
    this.render();
  }

  /** Your balance changed. */
  setBalance(balance: number) {
    this.balance = balance;
    this.render();
  }

  /** 1–4 at the table (see BlackjackPanel.key). Says whether it was one of them. */
  key(code: string): boolean {
    return this.active && this.panel.key(code);
  }

  /** Every frame, after the player's: the cards on their way, the clock, and at the table the camera. */
  update(dt: number) {
    this.cards?.update(dt);
    if (!this.active) return;
    this.panel.tick(this.clockLeft(), this.state.clock);
    this.placeCamera(dt);
  }

  private render() {
    if (this.active) this.panel.render(this.state, this.you, this.balance);
  }

  /** The clock's time left now, counting down from when the office last said. */
  private said = { at: 0, left: null as number | null };
  private clockLeft(): number | null {
    return this.said.left === null ? null : Math.max(0, this.said.left - (performance.now() - this.said.at));
  }

  /** The cards and the stakes on the felt, as the table is now. */
  private show() {
    this.said = { at: performance.now(), left: this.state.left };
    const view = this.view;
    if (!view || !this.cards) return;
    this.cards.show(cardSpots(this.state, view), this.fresh);
    this.fresh = false;
    // The stakes: a stack in each seat's betting box (its bet, then its hands' stakes, then what won).
    const r = this.state.round;
    const stacks = this.state.seats.map((s) => {
      const p = r?.players.find((o) => o.id === s.id);
      const amount = !p ? s.bet : r!.phase === 'done' ? (p.paid ?? 0) : p.hands.reduce((a, h) => a + h.bet, 0);
      return { seat: s.seat, amount };
    });
    const k = JSON.stringify(stacks);
    if (k === this.stakesShown) return;
    this.stakesShown = k;
    this.stakes.clear();
    for (const { seat, amount } of stacks) {
      const place = view.spots[seat];
      if (!place || !amount) continue;
      chipStack(amount).forEach((c, i) => this.stakes.add(mesh(chipGeo(), toon(c), place.bet.x, 0.004 + i * 0.0065, place.bet.y, false)));
    }
  }

  /** At the table you stay put on your stool; walking off gets you up. */
  private rig() {
    if (!this.player.holding(...GET_UP)) return;
    this.stop();
    this.hooks.getUp();
  }

  /** The camera, behind your stool over the felt. */
  private placeCamera(dt: number) {
    const view = this.view;
    const place = this.at !== null ? view?.spots[this.at] : undefined;
    if (!view || !place) return;
    const centre = -view.table.size.width / 2;
    const ux = place.cards.x;
    const uy = place.cards.y - centre;
    const len = Math.hypot(ux, uy) || 1;
    view.toWorld(place.cards.x + (ux / len) * CAM_BACK, place.cards.y + (uy / len) * CAM_BACK, CAM_UP, want);
    view.toWorld(LOOK_AT.x, LOOK_AT.y, 0, target);
    const k = 1 - Math.exp(-dt * 5);
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
    this.camera.updateMatrixWorld();
  }
}

let chipGeometry: THREE.CylinderGeometry | null = null;
function chipGeo() {
  return (chipGeometry ??= new THREE.CylinderGeometry(0.02, 0.02, 0.006, 20));
}
