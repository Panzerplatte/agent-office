import * as THREE from 'three';
import { DESK_SIZE } from '../../shared/layout';
import { SHOP_ITEMS, type ShopItem } from '../../shared/shop';
import { mesh, toon, toonUnique } from './toon';

// What the casino's shop sells (see shared/shop.ts), as things in the world: hats and glasses for a
// person's head, and knick-knacks for a desk. The same models go on people, on desks and on the
// shop's own displays. One builder per item id: an item without one is a test failure, not a blank.

const GOLD = '#e9b949';
const glowCache = new Map<string, THREE.MeshBasicMaterial>();
/** A material that glows on its own (the lava lamp's wax), shared like toon's. */
function glow(color: string): THREE.MeshBasicMaterial {
  let m = glowCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    m.toneMapped = false;
    glowCache.set(color, m);
  }
  return m;
}

const twoSidedCache = new Map<string, THREE.MeshToonMaterial>();
/** A toon material seen from inside too (an open ring, a cup), shared like toon's. */
function twoSided(color: string, emissive?: string): THREE.MeshToonMaterial {
  const key = `${color}|${emissive ?? ''}`;
  let m = twoSidedCache.get(key);
  if (!m) {
    m = toonUnique(color);
    m.side = THREE.DoubleSide;
    if (emissive) m.emissive = new THREE.Color(emissive);
    twoSidedCache.set(key, m);
  }
  return m;
}

/** A small part drawn without the cartoon outline, which would swallow it. */
function small(color: string, x = 0, y = 0, z = 0, geo: THREE.BufferGeometry = new THREE.SphereGeometry(0.03, 8, 6)): THREE.Mesh {
  return mesh(geo, toon(color), x, y, z, false);
}

// ---- On a head (the head's middle at 0,0,0, 0.34 round, the face looking down +z) --------------------

