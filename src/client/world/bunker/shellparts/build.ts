import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALCONY, BALCONY_DOOR, DARTBOARD, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, EXIT_STAIRS, FLOOR, LOFT, MEETING_ROOM, MEETING_TABLE, POOL_TABLE, WALL_HEIGHT, WALL_T, WINDOWS, type Opening, type Side } from '../../../../shared/layout';
import type { Office } from '../../office';
import { toon } from '../../toon';
import type { Reskin } from '../index';
import { concreteTexture, glowTexture, hazardTexture, lineTexture, shutterTexture, slabTexture, steelTexture, stencilTexture } from './textures';

// The bunker's room, in place of the office's: a concrete lining where the outside walls were, with
// a hazard stripe along the bottom, steel shutters down over the windows, a blast door over the
// balcony doors that rolls up as they open, a steel exit door, the floor and ceiling in concrete, the
// ceiling vaulted down into the long walls on steel ribs, with pipes, a cable tray and a vent duct
// along it, and cage lamps and a couple of fluorescent tubes. Nothing of the office's moves (what
// this replaces is only hidden, see BunkerPart), and nothing stands where anyone walks, sits or
// works: it all hugs the walls or hangs up high.

/** How far in front of the office's walls the lining is: behind anything hung on them (the pictures hang 5 mm out). */
const LINING = 0.012;
/** The vault: the coves along the north and south walls rise from SPRING up to the ceiling, REACH out from the wall. */
const SPRING = 5.4;
const REACH = 1.8;
/** Over the loft the cove starts on its roof instead. */
const LOFT_ROOF = LOFT.y + LOFT.height + 0.22;
const LOFT_REACH = 0.8;
/** How strong the light that makes up the lamplight on the balcony is, for each unit of it (see airlock). */
const MAKE_UP = 2.4;
/** How much further in than the office's exit door the steel one hangs: from the wall's outside face to just inside its inside one. */
const EXIT_LEAF_IN = WALL_T + 0.06;
/** Left clear round the elevator, which goes up to the ceiling. */
const ELEVATOR_GAP = { x0: ELEVATOR.x - ELEVATOR.width / 2 - 0.1, x1: ELEVATOR.x + ELEVATOR.width / 2 + 0.1 };
/** Pipes, trays and ducts run between these, clear of the ladder's hatch by the west wall. */
const RUN = { x0: FLOOR.minX + 1.6, x1: FLOOR.maxX - 0.02 };

export interface ShellParts {
  group: THREE.Group;
  /** The office meshes and materials it stands in for (see BunkerPart). */
  hideOffice: THREE.Mesh[];
  reskin: Reskin[];
  /**
   * Spins the fans, moves the doors with the office's (hidden) ones, and follows the floor (the exit
   * door's only on the bottom one). `lamplight` is what the bunker's lighting took off everything to
   * cancel the sky's night-time lamplight indoors (see lighting.ts): it's put back on the walled-in
   * balcony, which is outdoors and never had it.
   */
  update(t: number, dt: number, lamplight?: THREE.Color): void;
  /** Takes it all down again: every geometry, material and texture it made. */
  dispose(): void;
}

/** A point `u` along the inside face of a wall and `out` into the room from it, and the turn that makes local +z face into the room. */
function onInner(side: Side, u: number, out: number): { x: number; z: number; rotY: number } {
  switch (side) {
    case 'north':
      return { x: u, z: FLOOR.minZ + out, rotY: 0 };
    case 'south':
      return { x: u, z: FLOOR.maxZ - out, rotY: Math.PI };
    case 'west':
      return { x: FLOOR.minX + out, z: u, rotY: Math.PI / 2 };
    case 'east':
      return { x: FLOOR.maxX - out, z: u, rotY: -Math.PI / 2 };
  }
}

/** The span of a wall's inside face, along it. */
function span(side: Side): [number, number] {
  return side === 'north' || side === 'south' ? [FLOOR.minX, FLOOR.maxX] : [FLOOR.minZ, FLOOR.maxZ];
}

/** A plane `w` by `h` centred at (x, y) in a wall's frame, its uvs in meters over `tile` (so the texture lines up across pieces). */
function wallPlane(x0: number, x1: number, y0: number, y1: number, tile: number, flipU = false): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, ((flipU ? -1 : 1) * pos.getX(i)) / tile, pos.getY(i) / tile);
  return geo;
}

/** Box uvs in meters over `tile`, so a long box doesn't stretch its texture. */
function meterBox(w: number, h: number, d: number, tile: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv');
  // BoxGeometry's faces are +x, -x, +y, -y, +z, -z, four vertices each.
  const sizes: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, (uv.getX(f * 4 + k) * sizes[f][0]) / tile, (uv.getY(f * 4 + k) * sizes[f][1]) / tile);
  return geo;
}

/**
 * Bakes everything under `root` into one mesh per material (keeping uvs, unlike toon.ts's
 * mergeByMaterial), so the whole shell is a few dozen draw calls.
 */
function bake(root: THREE.Object3D, cast = false): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(geo);
    m.geometry.dispose();
  });
  // Where the root stood stays where it stands.
  const out = new THREE.Group();
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);
  for (const [mat, geos] of byMat) {
    const merged = new THREE.Mesh(mergeGeometries(geos)!, mat);
    merged.castShadow = cast;
    merged.receiveShadow = true;
    out.add(merged);
    for (const g of geos) g.dispose();
  }
  return out;
}

function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** The vault's cross-section along the north or south wall at `x`: where the cove starts up the wall, and how far out it reaches. */
function cove(side: 'north' | 'south', x: number): { y0: number; reach: number } {
  return side === 'south' && x > LOFT.minX - 0.05 ? { y0: LOFT_ROOF, reach: LOFT_REACH } : { y0: SPRING, reach: REACH };
}

/** A point on a cove's curve, `k` of the way from the wall (0) to the ceiling (1): (out from the wall, height). */
function covePoint(c: { y0: number; reach: number }, k: number, inset = 0): [number, number] {
  const a = (k * Math.PI) / 2;
  const top = WALL_HEIGHT - 0.006;
  // A quarter ellipse, and `inset` in toward its middle (for the ribs that run along it).
  const d = c.reach * (1 - Math.cos(a));
  const y = c.y0 + (top - c.y0) * Math.sin(a);
  const nx = (top - c.y0) * Math.cos(a);
  const ny = -c.reach * Math.sin(a);
  const n = Math.hypot(nx, ny) || 1;
  return [d + (nx / n) * inset, y + (ny / n) * inset];
}

