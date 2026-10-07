import * as THREE from 'three';
import {
  BLACKJACK_FELT,
  BLACKJACK_TABLE,
  CASHIER,
  CASINO_BAR,
  CASINO_LOUNGE,
  CASINO_ROOM,
  CASINO_SEATING,
  CASINO_SHOP,
  CHIP_BOARD,
  CRASH_BOARD,
  HOUSE_BANK_MACHINE,
  MARKET_SCREEN,
  PLINKO_MACHINE,
  TRADING_DESK,
  POKER_TABLE,
  ROULETTE_TABLE,
  ROULETTE_WHEEL,
  SLOT_MACHINES,
  SLOT_SIZE,
  WHEEL_ORDER,
  casinoFootprints,
  rouletteColor,
  type CasinoTable,
} from '../../shared/casino';
import { formatChips } from '../../shared/housebank';
import { multText, type CrashBoard, type CrashBoardRow } from '../../shared/crash';
import { ELEVATOR, ELEVATOR_FRONT, WALL_T } from '../../shared/layout';
import { locale, t } from '../i18n';
import { Worker } from './character';
import { buildCasinoBartender } from './casinobartender';
import { buildCasinoShop, type CasinoShop } from './casinoshop';
import { buildElevator, type Elevator } from './elevator';
import type { Collider, Interactable } from './office';
import { mergeByMaterial, mesh, roundedBox, toon, toonUnique } from './toon';

// The casino in the basement (see shared/casino.ts): dark patterned carpet under a low ceiling,
// warm light pooled over green felt, and a neon sign on the far wall facing the elevator. A poker
// table and a blackjack table along the north side, the roulette wheel to the south-west, a bank of
// slot machines down the west wall, a Plinko machine standing in the middle of the hall, the
// cashier's cage in the north-east corner with the chip board over it, and a bar with a lounge in
// the south-east. Only the room and its furniture: the games
// put their cards, chips and balls on it through the views below (each table's toWorld, the
// roulette wheel, each slot machine's screen and lever, the chip board).

const R = CASINO_ROOM;
const H = R.height;
const FELT = '#1d6b45';
const RAIL = '#2a1612';
const WOOD = '#5a2e1c';
const WOOD_DARK = '#3b1d12';
const BRASS = '#d4a84b';
const INK = '#14101a';
/** How near the cashier's window you have to be to bank there (chip credit, see shared/chips.ts) (m). */
const BANK_REACH = 1.6;
const CHIP_COLORS = ['#f4f1ea', '#d62839', '#1d4ed8', '#16a34a', '#111111', '#7c3aed'];

/** A view of one table: where its felt is, so a game can lay cards and chips on it. */
export interface CasinoTableView {
  table: CasinoTable;
  group: THREE.Group;
  /**
   * The world point at felt-local (x, y) meters from the middle of the table's top, `h` meters over
   * the felt (0 by default: lying on it). x runs along the table (its length), y across it, from the
   * dealer's side (-y) toward the players (+y).
   */
  toWorld(x: number, y: number, h?: number, target?: THREE.Vector3): THREE.Vector3;
  /** The other way: where a world point is on the felt. */
  toTable(p: THREE.Vector3): { x: number; y: number; h: number };
  /** Each seat's places on the felt, in seat order: where its cards go, and its bet in front of them. */
  spots: readonly { cards: { x: number; y: number }; bet: { x: number; y: number } }[];
  /** Where the dealer's own cards go (blackjack), or the board's five (poker, x along it). */
  dealerSpot: { x: number; y: number };
  /** The dealer (the croupier at the roulette wheel), standing behind the table facing the players. */
  dealer: Worker;
  /** The rack of chips in front of the dealer. */
  chipTray: THREE.Object3D;
}

export interface PokerTableView extends CasinoTableView {
  /** The five community cards' places on the felt, the flop first. */
  board: readonly { x: number; y: number }[];
  /** Where the pot goes, in front of the board. */
  pot: { x: number; y: number };
  /** The dealer button: a white puck, put next to whoever's on the button. */
  button: THREE.Object3D;
  /** The deck, face down by the dealer. */
  deck: THREE.Object3D;
}

export interface BlackjackTableView extends CasinoTableView {
  /** The card shoe at the dealer's left: cards come out of its mouth at `shoeMouth` on the felt. */
  shoe: THREE.Object3D;
  shoeMouth: { x: number; y: number };
  /** The discard holder at the dealer's right. */
  discard: THREE.Object3D;
}

export type RouletteBet = 'dozen1' | 'dozen2' | 'dozen3' | 'column1' | 'column2' | 'column3' | 'low' | 'even' | 'red' | 'black' | 'odd' | 'high';

export interface RouletteTableView extends CasinoTableView {
  wheel: RouletteWheel;
  /** The middle of number `n`'s box on the betting layout (0–36), on the felt. */
  numberSpot(n: number): { x: number; y: number };
  /** The middle of an outside bet's box on the layout. */
  betSpot(bet: RouletteBet): { x: number; y: number };
  /** How big a number's box is on the layout (x along the table, y across), for splits and corners. */
  cell: { x: number; y: number };
}

/**
 * The roulette wheel: a wooden bowl set into the table, and the rotor in it, which spins. Angles
 * are turns about +y in the bowl's frame (radians, positive anticlockwise seen from above, the way
 * three.js turns things); the numbers go clockwise round the rotor in WHEEL_ORDER.
 */
export interface RouletteWheel {
  /** The bowl, at the wheel's middle on the felt: the ball goes in here. */
  bowl: THREE.Group;
  /** The part that spins: set its rotation.y. */
  rotor: THREE.Group;
  /** The ball (hidden until a game shows it), a child of the bowl: put it where it is with ballAt. */
  ball: THREE.Mesh;
  /** Radii in the bowl: the track the ball runs round high up, and the ring of pockets it drops into. */
  radii: { track: number; pockets: number; rotor: number };
  /** How high over the felt the ball's middle is running on the track, and lying in a pocket. */
  heights: { track: number; pocket: number };
  /** Where number `n`'s pocket is on the rotor (its middle), as a turn from the rotor's zero (+x). */
  pocketAngle(n: number): number;
  /** The number in the pocket at bowl angle `angle`, with the rotor turned as it is now. */
  numberAt(angle: number): number;
  /** Puts the ball at bowl angle `angle`, `r` out from the middle and `h` over the felt. */
  ballAt(angle: number, r: number, h: number): void;
}

export interface SlotMachineView {
  index: number;
  group: THREE.Group;
  /**
   * The screen behind the glass where the reels are: a plane `screenSize` meters, facing out of the
   * machine. Its material's map is a canvas (`screenCanvas`) with three idle reels drawn on it, to
   * draw over (set `needsUpdate` on the map), or swap for another texture.
   */
  screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  screenCanvas: HTMLCanvasElement;
  screenSize: { width: number; height: number };
  /** In the middle of the screen, a hair in front of it: x to the right, y up, +z out toward the player. Reels in 3D go in here. */
  reels: THREE.Object3D;
  /** The lever on the right-hand side: turn its rotation.x from 0 (up) toward 1.1 (pulled down toward you). */
  lever: THREE.Object3D;
  /** The light on top, which chases round while idle; a game can make it flash (setWin). */
  setWin(on: boolean): void;
}

export interface ChipBoardRow {
  name: string;
  chips: number;
  /** Their color, for the dot by their name. */
  color?: string;
  /** Online in the office right now. */
  online?: boolean;
  /** It's whoever's looking: their row is lit up. */
  you?: boolean;
  /** Their name's colour, bought at the shop (see shared/shop.ts). */
  nameColor?: string;
}

/** The board over the cashier's cage: everyone's chips, most first. */
export interface ChipBoard {
  mesh: THREE.Mesh;
  /** Draws the board: the title, then a row for each (the first 10 fit), medals for the first three. With none, it says there's nothing yet. */
  setRows(rows: readonly ChipBoardRow[]): void;
  /** The house bank's total along the bottom (whole chips, as a decimal string: it has no upper limit). */
  setBank(total: string): void;
}

/** The Crash scoreboard on the west wall next to the Crash screen: who's bet the most, and who's won the most, all-time. */
export interface CrashBoardView {
  mesh: THREE.Mesh;
  /** Draws the board: the title, then the two rankings (the first 10 each), medals for the first three, your rows lit up. */
  setBoard(board: CrashBoard): void;
}

/** The Plinko machine in the middle of the hall: its big screen (a canvas everyone down there watches), and where E is. */
export interface PlinkoMachineView {
  group: THREE.Group;
  /** The screen: draw on `canvas`, then set `texture.needsUpdate`. */
  screen: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  interactable: Interactable;
  /** Where the screen is, for its sounds. */
  where: { x: number; y: number; z: number };
}

/** The trading desk by the east wall: the big chart screen over it (a canvas everyone down there watches), and where E is. */
export interface MarketDeskView {
  group: THREE.Group;
  /** The wall screen: draw on `canvas`, then set `texture.needsUpdate`. */
  screen: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  interactable: Interactable;
  /** Where the screen is, for its sounds. */
  where: { x: number; y: number; z: number };
}

/** The house bank's machine against the south wall: its screen shows the bank's total for everyone, and E there opens its panel. */
export interface HouseBankMachineView {
  group: THREE.Group;
  /** Draws the bank's total (whole chips, a decimal string: it has no upper limit) on its screen. */
  setTotal(total: string): void;
  interactable: Interactable;
  /** The screen's canvas, for checking what it shows. */
  canvas: HTMLCanvasElement;
}

export interface Casino {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  elevator: Elevator;
  /** What looking or clicking can land on. */
  pickables: THREE.Object3D[];
  poker: PokerTableView;
  blackjack: BlackjackTableView;
  roulette: RouletteTableView;
  slots: SlotMachineView[];
  chipBoard: ChipBoard;
  crashBoard: CrashBoardView;
  plinko: PlinkoMachineView;
  market: MarketDeskView;
  houseBank: HouseBankMachineView;
  /** Where you stand at the cashier's window, and the cashier behind it. */
  cashier: { at: { x: number; z: number }; worker: Worker };
  /** The shop, through the doorway at the west end of the south wall (see casinoshop.ts). */
  shop: CasinoShop;
  update(t: number, dt: number): void;
}

function canvasTexture(w: number, h: number, draw?: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw?.(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Sets `g`'s font to `px` pixels (`weight`), or smaller so `text` fits in `width`. */
/** The chips board's first three places. */
const MEDALS = ['🥇', '🥈', '🥉'];

function fitFont(g: CanvasRenderingContext2D, text: string, px: number, width: number, weight = 900) {
  const font = (n: number) => `${weight} ${n}px Nunito, ui-rounded, system-ui, sans-serif`;
  g.font = font(px);
  const w = g.measureText(text).width;
  if (w > width) g.font = font(Math.floor((px * width) / w));
}

/** A material that glows on its own, whatever the light. */
function glow(color: THREE.ColorRepresentation, opts: { transparent?: boolean; map?: THREE.Texture } = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, map: opts.map ?? null, transparent: !!opts.transparent, depthWrite: !opts.transparent });
  m.toneMapped = false;
  return m;
}

/** A toon material with a texture on it. */
function toonMap(map: THREE.Texture): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** Makes `obj` somewhere to sit (see CASINO_SEATING): walk up to it, or look at it, and press E. */
function seatable(obj: THREE.Object3D, seatId: string, radius: number, interactables: Interactable[]) {
  const seat = CASINO_SEATING.find((s) => s.id === seatId)!;
  const it: Interactable = { kind: 'seat', seatId, x: seat.x, z: seat.z, radius };
  interactables.push(it);
  obj.userData.interact = it;
}

