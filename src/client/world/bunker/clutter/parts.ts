import * as THREE from 'three';
import { Kit, mesh, seeded, STENCIL } from './kit';

// The bunker's clutter, one builder per kind of thing. Each is built in its own frame, standing on
// y = 0; where it goes against a wall, the wall is behind it at z = 0 and it faces +z.

const WOOD = '#b98a54';
const WOOD_DARK = '#7a5432';
const STEEL = '#8d99ae';
const STEEL_DARK = '#4a5162';
const OLIVE = '#56643a';

// ---- Crates -------------------------------------------------------------------------------------

/** A wooden crate's side: planks inside a frame, a cross brace, and a number stencilled on. */
function crateTexture(kit: Kit, label: string, wood: string): THREE.CanvasTexture {
  return kit.canvas(128, 128, (g) => {
    g.fillStyle = wood;
    g.fillRect(0, 0, 128, 128);
    // Planks, each a touch lighter or darker, with dark seams between.
    const rand = seeded(label.length * 97 + label.charCodeAt(0));
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '255,240,210' : '60,30,10'},${0.06 + rand() * 0.1})`;
      g.fillRect(0, i * 25.6, 128, 25.6);
      g.fillStyle = 'rgba(60,32,12,0.55)';
      g.fillRect(0, i * 25.6, 128, 2);
    }
    // The grain: a few thin streaks.
    g.strokeStyle = 'rgba(70,40,15,0.25)';
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const y = rand() * 128;
      g.beginPath();
      g.moveTo(rand() * 40, y);
      g.lineTo(60 + rand() * 68, y + (rand() - 0.5) * 4);
      g.stroke();
    }
    // The frame and the brace across it.
    g.fillStyle = WOOD_DARK;
    g.fillRect(0, 0, 128, 13);
    g.fillRect(0, 115, 128, 13);
    g.fillRect(0, 0, 13, 128);
    g.fillRect(115, 0, 13, 128);
    g.save();
    g.translate(64, 64);
    g.rotate(-Math.PI / 4);
    g.globalAlpha = 0.85;
    g.fillRect(-80, -6, 160, 12);
    g.restore();
    // Nails at the corners.
    g.fillStyle = '#3b3b3b';
    for (const [x, y] of [
      [6, 6],
      [122, 6],
      [6, 122],
      [122, 122],
    ])
      g.fillRect(x - 2, y - 2, 4, 4);
    // The stencil, a bit worn.
    g.font = `bold 44px ${STENCIL}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(30,28,24,0.85)';
    g.fillText(label, 64, 66);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 40; i++) g.fillRect(30 + rand() * 68, 44 + rand() * 44, 2, 2);
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = wood;
    g.fillRect(0, 0, 128, 128);
  });
}

export interface CrateSpec {
  x: number;
  z: number;
  /** Stacked on top of what's below it at (x, z): its bottom. */
  y?: number;
  size: [w: number, h: number, d: number];
  label: string;
  rotY?: number;
  /** Paler or darker wood. */
  wood?: string;
}

/** A pile of crates, stencilled with numbers. Each texture is made once per label and wood. */
export function crates(kit: Kit, specs: CrateSpec[]): THREE.Group {
  const g = new THREE.Group();
  const mats = new Map<string, THREE.Material>();
  for (const c of specs) {
    const wood = c.wood ?? WOOD;
    const key = `${c.label}|${wood}`;
    let mat = mats.get(key);
    if (!mat) {
      mat = kit.own(new THREE.MeshToonMaterial({ map: crateTexture(kit, c.label, wood), gradientMap: kit.toon('#fff').gradientMap }));
      mats.set(key, mat);
    }
    const [w, h, d] = c.size;
    const box = mesh(new THREE.BoxGeometry(w, h, d), mat, c.x, (c.y ?? 0) + h / 2, c.z);
    box.rotation.y = c.rotY ?? 0;
    g.add(box);
  }
  return g;
}

// ---- Drums and jerrycans ------------------------------------------------------------------------

const DRUM = { r: 0.29, h: 0.88 } as const;

/** An oil drum: ribbed steel, a lid with its bung, and a painted band. */
export function drum(kit: Kit, color: string, band = '#e9c46a'): THREE.Group {
  const g = new THREE.Group();
  const paint = kit.toon(color);
  g.add(mesh(new THREE.CylinderGeometry(DRUM.r, DRUM.r, DRUM.h, 18), paint, 0, DRUM.h / 2, 0));
  for (const y of [0.04, 0.3, 0.58, DRUM.h - 0.02]) g.add(mesh(new THREE.CylinderGeometry(DRUM.r + 0.012, DRUM.r + 0.012, 0.035, 18), y > 0.1 && y < 0.8 ? kit.toon(band) : kit.toon(STEEL_DARK), 0, y, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(DRUM.r - 0.02, DRUM.r - 0.02, 0.02, 18), kit.toon(new THREE.Color(color).multiplyScalar(0.8)), 0, DRUM.h + 0.005, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8), kit.toon(STEEL_DARK), 0.15, DRUM.h + 0.02, 0.05, false));
  return g;
}

