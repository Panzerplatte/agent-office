import * as THREE from 'three';
import { RINGS, SECTORS, SECTOR_ANGLE, emptyDarts, type Dart, type DartsState } from '../../shared/darts';
import { t } from '../i18n';
import { DARTBOARD, FLOOR } from '../../shared/layout';
import type { Collider } from './office';
import { bulb, type NightParts } from './outside';
import { mergeByMaterial, mesh, roundedBox, toon, toonUnique } from './toon';

// The dartboard on the lounge's east wall: a regulation bristle board in an open wooden cabinet, with
// chalkboards on the insides of its doors (the scores go up on them while there's a game on), a little lamp over it, and a metal oche on the floor.

/**
 * The board's size, in meters: its sectors and rings are the rules' own (SECTORS and RINGS in
 * shared/darts.ts), so a dart scores what it looks like it hit.
 */
export const BOARD = {
  /** The whole board, out to the edge of the number ring: 451 mm across. */
  radius: 0.2255,
  thick: 0.038,
} as const;

const BLACK = '#1d1d1f';
const CREAM = '#efe2c0';
const RED = '#d62828';
const GREEN = '#1f8a4c';
const WIRE = '#c9ced6';
const WOOD = '#8a5a3b';
const WOOD_DARK = '#6b4226';
const CHALK = '#2f3b36';
const INK = '#2b2d42';

export interface DartboardView {
  group: THREE.Group;
  /** The cabinet, its open doors and the lamp over it, to walk into. */
  colliders: Collider[];
  /** The picture lamp over the cabinet: its arm, shade and bulb. */
  lamp: THREE.Object3D;
  /**
   * The world point at board-local (x, y) meters from the middle of the face (x to the right as you
   * face it, y up), `out` meters in front of it (negative: into the board, where a dart's tip goes).
   */
  toWorld(x: number, y: number, out?: number, target?: THREE.Vector3): THREE.Vector3;
  /** The other way: where a world point is, in the board's own meters. */
  toBoard(p: THREE.Vector3): { x: number; y: number; out: number };
  /** The way the face looks, out into the room. */
  readonly normal: THREE.Vector3;
  /** Puts the game up on the doors' chalkboards: the scores on the left, the turn (`turn`, the darts in the board) on the right. */
  chalk(d: DartsState, turn: ShownTurn | null): void;
}

/** A turn as the board shows it: whose it is, the darts of it that are in the board, whether it went bust, and whether it's over (its last dart is in). */
export interface ShownTurn {
  player: string;
  darts: Dart[];
  bust: boolean;
  done: boolean;
}

