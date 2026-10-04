import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, toon } from '../../toon';

/**
 * The bunker furniture's own materials and textures. They're made here rather than taken from
 * toon()'s shared cache, so that taking the bunker down can dispose every one of them (see dispose)
 * without pulling a material out from under the office.
 */
export class Kit {
  private mats = new Map<string, THREE.MeshToonMaterial>();
  private extra: { dispose(): void }[] = [];
  private grad = (toon('#ffffff') as THREE.MeshToonMaterial).gradientMap;

  /** A flat toon material, made once per color (and glow) for this kit. */
  mat(color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation): THREE.MeshToonMaterial {
    const key = `${new THREE.Color(color).getHexString()}|${emissive ?? ''}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: this.grad });
      if (emissive !== undefined) m.emissive = new THREE.Color(emissive);
      this.mats.set(key, m);
    }
    return m;
  }

  /** A toon material over a canvas texture, made once per `key`. */
  painted(key: string, draw: () => HTMLCanvasElement, opts: { repeat?: [number, number] } = {}): THREE.MeshToonMaterial {
    let m = this.mats.get(`tex:${key}`);
    if (!m) {
      const tex = new THREE.CanvasTexture(draw());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      // Repeating: a rounded box's UVs run in meters, not 0..1.
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      if (opts.repeat) tex.repeat.set(...opts.repeat);
      this.extra.push(tex);
      m = new THREE.MeshToonMaterial({ map: tex, gradientMap: this.grad });
      this.mats.set(`tex:${key}`, m);
    }
    return m;
  }

  /** Something else to dispose with the kit (a line material, a one-off texture). */
  own<T extends { dispose(): void }>(thing: T): T {
    this.extra.push(thing);
    return thing;
  }

  dispose() {
    for (const m of this.mats.values()) m.dispose();
    for (const x of this.extra) x.dispose();
    this.mats.clear();
    this.extra = [];
  }
}

/**
 * A piece of furniture as a few meshes, one per material, in place of the dozens it's built from:
 * fewer draw calls. Unlike toon's mergeByMaterial it keeps the UVs, for the textures, and it all casts
 * shadows if any of it did (a merged mesh casts or doesn't).
 * The parts' geometries are disposed; the group keeps the root's place, turn, size and userData.
 */
export function merge(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byKey = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    m.geometry.dispose();
    const mat = m.material as THREE.Material;
    if (!byKey.has(mat.uuid)) byKey.set(mat.uuid, { mat, cast: false, geos: [] });
    const entry = byKey.get(mat.uuid)!;
    entry.cast ||= m.castShadow;
    entry.geos.push(geo);
  });
  const out = new THREE.Group();
  for (const { mat, cast, geos } of byKey.values()) {
    out.add(mesh(mergeGeometries(geos)!, mat, 0, 0, 0, cast));
    for (const geo of geos) geo.dispose();
  }
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);
  out.userData = root.userData;
  return out;
}

/** Disposes every geometry under `root` (materials belong to the kit). */
export function disposeGeometries(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as THREE.Line).isLine) m.geometry.dispose();
  });
}

/** A seeded random, so every desk keeps its own scratches from one switch to the next. */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Worn workbench planks: long boards with dark seams, grain, knots, scratches and oil stains. */
export function drawPlanks(seed: number): HTMLCanvasElement {
  const [c, g] = canvas(512, 256);
  const r = rng(seed);
  const boards = 4;
  const bh = c.height / boards;
  const tones = ['#9a6b43', '#8c603b', '#a3744a', '#916540'];
  for (let i = 0; i < boards; i++) {
    g.fillStyle = tones[(i + seed) % tones.length];
    g.fillRect(0, i * bh, c.width, bh);
    // Grain: long wavy streaks along the board.
    g.strokeStyle = 'rgba(60,35,18,0.35)';
    g.lineWidth = 1.5;
    for (let k = 0; k < 7; k++) {
      const y = i * bh + 4 + r() * (bh - 8);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= c.width; x += 32) g.lineTo(x, y + Math.sin(x / 60 + k) * 2.5);
      g.stroke();
    }
    // A knot or two.
    for (let k = 0; k < 2; k++) {
      if (r() < 0.4) continue;
      const kx = r() * c.width;
      const ky = i * bh + bh * (0.3 + r() * 0.4);
      g.fillStyle = 'rgba(70,40,20,0.7)';
      g.beginPath();
      g.ellipse(kx, ky, 9, 5, 0, 0, Math.PI * 2);
      g.fill();
    }
    // The seam between boards.
    g.fillStyle = '#4a2e1a';
    g.fillRect(0, i * bh, c.width, 3);
  }
  // Scratches, dents and dark oil rings: years of work on it.
  g.strokeStyle = 'rgba(235,210,170,0.45)';
  g.lineWidth = 1;
  for (let k = 0; k < 26; k++) {
    const x = r() * c.width;
    const y = r() * c.height;
    const a = r() * Math.PI;
    const l = 10 + r() * 40;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let k = 0; k < 3; k++) {
    g.fillStyle = 'rgba(30,20,10,0.25)';
    g.beginPath();
    g.ellipse(r() * c.width, r() * c.height, 18 + r() * 22, 12 + r() * 14, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(40,25,12,0.4)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(r() * c.width, r() * c.height, 14, 0, Math.PI * 2);
  g.stroke();
  return c;
}

/** Old cracked leather: a deep brown with lighter worn patches and fine creases. */
export function drawLeather(base: string, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 9; k++) {
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grd.addColorStop(0, 'rgba(255,220,170,0.22)');
    grd.addColorStop(1, 'rgba(255,220,170,0)');
    g.save();
    g.translate(r() * c.width, r() * c.height);
    g.scale(30 + r() * 50, 20 + r() * 40);
    g.fillStyle = grd;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  }
  g.strokeStyle = 'rgba(20,10,5,0.35)';
  g.lineWidth = 1;
  for (let k = 0; k < 60; k++) {
    const x = r() * c.width;
    const y = r() * c.height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 18, y + (r() - 0.5) * 18);
    g.stroke();
  }
  return c;
}

/** Army canvas: olive drab weave, a little faded and stained. */
export function drawCanvasCloth(base: string, seed: number, stencil?: string): HTMLCanvasElement {
  const [c, g] = canvas(256, 128);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < c.height; y += 3) g.fillRect(0, y, c.width, 1);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x < c.width; x += 3) g.fillRect(x, 0, 1, c.height);
  for (let k = 0; k < 5; k++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '40,35,20' : '200,190,150'},0.12)`;
    g.beginPath();
    g.ellipse(r() * c.width, r() * c.height, 10 + r() * 30, 8 + r() * 18, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  if (stencil) {
    g.fillStyle = 'rgba(235,230,200,0.75)';
    g.font = '700 30px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(stencil, c.width / 2, c.height / 2);
  }
  return c;
}

/** Scuffed grey-green steel with a few rust freckles and bright scratches on the edges. */
export function drawSteel(base: string, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 14; k++) {
    g.fillStyle = `rgba(150,80,30,${0.15 + r() * 0.25})`;
    g.beginPath();
    g.arc(r() * c.width, r() * c.height, 1 + r() * 4, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(220,225,215,0.35)';
  for (let k = 0; k < 12; k++) {
    const x = r() * c.width;
    const y = r() * c.height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 8);
    g.stroke();
  }
  return c;
}

/**
 * The war room's map: a made-up city from above, with blocks, a river, a park and the main roads, and
 * a grid with letters and numbers round the edge, the way a planning map has.
 */
export function drawCityMap(): HTMLCanvasElement {
  const [c, g] = canvas(1024, 342);
  const r = rng(7);
  g.fillStyle = '#e9dfc4';
  g.fillRect(0, 0, c.width, c.height);
  // City blocks.
  const step = 38;
  for (let x = 30; x < c.width - 30; x += step) {
    for (let y = 30; y < c.height - 30; y += step) {
      if (r() < 0.12) continue;
      const t = r();
      g.fillStyle = t < 0.1 ? '#b8c99a' : t < 0.55 ? '#d8cba8' : '#cbbd99';
      g.fillRect(x + 4, y + 4, step - 8, step - 8);
    }
  }
  // A park.
  g.fillStyle = '#a9c48a';
  g.fillRect(610, 70, 150, 100);
  g.fillStyle = '#93b276';
  for (let k = 0; k < 18; k++) {
    g.beginPath();
    g.arc(620 + r() * 130, 80 + r() * 80, 4 + r() * 4, 0, Math.PI * 2);
    g.fill();
  }
  // The river, winding across.
  g.strokeStyle = '#8fb8c9';
  g.lineWidth = 26;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-10, 250);
  g.bezierCurveTo(200, 180, 330, 330, 520, 260);
  g.bezierCurveTo(700, 200, 820, 300, 1040, 220);
  g.stroke();
  // Main roads.
  g.strokeStyle = '#f6efe0';
  g.lineWidth = 7;
  for (const [x0, y0, x1, y1] of [
    [0, 110, 1024, 140],
    [300, 0, 340, 342],
    [760, 0, 720, 342],
    [0, 30, 500, 342],
  ]) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  // Bridges over the river.
  g.fillStyle = '#7a6a55';
  for (const x of [318, 742]) g.fillRect(x - 8, 220, 16, 60);
  // Marked-up areas: circled in red and blue pencil.
  g.lineWidth = 4;
  for (const [x, y, rad, col] of [
    [200, 90, 46, '#c0392b'],
    [520, 150, 38, '#2e5f9e'],
    [880, 90, 52, '#c0392b'],
  ] as const) {
    g.strokeStyle = col;
    g.beginPath();
    g.ellipse(x, y, rad, rad * 0.75, 0.2, 0, Math.PI * 2);
    g.stroke();
  }
  g.setLineDash([10, 8]);
  g.strokeStyle = '#2e5f9e';
  g.beginPath();
  g.moveTo(200, 90);
  g.quadraticCurveTo(380, 40, 520, 150);
  g.stroke();
  g.setLineDash([]);
  // The grid, with its letters and numbers.
  g.strokeStyle = 'rgba(60,50,35,0.35)';
  g.lineWidth = 1;
  g.fillStyle = '#4a3f2e';
  g.font = '700 16px "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i <= 8; i++) {
    const x = 20 + (i * (c.width - 40)) / 8;
    g.beginPath();
    g.moveTo(x, 20);
    g.lineTo(x, c.height - 20);
    g.stroke();
    if (i < 8) g.fillText(String.fromCharCode(65 + i), x + (c.width - 40) / 16, 10);
  }
  for (let i = 0; i <= 3; i++) {
    const y = 20 + (i * (c.height - 40)) / 3;
    g.beginPath();
    g.moveTo(20, y);
    g.lineTo(c.width - 20, y);
    g.stroke();
    if (i < 3) g.fillText(String(i + 1), 10, y + (c.height - 40) / 6);
  }
  // A compass rose in the corner, and a worn border.
  g.save();
  g.translate(c.width - 60, c.height - 60);
  g.fillStyle = '#4a3f2e';
  g.beginPath();
  g.moveTo(0, -26);
  g.lineTo(7, 0);
  g.lineTo(0, 26);
  g.lineTo(-7, 0);
  g.closePath();
  g.fill();
  g.fillText('N', 0, -36);
  g.restore();
  g.strokeStyle = '#6b5a40';
  g.lineWidth = 8;
  g.strokeRect(4, 4, c.width - 8, c.height - 8);
  return c;
}
