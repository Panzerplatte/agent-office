import * as THREE from 'three';
import { DARTBOARD, FLOOR } from '../../shared/layout';
import type { Collider } from './office';
import { bulb, type NightParts } from './outside';
import { mergeByMaterial, mesh, roundedBox, toon, toonUnique } from './toon';

// The dartboard on the lounge's east wall: a regulation bristle board in an open wooden cabinet, with
// chalkboards on the insides of its doors, a little lamp over it, and a metal oche on the floor.

/**
 * A regulation board, in meters from the middle of its face: the sectors clockwise from the top, and
 * how far out each ring is. (Until shared/darts.ts has the rules, the board's own geometry lives here.)
 */
export const BOARD = {
  sectors: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5],
  innerBull: 0.00635,
  outerBull: 0.016,
  triple: [0.099, 0.107],
  double: [0.162, 0.17],
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
  /**
   * The world point at board-local (x, y) meters from the middle of the face (x to the right as you
   * face it, y up), `out` meters in front of it (negative: into the board, where a dart's tip goes).
   */
  toWorld(x: number, y: number, out?: number, target?: THREE.Vector3): THREE.Vector3;
  /** The other way: where a world point is, in the board's own meters. */
  toBoard(p: THREE.Vector3): { x: number; y: number; out: number };
  /** The way the face looks, out into the room. */
  readonly normal: THREE.Vector3;
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
  const step = (Math.PI * 2) / 20;
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
  const [t0, t1] = BOARD.triple;
  const [d0, d1] = BOARD.double;
  for (let i = 0; i < 20; i++) {
    const even = i % 2 === 0;
    const single = even ? BLACK : CREAM;
    const ring = even ? RED : GREEN;
    wedge(BOARD.outerBull, t0, i, single);
    wedge(t0, t1, i, ring);
    wedge(t1, d0, i, single);
    wedge(d0, d1, i, ring);
  }
  disc(BOARD.outerBull, GREEN);
  disc(BOARD.innerBull, RED);

  // The wire: round every ring, and out along the sector edges from the bull to the double.
  g.strokeStyle = WIRE;
  g.lineWidth = 2.2;
  for (const r of [BOARD.innerBull, BOARD.outerBull, t0, t1, d0, d1]) {
    g.beginPath();
    g.arc(mid, mid, r * px, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const a = from(i);
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * BOARD.outerBull * px, mid + Math.sin(a) * BOARD.outerBull * px);
    g.lineTo(mid + Math.cos(a) * d1 * px, mid + Math.sin(a) * d1 * px);
    g.stroke();
  }

  // The numbers, upright, round the ring outside the double.
  const numR = ((d1 + BOARD.radius) / 2) * px;
  g.fillStyle = '#f4f1e8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(0.032 * px)}px Nunito, ui-rounded, system-ui, sans-serif`;
  BOARD.sectors.forEach((n, i) => {
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

/** A door's chalkboard, ruled up for a game of 301 (the scores go up when there's a game on). */
function chalkTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = CHALK;
  g.fillRect(0, 0, 128, 320);
  // Smudges of old games, wiped off.
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.03})`;
    g.beginPath();
    g.ellipse(Math.random() * 128, Math.random() * 320, 10 + Math.random() * 30, 6 + Math.random() * 14, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(240,240,232,0.8)';
  g.fillStyle = 'rgba(240,240,232,0.85)';
  g.lineWidth = 3;
  g.font = '800 34px Nunito, ui-rounded, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('301', 64, 42);
  g.beginPath();
  g.moveTo(14, 60);
  g.lineTo(114, 60);
  g.moveTo(64, 60);
  g.lineTo(64, 300);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
  const chalk = toonMap(chalkTexture());
  const doorT = 0.022;
  for (const s of [-1, 1]) {
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
  const brass = toon('#c9a24a');
  const lampY = hh + 0.15;
  const lampZ = wall + 0.2;
  parts.add(mesh(roundedBox(0.12, 0.08, 0.02, 0.02), brass, 0, hh + 0.07, wall + 0.01, false));
  const reach = Math.hypot(lampZ - wall, lampY - hh - 0.07);
  const arm = mesh(new THREE.CylinderGeometry(0.01, 0.01, reach, 6), brass, 0, (hh + 0.07 + lampY) / 2, (wall + lampZ) / 2, false);
  arm.rotation.x = Math.atan2(lampZ - wall, lampY - hh - 0.07);
  parts.add(arm);
  const shadeMat = toonUnique('#c9a24a');
  shadeMat.side = THREE.DoubleSide;
  parts.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 16, 1, true, -0.4, 2.7).rotateZ(Math.PI / 2), shadeMat, 0, lampY, lampZ, false));
  for (const sx of [-1, 1]) parts.add(mesh(new THREE.CircleGeometry(0.045, 16, -0.4, 2.7).rotateY(-Math.PI / 2), shadeMat, sx * 0.17, lampY, lampZ, false));
  const glow = bulb(night, '#fff1c1', 0.15);
  parts.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8).rotateZ(Math.PI / 2), glow, 0, lampY - 0.01, lampZ - 0.005, false));
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

  // The cabinet with its doors open, and the lamp over it, in the room's own axes (it's on the east wall).
  const span = hw + cab.door + 0.01;
  const colliders: Collider[] = [{ minX: FLOOR.maxX - cab.depth, maxX: FLOOR.maxX, minZ: DARTBOARD.z - span, maxZ: DARTBOARD.z + span, bottom: DARTBOARD.y - hh, top: DARTBOARD.y + lampY + 0.05 }];

  const v = new THREE.Vector3();
  const normal = new THREE.Vector3(Math.sin(DARTBOARD.rotY), 0, Math.cos(DARTBOARD.rotY));
  return {
    group,
    colliders,
    normal,
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