/** The carpet: deep burgundy with a gold lattice, teal medallions and little card suits, one tile `size` meters across. */
function carpetTexture(): THREE.CanvasTexture {
  const S = 256;
  const tex = canvasTexture(S, S, (g) => {
    g.fillStyle = '#3a0d1e';
    g.fillRect(0, 0, S, S);
    // A diamond lattice in gold.
    g.strokeStyle = 'rgba(214, 168, 75, 0.55)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, S / 2);
    g.lineTo(S / 2, 0);
    g.lineTo(S, S / 2);
    g.lineTo(S / 2, S);
    g.closePath();
    g.stroke();
    // Teal medallions where the lattice crosses, and on its middle.
    const medal = (x: number, y: number, r: number) => {
      g.fillStyle = '#0f4c5c';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#d6a84b';
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = '#e36414';
      g.beginPath();
      g.arc(x, y, r * 0.4, 0, Math.PI * 2);
      g.fill();
    };
    for (const [x, y] of [
      [0, 0],
      [S, 0],
      [0, S],
      [S, S],
    ])
      medal(x, y, 30);
    medal(S / 2, S / 2, 40);
    // Card suits in the four diamonds' corners, small.
    g.fillStyle = 'rgba(214, 168, 75, 0.7)';
    const suit = (x: number, y: number, k: number) => {
      g.save();
      g.translate(x, y);
      g.beginPath();
      if (k === 0) {
        // A diamond.
        g.moveTo(0, -10);
        g.lineTo(8, 0);
        g.lineTo(0, 10);
        g.lineTo(-8, 0);
      } else if (k === 1) {
        // A heart.
        g.moveTo(0, 9);
        g.bezierCurveTo(-14, -2, -6, -12, 0, -4);
        g.bezierCurveTo(6, -12, 14, -2, 0, 9);
      } else {
        // A club or a spade: three dots, or a dot on a point, and a stem.
        g.arc(0, -4, 5, 0, Math.PI * 2);
        g.moveTo(-5, 3);
        g.arc(-5, 3, 5, 0, Math.PI * 2);
        g.moveTo(5, 3);
        g.arc(5, 3, 5, 0, Math.PI * 2);
        g.rect(-1.5, 3, 3, 9);
      }
      g.fill();
      g.restore();
    };
    suit(S / 2, S * 0.18, 0);
    suit(S * 0.82, S / 2, 1);
    suit(S / 2, S * 0.82, 2);
    suit(S * 0.18, S / 2, 1);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The wallpaper above the wainscot: a damask-ish pattern, dark red on darker. */
function wallTexture(): THREE.CanvasTexture {
  const S = 128;
  const tex = canvasTexture(S, S, (g) => {
    g.fillStyle = '#4a1222';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#5c1a2c';
    for (const [x, y] of [
      [S / 2, S / 2],
      [0, 0],
      [S, 0],
      [0, S],
      [S, S],
    ]) {
      g.beginPath();
      g.ellipse(x, y, 18, 30, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(214, 168, 75, 0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(S / 2, S / 2, 26, 40, 0, 0, Math.PI * 2);
    g.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Writes `text` on a felt canvas at (x, y) in its meters, `size` meters tall, no wider than `width` meters. */
type Label = (text: string, x: number, y: number, size: number, color: string, opts?: { width?: number; weight?: number; turn?: number }) => void;

/**
 * A felt canvas for a table `length` × `width` meters, drawn in its meters from the middle (felt x
 * along, y across toward the players, down the canvas). It maps onto a ShapeGeometry drawn in the
 * same meters (see feltMesh). Text goes on with `label`, in pixels, so it's crisp.
 */
function feltTexture(length: number, width: number, draw: (g: CanvasRenderingContext2D, label: Label) => void): THREE.CanvasTexture {
  const px = 400;
  const ox = (length * px) / 2;
  const oy = (width * px) / 2;
  return canvasTexture(Math.round(length * px), Math.round(width * px), (g) => {
    g.fillStyle = FELT;
    g.fillRect(0, 0, length * px, width * px);
    // A little nap, so it isn't flat.
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
      g.fillRect(Math.random() * length * px, Math.random() * width * px, 2, 2);
    }
    const label: Label = (text, x, y, size, color, opts = {}) => {
      g.save();
      g.setTransform(1, 0, 0, 1, ox + x * px, oy + y * px);
      if (opts.turn) g.rotate(opts.turn);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = color;
      fitFont(g, text, Math.round(size * px), (opts.width ?? length) * px, opts.weight ?? 800);
      g.fillText(text, 0, 0);
      g.restore();
    };
    g.save();
    g.translate(ox, oy);
    g.scale(px, px);
    draw(g, label);
    g.restore();
  });
}

/**
 * The felt on a table's top: `shape` in felt meters (its y is the felt's y, toward the players),
 * laid flat, the texture stretched over `length` × `width`.
 */
function feltMesh(shape: THREE.Shape, map: THREE.Texture, length: number, width: number): THREE.Mesh {
  map.repeat.set(1 / length, -1 / width);
  map.offset.set(0.5, 0.5);
  // The shape's y is toward the players, which is +z: laid flat with +y going to +z.
  const geo = new THREE.ShapeGeometry(shape, 24).rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, toonMap(map));
  m.receiveShadow = true;
  // Flipped over by the turn, its faces point down: put them back up.
  (m.material as THREE.Material).side = THREE.DoubleSide;
  return m;
}

/** A racetrack (a rectangle with round ends), `length` × `width`, round its middle. */
function racetrack(length: number, width: number): THREE.Shape {
  const r = width / 2;
  const s = new THREE.Shape();
  const a = length / 2 - r;
  s.moveTo(-a, -r);
  s.lineTo(a, -r);
  s.absarc(a, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-a, r);
  s.absarc(-a, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  return s;
}

/** A half-moon: straight along the dealer's side at y = `edge`, round from there toward the players, `length` across and `depth` deep. */
function halfMoon(length: number, depth: number, edge = -depth / 2): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(length / 2, edge);
  s.absellipse(0, edge, length / 2, depth, 0, Math.PI, false);
  s.lineTo(length / 2, edge);
  return s;
}

/** The padded rail round a half-moon's curve (not its straight side): `pad` wide, extruded `height` up from y = 0. */
function halfMoonRail(length: number, depth: number, pad: number, height: number): THREE.BufferGeometry {
  const edge = -depth / 2;
  const s = new THREE.Shape();
  s.moveTo(length / 2, edge);
  s.absellipse(0, edge, length / 2, depth, 0, Math.PI, false);
  s.lineTo(-length / 2 + pad, edge);
  s.absellipse(0, edge, length / 2 - pad, depth - pad, Math.PI, 0, true);
  s.lineTo(length / 2, edge);
  return new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.025, bevelSegments: 2, curveSegments: 32 }).rotateX(Math.PI / 2).translate(0, height, 0);
}

/** A ring round `shape` (its outline grown by `pad`), extruded `height` up from y = 0, as a padded rail. */
function railGeometry(outer: THREE.Shape, inner: THREE.Shape, height: number): THREE.BufferGeometry {
  const ring = new THREE.Shape(outer.getPoints(48));
  ring.holes.push(new THREE.Path(inner.getPoints(48).reverse()));
  return new THREE.ExtrudeGeometry(ring, { depth: height, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, curveSegments: 24 }).rotateX(Math.PI / 2).translate(0, height, 0);
}

/** Stacks of chips: a few colored cylinders, merged into one mesh per color under `into`. */
function chipStacks(into: THREE.Object3D, at: { x: number; z: number; n: number; color: number }[], y: number) {
  const parts = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.02, 0.02, 0.0034 * 1, 14);
  for (const s of at) {
    for (let i = 0; i < s.n; i++) parts.add(mesh(geo, toon(CHIP_COLORS[s.color % CHIP_COLORS.length]), s.x, y + 0.0017 + i * 0.0036, s.z, false));
  }
  into.add(mergeByMaterial(parts));
}

/** A chip tray: a wooden rack with rows of chips in it, `width` across, centered on its own (0, 0). */
function chipTray(width: number): THREE.Group {
  const g = new THREE.Group();
  const rows = Math.floor(width / 0.05);
  g.add(mesh(new THREE.BoxGeometry(width + 0.04, 0.03, 0.16), toon(WOOD_DARK), 0, 0.015, 0, false));
  const lying = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.019, 0.019, 0.12, 14).rotateX(Math.PI / 2);
  for (let i = 0; i < rows; i++) lying.add(mesh(geo, toon(CHIP_COLORS[i % 5]), -width / 2 + 0.025 + i * (width / rows), 0.035, 0, false));
  g.add(mergeByMaterial(lying));
  return g;
}

/** A table's toWorld/toTable, for its `top` group (whose origin is the middle of the felt). */
function feltFrame(top: THREE.Object3D) {
  const v = new THREE.Vector3();
  return {
    toWorld(x: number, y: number, h = 0, target = new THREE.Vector3()) {
      top.updateWorldMatrix(true, false);
      return top.localToWorld(target.set(x, h, y));
    },
    toTable(p: THREE.Vector3) {
      top.updateWorldMatrix(true, false);
      top.worldToLocal(v.copy(p));
      return { x: v.x, y: v.z, h: v.y };
    },
  };
}

/** A dealer in a waistcoat behind `table`, facing the players, with a card over their head saying what they deal. */
function dealerAt(table: CasinoTable, group: THREE.Group, name: string, summary: string): Worker {
  const w = new Worker(name, '#1f2937');
  w.setStatus('idle', false);
  w.setTask({ name, summary });
  w.root.position.set(table.dealer.x, 0, table.dealer.z);
  group.add(w.root);
  return w;
}

// ---- The chairs and stools -------------------------------------------------------------------------

/** A padded casino chair facing +z: a red seat and back on a brass pedestal. Built once, merged, and shared. */
function chairParts(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#9b1d20');
  const brass = toon(BRASS);
  g.add(mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.03, 16), brass, 0, 0.015, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), brass, 0, 0.22, 0, false));
  g.add(mesh(roundedBox(0.48, 0.1, 0.46, 0.05), red, 0, 0.45, 0));
  g.add(mesh(roundedBox(0.46, 0.5, 0.09, 0.05), red, 0, 0.74, -0.21));
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.025, 0.025), brass, 0, 0.98, -0.21, false));
  return mergeByMaterial(g);
}

/** A tall stool facing +z, for the blackjack and roulette tables and the slot machines: a padded seat with a low back. */
function stoolParts(seatY: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const brass = toon(BRASS);
  const pad = toon(color);
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.03, 16), brass, 0, 0.015, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, seatY - 0.05, 8), brass, 0, (seatY - 0.05) / 2, 0, false));
  g.add(mesh(new THREE.TorusGeometry(0.17, 0.014, 6, 16).rotateX(Math.PI / 2), brass, 0, seatY * 0.45, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.1, 16), pad, 0, seatY - 0.02, 0));
  g.add(mesh(roundedBox(0.36, 0.22, 0.06, 0.03), pad, 0, seatY + 0.2, -0.19));
  return mergeByMaterial(g);
}

/** Puts a copy of `parts` (sharing its geometry) where `seatId` is, facing the way you sit there. */
function placeSeat(parts: THREE.Group, seatId: string, group: THREE.Group, interactables: Interactable[]): THREE.Group {
  const s = CASINO_SEATING.find((x) => x.id === seatId)!;
  const g = parts.clone();
  g.position.set(s.x, 0, s.z);
  g.rotation.y = s.rotY;
  seatable(g, s.id, 0.7, interactables);
  group.add(g);
  return g;
}

// ---- The casino ------------------------------------------------------------------------------------