/** The face, drawn to a canvas: the sectors and rings, the wire, and the numbers round the edge. */
function faceTexture(): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const mid = S / 2;
  const px = mid / BOARD.radius;
  const step = SECTOR_ANGLE;
  // Canvas angles run clockwise from +x; sector i is centred i steps clockwise from straight up.
  const from = (i: number) => -Math.PI / 2 + (i - 0.5) * step;
  const wedge = (r0: number, r1: number, i: number, color: string) => {
    g.beginPath();
    g.arc(mid, mid, r1 * px, from(i), from(i + 1));
    g.arc(mid, mid, r0 * px, from(i + 1), from(i), true);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  const disc = (r: number, color: string) => {
    g.beginPath();
    g.arc(mid, mid, r * px, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  };

  // The black number ring, then each sector out from the bull: single, triple, single, double.
  disc(BOARD.radius, BLACK);
  const { bull, outerBull, tripleIn: t0, tripleOut: t1, doubleIn: d0, doubleOut: d1 } = RINGS;
  for (let i = 0; i < SECTORS.length; i++) {
    const even = i % 2 === 0;
    const single = even ? BLACK : CREAM;
    const ring = even ? RED : GREEN;
    wedge(outerBull, t0, i, single);
    wedge(t0, t1, i, ring);
    wedge(t1, d0, i, single);
    wedge(d0, d1, i, ring);
  }
  disc(outerBull, GREEN);
  disc(bull, RED);

  // The wire: round every ring, and out along the sector edges from the bull to the double.
  g.strokeStyle = WIRE;
  g.lineWidth = 2.2;
  for (const r of [bull, outerBull, t0, t1, d0, d1]) {
    g.beginPath();
    g.arc(mid, mid, r * px, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < SECTORS.length; i++) {
    const a = from(i);
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * outerBull * px, mid + Math.sin(a) * outerBull * px);
    g.lineTo(mid + Math.cos(a) * d1 * px, mid + Math.sin(a) * d1 * px);
    g.stroke();
  }

  // The numbers, upright, round the ring outside the double.
  const numR = ((d1 + BOARD.radius) / 2) * px;
  g.fillStyle = '#f4f1e8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(0.032 * px)}px Nunito, ui-rounded, system-ui, sans-serif`;
  SECTORS.forEach((n, i) => {
    const a = -Math.PI / 2 + i * step;
    g.fillText(String(n), mid + Math.cos(a) * numR, mid + Math.sin(a) * numR + 2);
  });
  // A thin wire round the outside of the numbers, as the number ring has.
  g.strokeStyle = WIRE;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(mid, mid, (BOARD.radius - 0.004) * px, 0, Math.PI * 2);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A door's chalkboard: its canvas, the smudges of old games wiped off it, and the texture it shows. */
interface Chalk {
  canvas: HTMLCanvasElement;
  smudges: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
}

const CHALK_W = 192;
const CHALK_H = 480;
const CHALK_INK = 'rgba(240,240,232,0.88)';
const CHALK_FONT = (px: number) => `800 ${px}px Nunito, ui-rounded, system-ui, sans-serif`;

function chalkboard(): Chalk {
  const smudges = document.createElement('canvas');
  smudges.width = CHALK_W;
  smudges.height = CHALK_H;
  const g = smudges.getContext('2d')!;
  g.fillStyle = CHALK;
  g.fillRect(0, 0, CHALK_W, CHALK_H);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.03})`;
    g.beginPath();
    g.ellipse(Math.random() * CHALK_W, Math.random() * CHALK_H, 15 + Math.random() * 45, 9 + Math.random() * 21, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const canvas = document.createElement('canvas');
  canvas.width = CHALK_W;
  canvas.height = CHALK_H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, smudges, tex };
}

/** Writes `text` at (x, y) `px` high, smaller if that's what it takes to fit across the door. */
function chalkText(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number) {
  g.font = CHALK_FONT(px);
  const w = g.measureText(text).width;
  const room = CHALK_W - 24;
  if (w > room) g.font = CHALK_FONT(Math.floor((px * room) / w));
  g.fillText(text, x, y);
}

/** A name short enough for a door: chalk takes room. */
const chalkName = (name: string) => (name.length > 9 ? `${name.slice(0, 8)}…` : name);

/**
 * The left door keeps the scores: the game at the top (301 or 501, and D/O for double-out), then
 * each player in their colour with what they have left, the one who's up marked. With no game on,
 * it's ruled up for the next one.
 */
function drawScores(c: Chalk, d: DartsState) {
  const g = c.canvas.getContext('2d')!;
  g.drawImage(c.smudges, 0, 0);
  const game = d.game;
  const mid = CHALK_W / 2;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = CHALK_INK;
  g.strokeStyle = CHALK_INK;
  g.lineWidth = 4;
  g.font = CHALK_FONT(50);
  const mode = game?.mode ?? d.mode;
  const doubleOut = game?.doubleOut ?? d.doubleOut;
  g.fillText(String(mode), doubleOut ? mid - 22 : mid, 62);
  if (doubleOut) {
    g.font = CHALK_FONT(22);
    g.fillText('D/O', mid + 52, 60);
  }
  g.beginPath();
  g.moveTo(20, 88);
  g.lineTo(CHALK_W - 20, 88);
  if (!game) {
    g.moveTo(mid, 88);
    g.lineTo(mid, CHALK_H - 30);
  }
  g.stroke();
  if (!game) return;
  const row = Math.min(96, (CHALK_H - 110) / Math.max(1, game.players.length));
  game.players.forEach((p, i) => {
    const y = 104 + i * row;
    const up = !game.over && i === game.up;
    g.fillStyle = p.color;
    chalkText(g, `${up ? '▸ ' : ''}${chalkName(p.name)}`, mid, y + 26, 26);
    g.font = CHALK_FONT(46);
    g.fillText(String(p.score), mid, y + 72);
  });
}

/**
 * The right door says what's going on: whose turn it is and their darts so far ("T20", "5", "D16"),
 * BUST, or who won. With no game on, who's at the board.
 */
function drawTurn(c: Chalk, d: DartsState, turn: ShownTurn | null) {
  const g = c.canvas.getContext('2d')!;
  g.drawImage(c.smudges, 0, 0);
  const game = d.game;
  const mid = CHALK_W / 2;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = CHALK_INK;
  g.strokeStyle = CHALK_INK;
  g.lineWidth = 4;
  const winner = game?.winner ? game.players.find((p) => p.id === game.winner) : undefined;
  if (!game) {
    g.font = CHALK_FONT(40);
    g.fillText('🎯', mid, 62);
    d.lobby.forEach((s, i) => {
      g.fillStyle = s.color;
      chalkText(g, chalkName(s.name), mid, 140 + i * 52, 28);
    });
    return;
  }
  const who = game.players.find((p) => p.id === (turn?.player ?? game.players[game.up]?.id));
  g.fillStyle = who?.color ?? CHALK_INK;
  if (who) chalkText(g, chalkName(who.name), mid, 52, 28);
  g.fillStyle = CHALK_INK;
  g.beginPath();
  g.moveTo(20, 76);
  g.lineTo(CHALK_W - 20, 76);
  g.stroke();
  g.font = CHALK_FONT(48);
  (turn?.darts ?? []).forEach((dart, i) => g.fillText(dart.label === 'MISS' ? '–' : dart.label, mid, 140 + i * 64));
  if (turn?.bust) {
    g.fillStyle = '#ff8fa3';
    chalkText(g, t('world.dartsBust'), mid, 360, 52);
  } else if (winner && (!turn || turn.done)) {
    g.fillStyle = winner.color;
    chalkText(g, `🏆 ${chalkName(winner.name)}`, mid, 350, 30);
    chalkText(g, t('world.dartsWins'), mid, 400, 40);
  }
}

/** A toon material with a picture on it, lit like the room. */
function toonMap(map: THREE.Texture): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
}

/**
 * Built in the board's own frame: the middle of its face at the origin, the face looking down +z and
 * the wall at z = -(FLOOR.maxX - DARTBOARD.x); then stood at DARTBOARD, turned to face the room.
 */
export function buildDartboard(night: NightParts): DartboardView {
  const { cabinet: cab, oche } = DARTBOARD;
  const group = new THREE.Group();
  group.position.set(DARTBOARD.x, DARTBOARD.y, DARTBOARD.z);
  group.rotation.y = DARTBOARD.rotY;
  const wall = -(FLOOR.maxX - DARTBOARD.x);
  const front = wall + cab.depth;
  const parts = new THREE.Group();
  const wood = toon(WOOD);
  const dark = toon(WOOD_DARK);

  // The cabinet: a back on the wall, and a frame round it standing out past the face.
  const hw = cab.width / 2;
  const hh = cab.height / 2;
  const T = 0.03;
  parts.add(mesh(new THREE.BoxGeometry(cab.width, cab.height, 0.02), dark, 0, 0, wall + 0.01));
  for (const s of [-1, 1]) {
    parts.add(mesh(new THREE.BoxGeometry(cab.width, T, cab.depth), wood, 0, s * (hh - T / 2), wall + cab.depth / 2));
    parts.add(mesh(new THREE.BoxGeometry(T, cab.height - 2 * T, cab.depth), wood, s * (hw - T / 2), 0, wall + cab.depth / 2));
  }

  // Its doors, swung right open flat by the wall either side, with a chalkboard on the inside of each.
  const chalks = [chalkboard(), chalkboard()];
  const doorT = 0.022;
  for (const s of [-1, 1]) {
    const chalk = toonMap(chalks[s < 0 ? 0 : 1].tex);
    const x = s * (hw + cab.door / 2 + 0.005);
    const z = wall + 0.018 + doorT / 2;
    parts.add(mesh(new THREE.BoxGeometry(cab.door, cab.height, doorT), wood, x, 0, z));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(cab.door - 0.07, cab.height - 0.1), chalk);
    board.position.set(x, -0.005, z + doorT / 2 + 0.001);
    group.add(board);
    // The hinges, at the cabinet's front corners.
    for (const y of [-hh + 0.1, hh - 0.1]) parts.add(mesh(new THREE.BoxGeometry(0.02, 0.06, 0.03), toon('#b08d57'), s * (hw + 0.004), y, front - 0.03, false));
  }

  // The board itself: a black-edged bristle disc on the back of the cabinet, its face painted on.
  const body = new THREE.CylinderGeometry(BOARD.radius, BOARD.radius, BOARD.thick, 48).rotateX(Math.PI / 2);
  parts.add(mesh(body, toon(BLACK), 0, 0, -BOARD.thick / 2));
  const face = new THREE.Mesh(new THREE.CircleGeometry(BOARD.radius, 64), toonMap(faceTexture()));
  face.position.z = 0.001;
  face.receiveShadow = true;
  group.add(face);

  // A little brass picture lamp over the cabinet: an arm out from the wall, and a half-round shade
  // along the top, open underneath and toward the board, with a bulb tube in it.
  const lamp = new THREE.Group();
  const brass = toon('#c9a24a');
  const lampY = hh + 0.15;
  const lampZ = wall + 0.2;
  lamp.add(mesh(roundedBox(0.12, 0.08, 0.02, 0.02), brass, 0, hh + 0.07, wall + 0.01, false));
  const reach = Math.hypot(lampZ - wall, lampY - hh - 0.07);
  const arm = mesh(new THREE.CylinderGeometry(0.01, 0.01, reach, 6), brass, 0, (hh + 0.07 + lampY) / 2, (wall + lampZ) / 2, false);
  arm.rotation.x = Math.atan2(lampZ - wall, lampY - hh - 0.07);
  lamp.add(arm);
  const shadeMat = toonUnique('#c9a24a');
  shadeMat.side = THREE.DoubleSide;
  lamp.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 16, 1, true, -0.4, 2.7).rotateZ(Math.PI / 2), shadeMat, 0, lampY, lampZ, false));
  for (const sx of [-1, 1]) lamp.add(mesh(new THREE.CircleGeometry(0.045, 16, -0.4, 2.7).rotateY(-Math.PI / 2), shadeMat, sx * 0.17, lampY, lampZ, false));
  const glow = bulb(night, '#fff1c1', 0.15);
  lamp.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8).rotateZ(Math.PI / 2), glow, 0, lampY - 0.01, lampZ - 0.005, false));
  night.halos.push({ at: new THREE.Vector3(DARTBOARD.x - 0.25, DARTBOARD.y + lampY - 0.03, DARTBOARD.z), size: 0.45, color: '#ffe08a' });
  night.lamps.push({ x: DARTBOARD.x - 0.6, y: DARTBOARD.y + 0.2, z: DARTBOARD.z, reach: 1.8, color: '#ffe3a3', power: 1.4 });

  // The oche: a brushed metal strip on the floor, its board-side edge on the throw line.
  const floorY = -DARTBOARD.y;
  const out = DARTBOARD.x - oche.x;
  // Not outlined: it's flat on the floor.
  const metal = toonUnique('#b9c0ca');
  metal.userData.outlineParameters = { visible: false };
  const strip = mesh(new THREE.BoxGeometry(oche.width, 0.01, 0.05), metal, 0, floorY + 0.005, out + 0.025, false);
  parts.add(strip);
  for (const s of [-1, 1]) parts.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 8), toon(INK), s * (oche.width / 2 - 0.03), floorY + 0.011, out + 0.025, false));

  group.add(mergeByMaterial(parts));
  const lampMeshes = mergeByMaterial(lamp);
  group.add(lampMeshes);

  // The cabinet with its doors open, and the lamp over it, in the room's own axes (it's on the east wall).
  const span = hw + cab.door + 0.01;
  const colliders: Collider[] = [{ minX: FLOOR.maxX - cab.depth, maxX: FLOOR.maxX, minZ: DARTBOARD.z - span, maxZ: DARTBOARD.z + span, bottom: DARTBOARD.y - hh, top: DARTBOARD.y + lampY + 0.05 }];

  const last: { d: DartsState; turn: ShownTurn | null } = { d: emptyDarts(), turn: null };
  const chalk = (d: DartsState, turn: ShownTurn | null) => {
    drawScores(chalks[0], d);
    drawTurn(chalks[1], d, turn);
    for (const c of chalks) c.tex.needsUpdate = true;
  };
  chalk(last.d, last.turn);
  // Canvas text only picks up the office's font once it has loaded.
  void document.fonts.ready.then(() => chalk(last.d, last.turn));

  const v = new THREE.Vector3();
  const normal = new THREE.Vector3(Math.sin(DARTBOARD.rotY), 0, Math.cos(DARTBOARD.rotY));
  return {
    group,
    colliders,
    lamp: lampMeshes,
    normal,
    chalk(d, turn) {
      last.d = d;
      last.turn = turn;
      chalk(d, turn);
    },
    toWorld(x, y, o = 0, target = new THREE.Vector3()) {
      group.updateWorldMatrix(true, false);
      return group.localToWorld(target.set(x, y, o));
    },
    toBoard(p) {
      group.updateWorldMatrix(true, false);
      group.worldToLocal(v.copy(p));
      return { x: v.x, y: v.y, out: v.z };
    },
  };
}