/** The curved strip of a cove along a wall from x0 to x1, facing down into the room. */
function coveGeometry(side: 'north' | 'south', x0: number, x1: number, tile: number): THREE.BufferGeometry {
  const c = cove(side, (x0 + x1) / 2);
  const N = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const s = side === 'north' ? 1 : -1;
  const wallZ = side === 'north' ? FLOOR.minZ + LINING : FLOOR.maxZ - LINING;
  let arc = 0;
  let prev = covePoint(c, 0);
  for (let i = 0; i <= N; i++) {
    const p = covePoint(c, i / N);
    arc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    for (const x of [x0, x1]) {
      pos.push(x, p[1], wallZ + s * p[0]);
      uv.push(x / tile, (c.y0 + arc) / tile);
    }
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    // Facing into the room: down and away from the wall.
    if (side === 'north') idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** The end of a cove where it stops short (at the elevator, or where it steps up over the loft): the wedge between its curve and the corner. */
function coveCap(side: 'north' | 'south', x: number, facing: 1 | -1): THREE.BufferGeometry {
  const c = cove(side, x - facing * 0.1);
  const shape = new THREE.Shape();
  const top = WALL_HEIGHT - 0.006;
  shape.moveTo(0, top);
  shape.lineTo(0, c.y0);
  for (let i = 1; i <= 10; i++) {
    const [d, y] = covePoint(c, i / 10);
    shape.lineTo(d, y);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  // Drawn in (out from the wall, y) facing +z: turn it so it faces along x, toward `facing`.
  const s = side === 'north' ? 1 : -1;
  const wallZ = side === 'north' ? FLOOR.minZ + LINING : FLOOR.maxZ - LINING;
  const m = new THREE.Matrix4();
  // Local x (out from the wall) → world z (s), local z (the normal) → world x (facing).
  m.set(0, 0, facing, x, 0, 1, 0, 0, s, 0, 0, wallZ, 0, 0, 0, 1);
  geo.applyMatrix4(m);
  // That may have mirrored it: make sure it faces `facing`.
  if (m.determinant() < 0) {
    const index = geo.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildShellParts(office: Office): ShellParts {
  const group = new THREE.Group();
  group.name = 'bunker-shell';
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];
  // toon.ts's three-step ramp, shared with the rest of the office (so never disposed here).
  const gradient = (toon('#ffffff') as THREE.MeshToonMaterial).gradientMap;
  const tex = <T extends THREE.Texture>(t: T): T => (textures.push(t), t);
  /** A toon material of our own (not toon.ts's shared cache), so it can be disposed with the rest. */
  const toonMat = (color: THREE.ColorRepresentation, o: { map?: THREE.Texture; emissive?: THREE.ColorRepresentation; flat?: boolean; transparent?: boolean } = {}) => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient, map: o.map ?? null, transparent: o.transparent ?? false });
    if (o.emissive !== undefined) m.emissive = new THREE.Color(o.emissive);
    // Big flat surfaces get no cartoon outline, as the office's floor and walls never have.
    if (o.flat) m.userData.outlineParameters = { visible: false };
    materials.push(m);
    return m;
  };
  const basic = (p: THREE.MeshBasicMaterialParameters) => {
    const m = new THREE.MeshBasicMaterial(p);
    m.userData.outlineParameters = { visible: false };
    materials.push(m);
    return m;
  };

  const look = office.look;
  const hideOffice: THREE.Mesh[] = [];
  const meshesOf = (root: THREE.Object3D, skip?: (m: THREE.Mesh) => boolean) => {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !skip?.(m)) out.push(m);
    });
    return out;
  };

  const concrete = toonMat('#ffffff', { map: tex(concreteTexture(7)), flat: true });
  // The ceiling's uvs are in meters (see the reskin below): the vault's are too, so they share a tile every 4 m.
  const vaultMap = tex(concreteTexture(19));
  vaultMap.repeat.set(1 / 4, 1 / 4);
  const vault = toonMat('#f4f1ec', { map: vaultMap, flat: true });
  const hazard = toonMat('#ffffff', { map: tex(hazardTexture()), flat: true });
  const steel = toonMat('#ffffff', { map: tex(steelTexture('#6b737d')), flat: true });
  const gunmetal = toonMat('#ffffff', { map: tex(steelTexture('#4f565f', 9)), flat: true });
  const shutter = toonMat('#ffffff', { map: tex(shutterTexture()), flat: true });
  const angle = toonMat('#3f454c');
  const ribMat = toonMat('#4a5058');
  const bolts = toonMat('#2c3036');
  const curb = toonMat('#d8d3c8', { map: concrete.map! });

  // ---- The walls: a concrete lining in place of the office's, with the hazard stripe along the bottom --
  // The office's walls go (inside paint, outside paint, baseboards, the upstairs plug): the lining
  // stands just in front of where they were, and nothing outside is to be seen anyway.
  hideOffice.push(...look.walls);
  const walls = new THREE.Group();
  /** Where the lining has holes to walk through: the balcony doors, and the exit door (which only the bottom floor has). */
  const doorways = [BALCONY_DOOR, EXIT_DOOR];
  const sides: Side[] = ['north', 'south', 'west', 'east'];
  const STRIPE = { y0: 0, y1: 0.32, out: 0.024 };
  const stripeGeo = (x0: number, x1: number) => {
    // The stripes tile every 1.28 m along the wall and fill the band's height once.
    const geo = wallPlane(x0, x1, STRIPE.y0, STRIPE.y1, 1);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.28, (uv.getY(i) - STRIPE.y0) / (STRIPE.y1 - STRIPE.y0));
    return geo;
  };
  for (const side of sides) {
    const [a, b] = span(side);
    const holes = doorways.filter((o) => o.wall === side).sort((p, q) => p.u - q.u);
    const lining = new THREE.Group();
    // Built along the wall in its own frame (local x along it, +z into the room), then turned onto it.
    // Local x runs the opposite way to u on the south and west walls.
    const flip = side === 'south' || side === 'west';
    const lx = (u0: number, u1: number) => [flip ? -u0 : u0, flip ? -u1 : u1].sort((p, q) => p - q);
    let u = a;
    const piece = (u0: number, u1: number, y0: number, y1: number) => {
      if (u1 - u0 < 0.001 || y1 - y0 < 0.001) return;
      const [x0, x1] = lx(u0, u1);
      put(lining, wallPlane(x0, x1, y0, y1, 4), concrete);
    };
    const band = (u0: number, u1: number) => {
      if (u1 - u0 < 0.001) return;
      const [x0, x1] = lx(u0, u1);
      put(lining, stripeGeo(x0, x1), hazard, 0, 0, STRIPE.out - LINING);
    };
    for (const o of holes) {
      const h0 = o.u - o.width / 2;
      const h1 = o.u + o.width / 2;
      piece(u, h0, 0, WALL_HEIGHT);
      piece(h0, h1, o.y1, WALL_HEIGHT);
      band(u, h0);
      u = h1;
    }
    piece(u, b, 0, WALL_HEIGHT);
    band(u, b);
    walls.add(mountInner(lining, side, 0, LINING));
  }
  // The doorways' reveals, through the thickness of the wall, in steel.
  for (const o of doorways) walls.add(reveal(o, gunmetal));
  group.add(bake(walls));

  // ---- The windows: gone, steel shutters down over where they were, a concrete sill and lintel --------
  hideOffice.push(...look.windows);
  const windows = new THREE.Group();
  for (const o of WINDOWS) windows.add(shutterOver(o, { shutter, angle, curb, hazard, bolts }));
  group.add(bake(windows, true));

  // ---- Outside: the street, the city and the rest of the building go ---------------------------------
  // All but the exit door (it's down there with the street, see Office.setLevel): its frame, sign and
  // hinge stay, and a steel leaf swings on the hinge in place of the teal one.
  const exitGroup = findExitDoor(look.ground);
  const exitHinge = exitGroup?.children.find((c) => !(c as THREE.Mesh).isMesh && c.children.some((k) => !(k as THREE.Mesh).isMesh)) ?? null;
  const exitSign = (m: THREE.Mesh) => !!(m.material as THREE.MeshBasicMaterial).map;
  hideOffice.push(...meshesOf(look.ground, (m) => exitSign(m) && isUnder(m, exitGroup)), ...meshesOf(look.tower));

  // ---- The exit door: a steel frame and leaf on the bottom floor, sealed with concrete upstairs ------
  const exitFrame = bake(steelDoorFrame(EXIT_DOOR, { steel: gunmetal, hazard, bolts }), true);
  group.add(exitFrame);
  const exitLeaf = new THREE.Group();
  exitLeaf.name = 'exit-door';
  exitLeaf.matrixAutoUpdate = false;
  exitLeaf.add(bake(steelLeaf(EXIT_DOOR, { steel, hazard, bolts, angle }), true));
  group.add(exitLeaf);
  const exitSeal = new THREE.Group();
  exitSeal.name = 'exit-sealed';
  {
    const o = EXIT_DOOR;
    const seal = new THREE.Group();
    put(seal, wallPlane(-o.width / 2 - 0.01, o.width / 2 + 0.01, 0, o.y1 + 0.01, 4), concrete);
    put(seal, stripeGeo(-o.width / 2 - 0.01, o.width / 2 + 0.01), hazard, 0, 0, STRIPE.out - LINING);
    exitSeal.add(bake(mountInner(seal, o.wall, o.u, LINING)));
  }
  group.add(exitSeal);
  // Out the exit door, a dark stairwell going down instead of the landing and the street.
  const stairwell = darkTunnel(basic);
  group.add(stairwell);

  // ---- The blast door over the balcony doors -------------------------------------------------------
  // The glass doors go; the blast door rolls up as they would have slid open (they still do, hidden).
  hideOffice.push(...look.balconyDoor);
  // One of the sliding panels: a group in the doors' group (the one standing in the wall at the doorway).
  const panel = look.balconyDoor.map((m) => m.parent).find((p): p is THREE.Object3D => !!p?.parent && Math.abs(p.parent.position.x - BALCONY_DOOR.u) < 0.01 && Math.abs(p.position.x) > 0.1) ?? null;
  const panelX0 = panel?.position.x ?? 0;
  const panelTravel = (BALCONY_DOOR.width - 2 * 0.08) / 2 + 0.04;
  const blast = blastDoor(BALCONY_DOOR, { steel, gunmetal, hazard, bolts, angle }, tex, toonMat);
  group.add(blast.group);
  // Past it, the balcony is walled in: a concrete airlock instead of the street and the sky.
  const lock = airlock(concrete, vault, basic);
  group.add(lock.group);

  // ---- The elevator: a riveted steel surround ------------------------------------------------------
  group.add(bake(elevatorSurround({ steel: gunmetal, hazard, bolts }), false));

  // ---- The floor: concrete (the office's own floor, reskinned: its holes come and go floor by floor) --
  hideOffice.push(...look.rugs);
  const slabMap = tex(slabTexture());
  // The floor's uvs span the whole room once: a tile every 6 m, as the planks have.
  slabMap.repeat.set((FLOOR.maxX - FLOOR.minX) / 6, (FLOOR.maxZ - FLOOR.minZ) / 6);
  group.add(floorMarkings(tex, basic, toonMat));

  // ---- The ceiling: concrete, vaulted down into the long walls, on steel ribs ------------------------
  const vaultParts = new THREE.Group();
  // The coves along the north wall (round the elevator) and the south wall (stepping up over the loft).
  put(vaultParts, coveGeometry('north', FLOOR.minX, ELEVATOR_GAP.x0, 1), vault);
  put(vaultParts, coveGeometry('north', ELEVATOR_GAP.x1, FLOOR.maxX, 1), vault);
  put(vaultParts, coveCap('north', ELEVATOR_GAP.x0, 1), vault);
  put(vaultParts, coveCap('north', ELEVATOR_GAP.x1, -1), vault);
  put(vaultParts, coveGeometry('south', FLOOR.minX, LOFT.minX - 0.1, 1), vault);
  put(vaultParts, coveGeometry('south', LOFT.minX - 0.1, FLOOR.maxX, 1), vault);
  put(vaultParts, coveCap('south', LOFT.minX - 0.1, 1), vault);
  group.add(bake(vaultParts));
  group.add(bake(ribs(ribMat, bolts)));

  // ---- Along the ceiling: pipes, cable trays and the vent duct, and fans in the walls --------------
  const services = ceilingServices(toonMat);
  group.add(services.group);

  // ---- Lamps: cage lamps with warm bulbs (where the office's pendants hung), a couple of fluorescent tubes --
  // The office's other fittings go too (the meeting room's lights, the billiard and dartboard lamps):
  // the bunker hangs its own where they were (see buildLamps), and lighting.ts puts out their glow.
  hideOffice.push(...look.lamps, ...look.fittings);
  const lamps = buildLamps(toonMat, basic, tex);
  group.add(lamps.group);

  const reskin: Reskin[] = [
    // What's left in the walls' paint is the loft's: its roof, stairs and wall, in bare concrete.
    { material: look.wallMat, props: { color: new THREE.Color('#a19e97') } },
    { material: look.trimMat, props: { color: new THREE.Color('#5c5f66') } },
    { material: look.floorMat, props: { map: slabMap, color: new THREE.Color('#ffffff') } },
    { material: look.ceilingMat, props: { map: vaultMap, emissiveMap: vaultMap, color: new THREE.Color('#f4f1ec'), emissive: new THREE.Color('#24221f') } },
  ];

  // ---- What follows the floor you're on -------------------------------------------------------------
  const hingeAt = new THREE.Matrix4();
  const inward = new THREE.Vector3();
  const follow = () => {
    // Only the bottom floor has the exit door; on the floors above, the doorway is wall.
    const bottom = office.stack.state.index === 0 && !!exitHinge;
    exitFrame.visible = bottom;
    exitLeaf.visible = bottom;
    stairwell.visible = bottom;
    exitSeal.visible = !bottom;
    if (bottom && exitHinge && exitGroup) {
      // The steel leaf swings as the hidden teal one does, but hung in the inside face of the wall
      // rather than the outside one: indoors, where the room's light falls on it.
      group.updateWorldMatrix(true, false);
      exitGroup.updateWorldMatrix(true, false);
      hingeAt.compose(inward.copy(exitHinge.position).setZ(exitHinge.position.z - EXIT_LEAF_IN), exitHinge.quaternion, exitHinge.scale);
      exitLeaf.matrix.copy(group.matrixWorld).invert().multiply(exitGroup.matrixWorld).multiply(hingeAt);
    }
  };
  follow();

  const update = (_t: number, dt: number, lamplight?: THREE.Color) => {
    follow();
    lock.makeUp(lamplight);
    services.update(dt);
    // The blast door: as far up as the hidden glass doors have slid apart.
    blast.show(panel ? Math.min(1, Math.abs(panel.position.x - panelX0) / panelTravel) : 0);
  };

  const dispose = () => {
    group.traverse((o) => {
      // Sprites share one geometry across the whole app: only their materials are ours.
      if ((o as THREE.Sprite).isSprite) materials.push((o as THREE.Sprite).material);
      else if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    group.removeFromParent();
    group.clear();
  };

  return { group, hideOffice, reskin, update, dispose };
}

/** The exit door's group among the things down at the street: the one standing in the west wall where the door is. */
function findExitDoor(ground: THREE.Group): THREE.Object3D | null {
  const x = FLOOR.minX - WALL_T / 2;
  return ground.children.find((c) => Math.abs(c.position.x - x) < 0.05 && Math.abs(c.position.z - EXIT_DOOR.u) < 0.05) ?? null;
}

function isUnder(o: THREE.Object3D, root: THREE.Object3D | null): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

type ToonMat = (color: THREE.ColorRepresentation, o?: { map?: THREE.Texture; emissive?: THREE.ColorRepresentation; flat?: boolean; transparent?: boolean }) => THREE.MeshToonMaterial;
type BasicMat = (p: THREE.MeshBasicMaterialParameters) => THREE.MeshBasicMaterial;

/** Stands a wall-built group (local x along the wall, +z into the room) at `u` on its wall. */
function mountInner(g: THREE.Object3D, side: Side, u: number, out = 0): THREE.Object3D {
  const at = onInner(side, u, out);
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.rotY;
  return g;
}

/** A rolled-down steel shutter over a window, in an angle-iron frame, with a concrete sill to stand things on and a lintel over it. */
function shutterOver(o: Opening, m: { shutter: THREE.Material; angle: THREE.Material; curb: THREE.Material; hazard: THREE.Material; bolts: THREE.Material }): THREE.Object3D {
  const g = new THREE.Group();
  const w = o.width + 0.12;
  const h = o.y1 - o.y0;
  const cy = (o.y0 + o.y1) / 2;
  // The slats: one tile of the texture per 1.2 m across, a slat every 10 cm up.
  const slats = meterBox(w, h, 0.04, 1.2);
  put(g, slats, m.shutter, 0, cy, LINING + 0.02);
  // The box it rolls down out of, over the top.
  put(g, meterBox(w + 0.16, 0.3, 0.2, 1), m.angle, 0, o.y1 + 0.13, LINING + 0.1);
  // Guides down either side.
  for (const s of [-1, 1]) put(g, new THREE.BoxGeometry(0.07, h, 0.08), m.angle, s * (w / 2 + 0.035), cy, LINING + 0.04);
  // A bottom bar with a stripe of hazard paint on it.
  put(g, new THREE.BoxGeometry(w, 0.08, 0.07), m.angle, 0, o.y0 + 0.1, LINING + 0.05);
  const bar = new THREE.PlaneGeometry(w - 0.04, 0.06);
  const uv = bar.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * ((w - 0.04) / 0.32));
  put(g, bar, m.hazard, 0, o.y0 + 0.1, LINING + 0.086);
  // Padlocked shut at the bottom.
  put(g, new THREE.BoxGeometry(0.09, 0.11, 0.05), m.bolts, 0.35, o.y0 + 0.2, LINING + 0.1);
  // The sill: deep enough for a pumpkin (holiday.ts puts them on the sills), its top where the window's was.
  put(g, meterBox(w + 0.36, 0.1, 0.24, 2), m.curb, 0, o.y0 - 0.05, 0.12);
  return mountInner(g, o.wall, o.u);
}

