// The bunker's packing table in the middle of the room: a steel table with a digital scale on it, a
// pile of empty bags, a jar or two and a stack of bricks, packaging boxes on the shelf underneath, and
// the packing machine at its end once you've bought one. While you're packing (your bench, see
// shared/bunker/pack.ts), the scale's display shows the grams, the heap on its pan grows with them,
// and the packaging you're filling stands open beside it.
import * as THREE from 'three';
import { countItem, stationBox, type StationSpot } from '../../../shared/bunker/index';
import { productKind } from '../../../shared/bunker/items';
import { PACK_MACHINE, benchTarget, reading, type PackId, type PackState } from '../../../shared/bunker/pack';
import { mergeByMaterial, mesh, toon, toonUnique } from '../toon';
import type { StationView } from './station';

/** How high the table's top is. */
export const PACK_TABLE_TOP = 0.9;

/** What the heap on the scale looks like for each product: weed's green, the lab's made-up ones their own colors. */
const HEAP_COLORS: Record<string, string> = { glimmer: '#cfe6f7', fizz: '#f1eee6', nebula: '#9a82d8' };
const WEED = '#6f9a3c';

function heapColor(product: string | undefined): string {
  if (!product) return WEED;
  return HEAP_COLORS[product] ?? (productKind(product)?.source === 'lab' ? '#e7e2f0' : WEED);
}

/** The scale's display: dark green, lit digits. Drawn again only when what it shows changes. */
function scaleDisplay() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  let shown = '';
  const draw = (text: string, color: string) => {
    if (text + color === shown) return;
    shown = text + color;
    const g = c.getContext('2d');
    if (!g) return;
    g.fillStyle = '#1d2a1d';
    g.fillRect(0, 0, 128, 48);
    g.fillStyle = color;
    g.font = 'bold 30px ui-monospace, Menlo, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(text, 120, 26);
    tex.needsUpdate = true;
  };
  draw('0.00', '#8fe388');
  return { tex, draw };
}

/** The grams as the display shows them: two decimals, or fewer once they're big. */
export function displayGrams(g: number): string {
  return g >= 1000 ? g.toFixed(0) : g >= 100 ? g.toFixed(1) : g.toFixed(2);
}

