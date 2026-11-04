import * as THREE from 'three';
import { STREET_Y } from '../../shared/layout';
import { COURSE, FLAG, START, type Piece } from '../../shared/jumprun';
import type { Collider } from './office';
import { mergeByMaterial, mesh, textPlane, toon, toonUnique } from './toon';
import { t } from '../i18n';

const G = STREET_Y;
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** Scaffold poles and pipe stands: thin, but you can't walk through them. */
const POLE = 0.08;

/** A collider of the course, with its top and underside above the street, to move down with it (see JumpRunWorld.setStreet). */
export interface CourseCollider {
  c: Collider;
  top: number;
  bottom: number;
  /** The piece it's the top of (its index in COURSE), for the moving ones. */
  piece?: number;
}

export interface JumpRunWorld {
  /** Everything, built for the bottom floor's street (STREET_Y): it goes down with the office's ground group. */
  group: THREE.Group;
  colliders: CourseCollider[];
  /** The moving platforms: their piece index, mesh and the collider of their top. */
  movers: { piece: number; mesh: THREE.Object3D; collider: CourseCollider }[];
  /** The checkpoint flags, in order: lit once you've reached them on this run. */
  checkpoints: THREE.Mesh[];
  /** The flag on top, waving. */
  flag: THREE.Object3D;
  /** The leaderboard's canvas: draw on it, then set `boardTexture.needsUpdate`. */
  boardCanvas: HTMLCanvasElement;
  boardTexture: THREE.CanvasTexture;
  /** The checkpoint flags' colours: not yet, and reached. */
  checkpointColor: { off: THREE.Color; on: THREE.Color };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, texture };
}

/** A container's corrugated side: ribs down it, in its paint. */
function corrugated(color: string): THREE.MeshToonMaterial {
  const { texture } = canvasTexture(128, 64, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let x = 0; x < 128; x += 8) g.fillRect(x, 0, 3, 64);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let x = 4; x < 128; x += 8) g.fillRect(x, 0, 1, 64);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  const mat = toonUnique(color);
  mat.color.set('#ffffff');
  mat.map = texture;
  return mat;
}