/** A heavy steel frame round a doorway, with hazard stripes up its sides. */
function steelDoorFrame(o: Opening, m: { steel: THREE.Material; hazard: THREE.Material; bolts: THREE.Material }): THREE.Object3D {
  const g = new THREE.Group();
  const J = 0.22;
  const D = 0.14;
  for (const s of [-1, 1]) {
    put(g, meterBox(J, o.y1 + J, D, 1.2), m.steel, s * (o.width / 2 + J / 2), (o.y1 + J) / 2, LINING + D / 2);
    // The hazard stripe up the jamb's face, from the floor to shoulder height.
    const geo = new THREE.PlaneGeometry(J - 0.06, 1.6);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * (1.6 / 0.32), uv.getX(i));
    put(g, geo, m.hazard, s * (o.width / 2 + J / 2), 0.85, LINING + D + 0.002);
    for (const y of [0.3, 1.2, 2.1]) put(g, new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8).rotateX(Math.PI / 2), m.bolts, s * (o.width / 2 + J / 2), y + 0.15, LINING + D + 0.01);
  }
  put(g, meterBox(o.width + 2 * J, J, D, 1.2), m.steel, 0, o.y1 + J / 2, LINING + D / 2);
  return mountInner(g, o.wall, o.u);
}

/** A doorway's reveals, through where the wall's thickness was: steel jambs, head and threshold. */
function reveal(o: Opening, mat: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const T = WALL_T + LINING;
  for (const s of [-1, 1]) {
    const jamb = new THREE.PlaneGeometry(T, o.y1);
    jamb.rotateY((-s * Math.PI) / 2);
    jamb.translate((s * o.width) / 2, o.y1 / 2, LINING - T / 2);
    put(g, jamb, mat);
  }
  const head = new THREE.PlaneGeometry(o.width, T);
  head.rotateX(Math.PI / 2);
  head.translate(0, o.y1, LINING - T / 2);
  put(g, head, mat);
  const sill = new THREE.PlaneGeometry(o.width, T);
  sill.rotateX(-Math.PI / 2);
  sill.translate(0, 0.004, LINING - T / 2);
  put(g, sill, mat);
  return mountInner(g, o.wall, o.u);
}