const HEAD: Record<string, () => THREE.Group> = {
  'party-hat': () => {
    const g = new THREE.Group();
    const cone = new THREE.Group();
    cone.add(mesh(new THREE.ConeGeometry(0.17, 0.42, 20), toon('#ff5ca8'), 0, 0.21, 0));
    // Stripes round it, smaller as it narrows.
    for (const [y, c] of [
      [0.07, '#ffd166'],
      [0.2, '#4cc9f0'],
      [0.32, '#ffd166'],
    ] as const) {
      const ring = mesh(new THREE.TorusGeometry(0.17 * (1 - y / 0.42) + 0.005, 0.014, 6, 20), toon(c), 0, y, 0, false);
      ring.rotation.x = Math.PI / 2;
      cone.add(ring);
    }
    cone.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), toon('#fffaf3'), 0, 0.44, 0));
    cone.position.set(0.06, 0.24, 0);
    cone.rotation.z = -0.25;
    g.add(cone);
    return g;
  },
  beanie: () => {
    const g = new THREE.Group();
    const red = toon('#c1121f');
    const dome = mesh(new THREE.SphereGeometry(0.365, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), red, 0, 0.04, -0.01);
    dome.scale.set(1, 0.95, 1);
    g.add(dome);
    g.add(mesh(new THREE.CylinderGeometry(0.375, 0.375, 0.1, 24, 1, true), twoSided('#9d0208'), 0, 0.07, -0.01));
    g.add(mesh(new THREE.SphereGeometry(0.09, 12, 10), toon('#fffaf3'), 0, 0.42, -0.01));
    g.rotation.x = -0.12;
    return g;
  },
  cap: () => {
    const g = new THREE.Group();
    const navy = toon('#1d3557');
    g.add(mesh(new THREE.SphereGeometry(0.36, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), navy, 0, 0.03, -0.01));
    // The visor: half a flat disc out over the eyes.
    const visor = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 20, 1, false, -Math.PI / 2, Math.PI), navy, 0, 0.13, 0.27);
    visor.rotation.x = 0.12;
    g.add(visor);
    g.add(small('#e63946', 0, 0.38, -0.01, new THREE.SphereGeometry(0.035, 8, 6)));
    g.rotation.x = -0.1;
    return g;
  },
  'cowboy-hat': () => {
    const g = new THREE.Group();
    const felt = toon('#8b5a2b');
    const brim = mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.03, 32), felt, 0, 0.22, 0);
    brim.scale.set(1, 1, 0.82);
    g.add(brim);
    // The sides of the brim curl up a little.
    for (const s of [-1, 1]) {
      const curl = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 16, 1, false, 0, Math.PI), felt, s * 0.52, 0.26, 0);
      curl.rotation.set(0, s > 0 ? 0 : Math.PI, s * 0.6);
      g.add(curl);
    }
    const crown = mesh(new THREE.CylinderGeometry(0.24, 0.31, 0.3, 24), felt, 0, 0.38, 0);
    crown.scale.set(1, 1, 0.85);
    g.add(crown);
    const band = mesh(new THREE.CylinderGeometry(0.302, 0.315, 0.06, 24), toon('#3b1d12'), 0, 0.27, 0);
    band.scale.set(1, 1, 0.86);
    g.add(band);
    g.rotation.x = -0.12;
    return g;
  },
  'top-hat': () => {
    const g = new THREE.Group();
    const silk = toon('#16161d');
    g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.03, 32), silk, 0, 0.24, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.52, 28), silk, 0, 0.51, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.265, 0.265, 0.08, 28), toon('#c1121f'), 0, 0.3, 0));
    g.rotation.x = -0.12;
    return g;
  },
  crown: () => {
    const g = new THREE.Group();
    const gold = toon(GOLD, { emissive: '#3a2a00' });
    g.add(mesh(new THREE.CylinderGeometry(0.3, 0.29, 0.14, 28, 1, true), twoSided(GOLD, '#3a2a00'), 0, 0.31, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.sin(a) * 0.29;
      const z = Math.cos(a) * 0.29;
      g.add(mesh(new THREE.ConeGeometry(0.06, 0.16, 4), gold, x, 0.45, z, false));
      g.add(small(GOLD, x, 0.54, z, new THREE.SphereGeometry(0.025, 8, 6)));
      g.add(small(i % 2 ? '#2563eb' : '#d00000', Math.sin(a) * 0.305, 0.31, Math.cos(a) * 0.305, new THREE.SphereGeometry(0.035, 8, 6)));
    }
    g.rotation.x = -0.1;
    return g;
  },
  sunglasses: () => {
    const g = new THREE.Group();
    const black = toon('#111111');
    for (const s of [-1, 1]) {
      const lens = mesh(new THREE.BoxGeometry(0.15, 0.09, 0.02), black, s * 0.12, 0.03, 0.33, false);
      lens.rotation.y = s * 0.25;
      g.add(lens);
      // The arms back to the ears.
      g.add(mesh(new THREE.BoxGeometry(0.015, 0.015, 0.3), black, s * 0.3, 0.05, 0.16, false));
    }
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), black, 0, 0.06, 0.345, false));
    return g;
  },
  monocle: () => {
    const g = new THREE.Group();
    const gold = toon(GOLD);
    g.add(mesh(new THREE.TorusGeometry(0.065, 0.012, 8, 20), gold, -0.12, 0.02, 0.33, false));
    g.add(mesh(new THREE.CircleGeometry(0.06, 20), toon('#cfe8ff', { opacity: 0.45 }), -0.12, 0.02, 0.332, false));
    // A fine chain down to the collar.
    const chain = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.17, -0.03, 0.32), new THREE.Vector3(-0.24, -0.2, 0.27), new THREE.Vector3(-0.2, -0.36, 0.2)]);
    g.add(mesh(new THREE.TubeGeometry(chain, 10, 0.006, 4), gold, 0, 0, 0, false));
    return g;
  },
};

// ---- On a desk (its foot at 0,0,0, on the desk top, its front toward +z: the desk's chair) ------------

