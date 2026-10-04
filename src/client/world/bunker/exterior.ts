import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALCONY_DOOR, EXIT_DOOR, FLOOR, SLAB, WALL_HEIGHT, WALL_T, WINDOWS, type Opening, type Side } from '../../../shared/layout';
import { toon } from '../toon';
import type { BunkerContext, BunkerPart } from './index';
import { concreteTexture, stencilTexture } from './shellparts/textures';

// The bunker from outside: no windows underground, so none from out there either. The office's outer
// walls (and their outside paint) and its windows go while the bunker's on (shell.ts hides them for the
// inside; so does this, for the outside), and in their place, round the outside of the building, a
// solid concrete facade: a narrow dark slit under a hood where each window was, a vent grille in every
// other one, and the floor's number stencilled over the blast door. Only the balcony doors (and the
// bottom floor's exit door) go through it. The rest of the building's floors, bunker or not, are
// world/tower.ts's (see setBunkerFloors).

/** The building's outside, walls included; the facade stands this far off it, as tower.ts's does. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
const OFF = 0.01;

/** Each side's plane from outside (as in tower.ts): where along it things are, and how a group built along x, outdoors toward +z, turns onto it. */
const FACES: Record<Side, { u0: number; u1: number; at: (u: number) => THREE.Vector3; rotY: number }> = {
  north: { u0: B.minX - OFF, u1: B.maxX + OFF, at: (u) => new THREE.Vector3(u, 0, B.minZ - OFF), rotY: Math.PI },
  south: { u0: B.minX - OFF, u1: B.maxX + OFF, at: (u) => new THREE.Vector3(u, 0, B.maxZ + OFF), rotY: 0 },
  west: { u0: B.minZ - OFF, u1: B.maxZ + OFF, at: (u) => new THREE.Vector3(B.minX - OFF, 0, u), rotY: -Math.PI / 2 },
  east: { u0: B.minZ - OFF, u1: B.maxZ + OFF, at: (u) => new THREE.Vector3(B.maxX + OFF, 0, u), rotY: Math.PI / 2 },
};

/** `root`'s meshes merged into one per material (uvs kept, for the concrete), so the bunker adds a handful of meshes, not dozens. */
function bake(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    m.geometry.dispose();
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(geo);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = new THREE.Mesh(mergeGeometries(geos)!, mat);
    merged.receiveShadow = true;
    out.add(merged);
    for (const geo of geos) geo.dispose();
  }
  return out;
}

/** Along x in a face's own frame, local x runs against u on the north and west sides (rotY π and -π/2). */
const lx = (side: Side, u: number) => (side === 'north' || side === 'west' ? -u : u);