/** Yellow and black stripes, for the moving platforms' edges. */
function hazard(): THREE.MeshToonMaterial {
  const { texture } = canvasTexture(64, 16, (g) => {
    g.fillStyle = '#ffb703';
    g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#2b2d42';
    for (let x = -16; x < 64; x += 16) {
      g.beginPath();
      g.moveTo(x, 16);
      g.lineTo(x + 8, 0);
      g.lineTo(x + 16, 0);
      g.lineTo(x + 8, 16);
      g.fill();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  const mat = toonUnique('#ffffff');
  mat.map = texture;
  return mat;
}

const CONTAINER_PAINT = ['#e76f51', '#2a9d8f', '#457b9d'];

/**
 * The jump & run course on the street east of the building (shared/jumprun.ts): crates, pipes on
 * stands, scaffolding, shipping containers, two moving platforms and the flag on top; the start line
 * with its sign, and the leaderboard beside it.
 */
export function buildJumpRun(): JumpRunWorld {
  const group = new THREE.Group();
  group.name = 'jumprun';
  const parts = new THREE.Group();
  const colliders: CourseCollider[] = [];
  const solid = (minX: number, maxX: number, minZ: number, maxZ: number, bottom: number, top: number, piece?: number) => {
    const c: CourseCollider = { c: { minX, maxX, minZ, maxZ, bottom: G + bottom, top: G + top }, top, bottom, piece };
    colliders.push(c);
    return c;
  };
  const wood = toon('#c8955a');
  const woodDark = toon('#8a5a3b');
  const steel = toon('#adb5bd');
  const pipeMat = toon('#7d8597');
  const plank = toon('#e9c46a');
  const ink = toon('#3d405b');

  /** Poles at the corners of a deck from the street up to `y`, with a brace across each side. */
  const poles = (p: Piece, under: number) => {
    const hx = p.w / 2 - POLE / 2;
    const hz = p.d / 2 - POLE / 2;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = p.x + sx * hx;
        const z = p.z + sz * hz;
        parts.add(mesh(box(POLE, under, POLE), steel, x, G + under / 2, z));
        solid(x - POLE / 2, x + POLE / 2, z - POLE / 2, z + POLE / 2, 0, under);
      }
    }
    // Diagonal braces on the two long sides.
    const len = Math.hypot(p.w, under);
    for (const sz of [-1, 1]) {
      const brace = mesh(box(len, 0.05, 0.05), steel, p.x, G + under / 2, p.z + sz * hz, false);
      brace.rotation.z = Math.atan2(under, p.w) * sz;
      parts.add(brace);
    }
  };

  const movers: JumpRunWorld['movers'] = [];
  const checkpoints: THREE.Mesh[] = [];
  const checkpointColor = { off: new THREE.Color('#c1121f'), on: new THREE.Color('#38b000') };
  let containers = 0;
  COURSE.forEach((p, i) => {
    const base = p.on !== undefined ? COURSE[p.on].h : 0;
    const thick = p.thick ?? p.h - base;
    const y0 = p.h - thick;
    switch (p.kind) {
      case 'crate': {
        parts.add(mesh(box(p.w, thick, p.d), wood, p.x, G + y0 + thick / 2, p.z));
        // Dark slats round its middle and edges.
        parts.add(mesh(box(p.w + 0.02, 0.08, p.d + 0.02), woodDark, p.x, G + y0 + thick / 2, p.z, false));
        parts.add(mesh(box(p.w + 0.02, 0.06, p.d + 0.02), woodDark, p.x, G + p.h - 0.03, p.z, false));
        solid(p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2, y0, p.h, i);
        break;
      }
      case 'pipe': {
        const r = thick / 2;
        const pipe = mesh(new THREE.CylinderGeometry(r, r, p.w, 16), pipeMat, p.x, G + p.h - r, p.z);
        pipe.rotation.z = Math.PI / 2;
        parts.add(pipe);
        // Flanges at its ends, and a stand under each.
        for (const sx of [-1, 1]) {
          const fx = p.x + sx * (p.w / 2 - 0.08);
          const flange = mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.1, 16), ink, fx, G + p.h - r, p.z, false);
          flange.rotation.z = Math.PI / 2;
          parts.add(flange);
          const sx2 = p.x + sx * (p.w / 2 - 0.35);
          parts.add(mesh(box(0.14, y0, 0.5), steel, sx2, G + y0 / 2, p.z));
          solid(sx2 - 0.07, sx2 + 0.07, p.z - 0.25, p.z + 0.25, 0, y0);
        }
        solid(p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2, y0, p.h, i);
        break;
      }
      case 'scaffold':
      case 'goal': {
        parts.add(mesh(box(p.w, thick, p.d), p.kind === 'goal' ? toon('#f1faee') : plank, p.x, G + y0 + thick / 2, p.z));
        parts.add(mesh(box(p.w + 0.04, 0.05, p.d + 0.04), steel, p.x, G + y0 + 0.02, p.z, false));
        poles(p, y0);
        solid(p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2, y0, p.h, i);
        break;
      }
      case 'container': {
        const paint = corrugated(CONTAINER_PAINT[containers++ % CONTAINER_PAINT.length]);
        // One box per 2.6 m it stands tall: stacked containers, each with a darker band at its foot.
        const n = Math.max(1, Math.round(thick / 2.6));
        const each = thick / n;
        for (let k = 0; k < n; k++) {
          parts.add(mesh(box(p.w, each - 0.04, p.d), paint, p.x, G + y0 + each * k + each / 2, p.z));
          parts.add(mesh(box(p.w + 0.03, 0.12, p.d + 0.03), ink, p.x, G + y0 + each * k + 0.06, p.z, false));
        }
        solid(p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2, y0, p.h, i);
        break;
      }
      case 'mover': {
        const m = new THREE.Group();
        m.add(mesh(box(p.w, thick, p.d), hazard(), 0, -thick / 2, 0));
        m.add(mesh(box(p.w * 0.4, 0.2, p.d * 0.4), ink, 0, -thick - 0.1, 0, false));
        m.position.set(p.x, G + p.h, p.z);
        group.add(m);
        // The rail it runs along, held up at each end.
        const amp = p.move!.amp;
        parts.add(mesh(box(amp * 2 + p.w, 0.08, 0.12), ink, p.x, G + y0 - 0.24, p.z, false));
        for (const sx of [-1, 1]) {
          const x = p.x + sx * (amp + p.w / 2 + 0.1);
          parts.add(mesh(box(0.12, y0 - 0.2, 0.12), steel, x, G + (y0 - 0.2) / 2, p.z));
          solid(x - 0.06, x + 0.06, p.z - 0.06, p.z + 0.06, 0, y0 - 0.2);
        }
        movers.push({ piece: i, mesh: m, collider: solid(p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2, y0, p.h, i) });
        break;
      }
    }
    if (p.checkpoint) {
      // A little red pennant on a post at its corner: green once you've reached it.
      const cx = pieceCornerX(p);
      const cz = p.z + p.d / 2 - 0.12;
      parts.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), ink, cx, G + p.h + 0.5, cz, false));
      const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 3), toonUnique('#c1121f'));
      pennant.rotation.z = -Math.PI / 2;
      pennant.position.set(cx + 0.22, G + p.h + 0.86, cz);
      group.add(pennant);
      checkpoints.push(pennant);
    }
  });

  // The start line: a chequered strip across the way in, and an arch over it with the sign.
  const { texture: chequer } = canvasTexture(64, 8, (g) => {
    for (let x = 0; x < 64; x += 4) {
      for (let y = 0; y < 8; y += 4) {
        g.fillStyle = (x + y) % 8 === 0 ? '#ffffff' : '#2b2d42';
        g.fillRect(x, y, 4, 4);
      }
    }
  });
  chequer.magFilter = THREE.NearestFilter;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(START.x1 - START.x0, 0.5), new THREE.MeshToonMaterial({ map: chequer, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  line.rotation.x = -Math.PI / 2;
  line.position.set((START.x0 + START.x1) / 2, G + 0.012, START.z);
  line.receiveShadow = true;
  group.add(line);
  // The flag on top: chequered, like the line.
  parts.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, FLAG.height, 8), steel, FLAG.x, G + COURSE[COURSE.length - 1].h + FLAG.height / 2, FLAG.z));
  const flag = new THREE.Group();
  const flagMap = chequer.clone();
  flagMap.repeat.set(0.25, 1.4);
  flagMap.wrapS = flagMap.wrapT = THREE.RepeatWrapping;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.62, 8, 1), new THREE.MeshBasicMaterial({ map: flagMap, side: THREE.DoubleSide }));
  cloth.position.x = 0.5;
  flag.add(cloth);
  flag.position.set(FLAG.x, G + COURSE[COURSE.length - 1].h + FLAG.height - 0.36, FLAG.z);
  group.add(flag);

  const archH = 3.4;
  for (const x of [START.x0 - 0.15, START.x1 + 0.15]) {
    parts.add(mesh(box(0.2, archH, 0.2), ink, x, G + archH / 2, START.z));
    solid(x - 0.1, x + 0.1, START.z - 0.1, START.z + 0.1, 0, archH);
  }
  parts.add(mesh(box(START.x1 - START.x0 + 0.5, 0.6, 0.12), toon('#2b2d42'), (START.x0 + START.x1) / 2, G + archH - 0.1, START.z));
  const sign = textPlane(t('jumprun.sign'), { bg: '#2b2d42', color: '#ffd166', size: 64 });
  sign.scale.multiplyScalar(1.1);
  sign.position.set((START.x0 + START.x1) / 2, G + archH - 0.1, START.z + 0.07);
  group.add(sign);

  // The leaderboard, on legs beside the start, facing west.
  const b = START.board;
  const board = canvasTexture(640, 480, () => {});
  const face = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshBasicMaterial({ map: board.texture }));
  face.rotation.y = -Math.PI / 2;
  face.position.set(b.x - 0.07, G + 0.9 + b.h / 2, b.z);
  group.add(face);
  parts.add(mesh(box(0.12, b.h + 0.16, b.w + 0.16), ink, b.x, G + 0.9 + b.h / 2, b.z));
  for (const s of [-1, 1]) parts.add(mesh(box(0.1, 0.9, 0.1), ink, b.x, G + 0.45, b.z + s * (b.w / 2 - 0.1)));
  solid(b.x - 0.08, b.x + 0.08, b.z - b.w / 2 - 0.08, b.z + b.w / 2 + 0.08, 0, 0.9 + b.h + 0.08);

  group.add(mergeByMaterial(parts));
  return { group, colliders, movers, checkpoints, flag, boardCanvas: board.canvas, boardTexture: board.texture, checkpointColor };
}

/** Where a checkpoint's pennant post goes along x: the west edge of its piece, out of the way. */
function pieceCornerX(p: Piece): number {
  return p.x - p.w / 2 + 0.12;
}