const DESK: Record<string, () => THREE.Group> = {
  'rubber-duck': () => {
    const g = new THREE.Group();
    const yellow = toon('#ffd60a');
    const body = mesh(new THREE.SphereGeometry(0.06, 14, 10), yellow, 0, 0.05, 0);
    body.scale.set(1, 0.8, 1.2);
    g.add(body);
    g.add(mesh(new THREE.SphereGeometry(0.04, 12, 10), yellow, 0, 0.12, 0.035));
    const beak = mesh(new THREE.ConeGeometry(0.018, 0.04, 8), toon('#fb8500'), 0, 0.115, 0.08, false);
    beak.rotation.x = Math.PI / 2;
    g.add(beak);
    for (const s of [-1, 1]) g.add(small('#111111', s * 0.018, 0.13, 0.068, new THREE.SphereGeometry(0.007, 6, 4)));
    g.rotation.y = 0.5;
    return g;
  },
  cactus: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.1, 14), toon('#c8693a'), 0, 0.05, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 14), toon('#b05a30'), 0, 0.1, 0));
    const green = toon('#2f8f46');
    g.add(mesh(new THREE.CapsuleGeometry(0.04, 0.14, 4, 10), green, 0, 0.2, 0));
    const arm = mesh(new THREE.CapsuleGeometry(0.022, 0.05, 4, 8), green, 0.055, 0.22, 0);
    arm.rotation.z = -0.3;
    g.add(arm);
    g.add(small('#ff5ca8', 0, 0.29, 0, new THREE.SphereGeometry(0.018, 8, 6)));
    return g;
  },
  'lava-lamp': () => {
    const g = new THREE.Group();
    const steel = toon('#adb5bd');
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.07, 0.1, 16), steel, 0, 0.05, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.2, 16), glow('#ff4fb3'), 0, 0.2, 0, false));
    g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), glow('#ffd166'), 0.008, 0.16, 0, false));
    g.add(mesh(new THREE.SphereGeometry(0.022, 10, 8), glow('#ffd166'), -0.01, 0.25, 0.01, false));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.06, 16), steel, 0, 0.33, 0));
    return g;
  },
  trophy: () => {
    const g = new THREE.Group();
    const gold = toon(GOLD, { emissive: '#3a2a00' });
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.05, 0.12), toon('#3b1d12'), 0, 0.025, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.08, 10), gold, 0, 0.09, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.075, 0.035, 0.12, 18, 1, true), twoSided(GOLD, '#3a2a00'), 0, 0.19, 0));
    for (const s of [-1, 1]) {
      const handle = mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 14, Math.PI), gold, s * 0.075, 0.2, 0, false);
      handle.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(handle);
    }
    return g;
  },
  'gold-bars': () => {
    const g = new THREE.Group();
    const gold = toon(GOLD, { emissive: '#3a2a00' });
    // A pyramid of bars, three on two on one, each a little narrower on top.
    const bar = new THREE.CylinderGeometry(0.045 * Math.SQRT2, 0.06 * Math.SQRT2, 0.035, 4, 1).rotateY(Math.PI / 4).scale(0.7, 1, 1.6);
    for (const [n, y] of [
      [3, 0.0175],
      [2, 0.0525],
      [1, 0.0875],
    ] as const)
      for (let i = 0; i < n; i++) g.add(mesh(bar, gold, (i - (n - 1) / 2) * 0.07, y, 0));
    g.rotation.y = 0.2;
    return g;
  },
};

/** What a name colour looks like on its own (on the shop's display): a glowing plate in that colour. */
function namePlate(item: ShopItem): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.12, 0.03), toon('#14101a'), 0, 0.06, 0));
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.05, 0.01), glow(item.color ?? '#ffffff'), 0, 0.06, 0.017, false));
  return g;
}

/** Whether there's a model for every item (the tests hold the catalogue to it). */
export function hasModel(item: ShopItem): boolean {
  return item.slot === 'name' || !!(item.slot === 'desk' ? DESK : HEAD)[item.id];
}

/**
 * The item as a thing: for a hat or glasses, on a head's middle; for a desk item, standing on a desk
 * top; for a name colour, a little glowing plate. Null for an id with no model.
 */
export function shopModel(item: ShopItem): THREE.Group | null {
  if (item.slot === 'name') return namePlate(item);
  const make = (item.slot === 'desk' ? DESK : HEAD)[item.id];
  if (!make) return null;
  const g = make();
  g.name = `shop:${item.id}`;
  return g;
}

/** Takes models off whatever had them on and frees their geometry (materials are shared). */
export function dropModels(parts: THREE.Object3D[]) {
  for (const o of parts) {
    o.removeFromParent();
    o.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
  }
  parts.length = 0;
}

/**
 * Desk items on the office's desks: each desk shows what whoever hired its worker has on from the
 * shop (see Chips.looks on the server), in each item's own spot on the desk top.
 */
export class DeskTrinkets {
  private on = new Map<string, { key: string; parts: THREE.Object3D[] }>();

  /** `desks` is every desk's group (in its own frame, see DeskDef.rotY), and `items` the desk items for each desk id. */
  sync(desks: ReadonlyMap<string, THREE.Object3D>, items: ReadonlyMap<string, readonly string[]>) {
    for (const [deskId, group] of desks) {
      const want = (items.get(deskId) ?? []).filter((id) => SHOP_ITEMS.some((i) => i.id === id && i.slot === 'desk'));
      const key = want.join();
      const was = this.on.get(deskId);
      if (was?.key === key) continue;
      if (was) dropModels(was.parts);
      const parts: THREE.Object3D[] = [];
      for (const id of want) {
        const item = SHOP_ITEMS.find((i) => i.id === id)!;
        const m = shopModel(item);
        if (!m || !item.spot) continue;
        m.position.set(item.spot.dx, DESK_SIZE.height, item.spot.dz);
        group.add(m);
        parts.push(m);
      }
      this.on.set(deskId, { key, parts });
    }
  }
}