/**
 * A steel leaf for the exit door, built the way office.ts builds its teal one (in its hinge's frame:
 * along +x from the hinge, the outside toward +z), so it can swing on that hinge.
 */
function steelLeaf(o: Opening, m: { steel: THREE.Material; hazard: THREE.Material; bolts: THREE.Material; angle: THREE.Material }): THREE.Group {
  const F = 0.08;
  const w = o.width - 2 * F - 0.02;
  const h = o.y1 - F - 0.02;
  const g = new THREE.Group();
  put(g, meterBox(w, h, 0.07, 1.2), m.steel, w / 2, 0.01 + h / 2, 0);
  // Inside (-z): a hazard band along the bottom, two stiffening bars, a push bar and a lever handle.
  const band = new THREE.PlaneGeometry(w - 0.04, 0.22);
  band.rotateY(Math.PI);
  const uv = band.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * ((w - 0.04) / 0.7));
  put(g, band, m.hazard, w / 2, 0.16, -0.037);
  for (const y of [0.75, 1.75]) put(g, new THREE.BoxGeometry(w - 0.1, 0.06, 0.03), m.angle, w / 2, y, -0.05);
  put(g, new THREE.BoxGeometry(w * 0.7, 0.05, 0.05), m.bolts, w * 0.5, 1.05, -0.08);
  put(g, new THREE.BoxGeometry(0.2, 0.04, 0.04), m.bolts, w - 0.2, 1.25, -0.06);
  return g;
}

/**
 * Out through the exit door: a dark stairwell going down where the landing and the street were, its
 * walls fading to black the further down it goes.
 */
function darkTunnel(basic: BasicMat): THREE.Group {
  const x0 = EXIT_STAIRS.minX - 0.15;
  const x1 = FLOOR.minX - WALL_T;
  const z0 = EXIT_STAIRS.landingZ0 - 0.15;
  const z1 = z0 + 12;
  const y0 = -6;
  const y1 = EXIT_DOOR.y1 + 0.8;
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, 1, 4, 8);
  const pos = geo.getAttribute('position');
  const colors: number[] = [];
  const near = new THREE.Color('#5c5850');
  const far = new THREE.Color('#0b0b0d');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Lit by the doorway near the landing, black down the stairs and below.
    const along = (pos.getZ(i) + (z1 - z0) / 2) / (z1 - z0);
    const down = Math.max(0, -(pos.getY(i) + (y1 - y0) / 2 - (0 - y0)) / 4);
    c.copy(near).lerp(far, Math.min(1, along * 2.4 + down));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const box = new THREE.Mesh(geo, basic({ vertexColors: true, side: THREE.BackSide }));
  box.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const g = new THREE.Group();
  g.add(box);
  return g;
}

/**
 * The balcony walled in: concrete on its three open sides and a roof over it, so going out for a
 * smoke you're in an airlock off the bunker, not up over the street.
 */