export function buildCasino(): Casino {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const statics = new THREE.Group();
  const w = R.maxX - R.minX;
  const d = R.maxZ - R.minZ;
  const cx = (R.minX + R.maxX) / 2;
  const cz = (R.minZ + R.maxZ) / 2;
  const brass = toon(BRASS);

  // ---- The room: carpet, walls, ceiling --------------------------------------------------------------
  const carpet = carpetTexture();
  carpet.repeat.set(w / 1.6, d / 1.6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), toonMap(carpet));
  floor.position.set(cx, 0.002, cz);
  floor.receiveShadow = true;
  group.add(floor);
  // Something to stand on (nothing's under it but the ground).
  colliders.push({ minX: R.minX, maxX: R.maxX, minZ: R.minZ, maxZ: R.maxZ, bottom: -0.3, top: 0 });

  // Dark wood panelling to the dado rail, wallpaper above it, a brass line along the top of the panels.
  const paper = wallTexture();
  const panel = toon(WOOD_DARK);
  const dado = 1.15;
  // The south wall has the shop's doorway in it (see casinoshop.ts): two runs, either side of it.
  const door = CASINO_SHOP.door;
  const doorW = door.x - door.width / 2;
  const doorE = door.x + door.width / 2;
  const walls: [number, number, number, number, number][] = [
    // x, z, length, turned (0 along x, 1 along z), facing (+1 into the room along the normal)
    [cx, R.minZ, w, 0, 1],
    [(R.minX + doorW) / 2, R.maxZ, doorW - R.minX, 0, -1],
    [(doorE + R.maxX) / 2, R.maxZ, R.maxX - doorE, 0, -1],
    [R.minX, cz, d, 1, 1],
    [R.maxX, cz, d, 1, -1],
  ];
  for (const [x, z, len, turned, face] of walls) {
    const p = paper.clone();
    p.repeat.set(len / 1.3, (H - dado) / 1.3);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H - dado), toonMap(p));
    const n = 0.001 * face;
    m.position.set(turned ? x + n : x, dado + (H - dado) / 2, turned ? z : z + n);
    m.rotation.y = turned ? (face > 0 ? Math.PI / 2 : -Math.PI / 2) : face > 0 ? 0 : Math.PI;
    group.add(m);
    // The panelling stands a little proud of the wall, and the dado rail on top of it.
    const along = turned ? [0.06, dado, len] : [len, dado, 0.06];
    statics.add(mesh(new THREE.BoxGeometry(along[0], along[1], along[2]), panel, turned ? x + 0.03 * face : x, dado / 2, turned ? z : z + 0.03 * face, false));
    const rail = turned ? [0.1, 0.05, len] : [len, 0.05, 0.1];
    statics.add(mesh(new THREE.BoxGeometry(rail[0], rail[1], rail[2]), brass, turned ? x + 0.05 * face : x, dado + 0.025, turned ? z : z + 0.05 * face, false));
    // The wall itself, behind, so nothing shows through from outside.
    // (Out round the room's corners, but not into the shop's doorway.)
    const x0 = turned ? x : x - len / 2 - (x - len / 2 <= R.minX ? WALL_T : 0);
    const x1 = turned ? x : x + len / 2 + (x + len / 2 >= R.maxX ? WALL_T : 0);
    const back = turned ? [WALL_T, H, len + WALL_T * 2] : [x1 - x0, H, WALL_T];
    statics.add(mesh(new THREE.BoxGeometry(back[0], back[1], back[2]), toon('#1a0a10'), turned ? x - (WALL_T / 2) * face : (x0 + x1) / 2, H / 2, turned ? z : z - (WALL_T / 2) * face, false));
    colliders.push(
      turned
        ? { minX: face > 0 ? x - WALL_T : x, maxX: face > 0 ? x : x + WALL_T, minZ: R.minZ - WALL_T, maxZ: R.maxZ + WALL_T, top: 99 }
        : { minX: x0, maxX: x1, minZ: face > 0 ? z - WALL_T : z, maxZ: face > 0 ? z : z + WALL_T, top: 99 },
    );
  }
  // A dark ceiling with a coffer of lit cove round its edge, and pot lights in rows.
  statics.add(mesh(new THREE.BoxGeometry(w + WALL_T * 2, 0.2, d + WALL_T * 2), toon('#120c14'), cx, H + 0.1, cz, false));
  const cove = glow('#ff9f43');
  const coveIn = 0.5;
  for (const [x, z, lx, lz] of [
    [cx, R.minZ + coveIn, w - coveIn * 2, 0.06],
    [cx, R.maxZ - coveIn, w - coveIn * 2, 0.06],
    [R.minX + coveIn, cz, 0.06, d - coveIn * 2],
    [R.maxX - coveIn, cz, 0.06, d - coveIn * 2],
  ])
    group.add(mesh(new THREE.BoxGeometry(lx, 0.04, lz), cove, x, H - 0.02, z, false));
  const pot = glow('#ffe6b3');
  const pots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.09, 12).rotateX(Math.PI / 2), pot, 60);
  let np = 0;
  const at = new THREE.Matrix4();
  for (let x = R.minX + 2.5; x < R.maxX - 1; x += 3.2) {
    for (let z = R.minZ + 2.5; z < R.maxZ - 1; z += 3.4) {
      if (np >= 60) break;
      at.makeTranslation(x, H - 0.005, z);
      pots.setMatrixAt(np++, at);
    }
  }
  pots.count = np;
  group.add(pots);

  // ---- The elevator: in its usual spot on the north wall ---------------------------------------------
  const elevator = buildElevator();
  elevator.setSign(t('world.signCasino'));
  group.add(elevator.group);
  colliders.push(...elevator.colliders);
  interactables.push(elevator.interactable);
  // A brass surround and a red carpet runner out from its doors.
  const runner = toon('#7a0f1f');
  statics.add(mesh(new THREE.BoxGeometry(1.8, 0.01, 2.6), runner, ELEVATOR.x, 0.006, ELEVATOR_FRONT + 1.3, false));
  for (const s of [-1, 1]) statics.add(mesh(new THREE.BoxGeometry(0.05, 0.012, 2.6), brass, ELEVATOR.x + s * 0.92, 0.008, ELEVATOR_FRONT + 1.3, false));
  // Velvet ropes on brass posts either side of the runner, out to the room.
  const rope = toon('#9b1d20');
  for (const s of [-1, 1]) {
    const x = ELEVATOR.x + s * 1.35;
    const z0 = ELEVATOR_FRONT + 0.4;
    const z1 = ELEVATOR_FRONT + 2.4;
    for (const z of [z0, z1]) {
      statics.add(mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.04, 14), brass, x, 0.02, z, false));
      statics.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8), brass, x, 0.47, z, false));
      statics.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), brass, x, 0.94, z, false));
      colliders.push({ minX: x - 0.12, maxX: x + 0.12, minZ: z - 0.12, maxZ: z + 0.12, top: 0.95 });
    }
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 0.86, z0), new THREE.Vector3(x, 0.58, (z0 + z1) / 2), new THREE.Vector3(x, 0.86, z1));
    statics.add(mesh(new THREE.TubeGeometry(curve, 12, 0.025, 6), rope, 0, 0, 0, false));
  }

  // ---- The neon sign on the south wall, facing the elevator ---------------------------------------------
  const neon = canvasTexture(1024, 256, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitFont(g, 'CASINO', 190, 900);
    for (const [blur, color, shadow] of [
      [46, '#ff2bd6', '#ff2bd6'],
      [18, '#ff6be6', '#ff2bd6'],
      [0, '#ffe3fb', '#ff2bd6'],
    ] as const) {
      g.shadowColor = shadow;
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.fillText('CASINO', 512, 136);
    }
  });
  const neonMat = glow('#ffffff', { map: neon, transparent: true });
  const sign = mesh(new THREE.PlaneGeometry(7.2, 1.8), neonMat, -1, 3.35, R.maxZ - 0.08, false);
  sign.rotation.y = Math.PI;
  group.add(sign);
  // Gold stars and a line of bulbs under it, chasing.
  const under = new THREE.Group();
  const bulbs: THREE.MeshBasicMaterial[] = [glow('#ffd166'), glow('#7a5a1a')];
  const bulbGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const marquee: THREE.Mesh[] = [];
  for (let i = 0; i < 26; i++) {
    const b = mesh(bulbGeo, bulbs[i % 2], -1 - 3.4 + (i * 6.8) / 25, 2.3, R.maxZ - 0.1, false);
    under.add(b);
    marquee.push(b);
  }
  group.add(under);
  const suitSign = canvasTexture(256, 256, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 200px serif';
    g.shadowColor = '#4cc9f0';
    g.shadowBlur = 24;
    g.fillStyle = '#c8f3ff';
    g.fillText('♠', 128, 140);
  });
  const suitMat = glow('#ffffff', { map: suitSign, transparent: true });
  for (const s of [-1, 1]) {
    const m = mesh(new THREE.PlaneGeometry(1.1, 1.1), suitMat, -1 + s * 4.6, 3.35, R.maxZ - 0.08, false);
    m.rotation.y = Math.PI;
    group.add(m);
  }

  // ---- A chandelier over the middle of the floor ---------------------------------------------------------
  const chand = new THREE.Group();
  const crystal = glow('#fff1cf');
  chand.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), brass, 0, -0.45, 0, false));
  chand.add(mesh(new THREE.TorusGeometry(0.75, 0.03, 8, 32).rotateX(Math.PI / 2), brass, 0, -1, 0, false));
  chand.add(mesh(new THREE.TorusGeometry(0.45, 0.025, 8, 24).rotateX(Math.PI / 2), brass, 0, -1.25, 0, false));
  const drops = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    drops.add(mesh(new THREE.OctahedronGeometry(0.05), crystal, Math.cos(a) * 0.75, -1.1, Math.sin(a) * 0.75, false));
    if (i % 2 === 0) drops.add(mesh(new THREE.OctahedronGeometry(0.06), crystal, Math.cos(a) * 0.45, -1.36, Math.sin(a) * 0.45, false));
  }
  chand.add(mergeByMaterial(drops));
  chand.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), crystal, 0, -1.5, 0, false));
  chand.position.set(2.5, H, 3.2);
  group.add(chand);

  // The lights: low and warm, pooled over the tables, a bit of color over the slots and the bar.
  const light = (color: string, intensity: number, x: number, y: number, z: number, reach: number) => {
    const l = new THREE.PointLight(color, intensity, reach, 1.4);
    l.position.set(x, y, z);
    group.add(l);
    return l;
  };
  light('#ffd8a0', 5, POKER_TABLE.x, 2.6, POKER_TABLE.z, 7);
  light('#ffd8a0', 5, BLACKJACK_TABLE.x, 2.6, BLACKJACK_TABLE.z, 7);
  light('#ffd8a0', 5, ROULETTE_TABLE.x, 2.6, ROULETTE_TABLE.z, 7);
  const slotGlow = light('#ff5fd2', 3, -15.6, 2.4, 0, 7);
  light('#ffb36b', 4, CASINO_BAR.x - 1.5, 2.6, (CASINO_BAR.minZ + CASINO_BAR.maxZ) / 2, 8);
  light('#ffe0b0', 4, 2.5, 3, 3.2, 10);

  // A low lamp over each table: a dark shade with a glowing underside, hung on rods from the ceiling.
  const lamp = (x: number, z: number, length: number, rotY: number) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(length, 0.14, 0.42), toon('#1e3a2a'), 0, 0, 0, false));
    g.add(mesh(new THREE.BoxGeometry(length + 0.04, 0.03, 0.46), brass, 0, 0.08, 0, false));
    g.add(mesh(new THREE.PlaneGeometry(length - 0.08, 0.36).rotateX(Math.PI / 2), glow('#fff0c8'), 0, -0.071, 0, false));
    for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, H - 2.2, 6), brass, s * (length / 2 - 0.15), (H - 2.2) / 2, 0, false));
    g.position.set(x, 2.2, z);
    g.rotation.y = rotY;
    statics.add(g);
  };

  // ---- The poker table ----------------------------------------------------------------------------------
  const poker = ((): PokerTableView => {
    const T = POKER_TABLE;
    const { length: L, width: W, height: TH } = T.size;
    const g = new THREE.Group();
    g.position.set(T.x, 0, T.z);
    g.rotation.y = T.rotY;
    const top = new THREE.Group();
    top.position.y = TH;
    g.add(top);
    const parts = new THREE.Group();
    // The base: two pedestals under a wooden apron.
    for (const s of [-1, 1]) {
      parts.add(mesh(new THREE.CylinderGeometry(0.2, 0.26, TH - 0.1, 12), toon(WOOD_DARK), s * 0.6, (TH - 0.1) / 2, 0));
      parts.add(mesh(new THREE.BoxGeometry(0.7, 0.05, 0.6), toon(WOOD_DARK), s * 0.6, 0.025, 0, false));
    }
    const rail = 0.16;
    const outer = racetrack(L, W);
    const inner = racetrack(L - rail * 2, W - rail * 2);
    parts.add(mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.07, bevelEnabled: false, curveSegments: 24 }).rotateX(Math.PI / 2).translate(0, TH, 0), toon(WOOD), 0, 0, 0));
    parts.add(mesh(railGeometry(outer, inner, 0.045), toon(RAIL), 0, TH - 0.01, 0));
    g.add(mergeByMaterial(parts));
    const felt = feltTexture(L - rail * 2, W - rail * 2, (c, label) => {
      // A betting line, and the room's name across the middle.
      c.strokeStyle = 'rgba(255, 230, 160, 0.55)';
      c.lineWidth = 0.012;
      const line = racetrack(L - rail * 2 - 0.32, W - rail * 2 - 0.3).getPoints(64);
      c.beginPath();
      line.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
      c.stroke();
      label("TEXAS HOLD'EM", 0, 0.1, 0.1, 'rgba(255, 230, 160, 0.35)', { weight: 900, width: 1.3 });
      label('AGENT OFFICE CASINO', 0, 0.2, 0.045, 'rgba(255, 230, 160, 0.35)', { weight: 700 });
      // Where the board's five cards go.
      c.strokeStyle = 'rgba(255, 230, 160, 0.3)';
      c.lineWidth = 0.006;
      for (let i = 0; i < 5; i++) c.strokeRect(-0.36 + i * 0.18 - 0.065, -0.17 - 0.09, 0.13, 0.18);
    });
    const feltM = feltMesh(inner, felt, L - rail * 2, W - rail * 2);
    feltM.position.y = 0.001;
    top.add(feltM);
    // The dealer's tray of chips, the deck and the button.
    const tray = chipTray(0.5);
    tray.position.set(0, 0, -W / 2 + rail + 0.1);
    top.add(tray);
    const deck = mesh(new THREE.BoxGeometry(0.064, 0.018, 0.09), toon('#b91c1c'), 0.38, 0.009, -W / 2 + rail + 0.12, false);
    top.add(deck);
    const button = new THREE.Group();
    button.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20), toon('#f8f8f2'), 0, 0.006, 0, false));
    const dTex = canvasTexture(64, 64, (c) => {
      c.fillStyle = '#f8f8f2';
      c.fillRect(0, 0, 64, 64);
      c.fillStyle = '#111';
      c.font = '900 44px Nunito, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('D', 32, 35);
    });
    button.add(mesh(new THREE.CircleGeometry(0.028, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: dTex }), 0, 0.0125, 0, false));
    button.position.set(-0.45, 0, -0.1);
    top.add(button);
    group.add(g);
    lamp(T.x, T.z, 2.2, T.rotY);
    const dealer = dealerAt(T, g, t('world.casinoDealer'), t('world.casinoPokerDealer'));
    const chair = chairParts();
    T.seats.forEach((_, i) => placeSeat(chair, `poker-${i + 1}`, group, interactables));
    const spots = T.seats.map((s) => ({ cards: { x: s.x * 0.42, y: s.z * 0.42 }, bet: { x: s.x * 0.3, y: s.z * 0.3 } }));
    return {
      table: T,
      group: g,
      ...feltFrame(top),
      spots,
      dealerSpot: { x: 0, y: -0.17 },
      board: [0, 1, 2, 3, 4].map((i) => ({ x: -0.36 + i * 0.18, y: -0.17 })),
      pot: { x: 0, y: 0.06 },
      dealer,
      chipTray: tray,
      button,
      deck,
    };
  })();

  // ---- The blackjack table --------------------------------------------------------------------------------
  const blackjack = ((): BlackjackTableView => {
    const T = BLACKJACK_TABLE;
    const { length: L, width: W, height: TH } = T.size;
    const g = new THREE.Group();
    g.position.set(T.x, 0, T.z);
    g.rotation.y = T.rotY;
    const top = new THREE.Group();
    top.position.y = TH;
    g.add(top);
    const parts = new THREE.Group();
    parts.add(mesh(new THREE.BoxGeometry(L - 0.5, TH - 0.08, 0.5), toon(WOOD_DARK), 0, (TH - 0.08) / 2, -0.1));
    const outer = halfMoon(L, W);
    const rail = 0.13;
    const inner = halfMoon(L - rail * 2, W - rail, -W / 2);
    parts.add(mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.07, bevelEnabled: false, curveSegments: 32 }).rotateX(Math.PI / 2).translate(0, TH, 0), toon(WOOD), 0, 0, 0));
    // The padded rail round the curve; the dealer's straight side is bare wood.
    parts.add(mesh(halfMoonRail(L, W, rail, 0.045), toon(RAIL), 0, TH - 0.01, 0));
    g.add(mergeByMaterial(parts));
    const cx0 = -W / 2;
    // Each seat's cards in front of it, and its bet behind them, nearer the rail (see BLACKJACK_FELT).
    const bjSpots = BLACKJACK_FELT.spots;
    const feltTex = feltTexture(L, W, (c, label) => {
      // The house rules in an arc over the betting boxes, and a betting box in front of each seat.
      label('BLACKJACK PAYS 3 TO 2', 0, cx0 + 0.36, 0.06, 'rgba(255, 230, 160, 0.8)', { weight: 900, width: 0.8 });
      label('Dealer must draw to 16 and stand on all 17s', 0, cx0 + 0.41, 0.028, 'rgba(255, 230, 160, 0.7)', { weight: 700, width: 0.6 });
      label('INSURANCE PAYS 2 TO 1', 0, cx0 + 0.45, 0.026, 'rgba(255, 230, 160, 0.45)', { weight: 700 });
      c.strokeStyle = 'rgba(255, 230, 160, 0.7)';
      c.lineWidth = 0.01;
      for (const s of bjSpots) {
        c.beginPath();
        c.arc(s.bet.x, s.bet.y, 0.065, 0, Math.PI * 2);
        c.stroke();
      }
    });
    const feltM = feltMesh(inner, feltTex, L, W);
    feltM.position.y = 0.001;
    top.add(feltM);
    const tray = chipTray(0.6);
    tray.position.set(0, 0, cx0 + 0.1);
    top.add(tray);
    // The shoe at the dealer's left (+x), its mouth toward the players; the discard holder at their right.
    const shoe = new THREE.Group();
    shoe.add(mesh(new THREE.BoxGeometry(0.11, 0.09, 0.26), toon('#2b2b2b'), 0, 0.045, 0, false));
    const wedge = mesh(new THREE.BoxGeometry(0.1, 0.05, 0.06), toon('#3a3a3a'), 0, 0.06, 0.14, false);
    wedge.rotation.x = -0.4;
    shoe.add(wedge);
    shoe.add(mesh(new THREE.BoxGeometry(0.064, 0.003, 0.09), toon('#b91c1c'), 0, 0.03, 0.15, false));
    shoe.position.set(0.78, 0, cx0 + 0.15);
    shoe.rotation.y = -0.5;
    top.add(shoe);
    const discard = new THREE.Group();
    discard.add(mesh(new THREE.BoxGeometry(0.1, 0.11, 0.1), toon('#3a3a3a'), 0, 0.055, 0, false));
    discard.add(mesh(new THREE.BoxGeometry(0.066, 0.06, 0.092), toon('#b91c1c'), 0, 0.09, 0, false));
    discard.position.set(-0.78, 0, cx0 + 0.12);
    top.add(discard);
    group.add(g);
    lamp(T.x, T.z, 1.8, T.rotY);
    const dealer = dealerAt(T, g, t('world.casinoDealer'), t('world.casinoBlackjackDealer'));
    const stool = stoolParts(0.62, '#9b1d20');
    T.seats.forEach((_, i) => placeSeat(stool, `blackjack-${i + 1}`, group, interactables));
    return {
      table: T,
      group: g,
      ...feltFrame(top),
      spots: bjSpots,
      dealerSpot: BLACKJACK_FELT.dealer,
      dealer,
      chipTray: tray,
      shoe,
      shoeMouth: { x: 0.71, y: cx0 + 0.28 },
      discard,
    };
  })();

  // ---- The roulette table and its wheel --------------------------------------------------------------------
  const roulette = ((): RouletteTableView => {
    const T = ROULETTE_TABLE;
    const { length: L, width: W, height: TH } = T.size;
    const g = new THREE.Group();
    g.position.set(T.x, 0, T.z);
    g.rotation.y = T.rotY;
    const top = new THREE.Group();
    top.position.y = TH;
    g.add(top);
    const parts = new THREE.Group();
    parts.add(mesh(new THREE.BoxGeometry(L - 0.4, TH - 0.08, W - 0.5), toon(WOOD_DARK), 0, (TH - 0.08) / 2, 0));
    const outer = new THREE.Shape();
    const rr = 0.18;
    outer.moveTo(-L / 2 + rr, -W / 2);
    outer.lineTo(L / 2 - rr, -W / 2);
    outer.quadraticCurveTo(L / 2, -W / 2, L / 2, -W / 2 + rr);
    outer.lineTo(L / 2, W / 2 - rr);
    outer.quadraticCurveTo(L / 2, W / 2, L / 2 - rr, W / 2);
    outer.lineTo(-L / 2 + rr, W / 2);
    outer.quadraticCurveTo(-L / 2, W / 2, -L / 2, W / 2 - rr);
    outer.lineTo(-L / 2, -W / 2 + rr);
    outer.quadraticCurveTo(-L / 2, -W / 2, -L / 2 + rr, -W / 2);
    const rail = 0.11;
    const inner = new THREE.Shape();
    inner.moveTo(-L / 2 + rail, -W / 2 + rail);
    inner.lineTo(L / 2 - rail, -W / 2 + rail);
    inner.lineTo(L / 2 - rail, W / 2 - rail);
    inner.lineTo(-L / 2 + rail, W / 2 - rail);
    inner.lineTo(-L / 2 + rail, -W / 2 + rail);
    parts.add(mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.07, bevelEnabled: false, curveSegments: 8 }).rotateX(Math.PI / 2).translate(0, TH, 0), toon(WOOD), 0, 0, 0));
    parts.add(mesh(railGeometry(outer, inner, 0.04), toon(RAIL), 0, TH - 0.01, 0));
    g.add(mergeByMaterial(parts));

    // The layout: the zero by the wheel, then twelve columns of three numbers, the "2 to 1"s at the
    // far end; under them the dozens, and under those the even-money bets.
    const cellX = 0.12;
    const cellY = 0.15;
    const x0 = -0.38;
    const y0 = -0.34;
    const numberSpot = (n: number) => {
      if (n === 0) return { x: x0 + cellX / 2, y: y0 + (cellY * 3) / 2 };
      const col = Math.floor((n - 1) / 3);
      const row = 2 - ((n - 1) % 3);
      return { x: x0 + cellX * (col + 1.5), y: y0 + cellY * (row + 0.5) };
    };
    const yDozen = y0 + cellY * 3 + 0.06;
    const yOutside = yDozen + 0.12;
    const betSpot = (bet: RouletteBet) => {
      const m = /^(dozen|column)(\d)$/.exec(bet);
      if (m?.[1] === 'dozen') return { x: x0 + cellX * (1 + 4 * (Number(m[2]) - 1) + 2), y: yDozen };
      if (m?.[1] === 'column') return { x: x0 + cellX * 13.5, y: y0 + cellY * (3 - Number(m[2]) + 0.5) };
      const i = ['low', 'even', 'red', 'black', 'odd', 'high'].indexOf(bet);
      return { x: x0 + cellX * (1 + 2 * i + 1), y: yOutside };
    };
    const feltTex = feltTexture(L - rail * 2, W - rail * 2, (c, label) => {
      c.lineWidth = 0.006;
      c.strokeStyle = 'rgba(255, 245, 220, 0.85)';
      const box = (x: number, y: number, bw: number, bh: number, text: string, size = 0.06) => {
        c.strokeRect(x, y, bw, bh);
        if (text) label(text, x + bw / 2, y + bh / 2 + 0.004, size, '#fff5dc', { width: bw * 0.86 });
      };
      // The zero, a pointed cell by the wheel.
      c.fillStyle = '#0f7a3f';
      c.beginPath();
      c.moveTo(x0 + cellX, y0);
      c.lineTo(x0 + cellX * 0.25, y0);
      c.lineTo(x0, y0 + cellY * 1.5);
      c.lineTo(x0 + cellX * 0.25, y0 + cellY * 3);
      c.lineTo(x0 + cellX, y0 + cellY * 3);
      c.closePath();
      c.fill();
      c.stroke();
      label('0', x0 + cellX * 0.55, y0 + cellY * 1.5, 0.07, '#fff5dc');
      for (let n = 1; n <= 36; n++) {
        const s = numberSpot(n);
        const red = rouletteColor(n) === 'red';
        box(s.x - cellX / 2, s.y - cellY / 2, cellX, cellY, '');
        // The number on a disc of its color.
        c.fillStyle = red ? '#c1121f' : '#111111';
        c.beginPath();
        c.arc(s.x, s.y, 0.045, 0, Math.PI * 2);
        c.fill();
        label(String(n), s.x, s.y + 0.003, 0.05, '#fff5dc', { width: 0.075 });
      }
      for (let k = 1; k <= 3; k++) {
        const s = betSpot(`column${k}` as RouletteBet);
        box(s.x - cellX / 2, s.y - cellY / 2, cellX, cellY, '2:1', 0.045);
        const dz = betSpot(`dozen${k}` as RouletteBet);
        box(dz.x - cellX * 2, dz.y - 0.06, cellX * 4, 0.12, ['1st 12', '2nd 12', '3rd 12'][k - 1], 0.06);
      }
      const outsides: [RouletteBet, string, string | null][] = [
        ['low', '1–18', null],
        ['even', 'EVEN', null],
        ['red', '', '#c1121f'],
        ['black', '', '#111111'],
        ['odd', 'ODD', null],
        ['high', '19–36', null],
      ];
      for (const [bet, text, fill] of outsides) {
        const s = betSpot(bet);
        box(s.x - cellX, s.y - 0.06, cellX * 2, 0.12, text, 0.055);
        if (fill) {
          // A diamond of red, or black.
          c.fillStyle = fill;
          c.beginPath();
          c.moveTo(s.x - 0.08, s.y);
          c.lineTo(s.x, s.y - 0.04);
          c.lineTo(s.x + 0.08, s.y);
          c.lineTo(s.x, s.y + 0.04);
          c.closePath();
          c.fill();
        }
      }
    });
    const feltM = feltMesh(inner, feltTex, L - rail * 2, W - rail * 2);
    feltM.position.y = 0.001;
    top.add(feltM);
    const tray = chipTray(0.5);
    tray.position.set(-0.1, 0, -W / 2 + rail + 0.1);
    top.add(tray);

    // The wheel: a wooden bowl, the rotor with its 37 pockets and their numbers, and the turret on top.
    const Wh = ROULETTE_WHEEL;
    const bowl = new THREE.Group();
    bowl.position.set(Wh.x, 0, Wh.z);
    top.add(bowl);
    const rotorR = 0.33;
    const pocketsR = 0.255;
    const trackR = Wh.r - 0.045;
    // The bowl, turned on a lathe: out from the rotor's edge, up its sloping inside to the ball track, over its rim.
    const profile = [
      new THREE.Vector2(rotorR + 0.005, 0.03),
      new THREE.Vector2(trackR - 0.03, 0.065),
      new THREE.Vector2(trackR, 0.09),
      new THREE.Vector2(Wh.r - 0.01, Wh.rim - 0.01),
      new THREE.Vector2(Wh.r, Wh.rim),
      new THREE.Vector2(Wh.r + 0.05, Wh.rim),
      new THREE.Vector2(Wh.r + 0.06, 0),
    ];
    const bowlMat = toonUnique(WOOD);
    bowlMat.side = THREE.DoubleSide;
    bowl.add(mesh(new THREE.LatheGeometry(profile, 48), bowlMat, 0, 0, 0, false));
    bowl.add(mesh(new THREE.TorusGeometry(trackR, 0.006, 6, 48).rotateX(Math.PI / 2), brass, 0, 0.09, 0, false));
    // Diamonds (deflectors) round the slope.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const dmd = mesh(new THREE.OctahedronGeometry(0.012), brass, Math.cos(a) * (trackR - 0.035), 0.072, Math.sin(a) * (trackR - 0.035), false);
      dmd.scale.set(1, 0.5, 1.6);
      dmd.rotation.y = -a;
      bowl.add(dmd);
    }
    const rotor = new THREE.Group();
    rotor.position.y = 0.03;
    bowl.add(rotor);
    const alpha = (Math.PI * 2) / WHEEL_ORDER.length;
    // The rotor's face: the pockets' colors in a ring, their numbers in a ring outside, drawn on a disc.
    // The disc's canvas has x as the rotor's x and down the canvas as its z, so pocket i is at canvas angle i·α.
    const face = canvasTexture(1024, 1024, (c) => {
      const C = 512;
      const k = C / rotorR;
      c.fillStyle = '#3b1d12';
      c.fillRect(0, 0, 1024, 1024);
      for (let i = 0; i < WHEEL_ORDER.length; i++) {
        const n = WHEEL_ORDER[i];
        const col = rouletteColor(n);
        const fill = col === 'green' ? '#0f7a3f' : col === 'red' ? '#c1121f' : '#151515';
        const a0 = (i - 0.5) * alpha;
        const a1 = (i + 0.5) * alpha;
        // The numbers' ring, outermost.
        c.fillStyle = fill;
        c.beginPath();
        c.arc(C, C, rotorR * k, a0, a1);
        c.arc(C, C, (pocketsR + 0.035) * k, a1, a0, true);
        c.closePath();
        c.fill();
        // The pocket itself, inside it, a shade darker.
        c.fillStyle = col === 'green' ? '#0b5e30' : col === 'red' ? '#9b0f19' : '#0c0c0c';
        c.beginPath();
        c.arc(C, C, (pocketsR + 0.035) * k, a0, a1);
        c.arc(C, C, (pocketsR - 0.04) * k, a1, a0, true);
        c.closePath();
        c.fill();
        // The number, upright when read from outside the wheel.
        c.save();
        c.translate(C + Math.cos(i * alpha) * (rotorR - 0.022) * k, C + Math.sin(i * alpha) * (rotorR - 0.022) * k);
        c.rotate(i * alpha + Math.PI / 2);
        c.fillStyle = '#fff5dc';
        c.font = `800 ${Math.round(0.03 * k)}px Nunito, ui-rounded, system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(n), 0, 0);
        c.restore();
      }
      // The cone in the middle, in wood with a brass ring.
      c.fillStyle = '#7a4a2a';
      c.beginPath();
      c.arc(C, C, (pocketsR - 0.04) * k, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#d4a84b';
      c.lineWidth = 6;
      c.beginPath();
      c.arc(C, C, (pocketsR - 0.04) * k, 0, Math.PI * 2);
      c.stroke();
    });
    // (Laid flat, the circle's v runs up -z, so the canvas, flipped as usual, runs down +z.)
    rotor.add(mesh(new THREE.CircleGeometry(rotorR, 64).rotateX(-Math.PI / 2), toonMap(face), 0, 0.001, 0, false));
    // Frets between the pockets, and the turret on top.
    const frets = new THREE.Group();
    const fretGeo = new THREE.BoxGeometry(0.075, 0.016, 0.004);
    for (let i = 0; i < WHEEL_ORDER.length; i++) {
      const a = (i + 0.5) * alpha;
      const f = mesh(fretGeo, brass, Math.cos(a) * pocketsR, 0.009, Math.sin(a) * pocketsR, false);
      f.rotation.y = -a;
      frets.add(f);
    }
    rotor.add(mergeByMaterial(frets));
    rotor.add(mesh(new THREE.ConeGeometry(0.17, 0.05, 32), toon('#7a4a2a'), 0, 0.025, 0, false));
    rotor.add(mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.08, 12), brass, 0, 0.07, 0, false));
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.add(mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 6).rotateZ(Math.PI / 2), brass, 0.05, 0, 0, false));
      arm.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), brass, 0.095, 0, 0, false));
      arm.position.y = 0.1;
      arm.rotation.y = (i * Math.PI) / 2;
      rotor.add(arm);
    }
    const ball = mesh(new THREE.SphereGeometry(0.0105, 14, 10), toon('#fbfbf6'), trackR - 0.01, 0.1, 0, false) as THREE.Mesh;
    ball.visible = false;
    bowl.add(ball);
    const wrap = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const wheel: RouletteWheel = {
      bowl,
      rotor,
      ball,
      radii: { track: trackR - 0.012, pockets: pocketsR, rotor: rotorR },
      heights: { track: 0.1, pocket: 0.03 + 0.011 },
      pocketAngle: (n) => -WHEEL_ORDER.indexOf(n) * alpha,
      numberAt(angle) {
        const i = Math.round(wrap(rotor.rotation.y - angle) / alpha) % WHEEL_ORDER.length;
        return WHEEL_ORDER[i];
      },
      ballAt(angle, r, h) {
        ball.position.set(Math.cos(angle) * r, h, -Math.sin(angle) * r);
      },
    };
    group.add(g);
    lamp(T.x + 0.4, T.z, 2.4, T.rotY);
    const dealer = dealerAt(T, g, t('world.casinoCroupier'), t('world.casinoRouletteDealer'));
    const stool = stoolParts(0.62, '#1e3a8a');
    T.seats.forEach((_, i) => placeSeat(stool, `roulette-${i + 1}`, group, interactables));
    const spots = T.seats.map((s) => {
      // Chips in front of the place, on the near edge of the layout; no cards.
      const y = s.z > 0.5 ? yOutside + 0.12 : s.z < -0.5 ? y0 - 0.06 : 0;
      const x = Math.min(s.x, 1.25);
      return { cards: { x, y }, bet: { x, y } };
    });
    return {
      table: T,
      group: g,
      ...feltFrame(top),
      spots,
      dealerSpot: { x: Wh.x, y: Wh.z },
      dealer,
      chipTray: tray,
      wheel,
      numberSpot,
      betSpot,
      cell: { x: cellX, y: cellY },
    };
  })();

  // ---- The slot machines -------------------------------------------------------------------------------------
  const winners: boolean[] = [];
  const toppers: THREE.MeshBasicMaterial[] = [];
  const slotStool = stoolParts(0.68, '#6d28d9');
  const slots = SLOT_MACHINES.map((m, index): SlotMachineView => {
    const S = SLOT_SIZE;
    const g = new THREE.Group();
    g.position.set(m.x, 0, m.z);
    // Built facing +z, turned to face the room.
    g.rotation.y = m.rotY;
    const parts = new THREE.Group();
    const body = toon(['#7c1d6f', '#1e3a8a', '#9a3412'][index % 3]);
    const chrome = toon('#cfd6dd');
    parts.add(mesh(roundedBox(S.width, 0.85, S.depth, 0.05), body, 0, 0.425, 0));
    // A ledge with the buttons on it, sloping toward the player.
    const ledge = mesh(new THREE.BoxGeometry(S.width - 0.04, 0.06, 0.26), toon(INK), 0, 0.88, S.depth / 2 - 0.05);
    ledge.rotation.x = 0.25;
    parts.add(ledge);
    parts.add(mesh(roundedBox(S.width, 0.8, S.depth - 0.18, 0.05), body, 0, 1.28, -0.09));
    parts.add(mesh(new THREE.BoxGeometry(S.width + 0.02, 0.04, S.depth - 0.16), chrome, 0, 1.7, -0.09, false));
    parts.add(mesh(new THREE.BoxGeometry(S.width - 0.1, 0.5, 0.02), toon('#0b0b12'), 0, 1.28, S.depth / 2 - 0.17, false));
    // The tray at the bottom where the winnings come out.
    parts.add(mesh(new THREE.BoxGeometry(0.5, 0.08, 0.1), chrome, 0, 0.3, S.depth / 2 + 0.03, false));
    g.add(mergeByMaterial(parts));
    const buttons = [glow('#ff4d6d'), glow('#ffd166'), glow('#06d6a0')];
    buttons.forEach((b, i) => {
      const btn = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), b, -0.2 + i * 0.2, 0.93, S.depth / 2 - 0.02, false);
      btn.rotation.x = 0.25;
      g.add(btn);
    });
    // The screen behind the glass, three idle reels on it.
    const screenSize = { width: S.width - 0.18, height: 0.44 };
    const tex = canvasTexture(384, 256, (c) => drawIdleReels(c, index));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenSize.width, screenSize.height), glow('#ffffff', { map: tex })) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    screen.position.set(0, 1.28, S.depth / 2 - 0.155);
    g.add(screen);
    const reels = new THREE.Object3D();
    reels.position.set(0, 1.28, S.depth / 2 - 0.15);
    g.add(reels);
    // The topper: a lit sign over the machine.
    const topTex = canvasTexture(256, 96, (c) => {
      const grad = c.createLinearGradient(0, 0, 0, 96);
      grad.addColorStop(0, '#ffd166');
      grad.addColorStop(1, '#ff7b00');
      c.fillStyle = grad;
      c.fillRect(0, 0, 256, 96);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#7a0f1f';
      fitFont(c, ['LUCKY 7', 'JACKPOT', 'BIG WIN', 'CHERRY', 'DIAMOND', 'BAR BAR'][index % 6], 62, 236);
      c.fillText(['LUCKY 7', 'JACKPOT', 'BIG WIN', 'CHERRY', 'DIAMOND', 'BAR BAR'][index % 6], 128, 52);
    });
    const topMat = glow('#ffffff', { map: topTex });
    toppers.push(topMat);
    const topper = mesh(new THREE.BoxGeometry(S.width - 0.06, 0.3, 0.12), topMat, 0, 1.88, -0.05, false);
    g.add(topper);
    // The lever on its right side (+x here, facing out): a chrome arm with a red ball, pivoting at its foot.
    const lever = new THREE.Group();
    lever.position.set(S.width / 2 + 0.05, 1.05, 0.05);
    lever.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12).rotateZ(Math.PI / 2), chrome, -0.02, 0, 0, false));
    lever.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), chrome, 0.01, 0.21, 0, false));
    lever.add(mesh(new THREE.SphereGeometry(0.045, 12, 10), toon('#d62839'), 0.01, 0.44, 0, false));
    g.add(lever);
    group.add(g);
    winners.push(false);
    placeSeat(slotStool, `slots-${index + 1}`, group, interactables);
    return {
      index,
      group: g,
      screen,
      screenCanvas: tex.image as HTMLCanvasElement,
      screenSize,
      reels,
      lever,
      setWin: (on) => (winners[index] = on),
    };
  });
  // A carpet runner of a different color along the slots, and a lit sign over the bank.
  statics.add(mesh(new THREE.BoxGeometry(1.8, 0.01, 7.6), toon('#1f1640'), -16.2, 0.006, 0, false));
  const slotSign = canvasTexture(1024, 160, (c) => {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    fitFont(c, 'SLOTS', 120, 900);
    for (const [blur, color] of [
      [30, '#ffd166'],
      [0, '#fff6d6'],
    ] as const) {
      c.shadowColor = '#ff9f1c';
      c.shadowBlur = blur;
      c.fillStyle = color;
      c.fillText('SLOTS', 512, 86);
    }
  });
  const slotSignM = mesh(new THREE.PlaneGeometry(4.2, 0.66), glow('#ffffff', { map: slotSign, transparent: true }), R.minX + 0.08, 3.1, 0, false);
  slotSignM.rotation.y = Math.PI / 2;
  group.add(slotSignM);

  // ---- The cashier's cage and the chip board ---------------------------------------------------------------
  const C = CASHIER;
  const cageBack = R.minZ;
  const cage = new THREE.Group();
  cage.add(mesh(new THREE.BoxGeometry(C.length, C.height, C.depth), toon(WOOD), C.x, C.height / 2, C.front - C.depth / 2));
  cage.add(mesh(new THREE.BoxGeometry(C.length + 0.1, 0.05, C.depth + 0.12), toon('#e8dcc2'), C.x, C.height + 0.025, C.front - C.depth / 2));
  cage.add(mesh(new THREE.BoxGeometry(C.length, 0.08, 0.04), brass, C.x, 0.3, C.front + 0.01, false));
  // Brass bars up from the counter to a header, with a window in the middle to talk through.
  const barsTop = 2.35;
  for (let x = C.x - C.length / 2 + 0.05; x <= C.x + C.length / 2 - 0.04; x += 0.12) {
    if (Math.abs(x - C.x) < 0.45) continue;
    cage.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, barsTop - C.height, 6), brass, x, (barsTop + C.height) / 2, C.front - C.depth + 0.08, false));
  }
  cage.add(mesh(new THREE.BoxGeometry(C.length, 0.3, 0.12), toon(WOOD_DARK), C.x, barsTop + 0.15, C.front - C.depth + 0.08));
  // Its sides back to the wall.
  for (const s of [-1, 1]) cage.add(mesh(new THREE.BoxGeometry(0.1, barsTop + 0.3, C.front - cageBack), toon(WOOD_DARK), C.x + (s * C.length) / 2, (barsTop + 0.3) / 2, (C.front + cageBack) / 2));
  statics.add(cage);
  const cashTex = canvasTexture(512, 80, (c) => {
    c.fillStyle = '#3b1d12';
    c.fillRect(0, 0, 512, 80);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffd98a';
    fitFont(c, t('world.casinoCashier').toUpperCase(), 52, 480);
    c.fillText(t('world.casinoCashier').toUpperCase(), 256, 43);
  });
  group.add(mesh(new THREE.PlaneGeometry(C.length - 0.2, 0.25), glow('#ffffff', { map: cashTex }), C.x, barsTop + 0.15, C.front - C.depth + 0.141, false));
  chipStacks(
    group,
    [
      { x: C.x - 0.25, z: C.front - 0.25, n: 8, color: 1 },
      { x: C.x - 0.2, z: C.front - 0.33, n: 5, color: 2 },
      { x: C.x + 0.3, z: C.front - 0.3, n: 11, color: 4 },
      { x: C.x + 0.36, z: C.front - 0.22, n: 6, color: 3 },
    ],
    C.height + 0.05,
  );
  const cashierW = new Worker(t('world.casinoCashier'), '#b45309');
  cashierW.setStatus('idle', false);
  cashierW.setTask({ name: `🪙 ${t('world.casinoCashier')}`, summary: t('world.casinoCashierSummary') });
  cashierW.root.position.set(C.x, 0, C.front - C.depth - 0.5);
  group.add(cashierW.root);
  // The cashier is the bank (chip credit, see shared/chips.ts): walk up to the window, or look at the
  // counter or the cashier, and press E. The cage is merged in with the rest of the room, so the
  // crosshair finds it on a box round the counter and the cashier that's never drawn.
  const bank: Interactable = { kind: 'bank', x: C.x, z: C.front + 0.6, radius: BANK_REACH };
  interactables.push(bank);
  const bankBox = new THREE.Mesh(new THREE.BoxGeometry(C.length, 1.9, C.depth + 0.7), new THREE.MeshBasicMaterial({ visible: false }));
  bankBox.position.set(C.x, 0.95, C.front - (C.depth + 0.7) / 2);
  bankBox.userData.interact = bank;
  group.add(bankBox);

  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 1024;
  boardCanvas.height = Math.round((1024 * CHIP_BOARD.height) / CHIP_BOARD.width);
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = 8;
  // Over the cage's header, high on the wall where everyone can see it.
  const boardMesh = mesh(new THREE.PlaneGeometry(CHIP_BOARD.width, CHIP_BOARD.height), glow('#ffffff', { map: boardTex }), CHIP_BOARD.x, CHIP_BOARD.y, CHIP_BOARD.z + 0.035, false);
  group.add(boardMesh);
  statics.add(mesh(new THREE.BoxGeometry(CHIP_BOARD.width + 0.16, CHIP_BOARD.height + 0.16, 0.06), brass, CHIP_BOARD.x, CHIP_BOARD.y, CHIP_BOARD.z, false));
  let boardRows: readonly ChipBoardRow[] = [];
  let bankTotal = '0';
  const drawBoard = () => {
      const rows = boardRows;
      const g = boardCanvas.getContext('2d')!;
      const W = boardCanvas.width;
      const Hh = boardCanvas.height;
      g.fillStyle = '#0d0b10';
      g.fillRect(0, 0, W, Hh);
      g.strokeStyle = '#d4a84b';
      g.lineWidth = 6;
      g.strokeRect(10, 10, W - 20, Hh - 20);
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = '#ffd166';
      fitFont(g, t('world.casinoChipBoard'), 54, W - 80);
      g.fillText(t('world.casinoChipBoard'), W / 2, 46);
      const shown = [...rows].sort((a, b) => b.chips - a.chips).slice(0, 10);
      if (!shown.length) {
        g.fillStyle = '#c9c1d6';
        fitFont(g, t('world.casinoChipBoardEmpty'), 36, W - 120, 700);
        g.fillText(t('world.casinoChipBoardEmpty'), W / 2, Hh / 2 + 20);
      }
      shown.forEach((r, i) => {
        const col = i < 5 ? 0 : 1;
        const row = i % 5;
        const x = 40 + col * (W / 2);
        const y = 102 + row * 50;
        if (r.you) {
          g.fillStyle = 'rgba(255, 209, 102, 0.22)';
          g.strokeStyle = '#ffd166';
          g.lineWidth = 3;
          g.beginPath();
          g.roundRect(x - 16, y - 23, W / 2 - 48, 46, 12);
          g.fill();
          g.stroke();
        }
        g.textAlign = 'left';
        g.fillStyle = i === 0 ? '#ffd166' : '#8d86a0';
        fitFont(g, MEDALS[i] ?? `${i + 1}`, 34, 40);
        g.fillText(MEDALS[i] ?? `${i + 1}`, x - (MEDALS[i] ? 6 : 0), y);
        g.fillStyle = r.color ?? '#adb5bd';
        g.beginPath();
        g.arc(x + 58, y, 12, 0, Math.PI * 2);
        g.fill();
        if (r.online) {
          g.strokeStyle = '#06d6a0';
          g.lineWidth = 4;
          g.stroke();
        }
        g.fillStyle = r.nameColor ?? '#f4efe1';
        fitFont(g, r.name, 34, 250, 800);
        if (r.nameColor) {
          g.shadowColor = r.nameColor;
          g.shadowBlur = 14;
        }
        g.fillText(r.name, x + 82, y);
        g.shadowBlur = 0;
        g.textAlign = 'right';
        g.fillStyle = '#ffd166';
        g.font = '900 34px Nunito, ui-rounded, system-ui, sans-serif';
        g.fillText(r.chips.toLocaleString('en-US'), x + W / 2 - 80, y);
      });
      // The house bank, along the bottom under a rule: every stake lost in the casino (see shared/housebank.ts).
      g.strokeStyle = 'rgba(212, 168, 75, 0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(40, Hh - 72);
      g.lineTo(W - 40, Hh - 72);
      g.stroke();
      const bankLine = `${t('world.casinoHouseBank')}: ${formatChips(bankTotal, locale())}`;
      g.textAlign = 'center';
      g.fillStyle = '#ffd166';
      fitFont(g, bankLine, 38, W - 100, 900);
      g.fillText(bankLine, W / 2, Hh - 40);
      boardTex.needsUpdate = true;
  };
  const chipBoard: ChipBoard = {
    mesh: boardMesh,
    setRows(rows) {
      boardRows = rows;
      drawBoard();
    },
    setBank(total) {
      if (total === bankTotal) return;
      bankTotal = total;
      drawBoard();
    },
  };
  chipBoard.setRows([]);

  // The Crash scoreboard, next to the Crash screen on the west wall, in the chip board's colours.
  const crashCanvas = document.createElement('canvas');
  crashCanvas.width = 1024;
  crashCanvas.height = Math.round((1024 * CRASH_BOARD.height) / CRASH_BOARD.width);
  const crashTex = new THREE.CanvasTexture(crashCanvas);
  crashTex.colorSpace = THREE.SRGBColorSpace;
  crashTex.anisotropy = 8;
  const crashMesh = mesh(new THREE.PlaneGeometry(CRASH_BOARD.width, CRASH_BOARD.height), glow('#ffffff', { map: crashTex }), CRASH_BOARD.x + 0.035, CRASH_BOARD.y, CRASH_BOARD.z, false);
  crashMesh.rotation.y = Math.PI / 2;
  group.add(crashMesh);
  statics.add(mesh(new THREE.BoxGeometry(0.06, CRASH_BOARD.height + 0.16, CRASH_BOARD.width + 0.16), brass, CRASH_BOARD.x, CRASH_BOARD.y, CRASH_BOARD.z, false));
  const crashBoard: CrashBoardView = {
    mesh: crashMesh,
    setBoard(board) {
      const g = crashCanvas.getContext('2d')!;
      const W = crashCanvas.width;
      const Hh = crashCanvas.height;
      g.fillStyle = '#0d0b10';
      g.fillRect(0, 0, W, Hh);
      g.strokeStyle = '#d4a84b';
      g.lineWidth = 6;
      g.strokeRect(10, 10, W - 20, Hh - 20);
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = '#ff5ca8';
      fitFont(g, t('world.crashBoardTitle'), 60, W - 80);
      g.fillText(t('world.crashBoardTitle'), W / 2, 62);
      // One ranking: its heading, then a row each, the amount on the right (and on the most won, the biggest win).
      const ranking = (top: number, title: string, empty: string, rows: readonly CrashBoardRow[], won: boolean) => {
        g.textAlign = 'left';
        g.fillStyle = '#ffd166';
        fitFont(g, title, 42, W - 100);
        g.fillText(title, 40, top);
        g.fillStyle = '#d4a84b';
        g.fillRect(40, top + 30, W - 80, 3);
        if (!rows.length) {
          g.textAlign = 'center';
          g.fillStyle = '#c9c1d6';
          fitFont(g, empty, 34, W - 120, 700);
          g.fillText(empty, W / 2, top + 150);
        }
        rows.slice(0, 10).forEach((r, i) => {
          const y = top + 80 + i * 50;
          if (r.you) {
            g.fillStyle = 'rgba(255, 209, 102, 0.22)';
            g.strokeStyle = '#ffd166';
            g.lineWidth = 3;
            g.beginPath();
            g.roundRect(28, y - 23, W - 56, 46, 12);
            g.fill();
            g.stroke();
          }
          g.textAlign = 'left';
          g.fillStyle = i === 0 ? '#ffd166' : '#8d86a0';
          fitFont(g, MEDALS[i] ?? `${i + 1}`, 32, 40);
          g.fillText(MEDALS[i] ?? `${i + 1}`, 40 - (MEDALS[i] ? 6 : 0), y);
          g.fillStyle = r.color ?? '#adb5bd';
          g.beginPath();
          g.arc(100, y, 11, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#f4efe1';
          fitFont(g, r.name, 32, won ? 320 : 520, 800);
          g.fillText(r.name, 124, y);
          g.textAlign = 'right';
          const amount = won ? `+${r.net.toLocaleString('en-US')}` : r.wagered.toLocaleString('en-US');
          g.fillStyle = won ? '#7ae582' : '#ffd166';
          fitFont(g, amount, 32, 210);
          g.fillText(amount, W - 50, y);
          if (won && r.best) {
            const best = t('world.crashBoardBest', { won: r.best.won.toLocaleString('en-US'), m: multText(r.best.m) });
            g.fillStyle = '#8d86a0';
            fitFont(g, best, 26, 270, 700);
            g.fillText(best, W - 280, y);
          }
        });
      };
      ranking(150, `🚀 ${t('world.crashBoardWagered')}`, t('world.crashBoardEmptyWagered'), board.wagered, false);
      ranking(Math.round(Hh / 2) + 80, `💰 ${t('world.crashBoardWon')}`, t('world.crashBoardEmptyWon'), board.won, true);
      crashTex.needsUpdate = true;
    },
  };
  crashBoard.setBoard({ wagered: [], won: [] });

  // ---- The Plinko machine ---------------------------------------------------------------------------------------
  // A tall cabinet in black lacquer and brass standing on its own in the middle of the hall, the
  // board on a big screen in its front (see world/plinkoboard.ts), a pink neon PLINKO over it, and a
  // brass shelf under the screen. Built facing +z in its own frame, then turned to face north.
  const plinko = ((): PlinkoMachineView => {
    const P = PLINKO_MACHINE;
    const m = new THREE.Group();
    m.name = 'plinko-machine';
    const body = P.height - 0.45;
    const front = P.depth / 2;
    const lacquer = toon('#16121c');
    m.add(mesh(new THREE.BoxGeometry(P.width + 0.12, 0.14, P.depth + 0.12), toon(WOOD_DARK), 0, 0.07, 0));
    m.add(mesh(roundedBox(P.width, body - 0.14, P.depth, 0.08), lacquer, 0, 0.14 + (body - 0.14) / 2, 0));
    // Brass down the front edges and round the screen.
    for (const sx of [-1, 1]) m.add(mesh(new THREE.BoxGeometry(0.05, body - 0.14, 0.05), brass, (sx * (P.width - 0.02)) / 2, 0.14 + (body - 0.14) / 2, front, false));
    const sw = P.screen.width;
    const sh = P.screen.height;
    m.add(mesh(new THREE.BoxGeometry(sw + 0.12, sh + 0.12, 0.04), brass, 0, P.screenY, front + 0.005, false));
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = Math.round((1024 * sh) / sw);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const screen = mesh(new THREE.PlaneGeometry(sw, sh), glow('#ffffff', { map: texture }), 0, P.screenY, front + 0.03, false);
    m.add(screen);
    // The shelf under the screen, where you'd lean while you play.
    m.add(mesh(new THREE.BoxGeometry(sw + 0.1, 0.05, 0.22), brass, 0, P.screenY - sh / 2 - 0.12, front + 0.1, false));
    // The sign on top: a lacquer box with the neon on its front, and a line of bulbs under it.
    const sign = canvasTexture(1024, 256, (c) => {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      fitFont(c, 'PLINKO', 170, 900);
      for (const [blur, color] of [
        [40, '#ff2bd6'],
        [14, '#ff6be6'],
        [0, '#ffe3fb'],
      ] as const) {
        c.shadowColor = '#ff2bd6';
        c.shadowBlur = blur;
        c.fillStyle = color;
        c.fillText('PLINKO', 512, 136);
      }
    });
    m.add(mesh(new THREE.BoxGeometry(P.width + 0.1, 0.45, P.depth * 0.7), lacquer, 0, body + 0.225, -0.04));
    m.add(mesh(new THREE.BoxGeometry(P.width + 0.14, 0.035, P.depth * 0.7 + 0.04), brass, 0, body + 0.02, -0.04, false));
    const signMat = glow('#ffffff', { map: sign, transparent: true });
    m.add(mesh(new THREE.PlaneGeometry(P.width - 0.1, 0.42), signMat, 0, body + 0.24, P.depth * 0.31 + 0.002, false));
    // A neon strip down each side of the screen, in the board's colours.
    const strip = glow('#ff9f43');
    for (const sx of [-1, 1]) m.add(mesh(new THREE.BoxGeometry(0.03, sh, 0.03), strip, sx * (sw / 2 + 0.11), P.screenY, front + 0.02, false));
    m.position.set(P.x, 0, P.z);
    m.rotation.y = P.rotY;
    group.add(m);
    // Its front, on the floor (it faces -z): where you stand to play.
    const out = P.depth / 2 + 1.1;
    const interactable: Interactable = { kind: 'plinko', x: P.x + Math.sin(P.rotY) * out, z: P.z + Math.cos(P.rotY) * out, radius: 1.6 };
    interactables.push(interactable);
    // E by crosshair anywhere on the cabinet: a box round it that's never drawn.
    const aim = new THREE.Mesh(new THREE.BoxGeometry(P.width, P.height, P.depth + 0.1), new THREE.MeshBasicMaterial({ visible: false }));
    aim.position.set(0, P.height / 2, 0.05);
    aim.userData.interact = interactable;
    screen.userData.interact = interactable;
    m.add(aim);
    return { group: m, screen, canvas, texture, interactable, where: { x: P.x + Math.sin(P.rotY) * front, y: P.screenY, z: P.z + Math.cos(P.rotY) * front } };
  })();
  // A warm light on the machine's front.
  light('#ffb3e6', 2.5, PLINKO_MACHINE.x, 2.6, PLINKO_MACHINE.z - 1.6, 5);

  // ---- The trading desk ---------------------------------------------------------------------------------------
  // A big chart screen on the east wall between the cashier's cage and the bar, in a black frame
  // with a cyan neon strip under it, and in front of it a dark trading desk with a brass top, a row
  // of three small monitors (green and red tickers) and a lamp. You stand on its west side and
  // look over it at the screen. The screen's drawn by world/marketscreen.ts.
  const market = ((): MarketDeskView => {
    const S = MARKET_SCREEN;
    const D = TRADING_DESK;
    const m = new THREE.Group();
    m.name = 'trading-desk';
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = Math.round((1280 * S.height) / S.width);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const screen = mesh(new THREE.PlaneGeometry(S.width, S.height), glow('#ffffff', { map: texture }), S.x - 0.06, S.y, S.z, false);
    screen.rotation.y = -Math.PI / 2;
    m.add(screen);
    m.add(mesh(new THREE.BoxGeometry(0.08, S.height + 0.22, S.width + 0.22), toon('#15131a'), S.x - 0.01, S.y, S.z, false));
    m.add(mesh(new THREE.BoxGeometry(0.04, 0.05, S.width + 0.22), glow('#4cc9f0'), S.x - 0.06, S.y - S.height / 2 - 0.16, S.z, false));
    // The desk: a dark body, a brass top, and a modesty panel on the side toward the room.
    const body = toon('#1b1f2a');
    m.add(mesh(roundedBox(D.depth, D.height - 0.05, D.length, 0.05), body, D.x, (D.height - 0.05) / 2, D.z));
    m.add(mesh(new THREE.BoxGeometry(D.depth + 0.12, 0.05, D.length + 0.12), brass, D.x, D.height - 0.025, D.z, false));
    // Three monitors along it, turned a little toward whoever stands in front, each with a ticker on it.
    const ticker = (up: boolean) =>
      canvasTexture(256, 160, (g) => {
        g.fillStyle = '#0b1118';
        g.fillRect(0, 0, 256, 160);
        g.strokeStyle = up ? '#3ddc84' : '#ff4d6d';
        g.lineWidth = 6;
        g.beginPath();
        for (let i = 0; i <= 12; i++) {
          const y = 80 + (up ? -1 : 1) * (i * 4.5) + Math.sin(i * 1.7) * 14;
          if (i) g.lineTo(14 + i * 19, y);
          else g.moveTo(14, y);
        }
        g.stroke();
      });
    const tickers = [glow('#ffffff', { map: ticker(true) }), glow('#ffffff', { map: ticker(false) })];
    const frame = toon('#0d0f14');
    [-1.05, 0, 1.05].forEach((dz, i) => {
      const mon = new THREE.Group();
      mon.add(mesh(new THREE.BoxGeometry(0.04, 0.36, 0.56), frame, 0, 0, 0, false));
      const face = mesh(new THREE.PlaneGeometry(0.52, 0.32), tickers[i % 2], -0.022, 0, 0, false);
      face.rotation.y = -Math.PI / 2;
      mon.add(face);
      mon.add(mesh(new THREE.BoxGeometry(0.03, 0.18, 0.03), frame, 0.02, -0.25, 0, false));
      mon.add(mesh(new THREE.BoxGeometry(0.16, 0.02, 0.2), frame, 0.02, -0.34, 0, false));
      mon.position.set(D.x + 0.12, D.height + 0.36, D.z + dz);
      mon.rotation.y = -dz * 0.25;
      m.add(mon);
    });
    group.add(m);
    // E at the desk's front, on the room's side of it (or by crosshair at the desk or the screen).
    const interactable: Interactable = { kind: 'market', x: D.x - D.depth / 2 - 0.9, z: D.z, radius: D.reach };
    interactables.push(interactable);
    const aim = new THREE.Mesh(new THREE.BoxGeometry(D.depth + 0.1, D.height + 0.8, D.length), new THREE.MeshBasicMaterial({ visible: false }));
    aim.position.set(D.x, (D.height + 0.8) / 2, D.z);
    aim.userData.interact = interactable;
    m.add(aim);
    screen.userData.interact = interactable;
    return { group: m, screen, canvas, texture, interactable, where: { x: S.x - 0.5, y: S.y, z: S.z } };
  })();
  // A cool light over the desk.
  light('#9fdcff', 3, TRADING_DESK.x - 1, 2.8, TRADING_DESK.z, 6);

  // ---- The house bank's machine -------------------------------------------------------------------------------------
  // A vault standing against the south wall: a gunmetal cabinet with brass edges, a round vault door
  // with a spoked wheel in its lower half, an ATM's screen over it (the bank's total, in gold for
  // everyone), a keypad and a slot under the screen, and a gold HOUSE BANK sign on top. Built facing
  // +z in its own frame, then turned to face north into the hall.
  const houseBank = ((): HouseBankMachineView => {
    const V = HOUSE_BANK_MACHINE;
    const m = new THREE.Group();
    m.name = 'house-bank-machine';
    const front = V.depth / 2;
    const steel = toon('#3a4150');
    const steelDark = toon('#232833');
    const body = V.height - 0.4;
    m.add(mesh(new THREE.BoxGeometry(V.width + 0.1, 0.12, V.depth + 0.08), steelDark, 0, 0.06, 0));
    m.add(mesh(roundedBox(V.width, body - 0.12, V.depth, 0.06), steel, 0, 0.12 + (body - 0.12) / 2, 0));
    for (const sx of [-1, 1]) m.add(mesh(new THREE.BoxGeometry(0.05, body - 0.12, 0.05), brass, (sx * (V.width - 0.02)) / 2, 0.12 + (body - 0.12) / 2, front, false));
    // The vault door: a thick brass-rimmed disc, bolts round it, and a wheel with four spokes.
    const doorY = 0.62;
    const door = new THREE.Group();
    door.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 40).rotateX(Math.PI / 2), steelDark, 0, 0, 0.03, false));
    door.add(mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 40), brass, 0, 0, 0.05, false));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      door.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), brass, Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0.065, false));
    }
    door.add(mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 28), brass, 0, 0, 0.11, false));
    for (let i = 0; i < 4; i++) {
      const spoke = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 6), brass, 0, 0, 0.11, false);
      spoke.rotation.z = (i * Math.PI) / 4;
      door.add(spoke);
    }
    door.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 16).rotateX(Math.PI / 2), brass, 0, 0, 0.1, false));
    door.position.set(0, doorY, front);
    m.add(door);
    // The screen, in a brass frame, with a keypad and a card slot on a shelf under it.
    const sw = V.screen.width;
    const sh = V.screen.height;
    m.add(mesh(new THREE.BoxGeometry(sw + 0.1, sh + 0.1, 0.04), brass, 0, V.screenY, front + 0.005, false));
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = Math.round((768 * sh) / sw);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const screen = mesh(new THREE.PlaneGeometry(sw, sh), glow('#ffffff', { map: texture }), 0, V.screenY, front + 0.03, false);
    m.add(screen);
    const shelfY = V.screenY - sh / 2 - 0.12;
    m.add(mesh(new THREE.BoxGeometry(sw + 0.06, 0.04, 0.2), steelDark, 0, shelfY, front + 0.09, false));
    const key = toon('#c9ced8');
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m.add(mesh(new THREE.BoxGeometry(0.05, 0.015, 0.035), key, -0.32 + col * 0.07, shelfY + 0.028, front + 0.05 + row * 0.05, false));
    m.add(mesh(new THREE.BoxGeometry(0.26, 0.02, 0.012), toon('#0b0d12'), 0.25, shelfY + 0.1, front + 0.004, false));
    m.add(mesh(new THREE.BoxGeometry(0.28, 0.01, 0.01), glow('#3ddc84'), 0.25, shelfY + 0.075, front + 0.006, false));
    // The sign on top: a dark box with the name in gold on its front.
    const signText = t('world.casinoHouseBank');
    const sign = canvasTexture(1024, 192, (c) => {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      fitFont(c, signText, 120, 960);
      c.shadowColor = '#ffb300';
      c.shadowBlur = 26;
      c.fillStyle = '#ffd166';
      c.fillText(signText, 512, 104);
    });
    m.add(mesh(new THREE.BoxGeometry(V.width + 0.06, 0.34, V.depth * 0.8), steelDark, 0, body + 0.17, -0.03));
    m.add(mesh(new THREE.BoxGeometry(V.width + 0.1, 0.03, V.depth * 0.8 + 0.04), brass, 0, body + 0.015, -0.03, false));
    m.add(mesh(new THREE.PlaneGeometry(V.width - 0.04, 0.26), glow('#ffffff', { map: sign, transparent: true }), 0, body + 0.18, V.depth * 0.37 + 0.002, false));
    m.position.set(V.x, 0, V.z);
    m.rotation.y = V.rotY;
    group.add(m);
    // Where you stand: in front of it, out in the hall.
    const out = front + 0.9;
    const interactable: Interactable = { kind: 'housebank', x: V.x + Math.sin(V.rotY) * out, z: V.z + Math.cos(V.rotY) * out, radius: V.reach };
    interactables.push(interactable);
    const aim = new THREE.Mesh(new THREE.BoxGeometry(V.width, V.height, V.depth + 0.1), new THREE.MeshBasicMaterial({ visible: false }));
    aim.position.set(0, V.height / 2, 0.05);
    aim.userData.interact = interactable;
    screen.userData.interact = interactable;
    m.add(aim);
    let shown = '';
    const setTotal = (total: string) => {
      if (total === shown) return;
      shown = total;
      const g = canvas.getContext('2d')!;
      const W = canvas.width;
      const Hh = canvas.height;
      const bg = g.createLinearGradient(0, 0, 0, Hh);
      bg.addColorStop(0, '#0d1b2a');
      bg.addColorStop(1, '#08111c');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, Hh);
      g.strokeStyle = 'rgba(255, 209, 102, 0.55)';
      g.lineWidth = 6;
      g.strokeRect(12, 12, W - 24, Hh - 24);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#c9d6e8';
      fitFont(g, signText, 44, W - 80, 800);
      g.fillText(signText, W / 2, 78);
      const n = formatChips(total, locale());
      g.fillStyle = '#ffd166';
      g.shadowColor = '#ffb300';
      g.shadowBlur = 18;
      fitFont(g, n, 140, W - 80, 900);
      g.fillText(n, W / 2, Hh / 2 + 10);
      g.shadowBlur = 0;
      g.fillStyle = '#8fa3bf';
      fitFont(g, t('world.casinoHouseBankChips'), 40, W - 80, 800);
      g.fillText(t('world.casinoHouseBankChips'), W / 2, Hh - 64);
      texture.needsUpdate = true;
    };
    setTotal('0');
    return { group: m, setTotal, interactable, canvas };
  })();
  // A warm light on its front.
  light('#ffd9a0', 2.2, HOUSE_BANK_MACHINE.x, 2.6, HOUSE_BANK_MACHINE.z - 1.4, 5);

  // ---- The bar and the lounge ----------------------------------------------------------------------------------
  const B = CASINO_BAR;
  const blen = B.maxZ - B.minZ;
  const bz = (B.minZ + B.maxZ) / 2;
  const front = B.x - B.depth / 2;
  const bar = new THREE.Group();
  bar.add(mesh(new THREE.BoxGeometry(B.depth, B.height - 0.06, blen), toon(WOOD), B.x, (B.height - 0.06) / 2, bz));
  bar.add(mesh(new THREE.BoxGeometry(B.depth + 0.2, 0.06, blen + 0.2), toon('#1b1b1f'), B.x - 0.05, B.height - 0.03, bz));
  const footRail = mesh(new THREE.CylinderGeometry(0.03, 0.03, blen, 8), brass, front - 0.2, 0.22, bz, false);
  footRail.rotation.x = Math.PI / 2;
  bar.add(footRail);
  // The back bar: shelves of bottles against a warm glow.
  const back = R.maxX - 0.3;
  bar.add(mesh(new THREE.BoxGeometry(0.5, 1.0, blen - 0.4), toon(WOOD_DARK), back, 0.5, bz));
  const bottles = new THREE.Group();
  const bottleColors = ['#2a9d8f', '#e9c46a', '#8ecae6', '#6a994e', '#bc4749', '#f4a261'];
  let k = 0;
  for (const y of [1.2, 1.7, 2.2]) {
    bar.add(mesh(new THREE.BoxGeometry(0.34, 0.04, blen - 0.8), toon(WOOD_DARK), R.maxX - 0.2, y - 0.02, bz, false));
    for (let z = B.minZ + 0.6; z < B.maxZ - 0.5; z += 0.26) {
      const hgt = 0.26 + ((k * 7) % 5) * 0.03;
      const c = bottleColors[k++ % bottleColors.length];
      bottles.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, hgt, 8), toon(c), R.maxX - 0.2, y + hgt / 2, z, false));
    }
  }
  bar.add(bottles);
  statics.add(bar);
  group.add(mesh(new THREE.PlaneGeometry(blen - 0.8, 1.5).rotateY(-Math.PI / 2), glow('#b8641f'), R.maxX - 0.05, 1.75, bz, false));
  group.add(mesh(new THREE.BoxGeometry(0.02, 0.05, blen), glow('#ff2bd6'), front - 0.02, 0.06, bz, false));
  const bartender = buildCasinoBartender(group, interactables);
  const barStool = stoolParts(0.74, '#9b1d20');
  for (let i = 1; i <= 5; i++) placeSeat(barStool, `casino-stool-${i}`, group, interactables);

  // The lounge: a round rug, a low table with a bowl of chips (the other kind) on it, three sofas and a lamp.
  const Lg = CASINO_LOUNGE;
  statics.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.012, 40), toon('#13314a'), Lg.x, 0.007, Lg.z, false));
  statics.add(mesh(new THREE.TorusGeometry(2.45, 0.03, 4, 48).rotateX(Math.PI / 2), brass, Lg.x, 0.014, Lg.z, false));
  statics.add(mesh(roundedBox(1.2, 0.08, 0.8, 0.04), toon('#1b1b1f'), Lg.x, 0.4, Lg.z));
  for (const [sx, sz] of [
    [-0.5, -0.32],
    [0.5, -0.32],
    [-0.5, 0.32],
    [0.5, 0.32],
  ])
    statics.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.38, 6), brass, Lg.x + sx, 0.19, Lg.z + sz, false));
  colliders.push({ minX: Lg.x - 0.6, maxX: Lg.x + 0.6, minZ: Lg.z - 0.4, maxZ: Lg.z + 0.4, top: 0.44 });
  const velvet = toon('#5b1530');
  const sofa = (id: string, len: number) => {
    const s = CASINO_SEATING.find((x) => x.id === id)!;
    const g = new THREE.Group();
    g.add(mesh(roundedBox(len, 0.3, 0.9, 0.08), velvet, 0, 0.15, 0));
    g.add(mesh(roundedBox(len - 0.1, 0.16, 0.8, 0.08), velvet, 0, 0.38, 0.03));
    g.add(mesh(roundedBox(len, 0.55, 0.2, 0.08), velvet, 0, 0.62, -0.36));
    for (const sx of [-1, 1]) g.add(mesh(roundedBox(0.16, 0.5, 0.9, 0.06), velvet, sx * (len / 2 - 0.08), 0.35, 0));
    g.add(mesh(new THREE.BoxGeometry(len, 0.03, 0.04), brass, 0, 0.9, -0.36, false));
    const merged = mergeByMaterial(g);
    merged.position.set(s.x, 0, s.z);
    merged.rotation.y = s.rotY;
    seatable(merged, id, 1.5, interactables);
    group.add(merged);
    const turned = Math.abs(Math.sin(s.rotY)) > 0.5;
    const hw = (turned ? 0.9 : len) / 2;
    const hd = (turned ? len : 0.9) / 2;
    colliders.push({ minX: s.x - hw, maxX: s.x + hw, minZ: s.z - hd, maxZ: s.z + hd, top: 0.5 });
  };
  sofa('casino-sofa-1', 2.4);
  sofa('casino-sofa-2', 1.8);
  sofa('casino-sofa-3', 1.8);
  // A floor lamp in the corner, and palms in brass pots here and there.
  const lampX = Lg.x + 2.3;
  const lampZ = Lg.z + 2.1;
  statics.add(mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 14), brass, lampX, 0.02, lampZ, false));
  statics.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 6), brass, lampX, 0.8, lampZ, false));
  group.add(mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.3, 16, 1, true), glow('#ffcf8a'), lampX, 1.65, lampZ, false));
  const leaf = toon('#2f7d4a');
  const palm = (x: number, z: number) => {
    statics.add(mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.5, 12), brass, x, 0.25, z));
    statics.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 6), toon('#6b4a2a'), x, 1.05, z, false));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const f = mesh(new THREE.ConeGeometry(0.14, 0.9, 4), leaf, x + Math.cos(a) * 0.32, 1.6, z + Math.sin(a) * 0.32, false);
      f.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
      statics.add(f);
    }
    colliders.push({ minX: x - 0.28, maxX: x + 0.28, minZ: z - 0.28, maxZ: z + 0.28, top: 0.5 });
  };
  palm(R.minX + 0.6, R.minZ + 0.6);
  palm(R.minX + 0.6, R.maxZ - 0.6);
  palm(R.maxX - 0.6, R.maxZ - 0.6);
  palm(5.9, R.minZ + 0.6);
  palm(11.4, R.minZ + 0.6);

  // ---- What stops you: the tables, the machines, the counters (see casinoFootprints) -----------------------------
  for (const f of casinoFootprints()) colliders.push({ minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ, top: f.top });

  group.add(mergeByMaterial(statics));

  // ---- Moving -----------------------------------------------------------------------------------------------------
  // ---- The shop, off the main hall -------------------------------------------------------------------------------
  const shop = buildCasinoShop(group, colliders, interactables);

  const workers = [poker.dealer, blackjack.dealer, roulette.dealer, cashierW, bartender, shop];
  const tmp = new THREE.Color();
  return {
    group,
    colliders,
    interactables,
    elevator,
    pickables: group.children,
    poker,
    blackjack,
    roulette,
    slots,
    chipBoard,
    crashBoard,
    plinko,
    market,
    houseBank,
    cashier: { at: { x: C.x, z: C.front + 0.6 }, worker: cashierW },
    shop,
    update(time, dt) {
      elevator.update(dt);
      for (const wk of workers) wk.update(dt, time);
      // The marquee's bulbs chase under the sign; the neon hums.
      const step = Math.floor(time * 6);
      marquee.forEach((b, i) => (b.material = bulbs[(i + step) % 2]));
      neonMat.opacity = 0.92 + 0.08 * Math.sin(time * 2.3) * Math.sin(time * 7.1);
      // The slots' toppers breathe, each out of step; a winning one flashes.
      toppers.forEach((m, i) => {
        const v = winners[i] ? (Math.floor(time * 8) % 2 ? 1.25 : 0.5) : 0.8 + 0.2 * Math.sin(time * 2 + i * 1.3);
        m.color.setScalar(v);
      });
      slotGlow.color.copy(tmp.setHSL((time * 0.03) % 1, 0.8, 0.6));
    },
  };
}

/** Three reels at rest on a slot machine's screen: a seven, a cherry and a bar, a different line on each machine. */
function drawIdleReels(c: CanvasRenderingContext2D, index: number) {
  const W = 384;
  const H = 256;
  c.fillStyle = '#120a1f';
  c.fillRect(0, 0, W, H);
  const symbols = ['7', '🍒', 'BAR', '🔔', '💎', '🍋'];
  const colors = ['#d62839', '#d62839', '#111111', '#e9b949', '#1d8cf8', '#e9c46a'];
  for (let r = 0; r < 3; r++) {
    const x = 16 + r * 120;
    const grad = c.createLinearGradient(0, 12, 0, H - 12);
    grad.addColorStop(0, '#b8b2c4');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#b8b2c4');
    c.fillStyle = grad;
    c.fillRect(x, 12, 112, H - 24);
    for (let k = -1; k <= 1; k++) {
      const s = (index + r * 2 + k + 6) % symbols.length;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = colors[s];
      c.globalAlpha = k === 0 ? 1 : 0.45;
      c.font = symbols[s] === 'BAR' ? '900 34px Nunito, sans-serif' : '900 54px Nunito, sans-serif';
      c.fillText(symbols[s], x + 56, H / 2 + k * 78);
    }
    c.globalAlpha = 1;
  }
  // The pay line across the middle.
  c.strokeStyle = 'rgba(255, 77, 109, 0.8)';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(8, H / 2);
  c.lineTo(W - 8, H / 2);
  c.stroke();
}