export function buildExterior(ctx: BunkerContext): BunkerPart {
  const { office, look } = ctx;
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const gradient = (toon('#ffffff') as THREE.MeshToonMaterial).gradientMap;
  const mat = (color: THREE.ColorRepresentation, map: THREE.Texture | null = null, flat = false) => {
    const m = new THREE.MeshToonMaterial({ color, map, gradientMap: gradient });
    if (flat) m.userData.outlineParameters = { visible: false };
    materials.push(m);
    return m;
  };
  const concreteMap = concreteTexture(23);
  textures.push(concreteMap);
  const concrete = mat('#d9d6cf', concreteMap, true);
  const band = mat('#8e8b85', concreteMap, true);
  const hood = mat('#a8a49c');
  const steel = mat('#5d646c');
  const slit = mat('#1d1f24');

  const group = new THREE.Group();
  group.name = 'bunker-exterior';
  const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
  };

  /** A plane from u0 to u1, y0 to y1 on `side`, facing out, its uvs in meters (a tile every 4 m). */
  const plane = (g: THREE.Object3D, side: Side, u0: number, u1: number, y0: number, y1: number, m: THREE.Material) => {
    if (u1 - u0 < 0.001 || y1 - y0 < 0.001) return;
    const f = FACES[side];
    const geo = new THREE.PlaneGeometry(u1 - u0, y1 - y0);
    geo.translate(0, (y0 + y1) / 2, 0);
    const uv = geo.getAttribute('uv');
    const pos = geo.getAttribute('position');
    const x0 = lx(side, (u0 + u1) / 2);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + pos.getX(i)) / 4, pos.getY(i) / 4);
    const p = new THREE.Mesh(geo, m);
    p.position.copy(f.at((u0 + u1) / 2));
    p.rotation.y = f.rotY;
    p.receiveShadow = true;
    g.add(p);
  };

  /** A face's concrete round its holes, from the slab's band up to the top of the wall. */
  const facade = (g: THREE.Object3D, side: Side, holes: Opening[]) => {
    const f = FACES[side];
    plane(g, side, f.u0, f.u1, -SLAB, 0, band);
    let u = f.u0;
    for (const o of [...holes].sort((a, b) => a.u - b.u)) {
      const h0 = o.u - o.width / 2;
      const h1 = o.u + o.width / 2;
      plane(g, side, u, h0, 0, WALL_HEIGHT, concrete);
      plane(g, side, h0, h1, o.y1, WALL_HEIGHT, concrete);
      u = h1;
    }
    plane(g, side, u, f.u1, 0, WALL_HEIGHT, concrete);
  };

  const walls = new THREE.Group();
  for (const side of Object.keys(FACES) as Side[]) facade(walls, side, [BALCONY_DOOR, EXIT_DOOR].filter((o) => o.wall === side));
  // Where a window was: a slit under a hood, and a vent grille below every other one.
  WINDOWS.forEach((o, i) => {
    const g = new THREE.Group();
    const top = o.y1 - 0.25;
    box(g, o.width * 0.6, 0.12, 0.04, slit, 0, top, 0.02);
    box(g, o.width * 0.6 + 0.2, 0.08, 0.16, hood, 0, top + 0.12, 0.08);
    if (i % 2 === 0) {
      const v = o.y0 + 0.45;
      box(g, 0.6, 0.45, 0.06, steel, 0, v, 0.03);
      for (let k = 0; k < 4; k++) box(g, 0.5, 0.04, 0.08, slit, 0, v - 0.15 + k * 0.1, 0.04);
    }
    const f = FACES[o.wall];
    g.position.copy(f.at(o.u));
    g.rotation.y = f.rotY;
    walls.add(g);
  });
  group.add(bake(walls));

  // Upstairs there's no exit door: the hole in the west face is concrete too.
  const exitPlug = new THREE.Group();
  plane(exitPlug, EXIT_DOOR.wall, EXIT_DOOR.u - EXIT_DOOR.width / 2, EXIT_DOOR.u + EXIT_DOOR.width / 2, 0, EXIT_DOOR.y1, concrete);
  group.add(exitPlug);

  // The floor's number, stencilled over the blast door, for whoever's out on the balcony.
  const number = new THREE.MeshBasicMaterial({ transparent: true });
  number.userData.outlineParameters = { visible: false };
  materials.push(number);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), number);
  sign.position.copy(FACES.south.at(BALCONY_DOOR.u)).add(new THREE.Vector3(0, BALCONY_DOOR.y1 + 0.36, 0.01));
  group.add(sign);
  let shown = -1;
  const follow = () => {
    const index = office.stack.state.index;
    exitPlug.visible = index > 0;
    if (index === shown) return;
    shown = index;
    number.map?.dispose();
    number.map = stencilTexture(`BUNKER ${String(index + 1).padStart(2, '0')}`, { bg: '#d9d6cf', color: '#2b2d33' });
    number.needsUpdate = true;
  };
  follow();

  // None of it is aimed at: what's behind it (the blast door, the balcony) is.
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.raycast = () => {};
  });
  ctx.group.add(group);

  return {
    // The office's walls (their outside paint too) and its windows' frames and glass: shell.ts hides
    // them as well, and hiding one twice is the same as once.
    hideOffice: [...look.walls, ...look.windows],
    set(on) {
      if (on) follow();
    },
    update() {
      follow();
    },
    dispose() {
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
      number.map?.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      group.removeFromParent();
    },
  };
}