function airlock(walls: THREE.Material, roof: THREE.Material, basic: BasicMat): { group: THREE.Group; makeUp(lamplight?: THREE.Color): void } {
  const g = new THREE.Group();
  const x0 = BALCONY.minX - 0.12;
  const x1 = BALCONY.maxX + 0.12;
  const z0 = BALCONY.minZ;
  const z1 = BALCONY.maxZ + 0.12;
  const y0 = -0.32;
  const y1 = 3.2;
  const parts = new THREE.Group();
  // The far wall, facing back toward the building, and the two ends, facing in.
  const far = wallPlane(-(x1 - x0) / 2, (x1 - x0) / 2, y0, y1, 4);
  far.rotateY(Math.PI);
  far.translate((x0 + x1) / 2, 0, z1);
  put(parts, far, walls);
  for (const [x, turn] of [
    [x0, Math.PI / 2],
    [x1, -Math.PI / 2],
  ] as const) {
    const end = wallPlane(-(z1 - z0) / 2, (z1 - z0) / 2, y0, y1, 4);
    end.rotateY(turn);
    end.translate(x, 0, (z0 + z1) / 2);
    put(parts, end, walls);
  }
  // The roof in the vault's concrete, its uvs in meters like the ceiling's.
  const top = wallPlane(-(x1 - x0) / 2, (x1 - x0) / 2, -(z1 - z0) / 2, (z1 - z0) / 2, 1);
  top.rotateX(Math.PI / 2);
  top.translate((x0 + x1) / 2, y1, (z0 + z1) / 2);
  put(parts, top, roof);
  g.add(bake(parts));
  // Its own bulb in a cage over the bench.
  const glow = basic({ color: '#ffd58a' });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glow);
  bulb.position.set(-8.2, y1 - 0.35, z1 - 0.5);
  g.add(bulb);
  const light = new THREE.PointLight('#ffcf8a', 3, 7, 1.4);
  light.position.set(-4, y1 - 0.6, (z0 + z1) / 2);
  g.add(light);
  // Making up for the lamplight the bunker's lighting takes off everything (see lighting.ts), which
  // indoors only cancels the sky's: a broad spot from over the doors, aimed out and down across the
  // balcony, so none of it falls back indoors (behind it, outside its cone).
  const makeUpLight = new THREE.SpotLight('#ffffff', 0, 12, 1.25, 0.35, 0.6);
  makeUpLight.position.set(BALCONY_DOOR.u, y1 - 0.1, z0 + 0.05);
  makeUpLight.target.position.set(BALCONY_DOOR.u, 1, z1 + 1.6);
  g.add(makeUpLight, makeUpLight.target);
  const makeUp = (lamplight?: THREE.Color) => {
    if (!lamplight) return;
    makeUpLight.color.copy(lamplight);
    makeUpLight.intensity = MAKE_UP;
  };
  return { group: g, makeUp };
}

/**
 * The blast door over the balcony doors: a thick riveted steel slab in a frame, that rolls up its
 * guides as the (hidden) glass doors behind it slide open for someone, and comes back down as they
 * close.
 */
function blastDoor(
  o: Opening,
  m: { steel: THREE.Material; gunmetal: THREE.Material; hazard: THREE.Material; bolts: THREE.Material; angle: THREE.Material },
  tex: <T extends THREE.Texture>(t: T) => T,
  toonMat: ToonMat,
): { group: THREE.Group; show(open: number): void } {
  const g = new THREE.Group();
  const frame = new THREE.Group();
  const J = 0.3;
  const D = 0.2;
  const H = o.y1 + 0.1;
  for (const s of [-1, 1]) {
    put(frame, meterBox(J, H + J, D, 1.2), m.gunmetal, s * (o.width / 2 + J / 2), (H + J) / 2, LINING + D / 2);
    // The guides the slab rides up in, all the way up to the vault.
    put(frame, new THREE.BoxGeometry(0.12, SPRING - 0.3, 0.16), m.angle, s * (o.width / 2 + 0.04), (SPRING - 0.3) / 2, LINING + D + 0.08);
    const geo = new THREE.PlaneGeometry(J - 0.08, H - 0.2);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * ((H - 0.2) / 0.32), uv.getX(i));
    put(frame, geo, m.hazard, s * (o.width / 2 + J / 2), (H - 0.2) / 2 + 0.05, LINING + D + 0.002);
  }
  put(frame, meterBox(o.width + 2 * J, J, D, 1.2), m.gunmetal, 0, H + J / 2, LINING + D / 2);
  // The motor housing at the top of the guides.
  put(frame, meterBox(o.width + 0.5, 0.4, 0.36, 1.2), m.angle, 0, SPRING - 0.1, LINING + 0.2);
  g.add(bake(frame, true));

  // The slab itself: steel plate, a band of hazard chevrons along the bottom, a stencilled number.
  const slabG = new THREE.Group();
  const W = o.width + 0.06;
  const SH = H + 0.05;
  const T = 0.12;
  put(slabG, meterBox(W, SH, T, 1.2), m.steel, 0, SH / 2, 0);
  const band = new THREE.PlaneGeometry(W - 0.04, 0.3);
  const uv = band.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * ((W - 0.04) / 0.96));
  put(slabG, band, m.hazard, 0, 0.2, T / 2 + 0.002);
  // Horizontal ribs across it, and rivets.
  for (const y of [0.9, 1.7]) put(slabG, new THREE.BoxGeometry(W - 0.1, 0.08, 0.05), m.gunmetal, 0, y, T / 2 + 0.02);
  const sign = toonMat('#ffffff', { map: tex(stencilTexture('B-02', { bg: '#c9a227', color: '#1d1c19', w: 256, h: 96 })) });
  put(slabG, new THREE.PlaneGeometry(0.62, 0.23), sign, 0, 2.2, T / 2 + 0.003);
  const bakedSlab = bake(slabG, true);
  const slab = new THREE.Group();
  slab.name = 'blast-door';
  slab.add(bakedSlab);
  slab.position.z = LINING + D + 0.08;
  g.add(slab);
  mountInner(g, o.wall, o.u);

  /** How far up it goes: clear of the doorway, its bottom edge just showing under the frame. */
  const lift = H - 0.12;
  /** `open` is how far the glass doors behind it have slid apart, eased already (0 shut … 1 open). */
  const show = (open: number) => {
    slab.position.y = lift * open;
  };
  return { group: g, show };
}

/** Riveted steel plates over the front and sides of the elevator, with hazard stripes up beside its doors. */
function elevatorSurround(m: { steel: THREE.Material; hazard: THREE.Material; bolts: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  const { x, width, depth, doorWidth, doorHeight } = ELEVATOR;
  const minX = x - width / 2;
  const maxX = x + width / 2;
  const front = ELEVATOR_FRONT;
  const back = FLOOR.minZ;
  const z = front + 0.008;
  // The pillars either side of the doors, above the kick plate, and the header over them.
  const frameW = 0.09;
  for (const [x0, x1] of [
    [minX - 0.01, x - doorWidth / 2 - frameW],
    [x + doorWidth / 2 + frameW, maxX + 0.01],
  ]) {
    const geo = wallPlane(x0, x1, 0.26, WALL_HEIGHT - 0.01, 1.2);
    put(g, geo, m.steel, 0, 0, z);
    // A hazard stripe up the edge by the doors.
    const edge = x0 > x ? x0 + 0.07 : x1 - 0.07;
    const sg = new THREE.PlaneGeometry(0.1, doorHeight - 0.3);
    const uv = sg.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * ((doorHeight - 0.3) / 0.32), uv.getX(i));
    put(g, sg, m.hazard, edge, 0.26 + (doorHeight - 0.3) / 2, z + 0.004);
    for (let y = 0.6; y < WALL_HEIGHT - 0.2; y += 0.6) for (const bx of [x0 + 0.06, x1 - 0.06]) put(g, new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6).rotateX(Math.PI / 2), m.bolts, bx, y, z + 0.008);
  }
  put(g, wallPlane(x - doorWidth / 2 - frameW, x + doorWidth / 2 + frameW, doorHeight + frameW, WALL_HEIGHT - 0.01, 1.2), m.steel, 0, 0, z);
  // Down the shaft's sides.
  for (const [sx, turn] of [
    [minX - 0.008, -Math.PI / 2],
    [maxX + 0.008, Math.PI / 2],
  ] as const) {
    const side = wallPlane(-depth / 2, depth / 2, 0.26, WALL_HEIGHT - 0.01, 1.2);
    side.rotateY(turn);
    side.translate(sx, 0, (back + front) / 2);
    put(g, side, m.steel);
  }
  return g;
}