export interface Animated {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

/** A soft round glow, white in the middle, for additive halos. */
function glowTexture(kit: Kit): THREE.CanvasTexture {
  return kit.canvas(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

/**
 * The fire barrel: a rusty open drum with holes punched round it, flames licking out of the top,
 * embers drifting up and a warm glow on everything round it, all flickering. No light of its own (a
 * new light would make every material in the office recompile): the glow is drawn.
 */
export function fireBarrel(kit: Kit): Animated {
  const g = new THREE.Group();
  const rust = kit.toon('#7b4a2c');
  g.add(mesh(new THREE.CylinderGeometry(DRUM.r, DRUM.r, DRUM.h, 18, 1, true), kit.own(new THREE.MeshToonMaterial({ color: '#7b4a2c', side: THREE.DoubleSide, gradientMap: rust.gradientMap })), 0, DRUM.h / 2, 0));
  for (const y of [0.04, 0.3, 0.58, DRUM.h - 0.02]) g.add(mesh(new THREE.TorusGeometry(DRUM.r + 0.004, 0.016, 5, 20), kit.toon('#5a341f'), 0, y, 0, false).rotateX(Math.PI / 2));
  // The coals, glowing, a little way down inside.
  const coals = kit.own(new THREE.MeshBasicMaterial({ color: '#ff7a1a' }));
  g.add(mesh(new THREE.CircleGeometry(DRUM.r - 0.01, 16), coals, 0, DRUM.h - 0.12, 0, false).rotateX(-Math.PI / 2));
  // Holes punched in the side, with the fire showing through.
  const holeMat = kit.own(new THREE.MeshBasicMaterial({ color: '#ffb347' }));
  const holeGeo = new THREE.CircleGeometry(0.03, 8);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + (i % 2) * 0.3;
    const y = i % 2 ? 0.45 : 0.68;
    const hole = mesh(holeGeo.clone(), holeMat, Math.sin(a) * (DRUM.r + 0.002), y, Math.cos(a) * (DRUM.r + 0.002), false);
    hole.rotation.y = a;
    g.add(hole);
  }
  holeGeo.dispose();

  // Flames: a few cones round the middle, each its own height and pace.
  const flameMats = ['#ff6b1a', '#ffa41b', '#ffe066'].map((c) => kit.own(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.92, depthWrite: false })));
  const flames: { m: THREE.Mesh; base: number; speed: number; phase: number }[] = [];
  const flameGeo = new THREE.ConeGeometry(1, 1, 7);
  flameGeo.translate(0, 0.5, 0);
  const spots: [number, number, number, number][] = [
    [0, 0, 0.5, 0.17],
    [0.1, 0.06, 0.38, 0.12],
    [-0.1, 0.04, 0.34, 0.12],
    [0.02, -0.11, 0.4, 0.12],
    [-0.04, 0.01, 0.3, 0.08],
    [0.05, 0.03, 0.22, 0.06],
  ];
  spots.forEach(([x, z, h, r], i) => {
    const m = mesh(i === 0 ? flameGeo : flameGeo.clone(), flameMats[Math.min(2, Math.floor(i / 2))], x, DRUM.h - 0.12, z, false);
    m.scale.set(r, h, r);
    m.renderOrder = 2;
    g.add(m);
    flames.push({ m, base: h, speed: 7 + i * 1.7, phase: i * 1.9 });
  });