export function buildPack(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-pack';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;

  const steel = toon('#9aa1a6');
  const dark = toon('#3a3f44');
  const card = toon('#b98a52');
  const bagMat = toon('#e9eef0', { transparent: true, opacity: 0.85 });
  const glass = toon('#cfe3e6', { transparent: true, opacity: 0.6 });
  const lid = toon('#2f3a44');
  const wrap = toon('#c9c19a');
  const tape = toon('#c8a040');

  // ---- What doesn't move: the table, its shelf, the scale's body, the empty packaging ---------------------
  const statics = new THREE.Group();
  const W = spot.w - 0.1;
  const D = spot.d - 0.1;
  const top = PACK_TABLE_TOP;
  statics.add(mesh(new THREE.BoxGeometry(W, 0.05, D), steel, 0, top - 0.025, 0));
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) statics.add(mesh(new THREE.BoxGeometry(0.05, top - 0.05, 0.05), dark, x, (top - 0.05) / 2, z));
  statics.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.03, D - 0.1), dark, 0, 0.22, 0, false));
  // Boxes of packaging on the shelf.
  for (const [x, w, hh] of [
    [-0.7, 0.42, 0.26],
    [-0.22, 0.36, 0.22],
    [0.35, 0.5, 0.3],
  ] as const)
    statics.add(mesh(new THREE.BoxGeometry(w, hh, 0.5), card, x, 0.235 + hh / 2, -0.05));

  // The scale, front and middle: a body, a sloped display, a steel pan.
  const scaleX = 0.05;
  const scaleZ = 0.12;
  statics.add(mesh(new THREE.BoxGeometry(0.34, 0.06, 0.3), dark, scaleX, top + 0.03, scaleZ));
  statics.add(mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.015, 24), steel, scaleX, top + 0.068, scaleZ - 0.02));

  // A pile of empty bags on the left, a few jars behind it, bricks of wrap on the right.
  for (let i = 0; i < 9; i++) {
    const b = mesh(new THREE.BoxGeometry(0.1, 0.006, 0.13), bagMat, -0.75 + (i % 3) * 0.035, top + 0.004 + i * 0.006, 0.1 + ((i * 7) % 5) * 0.012, false);
    b.rotation.y = ((i * 37) % 60) * 0.01 - 0.3;
    statics.add(b);
  }
  for (const [x, z] of [
    [-0.55, -0.3],
    [-0.42, -0.34],
    [-0.48, -0.18],
  ] as const) {
    statics.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 14), glass, x, top + 0.055, z));
    statics.add(mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.02, 14), lid, x, top + 0.12, z, false));
  }
  for (let i = 0; i < 3; i++) {
    statics.add(mesh(new THREE.BoxGeometry(0.22, 0.07, 0.13), wrap, 0.62, top + 0.035 + i * 0.07, -0.28 + (i % 2) * 0.01));
    statics.add(mesh(new THREE.BoxGeometry(0.225, 0.012, 0.135), tape, 0.62, top + 0.035 + i * 0.07, -0.28 + (i % 2) * 0.01, false));
  }
  group.add(mergeByMaterial(statics));

  // ---- The scale's display ------------------------------------------------------------------------------
  const display = scaleDisplay();
  const screenMat = new THREE.MeshBasicMaterial({ map: display.tex });
  screenMat.toneMapped = false;
  screenMat.userData.outlineParameters = { visible: false };
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), screenMat);
  screen.name = 'pack-display';
  screen.position.set(scaleX, top + 0.045, scaleZ + 0.151);
  screen.rotation.x = -0.35;
  group.add(screen);

  // ---- What's being packed: the heap on the pan, and the packaging open beside it ---------------------
  const heapMat = toonUnique(WEED);
  const heap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), heapMat);
  heap.name = 'pack-heap';
  heap.position.set(scaleX, top + 0.075, scaleZ - 0.02);
  heap.visible = false;
  group.add(heap);

  const open: Record<PackId, THREE.Object3D> = {
    bag: mesh(new THREE.BoxGeometry(0.07, 0.09, 0.012), bagMat, 0, 0.045, 0),
    'bag-big': mesh(new THREE.BoxGeometry(0.12, 0.15, 0.02), bagMat, 0, 0.075, 0),
    jar: (() => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 14), glass, 0, 0.06, 0));
      const l = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 14), lid, 0.09, 0.01, 0, false);
      g.add(l);
      return g;
    })(),
    brick: mesh(new THREE.BoxGeometry(0.24, 0.08, 0.14), wrap, 0, 0.04, 0),
  };
  const packing = new THREE.Group();
  packing.name = 'pack-packing';
  packing.position.set(scaleX + 0.32, top, scaleZ);
  for (const o of Object.values(open)) {
    o.visible = false;
    packing.add(o);
  }
  group.add(packing);

  // ---- The packing machine, at the right end, once there is one --------------------------------------------
  const machine = new THREE.Group();
  machine.name = 'pack-machine';
  machine.add(mesh(new THREE.BoxGeometry(0.34, 0.2, 0.36), toon('#d0632f'), 0, 0.1, -0.02));
  machine.add(mesh(new THREE.BoxGeometry(0.2, 0.06, 0.2), steel, 0, 0.23, -0.04));
  machine.add(mesh(new THREE.BoxGeometry(0.16, 0.02, 0.14), dark, 0, 0.04, 0.22));
  const lamp = new THREE.MeshBasicMaterial({ color: '#6cff6c' });
  lamp.userData.outlineParameters = { visible: false };
  machine.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), lamp, 0.12, 0.16, 0.165, false));
  machine.position.set(W / 2 - 0.22, top, 0.12);
  machine.visible = false;
  group.add(machine);

  const box = stationBox(spot);
  let blink = 0;
  return {
    group,
    colliders: [{ ...box, top }],
    update(t, dt, mine) {
      const state = mine?.pack as PackState | undefined;
      const bench = state?.bench ?? null;
      machine.visible = !!mine && countItem(mine.inventory, PACK_MACHINE) > 0;
      if (machine.visible) {
        blink += dt;
        lamp.color.set(bench && Math.floor(blink * 3) % 2 ? '#2a6a2a' : '#6cff6c');
      }
      for (const [id, o] of Object.entries(open)) o.visible = !!bench && bench.pack === id;
      if (!bench) {
        heap.visible = false;
        display.draw(displayGrams(0), '#8fe388');
        return;
      }
      const target = benchTarget(bench);
      const share = Math.min(1.5, bench.grams / target);
      heap.visible = share > 0;
      // The heap grows with what's on the pan (its volume, so its size goes with the cube root), and breathes a little.
      const s = Math.max(0.15, Math.cbrt(share)) * (1 + Math.sin(t * 2) * 0.01);
      heap.scale.set(s, s * 0.7, s);
      const from = mine?.products.find((u) => u.id === bench.from);
      heapMat.color.set(heapColor(from?.product));
      const read = reading(bench.grams, target);
      display.draw(displayGrams(bench.grams), read === 'on' ? '#8fe388' : read === 'over' ? '#ff7b7b' : '#ffd166');
    },
  };
}
