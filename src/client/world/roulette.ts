import * as THREE from 'three';
import { DENOMINATIONS, SPIN_TIME, colorOf, spotOf, spotPlace, type RouletteState, type Spot } from '../../shared/roulette';
import type { RouletteBet, RouletteTableView } from './casino';
import { toon } from './toon';

// The roulette table as everyone in the casino sees it: the wheel turning, the ball sent round it and
// dropping into the pocket the office picked, everyone's chips on the layout in their colours, the
// winning number and the winning chips lit up, and a board by the wheel with the last numbers. All
// of it follows the office's news (see shared/roulette.ts); nothing here decides anything.

/** How fast the wheel turns on its own between spins (rad/s), and how much faster when it's just been spun. */
const IDLE_SPIN = 0.45;
const SPUN = 2.4;
/** How quickly that extra speed dies away (s). */
const SPIN_DECAY = 3.2;
/** The ball has dropped into its pocket by this far into the spin. */
export const LAND = 0.93;
/** It runs on the track until this far in, then spirals down over the deflectors and frets. */
const DROP = 0.64;
/** How many times round the ball goes, relative to the wheel, before it's in its pocket. */
const LAPS = 7;

/**
 * Where the ball is, `e` ms into a spin of SPIN_TIME: `behind` how far (radians) it still has to go
 * round, against the wheel, to its pocket (0 once it's in), and `down` how far it's come down from
 * the track to the pockets (0 on the track, 1 in its pocket), with `hop` a little bounce on the way.
 * It slows smoothly to a stop in the pocket: `behind` falls off as the square of the time left.
 */
export function ballPath(e: number): { behind: number; down: number; hop: number } {
  const land = SPIN_TIME * LAND;
  const k = Math.min(1, Math.max(0, e / land));
  const behind = LAPS * Math.PI * 2 * (1 - k) * (1 - k);
  const drop = SPIN_TIME * DROP;
  const down = e <= drop ? 0 : Math.min(1, (e - drop) / (land - drop));
  // A few hops over the frets as it comes down, smaller each time.
  const hop = down > 0 && down < 1 ? Math.abs(Math.sin(down * Math.PI * 4)) * (1 - down) * 0.02 : 0;
  return { behind, down, hop };
}

/** The wheel's own extra speed `e` ms after it was spun (rad/s). */
export function rotorSpeed(e: number): number {
  return IDLE_SPIN + (e >= 0 && e < SPIN_TIME * 2 ? SPUN * Math.exp(-e / 1000 / SPIN_DECAY) : 0);
}

/** The chips a stack of `amount` is made of, biggest first: how it's drawn (DENOMINATIONS, at most `max` of them). */
export function chipStack(amount: number, max = 12): number[] {
  const out: number[] = [];
  let left = amount;
  for (let i = DENOMINATIONS.length - 1; i >= 0 && out.length < max; i--) {
    const d = DENOMINATIONS[i];
    while (left >= d && out.length < max) {
      out.push(d);
      left -= d;
    }
  }
  return out;
}

/** A chip's colour by its value, as on the panel. */
export const CHIP_FACE: Record<number, string> = { 1: '#f4f1ea', 5: '#d62839', 25: '#16a34a', 100: '#111827', 500: '#7c3aed' };

const CHIP_R = 0.025;
const CHIP_H = 0.006;
const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 18);
const edgeGeo = new THREE.TorusGeometry(CHIP_R * 0.98, 0.0016, 4, 18).rotateX(Math.PI / 2);
const materials = new Map<string, THREE.Material>();
const mat = (color: string) => {
  let m = materials.get(color);
  if (!m) materials.set(color, (m = toon(color)));
  return m;
};

/** Where a spot's chips go on the felt (felt meters, see RouletteTableView): on its number, line or corner, or in its box. */
export function feltSpot(view: Pick<RouletteTableView, 'numberSpot' | 'betSpot' | 'cell'>, spot: Spot): { x: number; y: number } {
  const p = spotPlace(spot);
  if (p) {
    // The numbers' units: u along the table from the first street, v across it from the top row (3, 6 … 36).
    const one = view.numberSpot(3);
    return { x: one.x + (p.u - 0.5) * view.cell.x, y: one.y + (p.v - 0.5) * view.cell.y };
  }
  if (spot.kind === 'straight') return view.numberSpot(0);
  return view.betSpot(spot.id.replace(':', '') as RouletteBet);
}