/** The floor's markings: worn yellow walkway lines down the aisles, a hatched box in front of the elevator, drains. */
function floorMarkings(tex: <T extends THREE.Texture>(t: T) => T, basic: BasicMat, toonMat: ToonMat): THREE.Group {
  const g = new THREE.Group();
  const yellow = toonMat('#ffffff', { map: tex(lineTexture('#e8b41c')), flat: true, transparent: true });
  const white = toonMat('#ffffff', { map: tex(lineTexture('#e9e4d6')), flat: true, transparent: true });
  yellow.depthWrite = white.depthWrite = false;
  const lines = new THREE.Group();
  const strip = (x0: number, z0: number, x1: number, z1: number, w: number, mat: THREE.Material) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const geo = new THREE.PlaneGeometry(len, w);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 3));
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    geo.translate((x0 + x1) / 2, 0.006, (z0 + z1) / 2);
    put(lines, geo, mat);
  };
  // The walkway between the two rows of desk pods, east to the lounge, either side of the aisle
  // (round the plants that stand in it).
  for (const z of [-1.75, 1.75]) strip(-15.5, z, 9.2, z, 0.1, yellow);
  // Across in front of the boards along the north wall.
  strip(-16.4, -9.4, 6.6, -9.4, 0.08, white);
  // A box in front of the elevator, hatched: keep it clear.
  const ex0 = ELEVATOR.x - ELEVATOR.width / 2;
  const ex1 = ELEVATOR.x + ELEVATOR.width / 2;
  const ez0 = ELEVATOR_FRONT + 0.1;
  const ez1 = ELEVATOR_FRONT + 1.4;
  strip(ex0, ez0, ex1, ez0, 0.08, yellow);
  strip(ex0, ez1, ex1, ez1, 0.08, yellow);
  strip(ex0, ez0, ex0, ez1, 0.08, yellow);
  strip(ex1, ez0, ex1, ez1, 0.08, yellow);
  for (let i = 0; i < 5; i++) {
    const xa = ex0 + 0.25 + i * 0.5;
    strip(xa, ez0 + 0.08, Math.min(ex1 - 0.05, xa + 0.45), ez1 - 0.08, 0.06, yellow);
  }
  g.add(bake(lines));

  // Drains: a round steel grate in a dark, damp ring, here and there out of the way.
  const grate = basic({ map: tex(drainTexture()), transparent: true, depthWrite: false });
  const drains = new THREE.Group();
  for (const [x, z] of [
    [-6, -8.2],
    [6.2, 4.8],
    [-14.6, 6.8],
    [15.2, -9.6],
  ]) {
    const geo = new THREE.CircleGeometry(0.34, 20);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, 0.007, z);
    put(drains, geo, grate);
  }
  g.add(bake(drains));
  return g;
}

/** A round drain grate with a damp stain round it. */
function drainTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const stain = g.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S / 2);
  stain.addColorStop(0, 'rgba(40,38,34,0.55)');
  stain.addColorStop(1, 'rgba(40,38,34,0)');
  g.fillStyle = stain;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#4b4f55';
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#151618';
  for (let i = -3; i <= 3; i++) g.fillRect(S / 2 - S * 0.22, S / 2 + i * 6 - 2, S * 0.44, 3);
  g.strokeStyle = '#2a2d31';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The steel ribs the vault rests on: I-beams across the room from the north wall to the south one,
 * bracketed to the wall where each cove starts, up round the cove and flat along the ceiling; and a
 * beam along each long wall where the coves meet the ceiling.
 */
function ribs(mat: THREE.Material, bolts: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const D = 0.18;
  const Wf = 0.16;
  /** A length of I-beam from a to b (in z, y at x), its web vertical. */
  const beam = (x: number, a: [number, number], b: [number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const seg = new THREE.Group();
    // Two flanges and the web between them, along local z.
    seg.add(new THREE.Mesh(new THREE.BoxGeometry(Wf, 0.03, len + 0.02), mat).translateY(D / 2 - 0.015));
    seg.add(new THREE.Mesh(new THREE.BoxGeometry(Wf, 0.03, len + 0.02), mat).translateY(-D / 2 + 0.015));
    seg.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, D, len + 0.02), mat));
    seg.position.set(x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
    seg.rotation.x = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    g.add(seg);
  };
  for (const x of [-15, -9, -3, 3, 14]) {
    const pts: [number, number][] = [];
    for (const side of ['north', 'south'] as const) {
      const c = cove(side, x);
      const s = side === 'north' ? 1 : -1;
      const wallZ = side === 'north' ? FLOOR.minZ + LINING : FLOOR.maxZ - LINING;
      const run: [number, number][] = [];
      for (let i = 0; i <= 6; i++) {
        const [d, y] = covePoint(c, i / 6, D / 2);
        run.push([wallZ + s * d, y]);
      }
      // A bracket on the wall under where it starts.
      const y0 = run[0][1];
      g.add(new THREE.Mesh(new THREE.BoxGeometry(Wf + 0.04, 0.5, 0.08), mat).translateX(x).translateY(y0 - 0.2).translateZ(wallZ + s * 0.04));
      for (const by of [y0 - 0.05, y0 - 0.35]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6).rotateX(Math.PI / 2), bolts).translateX(x).translateY(by).translateZ(wallZ + s * 0.095));
      if (side === 'north') pts.push(...run);
      else pts.push(...run.reverse());
    }
    for (let i = 0; i < pts.length - 1; i++) beam(x, pts[i], pts[i + 1]);
  }
  // Along the walls where the coves meet the ceiling (round the elevator, and short of the loft).
  const along = (x0: number, x1: number, z: number) => {
    const b = new THREE.Group();
    b.add(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, Wf), mat).translateY(-0.015));
    b.add(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, Wf), mat).translateY(-D + 0.015));
    b.add(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, D, 0.03), mat).translateY(-D / 2));
    b.position.set((x0 + x1) / 2, WALL_HEIGHT - 0.006, z);
    g.add(b);
  };
  along(FLOOR.minX, ELEVATOR_GAP.x0, FLOOR.minZ + REACH);
  along(ELEVATOR_GAP.x1, FLOOR.maxX, FLOOR.minZ + REACH);
  along(FLOOR.minX, LOFT.minX - 0.1, FLOOR.maxZ - REACH);
  return g;
}