  // The glow: a halo round the flames and a warm pool on the floor.
  const glow = glowTexture(kit);
  const haloMat = kit.own(new THREE.SpriteMaterial({ map: glow, color: '#ff9a3c', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  const halo = new THREE.Sprite(haloMat);
  halo.position.set(0, DRUM.h + 0.25, 0);
  halo.scale.setScalar(1.8);
  g.add(halo);
  const poolMat = kit.own(new THREE.MeshBasicMaterial({ map: glow, color: '#ff8c32', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  const pool = mesh(new THREE.PlaneGeometry(3, 3), poolMat, 0, 0.02, 0, false);
  pool.rotation.x = -Math.PI / 2;
  g.add(pool);

  // Embers: a handful of sparks rising, fading, and starting over.
  const N = 14;
  const emberGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  emberGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const embers = new THREE.Points(emberGeo, kit.own(new THREE.PointsMaterial({ color: '#ffb347', size: 0.05, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })));
  embers.frustumCulled = false;
  g.add(embers);
  const rand = seeded(7);
  const life = Array.from({ length: N }, () => ({ age: rand() * 1.6, x: 0, z: 0, drift: 0 }));

  const update = (dt: number, t: number) => {
    for (const f of flames) {
      const s = 0.8 + 0.25 * Math.sin(t * f.speed + f.phase) + 0.12 * Math.sin(t * f.speed * 2.3 + f.phase);
      f.m.scale.y = f.base * s;
      f.m.rotation.z = 0.12 * Math.sin(t * 3 + f.phase);
    }
    const flick = 0.85 + 0.1 * Math.sin(t * 11) + 0.08 * Math.sin(t * 23.7);
    haloMat.opacity = 0.5 * flick;
    poolMat.opacity = 0.36 * flick;
    halo.scale.setScalar(1.7 + 0.15 * flick);
    for (let i = 0; i < N; i++) {
      const e = life[i];
      e.age += dt;
      if (e.age > 1.6) {
        e.age = 0;
        e.x = (rand() - 0.5) * 0.3;
        e.z = (rand() - 0.5) * 0.3;
        e.drift = (rand() - 0.5) * 0.3;
      }
      pos[i * 3] = e.x + e.drift * e.age + 0.04 * Math.sin(t * 4 + i);
      pos[i * 3 + 1] = DRUM.h + e.age * 0.9;
      pos[i * 3 + 2] = e.z + e.drift * e.age * 0.5;
    }
    emberGeo.attributes.position.needsUpdate = true;
  };
  update(0, 0);
  return { group: g, update };
}

/** A jerrycan: a slab with the X pressed into its sides, a three-bar handle and a spout. */
export function jerrycan(kit: Kit, color: string): THREE.Group {
  const g = new THREE.Group();
  const paint = kit.toon(color);
  const dark = kit.toon(new THREE.Color(color).multiplyScalar(0.7));
  const W = 0.36;
  const H = 0.46;
  const D = 0.17;
  g.add(mesh(new THREE.BoxGeometry(W, H, D), paint, 0, H / 2, 0));
  for (const s of [-1, 1])
    for (const a of [-1, 1]) {
      const x = mesh(new THREE.BoxGeometry(0.035, Math.hypot(W, H) * 0.78, 0.01), dark, 0, H / 2 - 0.02, s * (D / 2 + 0.003), false);
      x.rotation.z = a * Math.atan2(W, H);
      g.add(x);
    }
  for (const x of [-0.1, 0, 0.1]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.07, 0.03), dark, x, H + 0.035, 0, false));
  g.add(mesh(new THREE.BoxGeometry(0.26, 0.03, 0.035), dark, 0, H + 0.075, 0, false));
  const spout = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.07, 8), kit.toon(STEEL_DARK), W / 2 - 0.05, H + 0.03, 0, false);
  spout.rotation.z = -0.5;
  g.add(spout);
  return g;
}

// ---- Sandbags -----------------------------------------------------------------------------------

/**
 * A sandbag wall `length` long and `rows` high along x, from x = 0, its back against z = 0: lumpy
 * bags in a brick pattern, each a slightly different sandy shade and size.
 */
export function sandbags(kit: Kit, length: number, rows: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rand = seeded(seed);
  const shades = ['#c2a878', '#b39a6b', '#cdb688', '#a88f61'].map((c) => kit.toon(c));
  const tie = kit.toon('#8a7350');
  const BAG = { l: 0.52, h: 0.22, d: 0.34 };
  // A pillow: a sphere pushed out toward a box, so the bags sit flat on each other.
  const geo = new THREE.SphereGeometry(1, 12, 8);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    p.setXYZ(i, Math.sign(v.x) * Math.abs(v.x) ** 0.45, Math.sign(v.y) * Math.abs(v.y) ** 0.8, Math.sign(v.z) * Math.abs(v.z) ** 0.55);
  }
  geo.computeVertexNormals();
  for (let row = 0; row < rows; row++) {
    const inset = row * 0.03;
    const off = row % 2 ? BAG.l / 2 : 0;
    const n = Math.max(1, Math.round((length - off) / BAG.l));
    const step = (length - off) / n;
    for (let i = 0; i < n; i++) {
      const x = off + (i + 0.5) * step;
      const sx = (step / 2) * (0.96 + rand() * 0.06);
      const sy = (BAG.h / 2) * (0.9 + rand() * 0.15);
      const bag = mesh(geo, shades[Math.floor(rand() * shades.length)], x + (rand() - 0.5) * 0.03, sy + row * (BAG.h - 0.035), BAG.d / 2 + inset + (rand() - 0.5) * 0.03);
      bag.scale.set(sx, sy, (BAG.d / 2) * (0.92 + rand() * 0.1));
      bag.rotation.y = (rand() - 0.5) * 0.14;
      bag.rotation.z = (rand() - 0.5) * 0.06;
      g.add(bag);
      // The tied-off end of every other bag.
      if (rand() < 0.5) g.add(mesh(new THREE.SphereGeometry(0.04, 6, 4), tie, x + sx * 0.95, bag.position.y, bag.position.z + 0.03, false));
    }
  }
  return g;
}

// ---- Camo netting -------------------------------------------------------------------------------

function camoTexture(kit: Kit): THREE.CanvasTexture {
  const t = kit.canvas(256, 256, (g) => {
    g.fillStyle = '#4f5b32';
    g.fillRect(0, 0, 256, 256);
    const rand = seeded(11);
    for (const c of ['#6b7444', '#3a4325', '#7a6a43', '#2f3520', '#5d6b3a']) {
      g.fillStyle = c;
      for (let i = 0; i < 14; i++) {
        const x = rand() * 256;
        const y = rand() * 256;
        g.beginPath();
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          const r = 10 + rand() * 18;
          g.lineTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
      }
    }
    // The net: a diamond mesh of holes everywhere but under the leafy garnish tied into it, so the
    // lights show through it.
    const holes = document.createElement('canvas');
    holes.width = holes.height = 256;
    const h = holes.getContext('2d')!;
    for (let y = 0; y <= 256; y += 12)
      for (let x = (y / 12) % 2 ? 6 : 0; x <= 256; x += 12) {
        h.beginPath();
        h.moveTo(x, y - 5);
        h.lineTo(x + 5, y);
        h.lineTo(x, y + 5);
        h.lineTo(x - 5, y);
        h.closePath();
        h.fill();
      }
    h.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) {
      const x = rand() * 256;
      const y = rand() * 256;
      for (const [ox, oy] of [
        [0, 0],
        [256, 0],
        [0, 256],
        [-256, 0],
        [0, -256],
      ]) {
        h.beginPath();
        h.ellipse(x + ox, y + oy, 14 + rand() * 16, 9 + rand() * 10, rand() * 3, 0, Math.PI * 2);
        h.fill();
      }
    }
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(holes, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Camo netting slung in a corner under the ceiling: `w` × `d`, tacked up along the two walls (the
 * -x and -z edges, at y = 0) and sagging down toward the open corner, with its edges hanging in
 * scallops. Turn it so those edges are against the walls.
 */
export function camoNet(kit: Kit, w: number, d: number, sag: number, seed: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, d, 16, 16);
  geo.rotateX(-Math.PI / 2);
  geo.translate(w / 2, 0, d / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const rand = seeded(seed);
  const bump = Array.from({ length: p.count }, () => rand());
  for (let i = 0; i < p.count; i++) {
    const u = THREE.MathUtils.clamp(p.getX(i) / w, 0, 1);
    const v = THREE.MathUtils.clamp(p.getZ(i) / d, 0, 1);
    // Tacked up along both walls, hanging lowest toward the open corner, in folds.
    const droop = sag * Math.sqrt(u * v) * (1 + 0.15 * Math.sin(u * 9 + v * 4));
    // Its open edges hang down in scallops between the points it's tied up by.
    const out = Math.max(u, v);
    const edge = out > 0.9 ? sag * 0.5 * ((out - 0.9) / 0.1) * (0.6 + 0.4 * Math.sin((u + v) * 18)) : 0;
    p.setY(i, -droop - edge - bump[i] * 0.04 * Math.min(1, out * 4));
  }
  geo.computeVertexNormals();
  const map = camoTexture(kit);
  map.repeat.set(w / 2.5, d / 2.5);
  const mat = kit.own(new THREE.MeshToonMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, gradientMap: kit.toon('#fff').gradientMap }));
  const m = mesh(geo, mat, 0, 0, 0, false);
  return m;
}

// ---- Workshop corner ----------------------------------------------------------------------------

const PEG = { w: 1.9, h: 1.05, y: 1.08 } as const;

interface ToolDef {
  /** Where it hangs on the pegboard, from its bottom-left corner, in meters. */
  x: number;
  y: number;
  kind: 'wrench' | 'hammer' | 'screwdriver' | 'saw' | 'pliers' | 'tape' | 'coil' | 'square';
  rot?: number;
  color?: string;
  /** Not on its hook: just the painted outline where it goes. */
  missing?: boolean;
}

const TOOLS: ToolDef[] = [
  { x: 0.2, y: 0.6, kind: 'saw' },
  { x: 0.55, y: 0.72, kind: 'hammer' },
  { x: 0.75, y: 0.72, kind: 'hammer', missing: true },
  { x: 0.95, y: 0.8, kind: 'screwdriver', color: '#e63946' },
  { x: 1.04, y: 0.8, kind: 'screwdriver', color: '#ffd166' },
  { x: 1.13, y: 0.8, kind: 'screwdriver', color: '#06d6a0', missing: true },
  { x: 1.22, y: 0.8, kind: 'screwdriver', color: '#118ab2' },
  { x: 1.45, y: 0.78, kind: 'wrench' },
  { x: 1.57, y: 0.74, kind: 'wrench', rot: 0.0 },
  { x: 1.7, y: 0.7, kind: 'wrench', missing: true },
  { x: 0.5, y: 0.28, kind: 'pliers' },
  { x: 0.78, y: 0.3, kind: 'tape' },
  { x: 1.08, y: 0.3, kind: 'coil' },
  { x: 1.5, y: 0.3, kind: 'square' },
];

/** A tool's silhouette, for its outline on the shadow board. Sizes in pixels at 200 px a meter. */
function toolOutline(g: CanvasRenderingContext2D, t: ToolDef, px: number, py: number) {
  g.save();
  g.translate(px, py);
  g.rotate(-(t.rot ?? 0));
  g.beginPath();
  switch (t.kind) {
    case 'hammer':
      g.rect(-4, -10, 8, 50);
      g.rect(-16, -18, 32, 12);
      break;
    case 'screwdriver':
      g.rect(-2, -10, 4, 30);
      g.rect(-5, 20, 10, 22);
      break;
    case 'wrench':
      g.rect(-4, -40, 8, 70);
      g.arc(0, -42, 9, 0, Math.PI * 2);
      g.arc(0, 32, 8, 0, Math.PI * 2);
      break;
    default:
      break;
  }
  g.fill();
  g.restore();
}

function pegboardTexture(kit: Kit): THREE.CanvasTexture {
  const S = 200;
  return kit.canvas(Math.round(PEG.w * S), Math.round(PEG.h * S), (g) => {
    const W = PEG.w * S;
    const H = PEG.h * S;
    g.fillStyle = '#c8a36f';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(70,45,20,0.6)';
    for (let y = 8; y < H; y += 16) for (let x = 8; x < W; x += 16) g.fillRect(x - 1.5, y - 1.5, 3, 3);
    // Painted outlines where each tool hangs, so you can see what's missing.
    g.fillStyle = 'rgba(40,40,46,0.75)';
    for (const t of TOOLS) toolOutline(g, t, t.x * S, H - t.y * S);
    // A strip of tape along the top with a label.
    g.fillStyle = '#f1e3b5';
    g.fillRect(W / 2 - 110, 6, 220, 26);
    g.fillStyle = '#2b2d42';
    g.font = `bold 20px ${STENCIL}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PUT IT BACK!', W / 2, 20);
    g.strokeStyle = WOOD_DARK;
    g.lineWidth = 10;
    g.strokeRect(0, 0, W, H);
  });
}

/** One tool on the board, built facing +z with its hook point at the origin. */
function tool(kit: Kit, t: ToolDef): THREE.Object3D {
  const g = new THREE.Group();
  const steel = kit.toon('#c9d1d9');
  const grip = kit.toon(t.color ?? '#d62828');
  const wood = kit.toon(WOOD);
  switch (t.kind) {
    case 'hammer':
      g.add(mesh(new THREE.BoxGeometry(0.04, 0.26, 0.03), wood, 0, -0.07, 0.02));
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.055, 0.045), kit.toon(STEEL_DARK), 0, 0.06, 0.025));
      break;
    case 'screwdriver':
      g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.15, 6), steel, 0, 0.0, 0.02));
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.11, 8), grip, 0, -0.13, 0.02));
      break;
    case 'wrench':
      g.add(mesh(new THREE.BoxGeometry(0.035, 0.33, 0.012), steel, 0, -0.03, 0.015));
      g.add(mesh(new THREE.TorusGeometry(0.035, 0.013, 5, 10, Math.PI * 1.5), steel, 0, 0.17, 0.015).rotateZ(-Math.PI * 0.25));
      g.add(mesh(new THREE.TorusGeometry(0.03, 0.012, 5, 12), steel, 0, -0.2, 0.015));
      break;
    case 'saw': {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(0.5, 0.02);
      shape.lineTo(0.5, 0.1);
      shape.lineTo(0, 0.16);
      shape.closePath();
      const blade = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false }), steel, 0, -0.08, 0.012);
      g.add(blade);
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.15, 0.03), wood, -0.04, 0, 0.02));
      g.rotation.z = Math.PI / 2;
      break;
    }
    case 'pliers':
      for (const s of [-1, 1]) {
        const arm = mesh(new THREE.BoxGeometry(0.025, 0.2, 0.015), grip, s * 0.025, -0.05, 0.015);
        arm.rotation.z = s * 0.18;
        g.add(arm);
        g.add(mesh(new THREE.BoxGeometry(0.02, 0.07, 0.016), steel, s * 0.008, 0.08, 0.016));
      }
      break;
    case 'tape': {
      const c = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 14), kit.toon('#ffd166'), 0, 0, 0.03);
      c.rotation.x = Math.PI / 2;
      g.add(c);
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.045), kit.toon('#2b2d42'), 0.04, -0.04, 0.03));
      break;
    }
    case 'coil': {
      const c = mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 18), kit.toon('#e76f51'), 0, -0.06, 0.03);
      g.add(c);
      g.add(mesh(new THREE.TorusGeometry(0.095, 0.02, 6, 18), kit.toon('#e76f51'), 0.01, -0.07, 0.05));
      break;
    }
    case 'square':
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.3, 0.01), steel, 0, -0.05, 0.015));
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.04, 0.012), wood, 0.085, -0.18, 0.015));
      break;
  }
  // The hook it hangs from.
  g.add(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 4), kit.toon(STEEL_DARK), 0, 0.02, 0.02, false).rotateX(Math.PI / 2));
  g.rotation.z += t.rot ?? 0;
  return g;
}

/**
 * The workshop corner: a worn workbench `PEG.w` wide against the wall, a pegboard of tools over it
 * (with outlines painted where the missing ones go), a vice on one end, a toolbox on the other,
 * jerrycans and a crate of parts under it.
 */
export function workshop(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const W = PEG.w;
  const D = 0.62;
  const TOP = 0.9;
  const wood = kit.toon(WOOD);
  const woodDark = kit.toon(WOOD_DARK);
  g.add(mesh(new THREE.BoxGeometry(W, 0.07, D), wood, 0, TOP - 0.035, D / 2 + 0.02));
  // Scorch marks and a ring stain, as blobs on the top.
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.004, 14), woodDark, -0.35, TOP + 0.002, 0.42, false));
  for (const x of [-W / 2 + 0.06, W / 2 - 0.06])
    for (const z of [0.08, D - 0.04]) g.add(mesh(new THREE.BoxGeometry(0.07, TOP - 0.07, 0.07), woodDark, x, (TOP - 0.07) / 2, z));
  g.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.04, D - 0.1), woodDark, 0, 0.22, D / 2 + 0.02));
  g.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.12, 0.03), woodDark, 0, TOP - 0.13, D + 0.0));

  // The pegboard and its tools.
  const board = mesh(new THREE.PlaneGeometry(W, PEG.h), kit.own(new THREE.MeshToonMaterial({ map: pegboardTexture(kit), gradientMap: kit.toon('#fff').gradientMap })), 0, PEG.y + PEG.h / 2, 0.015, false);
  g.add(board);
  for (const t of TOOLS) {
    if (t.missing) continue;
    const o = tool(kit, t);
    o.position.set(-W / 2 + t.x, PEG.y + t.y, 0.015);
    g.add(o);
  }

  // The vice, bolted to the right-hand end, its jaws over the front edge.
  const blue = kit.toon('#3a6ea5');
  const vx = W / 2 - 0.22;
  const vz = D - 0.02;
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.06, 0.22), blue, vx, TOP + 0.03, vz - 0.12));
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.13, 0.07), blue, vx, TOP + 0.12, vz - 0.12));
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.13, 0.07), blue, vx, TOP + 0.12, vz + 0.02));
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), kit.toon(STEEL_DARK), vx, TOP + 0.19, vz - 0.075, false));
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), kit.toon(STEEL_DARK), vx, TOP + 0.19, vz - 0.025, false));
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 8), kit.toon('#c9d1d9'), vx, TOP + 0.1, vz + 0.12, false).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.26, 6), kit.toon('#c9d1d9'), vx, TOP + 0.1, vz + 0.25, false).rotateZ(Math.PI / 2));
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.018, 6, 4), kit.toon('#c9d1d9'), vx + s * 0.13, TOP + 0.1, vz + 0.25, false));
  // A bit of wood caught in its jaws.
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.2, 0.1), wood, vx, TOP + 0.22, vz - 0.05));

  // The toolbox on the left-hand end, lid shut, handle up.
  const red = kit.toon('#c0392b');
  const tx = -W / 2 + 0.35;
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.2, 0.24), red, tx, TOP + 0.1, 0.3));
  g.add(mesh(new THREE.BoxGeometry(0.52, 0.03, 0.26), kit.toon('#9b2c22'), tx, TOP + 0.13, 0.3, false));
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), kit.toon('#c9d1d9'), tx, TOP + 0.1, 0.43, false));
  g.add(mesh(new THREE.TorusGeometry(0.08, 0.012, 5, 12, Math.PI), kit.toon('#2b2d42'), tx, TOP + 0.21, 0.3, false));
  // A rag and an oil can beside it.
  const rag = mesh(new THREE.SphereGeometry(0.08, 7, 5), kit.toon('#dfe7ef'), tx + 0.42, TOP + 0.03, 0.42, false);
  rag.scale.set(1, 0.35, 0.8);
  g.add(rag);
  const can = new THREE.Group();
  can.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 12), kit.toon('#e9c46a'), 0, 0.06, 0));
  const nozzle = mesh(new THREE.CylinderGeometry(0.006, 0.014, 0.18, 6), kit.toon('#e9c46a'), 0.04, 0.17, 0, false);
  nozzle.rotation.z = -0.6;
  can.add(nozzle);
  can.position.set(0.1, TOP, 0.25);
  g.add(can);

  // Under the bench: two jerrycans and a crate of spare parts.
  const j1 = jerrycan(kit, OLIVE);
  j1.position.set(-0.55, 0, 0.18);
  const j2 = jerrycan(kit, '#c0392b');
  j2.position.set(-0.15, 0, 0.2);
  j2.rotation.y = 0.15;
  g.add(j1, j2);
  return g;
}

// ---- The war-room map ---------------------------------------------------------------------------

/** A big old map on the wall: coastlines, a grid, contour rings, routes in red and pins. `w` × `h`. */
export function wallMap(kit: Kit, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const S = 160;
  const tex = kit.canvas(Math.round(w * S), Math.round(h * S), (c) => {
    const W = w * S;
    const H = h * S;
    const rand = seeded(23);
    c.fillStyle = '#9cc3c9';
    c.fillRect(0, 0, W, H);
    // Land: a couple of big wobbly blobs and an island.
    const blob = (cx: number, cy: number, r: number, k: number) => {
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const rr = r * (1 + 0.18 * Math.sin(a * k + cx) + 0.1 * Math.sin(a * (k + 3) + cy));
        c.lineTo(cx + Math.cos(a) * rr * 1.3, cy + Math.sin(a) * rr);
      }
      c.closePath();
    };
    c.fillStyle = '#e8d9a8';
    c.strokeStyle = '#6d5a3a';
    c.lineWidth = 3;
    for (const [x, y, r, k] of [
      [W * 0.3, H * 0.45, H * 0.38, 5],
      [W * 0.78, H * 0.35, H * 0.26, 4],
      [W * 0.72, H * 0.82, H * 0.1, 3],
    ]) {
      blob(x, y, r, k);
      c.fill();
      c.stroke();
    }
    // Contours: smaller rings inside the land, greener toward the top.
    for (const [x, y, r] of [
      [W * 0.27, H * 0.42, H * 0.2],
      [W * 0.8, H * 0.33, H * 0.13],
    ]) {
      for (let i = 1; i <= 3; i++) {
        blob(x, y, r * (1 - i * 0.25), 4 + i);
        c.fillStyle = ['#cdd59a', '#b5c77f', '#9db86a'][i - 1];
        c.fill();
        c.lineWidth = 1.5;
        c.stroke();
      }
    }
    // The grid, with letters and numbers along the edges.
    c.strokeStyle = 'rgba(60,50,40,0.35)';
    c.lineWidth = 1.5;
    c.fillStyle = '#3d3326';
    c.font = `bold 18px ${STENCIL}`;
    const cols = 8;
    const rows = 5;
    for (let i = 1; i < cols; i++) {
      c.beginPath();
      c.moveTo((i * W) / cols, 0);
      c.lineTo((i * W) / cols, H);
      c.stroke();
    }
    for (let i = 1; i < rows; i++) {
      c.beginPath();
      c.moveTo(0, (i * H) / rows);
      c.lineTo(W, (i * H) / rows);
      c.stroke();
    }
    c.textAlign = 'center';
    for (let i = 0; i < cols; i++) c.fillText('ABCDEFGH'[i], ((i + 0.5) * W) / cols, 18);
    for (let i = 0; i < rows; i++) c.fillText(String(i + 1), 12, ((i + 0.5) * H) / rows + 6);
    // Routes, dashed in red, between the places that matter.
    const spots = [
      [W * 0.2, H * 0.55, 'HQ'],
      [W * 0.42, H * 0.3, 'DEPOT'],
      [W * 0.8, H * 0.36, 'SECTOR 7'],
      [W * 0.7, H * 0.8, 'DROP'],
    ] as const;
    c.strokeStyle = '#c1121f';
    c.lineWidth = 4;
    c.setLineDash([10, 7]);
    c.beginPath();
    c.moveTo(spots[0][0], spots[0][1]);
    for (const [x, y] of spots.slice(1)) c.quadraticCurveTo((x + spots[0][0]) / 2 + 30, Math.min(y, spots[0][1]) - 40, x, y);
    c.stroke();
    c.setLineDash([]);
    // Each place: a red circle and its name; an X on the drop.
    c.font = `bold 22px ${STENCIL}`;
    for (const [x, y, name] of spots) {
      c.strokeStyle = '#c1121f';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(x, y, 14, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#1d1a14';
      c.fillText(name, x, y - 22);
    }
    // A compass rose in the corner, and the title.
    c.save();
    c.translate(W - 48, H - 48);
    c.fillStyle = '#3d3326';
    for (let i = 0; i < 4; i++) {
      c.rotate(Math.PI / 2);
      c.beginPath();
      c.moveTo(0, -34);
      c.lineTo(7, 0);
      c.lineTo(-7, 0);
      c.closePath();
      c.fill();
    }
    c.restore();
    c.fillText('N', W - 48, H - 88);
    c.fillStyle = 'rgba(255,248,225,0.85)';
    c.fillRect(W * 0.04, H - 52, 250, 38);
    c.fillStyle = '#1d1a14';
    c.textAlign = 'left';
    c.fillText('OPERATION: SHIP IT', W * 0.04 + 12, H - 25);
    // Age: stains and a faded edge.
    for (let i = 0; i < 18; i++) {
      c.fillStyle = `rgba(120,90,40,${0.04 + rand() * 0.06})`;
      c.beginPath();
      c.arc(rand() * W, rand() * H, 10 + rand() * 50, 0, Math.PI * 2);
      c.fill();
    }
    const vignette = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.65);
    vignette.addColorStop(0, 'rgba(90,60,20,0)');
    vignette.addColorStop(1, 'rgba(90,60,20,0.35)');
    c.fillStyle = vignette;
    c.fillRect(0, 0, W, H);
  });
  g.add(mesh(new THREE.PlaneGeometry(w, h), kit.own(new THREE.MeshToonMaterial({ map: tex, gradientMap: kit.toon('#fff').gradientMap })), 0, 0, 0.04, false));
  // A wooden frame round it.
  const frame = kit.toon(WOOD_DARK);
  const F = 0.07;
  g.add(mesh(new THREE.BoxGeometry(w + 2 * F, F, 0.05), frame, 0, h / 2 + F / 2, 0.03));
  g.add(mesh(new THREE.BoxGeometry(w + 2 * F, F, 0.05), frame, 0, -h / 2 - F / 2, 0.03));
  g.add(mesh(new THREE.BoxGeometry(F, h, 0.05), frame, -w / 2 - F / 2, 0, 0.03));
  g.add(mesh(new THREE.BoxGeometry(F, h, 0.05), frame, w / 2 + F / 2, 0, 0.03));
  // Pins stuck in it.
  const pinGeo = new THREE.SphereGeometry(0.025, 8, 6);
  for (const [u, v, c] of [
    [0.2, 0.45, '#e63946'],
    [0.42, 0.7, '#ffd166'],
    [0.8, 0.64, '#e63946'],
    [0.7, 0.2, '#06d6a0'],
    [0.55, 0.5, '#ffd166'],
  ] as const)
    g.add(mesh(pinGeo.clone(), kit.toon(c), (u - 0.5) * w, (v - 0.5) * h, 0.07, false));
  pinGeo.dispose();
  return g;
}

// ---- The radio set ------------------------------------------------------------------------------

/** An old field radio: olive case, two big dials, a glowing meter, a speaker grille and a whip aerial. */
export function radio(kit: Kit): Animated {
  const g = new THREE.Group();
  const W = 0.62;
  const H = 0.36;
  const D = 0.3;
  const olive = kit.toon('#5b6b3c');
  g.add(mesh(new THREE.BoxGeometry(W, H, D), olive, 0, H / 2, 0));
  // Corner guards and a carrying handle.
  for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.04, H + 0.02, D + 0.02), kit.toon('#3f4a29'), sx * (W / 2 - 0.02), H / 2, 0, false));
  g.add(mesh(new THREE.TorusGeometry(0.1, 0.015, 5, 12, Math.PI), kit.toon('#2b2d42'), 0, H, 0, false));
  // The face: grille, meter, dials, a tuning scale, all drawn.
  const face = kit.canvas(256, 148, (c) => {
    c.fillStyle = '#2f3524';
    c.fillRect(0, 0, 256, 148);
    c.fillStyle = '#1a1d14';
    for (let i = 0; i < 9; i++) c.fillRect(14, 16 + i * 13, 82, 6);
    c.fillStyle = '#f2e8c9';
    c.fillRect(110, 14, 132, 30);
    c.fillStyle = '#2b2d42';
    for (let i = 0; i <= 12; i++) c.fillRect(116 + i * 10, 14, 2, i % 3 ? 8 : 14);
    c.font = `bold 11px ${STENCIL}`;
    c.fillText('88   92   96  100  104  108', 114, 40);
    c.fillStyle = '#e63946';
    c.fillRect(170, 14, 3, 30);
    c.fillStyle = '#d9d2b6';
    c.font = `bold 13px ${STENCIL}`;
    c.textAlign = 'center';
    c.fillText('VOL', 140, 138);
    c.fillText('TUNE', 212, 138);
  });
  g.add(mesh(new THREE.PlaneGeometry(W - 0.08, H - 0.06), kit.own(new THREE.MeshToonMaterial({ map: face, gradientMap: kit.toon('#fff').gradientMap })), 0, H / 2, D / 2 + 0.002, false));
  // The meter: a little lit window with a needle that wobbles while it plays.
  const meterMat = kit.own(new THREE.MeshBasicMaterial({ color: '#ffe8a3' }));
  g.add(mesh(new THREE.CircleGeometry(0.045, 16, 0, Math.PI), meterMat, 0.17, H / 2 - 0.02, D / 2 + 0.004, false));
  const needle = mesh(new THREE.BoxGeometry(0.004, 0.04, 0.002), kit.toon('#c1121f'), 0, 0.02, 0, false);
  const needlePivot = new THREE.Group();
  needlePivot.position.set(0.17, H / 2 - 0.02, D / 2 + 0.006);
  needlePivot.add(needle);
  g.add(needlePivot);
  // Knobs.
  for (const [x, r] of [
    [0.06, 0.035],
    [0.17, 0.04],
  ]) {
    const k = mesh(new THREE.CylinderGeometry(r, r, 0.03, 14), kit.toon('#1b1d16'), x, 0.07, D / 2 + 0.015, false);
    k.rotation.x = Math.PI / 2;
    g.add(k);
  }
  // A headset hung on a hook on its side, and the whip aerial leaning back.
  const aerial = mesh(new THREE.CylinderGeometry(0.005, 0.009, 1.0, 5), kit.toon(STEEL), -0.24, H + 0.5, -0.08, false);
  aerial.rotation.z = 0.25;
  aerial.rotation.x = -0.15;
  g.add(aerial);
  g.add(mesh(new THREE.SphereGeometry(0.014, 6, 4), kit.toon('#e63946'), -0.24 - Math.sin(0.25) * 0.5, H + 0.98, -0.08 - 0.075, false));
  g.add(mesh(new THREE.TorusGeometry(0.075, 0.01, 5, 12, Math.PI), kit.toon('#2b2d42'), W / 2 + 0.03, H * 0.62, 0, false).rotateY(Math.PI / 2));
  for (const z of [-0.075, 0.075]) {
    const cup = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), kit.toon('#2b2d42'), W / 2 + 0.03, H * 0.62, z, false);
    cup.rotation.z = Math.PI / 2;
    g.add(cup);
  }
  return {
    group: g,
    update: (_dt, t) => {
      needlePivot.rotation.z = 0.5 * Math.sin(t * 1.3) + 0.25 * Math.sin(t * 4.1) + 0.12 * Math.sin(t * 9.7);
    },
  };
}

// ---- Signs --------------------------------------------------------------------------------------

/**
 * The neon "BUNKER" sign: glass tubes of light on a dark steel backing plate, bolted to the wall,
 * buzzing now and then: every so often it stutters, and its "K" goes out for a moment.
 */
export function neonSign(kit: Kit, text = 'BUNKER'): Animated {
  const g = new THREE.Group();
  const W = 3.4;
  const H = 1;
  const px = 160;
  const draw = (off: number) => (c: CanvasRenderingContext2D) => {
    c.font = `bold ${0.62 * H * px}px "Arial Rounded MT Bold", ${STENCIL}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    const letters = [...text];
    const widths = letters.map((l) => c.measureText(l).width + 14);
    let x = (W * px - widths.reduce((a, b) => a + b, 0)) / 2;
    letters.forEach((l, i) => {
      const cx = x + widths[i] / 2;
      x += widths[i];
      const lit = i !== off;
      // The tube: a wide soft glow, the colored glass, then the hot white core.
      c.shadowColor = lit ? '#ff3d6e' : 'transparent';
      c.shadowBlur = lit ? 30 : 0;
      c.strokeStyle = lit ? '#ff4f7b' : '#5a2a38';
      c.lineWidth = 11;
      c.strokeText(l, cx, (H * px) / 2 + 4);
      c.shadowBlur = lit ? 12 : 0;
      c.strokeStyle = lit ? '#ffd6e2' : '#6b3a48';
      c.lineWidth = 4;
      c.strokeText(l, cx, (H * px) / 2 + 4);
    });
    c.shadowBlur = 0;
  };
  const on = kit.canvas(W * px, H * px, draw(-1));
  const kOff = kit.canvas(W * px, H * px, draw(text.indexOf('K')));
  // The backing plate, bolted up, with the transformer box on it.
  g.add(mesh(new THREE.BoxGeometry(W + 0.2, H + 0.2, 0.06), kit.toon('#2a2d36'), 0, 0, 0.03));
  for (const x of [-1, 1]) for (const y of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), kit.toon(STEEL), x * (W / 2 + 0.03), y * (H / 2 + 0.03), 0.07, false).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.14, 0.1), kit.toon('#3a3f4b'), W / 2 - 0.15, -H / 2 - 0.12, 0.05));
  const mat = kit.own(new THREE.MeshBasicMaterial({ map: on, transparent: true, depthWrite: false, toneMapped: false }));
  const tubes = mesh(new THREE.PlaneGeometry(W, H), mat, 0, 0, 0.065, false);
  tubes.renderOrder = 3;
  g.add(tubes);
  // A pink wash on the wall round it.
  const washMat = kit.own(new THREE.MeshBasicMaterial({ map: glowTexture(kit), color: '#ff3d6e', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  const wash = mesh(new THREE.PlaneGeometry(W * 1.9, H * 3), washMat, 0, 0, 0.01, false);
  g.add(wash);

  let next = 4;
  let stutter = 0;
  return {
    group: g,
    update: (dt, t) => {
      if (t > next) {
        stutter = 0.6 + Math.random() * 0.6;
        next = t + 6 + Math.random() * 8;
      }
      if (stutter > 0) {
        stutter -= dt;
        const blink = Math.sin(t * 40) > 0.2;
        mat.map = blink ? kOff : on;
        washMat.opacity = blink ? 0.25 : 0.35;
      } else if (mat.map !== on) {
        mat.map = on;
        washMat.opacity = 0.35;
      }
    },
  };
}

/** A yellow-and-black warning sign, `w` × `h`, on a steel plate: a hazard triangle and the words. */
export function warningSign(kit: Kit, lines: string[], w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const px = 360;
  const tex = kit.canvas(Math.round(w * px), Math.round(h * px), (c) => {
    const W = w * px;
    const H = h * px;
    c.fillStyle = '#ffd23f';
    c.fillRect(0, 0, W, H);
    // Hazard stripes along the top and bottom.
    c.save();
    for (const y0 of [0, H - 26]) {
      c.beginPath();
      c.rect(0, y0, W, 26);
      c.clip();
      c.fillStyle = '#1d1d1d';
      for (let x = -40; x < W + 40; x += 36) {
        c.beginPath();
        c.moveTo(x, y0 + 26);
        c.lineTo(x + 18, y0 + 26);
        c.lineTo(x + 44, y0);
        c.lineTo(x + 26, y0);
        c.closePath();
        c.fill();
      }
      c.restore();
      c.save();
    }
    c.restore();
    // The triangle with its "!".
    const ty = 42;
    const ts = Math.min(W * 0.32, 96);
    c.fillStyle = '#1d1d1d';
    c.beginPath();
    c.moveTo(W / 2, ty);
    c.lineTo(W / 2 + ts / 2, ty + ts * 0.86);
    c.lineTo(W / 2 - ts / 2, ty + ts * 0.86);
    c.closePath();
    c.fill();
    c.fillStyle = '#ffd23f';
    c.fillRect(W / 2 - 5, ty + ts * 0.3, 10, ts * 0.32);
    c.fillRect(W / 2 - 5, ty + ts * 0.68, 10, 10);
    // The words, as big as fit.
    c.fillStyle = '#1d1d1d';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const top = ty + ts * 0.86 + 14;
    const lh = (H - 30 - top) / lines.length;
    lines.forEach((l, i) => {
      let size = lh * 0.8;
      c.font = `bold ${size}px ${STENCIL}`;
      while (c.measureText(l).width > W - 30 && size > 8) {
        size -= 2;
        c.font = `bold ${size}px ${STENCIL}`;
      }
      c.fillText(l, W / 2, top + (i + 0.5) * lh);
    });
  });
  g.add(mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.02), kit.toon(STEEL_DARK), 0, 0, 0.01, false));
  g.add(mesh(new THREE.PlaneGeometry(w, h), kit.own(new THREE.MeshToonMaterial({ map: tex, gradientMap: kit.toon('#fff').gradientMap })), 0, 0, 0.022, false));
  for (const x of [-1, 1]) for (const y of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.012, 6, 4), kit.toon(STEEL), x * (w / 2 - 0.03), y * (h / 2 - 0.03), 0.025, false));
  return g;
}