/** A board on a stand by the wheel: the last numbers, newest at the top, in their colours. */
function historyBoard(): { group: THREE.Group; draw(history: readonly number[]): void } {
  const W = 0.26;
  const H = 0.5;
  const canvas = document.createElement('canvas');
  canvas.width = 208;
  canvas.height = 400;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.42, 10), toon('#d4a84b'));
  pole.position.y = 0.21;
  group.add(pole);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, H + 0.03, 0.03), toon('#14101a'));
  frame.position.y = 0.42 + H / 2;
  group.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.set(0, 0.42 + H / 2, 0.0151);
  group.add(screen);
  let shown = '';
  const draw = (history: readonly number[]) => {
    const k = history.join(',');
    if (k === shown) return;
    shown = k;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#0b0a10';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.textBaseline = 'middle';
    c.font = '800 22px Nunito, ui-rounded, system-ui, sans-serif';
    c.fillStyle = '#d4a84b';
    c.textAlign = 'center';
    c.fillText('ROULETTE', canvas.width / 2, 22);
    // Red numbers to the left, black to the right, the zero in the middle: how a casino's board shows them.
    history.slice(0, 10).forEach((n, i) => {
      const y = 62 + i * 34;
      const col = colorOf(n);
      const x = col === 'red' ? 52 : col === 'black' ? canvas.width - 52 : canvas.width / 2;
      c.font = `900 ${i === 0 ? 34 : 26}px Nunito, ui-rounded, system-ui, sans-serif`;
      c.fillStyle = col === 'red' ? '#ff4d5a' : col === 'black' ? '#f4f1ea' : '#38d97a';
      c.fillText(String(n), x, y);
    });
    tex.needsUpdate = true;
  };
  draw([]);
  return { group, draw };
}

/**
 * The roulette table brought to life, for everyone in the casino: call `follow` with each piece of
 * news of the table (and `at`, when it came: performance.now()), and `update` every frame.
 */
export class RouletteWheelView {
  /** The chips on the layout, and the lights on the winners: on the felt. */
  private readonly chips = new THREE.Group();
  private readonly glow: THREE.Mesh;
  private readonly board: ReturnType<typeof historyBoard>;
  private state: RouletteState | null = null;
  /** When the spin of the round we're showing started (performance.now()), and which round that is. */
  private spunAt = 0;
  private round = -1;
  private landed = false;
  /** When the ball dropped into its pocket in the spin we're showing (performance.now()), or 0 if we didn't see it. */
  private landedAt = 0;
  private shownChips = '';
  private readonly glowMat: THREE.MeshBasicMaterial;
  /** The ball has been sent round (`seconds` to go), it dropped into its pocket, or you won. */
  onSpin: ((seconds: number) => void) | null = null;
  onDrop: ((n: number) => void) | null = null;