/** Pipes, cable trays and a vent duct along the ceiling, and fans in the walls and the duct (which spin). */
function ceilingServices(toonMat: ToonMat): { group: THREE.Group; update(dt: number): void } {
  const g = new THREE.Group();
  const fixed = new THREE.Group();
  const top = WALL_HEIGHT;
  const hanger = toonMat('#3a3e44');
  const pipeMats = [toonMat('#9c4a32'), toonMat('#5f7a4a'), toonMat('#7d848c'), toonMat('#d29b2a')];
  const pipe = (z: number, y: number, r: number, mat: THREE.Material, x0 = RUN.x0, x1 = RUN.x1) => {
    const geo = new THREE.CylinderGeometry(r, r, x1 - x0, 10, 1, true);
    geo.rotateZ(Math.PI / 2);
    put(fixed, geo, mat, (x0 + x1) / 2, y, z);
    // Flanged joints every 3 m, and a hanger rod up to the ceiling at each.
    for (let x = x0 + 1.5; x < x1 - 0.5; x += 3) {
      put(fixed, new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.06, 10).rotateZ(Math.PI / 2), mat, x, y, z);
      put(fixed, new THREE.CylinderGeometry(0.012, 0.012, top - y - r, 4), hanger, x + 0.2, (top + y + r) / 2, z);
    }
  };
  // Two pipes side by side over the north half (water and heating), a gas line and a grey one to the south.
  pipe(-8.4, 6.42, 0.09, pipeMats[0]);
  pipe(-8.05, 6.46, 0.06, pipeMats[1]);
  pipe(9.7, 6.45, 0.07, pipeMats[2]);
  pipe(9.95, 6.5, 0.04, pipeMats[3]);

  // A cable tray down the middle, with bundles of cable in it, hung on rods.
  const tray = toonMat('#9aa2a8');
  const cables = [toonMat('#26262a'), toonMat('#c8552b')];
  const trayZ = -1.4;
  const trayY = 6.3;
  const TW = 0.45;
  const len = RUN.x1 - RUN.x0 - 0.2;
  const cx = (RUN.x0 + RUN.x1) / 2;
  put(fixed, new THREE.BoxGeometry(len, 0.02, TW), tray, cx, trayY, trayZ);
  for (const s of [-1, 1]) put(fixed, new THREE.BoxGeometry(len, 0.1, 0.02), tray, cx, trayY + 0.05, trayZ + (s * TW) / 2);
  cables.forEach((m, i) => put(fixed, new THREE.CylinderGeometry(0.035, 0.035, len, 6, 1, true).rotateZ(Math.PI / 2), m, cx, trayY + 0.045, trayZ - 0.1 + i * 0.12));
  put(fixed, new THREE.CylinderGeometry(0.025, 0.025, len, 6, 1, true).rotateZ(Math.PI / 2), cables[0], cx, trayY + 0.05, trayZ + 0.12);
  for (let x = RUN.x0 + 1; x < RUN.x1 - 0.5; x += 2.5) for (const s of [-1, 1]) put(fixed, new THREE.CylinderGeometry(0.01, 0.01, top - trayY, 4), hanger, x, (top + trayY) / 2, trayZ + (s * (TW + 0.04)) / 2);

  // The vent duct: galvanized, in lengths with flanges, over the south desks.
  const duct = toonMat('#a3acb3');
  const ductZ = 6.9;
  const ductY = 6.15;
  const DW = 0.8;
  const DH = 0.5;
  put(fixed, new THREE.BoxGeometry(len, DH, DW), duct, cx, ductY, ductZ);
  for (let x = RUN.x0 + 0.2; x < RUN.x1 - 0.1; x += 2) put(fixed, new THREE.BoxGeometry(0.05, DH + 0.06, DW + 0.06), hanger, x, ductY, ductZ);
  for (let x = RUN.x0 + 1.2; x < RUN.x1; x += 3) put(fixed, new THREE.BoxGeometry(0.04, top - ductY - DH / 2, 0.04), hanger, x, (top + ductY + DH / 2) / 2, ductZ);
  g.add(bake(fixed, false));

  // Fans: round grilles under the duct and in the west and east walls, blades turning behind them.
  const fans: THREE.Object3D[] = [];
  const bladeMat = toonMat('#2f3338');
  const ringMat = toonMat('#555b62');
  const fan = (r: number) => {
    const f = new THREE.Group();
    f.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 6, 24), ringMat));
    const back = new THREE.Mesh(new THREE.CircleGeometry(r, 24), toonMat('#1b1c1f'));
    back.position.z = -0.05;
    f.add(back);
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, r * 0.32, 0.015), bladeMat);
      b.position.x = (r * 0.9) / 2;
      b.rotation.x = 0.35;
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(b);
      blades.add(arm);
    }
    blades.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.06, 10).rotateX(Math.PI / 2), ringMat));
    blades.position.z = -0.02;
    f.add(blades);
    // Grille bars across the front.
    for (let i = -2; i <= 2; i++) f.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, Math.sqrt(Math.max(0, r * r - (i * r * 0.36) ** 2)) * 2, 0.012), ringMat).translateX(i * r * 0.36));
    fans.push(blades);
    return f;
  };
  // Under the duct, facing down.
  for (const x of [-8, 5.5]) {
    const f = fan(0.3);
    f.rotation.x = Math.PI / 2;
    f.position.set(x, ductY - DH / 2 - 0.01, ductZ);
    g.add(f);
  }
  // In the west wall over the machine monitor, and the east wall between the TV and the jukebox's corner.
  const wallFan = (side: Side, u: number, y: number) => {
    const f = fan(0.42);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.12), toonMat('#5d636a'));
    box.position.z = -0.03;
    f.add(box);
    const at = onInner(side, u, LINING + 0.1);
    f.position.set(at.x, y, at.z);
    f.rotation.y = at.rotY;
    g.add(f);
  };
  wallFan('west', -6, 4.7);
  wallFan('east', 4.6, 4.9);

  const update = (dt: number) => {
    for (const [i, b] of fans.entries()) b.rotation.z += dt * (i % 2 ? 7 : 9);
  };
  return { group: g, update };
}

/** Where the lamps hang: cage lamps (x, z) over the desks and round the room, and the fluorescent tubes. */
const CAGE_LAMPS: readonly [number, number][] = [
  // Where the office's pendants hang (the sky puts their glow there at night), over each pod and the lounge.
  [-10.5, -4],
  [-1.5, -4],
  [-10.5, 4],
  [-1.5, 4],
  [13, 0],
  // Down the aisle between the pods, by the elevator, and in the north-west corner.
  [-6, 0],
  [2, 0],
  [8.5, -8.2],
  [-15.4, -8.5],
  [13.2, -6.6],
];
const TUBES: readonly { x: number; z: number; y: number; len: number }[] = [
  { x: 5.4, z: -7.7, y: 4.5, len: 2.6 },
  { x: -14.6, z: 10.2, y: 4.3, len: 2.2 },
];
/** The real lights: warm over each pod and the lounge, cool under the tubes. Few, so it stays quick. */
const LIGHTS: readonly { x: number; y: number; z: number; color: string; power: number; reach: number }[] = [
  { x: -10.5, y: 3.9, z: -4, color: '#ffc77d', power: 6, reach: 10 },
  { x: -1.5, y: 3.9, z: -4, color: '#ffc77d', power: 6, reach: 10 },
  { x: -10.5, y: 3.9, z: 4, color: '#ffc77d', power: 6, reach: 10 },
  { x: -1.5, y: 3.9, z: 4, color: '#ffc77d', power: 6, reach: 10 },
  { x: 13, y: 3.9, z: 0, color: '#ffb766', power: 5, reach: 9 },
  { x: 5.4, y: 4.2, z: -7.7, color: '#cfe6ff', power: 4, reach: 9 },
  // Over the pool table, low: it lights the cloth the way the billiard lamp did, at any hour.
  { x: POOL_TABLE.x, y: POOL_TABLE.y + 0.85, z: POOL_TABLE.z, color: '#ffd08a', power: 2.2, reach: 3.2 },
];
/** The cage's middle: its bulb hangs where the office's pendants' bulbs were. */
const LAMP_Y = 3.97;
/** The trough lamp over the pool table: how high over the cloth (where the billiard lamp's shade was), and its bulbs along it. */
const POOL_LAMP_Y = 1.0;
const POOL_BULBS = [-0.45, 0, 0.45];
/** The meeting room's bulkhead lights, either side of the table's middle (where its flat lights were). */
const MEETING_LAMPS = [-0.95, 0.95];
/** The little cage lamp out from the wall over the dartboard's cabinet: its bulb, where the picture lamp's was. */
const DARTBOARD_LAMP = { x: FLOOR.maxX - 0.2, y: DARTBOARD.y + DARTBOARD.cabinet.height / 2 + 0.14, z: DARTBOARD.z };