  constructor(private readonly view: RouletteTableView) {
    const top = view.wheel.bowl.parent!;
    top.add(this.chips);
    this.glowMat = new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.45, depthWrite: false });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.glowMat);
    this.glow.visible = false;
    this.glow.renderOrder = 2;
    top.add(this.glow);
    this.board = historyBoard();
    // By the wheel, on the croupier's side, facing the players.
    this.board.group.position.set(view.dealerSpot.x - 0.42, 0, -view.table.size.width / 2 + 0.2);
    top.add(this.board.group);
  }

  /** The point in the world where the wheel is (for sounds). */
  get where(): THREE.Vector3 {
    return this.view.toWorld(this.view.dealerSpot.x, this.view.dealerSpot.y, 0.1);
  }

  /** The office's latest on the table, which came at `at` (performance.now()). */
  follow(s: RouletteState, at: number) {
    const fresh = s.round !== this.round;
    this.state = s;
    if (s.phase === 'spinning' && (fresh || !this.spunAt)) {
      this.round = s.round;
      this.spunAt = at - (SPIN_TIME - s.left);
      this.landed = false;
      this.landedAt = 0;
      const e = SPIN_TIME - s.left;
      if (e < SPIN_TIME * LAND) this.onSpin?.((SPIN_TIME * LAND - e) / 1000);
    } else if (s.phase === 'result' && fresh) {
      // Only just come in: the ball's already in its pocket.
      this.round = s.round;
      this.spunAt = at - SPIN_TIME * 2;
      this.landed = true;
      this.landedAt = 0;
    } else if (s.phase === 'betting' || s.phase === 'idle') {
      if (fresh) this.round = s.round;
      this.spunAt = 0;
    }
    this.board.draw(s.history);
    this.drawChips();
  }

  /** Whether the ball's in its pocket (so the winning number can be shown). */
  get settled(): boolean {
    const s = this.state;
    return !!s && s.number !== null && (s.phase === 'result' || (s.phase === 'spinning' && this.landed));
  }

  /** Whether the ball's going round, or dropped into its pocket less than `hold` ms ago (and we saw it): while the window over the wheel is up. */
  spinShowing(hold: number, now = performance.now()): boolean {
    return !!this.spunAt && (!this.landed || (this.landedAt > 0 && now - this.landedAt < hold));
  }

  /** The number the ball's going to (or did) land on, this spin. */
  get number(): number | null {
    return this.state?.number ?? null;
  }

  update(dt: number, now = performance.now()) {
    const w = this.view.wheel;
    const s = this.state;
    const e = this.spunAt ? now - this.spunAt : -1;
    w.rotor.rotation.y += rotorSpeed(e) * dt;
    // Between spins the ball lies where it last landed, going round with the wheel.
    const n = s?.number ?? s?.history[0];
    if (s && n !== undefined && n !== null) {
      const p = this.spunAt && s.number !== null ? ballPath(e) : { behind: 0, down: 1, hop: 0 };
      const r = w.radii.track + (w.radii.pockets - w.radii.track) * p.down;
      const h = w.heights.track + (w.heights.pocket - w.heights.track) * p.down + p.hop;
      // Round the other way from the wheel, catching up with its pocket as it slows.
      w.ballAt(w.rotor.rotation.y + w.pocketAngle(n) + p.behind, r, h);
      w.ball.visible = true;
      if (this.spunAt && !this.landed && p.down >= 1) {
        this.landed = true;
        this.landedAt = now;
        this.onDrop?.(n);
        this.drawChips();
      }
    } else w.ball.visible = false;
    if (this.glow.visible) this.glowMat.opacity = 0.3 + 0.2 * Math.sin(now / 160);
  }

  /** Everyone's chips on the layout, a stack per player per spot (a little apart where several share one), and once the ball's in, the winners lit. */
  private drawChips() {
    const s = this.state;
    if (!s) return;
    const settled = this.settled;
    const k = JSON.stringify([s.bets, s.seats.map((x) => x.color), settled && s.number]);
    if (k === this.shownChips) return;
    this.shownChips = k;
    this.chips.clear();
    const colorOfSeat = new Map(s.seats.map((x) => [x.id, x.color]));
    const seatOrder = new Map(s.seats.map((x, i) => [x.id, i]));
    const bySpot = new Map<string, number>();
    for (const b of s.bets) {
      const spot = spotOf(b.spot);
      if (!spot) continue;
      const nth = bySpot.get(b.spot) ?? 0;
      bySpot.set(b.spot, nth + 1);
      const at = feltSpot(this.view, spot);
      const won = settled && spot.numbers.includes(s.number!);
      const lost = settled && !won;
      const stack = new THREE.Group();
      stack.position.set(at.x + nth * 0.012, 0.0005, at.y - nth * 0.012);
      const color = colorOfSeat.get(b.seat) ?? '#cccccc';
      chipStack(b.amount).forEach((d, i) => {
        // The player's colour, with an edge in the chip's value colour.
        const c = new THREE.Mesh(chipGeo, mat(color));
        c.position.y = CHIP_H / 2 + i * CHIP_H;
        stack.add(c);
        const edge = new THREE.Mesh(edgeGeo, mat(CHIP_FACE[d]));
        edge.position.y = c.position.y + CHIP_H / 2;
        stack.add(edge);
      });
      if (won) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(CHIP_R * 1.15, CHIP_R * 1.6, 20).rotateX(-Math.PI / 2), this.glowMat);
        ring.position.y = 0.001;
        stack.add(ring);
      }
      // Losing chips go flat and grey, about to be swept off.
      if (lost) stack.scale.y = 0.5;
      stack.userData.seat = seatOrder.get(b.seat);
      this.chips.add(stack);
    }
    // The winning number's box, lit.
    this.glow.visible = settled;
    if (settled) {
      const n = s.number!;
      const p = this.view.numberSpot(n);
      this.glow.position.set(p.x, 0.0015, p.y);
      this.glow.scale.set(this.view.cell.x * (n === 0 ? 0.9 : 0.95), 1, this.view.cell.y * (n === 0 ? 3 : 0.95));
    }
  }
}