/** The cage lamps and tubes, their glow, and the few real lights that do the lighting. */
function buildLamps(toonMat: ToonMat, basic: BasicMat, tex: <T extends THREE.Texture>(t: T) => T): { group: THREE.Group } {
  const g = new THREE.Group();
  const parts = new THREE.Group();
  const cord = toonMat('#1f2125');
  const cap = toonMat('#3d4a3a');
  const cage = toonMat('#2a2d31');
  const warm = basic({ color: '#ffd58a' });
  const cool = basic({ color: '#eef8ff' });
  const housing = toonMat('#cfd3d6');
  for (const [x, z] of CAGE_LAMPS) {
    put(parts, new THREE.CylinderGeometry(0.012, 0.012, WALL_HEIGHT - LAMP_Y - 0.18, 4), cord, x, (WALL_HEIGHT + LAMP_Y + 0.18) / 2, z);
    // An enamel cap, the bulb under it, and a wire cage round the bulb.
    put(parts, new THREE.ConeGeometry(0.26, 0.18, 14, 1, true), cap, x, LAMP_Y + 0.1, z);
    put(parts, new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), cap, x, LAMP_Y + 0.2, z);
    put(parts, new THREE.SphereGeometry(0.09, 10, 8), warm, x, LAMP_Y - 0.04, z);
    for (let i = 0; i < 4; i++) {
      const wire = new THREE.TorusGeometry(0.13, 0.008, 4, 12, Math.PI);
      wire.rotateY((i * Math.PI) / 4);
      put(parts, wire, cage, x, LAMP_Y, z);
    }
    put(parts, new THREE.TorusGeometry(0.13, 0.01, 4, 16).rotateX(Math.PI / 2), cage, x, LAMP_Y, z);
  }
  for (const t of TUBES) {
    // A white housing on two chains, a pair of tubes under it.
    put(parts, new THREE.BoxGeometry(t.len, 0.07, 0.3), housing, t.x, t.y + 0.05, t.z);
    for (const s of [-1, 1]) {
      put(parts, new THREE.CylinderGeometry(0.03, 0.03, t.len - 0.12, 8).rotateZ(Math.PI / 2), cool, t.x, t.y - 0.01, t.z + s * 0.07);
      put(parts, new THREE.CylinderGeometry(0.008, 0.008, WALL_HEIGHT - t.y - 0.08, 4), cord, t.x + s * (t.len / 2 - 0.15), (WALL_HEIGHT + t.y + 0.08) / 2, t.z);
    }
  }
  // Where the office's other fittings were: a steel trough lamp on chains over the pool table, a
  // caged bulkhead light under the loft's floor over each end of the meeting table, and a little cage
  // lamp on a bracket over the dartboard.
  const steel = toonMat('#3a3f44');
  const pool = POOL_TABLE.y + POOL_LAMP_Y;
  put(parts, new THREE.BoxGeometry(1.5, 0.08, 0.34), steel, POOL_TABLE.x, pool + 0.1, POOL_TABLE.z);
  put(parts, new THREE.BoxGeometry(1.5, 0.14, 0.03), steel, POOL_TABLE.x, pool + 0.03, POOL_TABLE.z - 0.17);
  put(parts, new THREE.BoxGeometry(1.5, 0.14, 0.03), steel, POOL_TABLE.x, pool + 0.03, POOL_TABLE.z + 0.17);
  for (const dx of [-0.55, 0.55]) put(parts, new THREE.CylinderGeometry(0.01, 0.01, WALL_HEIGHT - pool - 0.14, 4), cord, POOL_TABLE.x + dx, (WALL_HEIGHT + pool + 0.14) / 2, POOL_TABLE.z);
  for (const dx of POOL_BULBS) put(parts, new THREE.SphereGeometry(0.07, 10, 8), warm, POOL_TABLE.x + dx, pool - 0.01, POOL_TABLE.z);
  const bulkhead = (x: number, y: number, z: number, r: number) => {
    // A round steel base flat on the ceiling, a frosted dome under it and a cage over that.
    put(parts, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.05, 16), cap, x, y - 0.025, z);
    put(parts, new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), warm, x, y - 0.05, z);
    put(parts, new THREE.TorusGeometry(r + 0.01, 0.01, 4, 16).rotateX(Math.PI / 2), cage, x, y - 0.05 - r * 0.45, z);
    for (let i = 0; i < 2; i++) put(parts, new THREE.TorusGeometry(r + 0.015, 0.008, 4, 12, Math.PI).rotateX(Math.PI).rotateY((i * Math.PI) / 2), cage, x, y - 0.05, z);
  };
  for (const dx of MEETING_LAMPS) bulkhead(MEETING_TABLE.x + dx, MEETING_ROOM.height, MEETING_TABLE.z, 0.16);
  const dart = DARTBOARD_LAMP;
  put(parts, new THREE.BoxGeometry(FLOOR.maxX - dart.x, 0.03, 0.03), steel, (FLOOR.maxX + dart.x) / 2, dart.y + 0.1, dart.z);
  put(parts, new THREE.ConeGeometry(0.1, 0.08, 12, 1, true), cap, dart.x, dart.y + 0.05, dart.z);
  put(parts, new THREE.SphereGeometry(0.045, 8, 6), warm, dart.x, dart.y, dart.z);
  for (let i = 0; i < 2; i++) put(parts, new THREE.TorusGeometry(0.07, 0.006, 4, 10, Math.PI).rotateX(Math.PI).rotateY((i * Math.PI) / 2), cage, dart.x, dart.y + 0.02, dart.z);
  g.add(bake(parts, false));

  // A soft glow round every bulb and tube, brighter in the dark.
  const glowMap = tex(glowTexture());
  const halo = (color: string, size: number, x: number, y: number, z: number, sx = 1) => {
    const mat = new THREE.SpriteMaterial({ map: glowMap, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(size * sx, size, 1);
    s.position.set(x, y, z);
    g.add(s);
  };
  for (const [x, z] of CAGE_LAMPS) halo('#ffc56e', 1.1, x, LAMP_Y - 0.04, z);
  for (const t of TUBES) halo('#cfe8ff', 0.9, t.x, t.y - 0.02, t.z, t.len / 0.9);
  for (const dx of POOL_BULBS) halo('#ffc56e', 0.6, POOL_TABLE.x + dx, POOL_TABLE.y + POOL_LAMP_Y - 0.03, POOL_TABLE.z);
  for (const dx of MEETING_LAMPS) halo('#ffc56e', 0.6, MEETING_TABLE.x + dx, MEETING_ROOM.height - 0.15, MEETING_TABLE.z);
  halo('#ffc56e', 0.4, DARTBOARD_LAMP.x, DARTBOARD_LAMP.y, DARTBOARD_LAMP.z);

  for (const l of LIGHTS) {
    const light = new THREE.PointLight(l.color, l.power, l.reach, 1.4);
    light.position.set(l.x, l.y, l.z);
    g.add(light);
  }

  return { group: g };
}
