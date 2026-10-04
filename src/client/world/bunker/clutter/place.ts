import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOOKSHELF, ELEVATOR, ELEVATOR_FRONT, FLOOR, MEETING_ROOM, POOL_TABLE } from '../../../../shared/layout';
import { Kit, mesh } from './kit';
import { ammoBoxes, crates, drum, extinguisher, fireBarrel, jerrycan, neonSign, radio, sandbags, wallMap, warningSign, workshop, type Animated } from './parts';

// Where the bunker's clutter goes. Everything stands against a wall or in a corner nothing else
// uses (see shared/layout.ts and office.ts for what's where), clear of the desks, the walkways, the
// doors, the dartboard's lane, the pool table's cueing room, the hoop, the seats and the boards, so
// it needs no colliders: it's only to look at.

/** The open corner west of the kitchen counter (which stops a meter short of the west wall). */
export const FIRE_BARREL = { x: FLOOR.minX + 0.55, z: FLOOR.maxZ - 0.6 } as const;
/** The workshop's bench, against the north wall between the plants in the north-east corner. */
export const WORKSHOP = { x: 15.65, z: FLOOR.minZ, width: 1.9, depth: 0.9 } as const;
/** The sandbag walls: [start, end] along their wall, which their backs are up against. */
export const SANDBAGS = {
  /** Under the Issues board, east of its kiosk. */
  north: [-14.3, -9.1],
  /** Under the machine monitor, between the overflow bean bags' spots. */
  west: [-7.9, -4.1],
  /** Under the south window between the kitchen's fridge and the bookshelf. */
  south: [-10.6, BOOKSHELF.x - BOOKSHELF.width / 2 - 0.12],
} as const;
/** The crates along the meeting room's glass, between its door and the jukebox. */
export const CRATES_X = [12.85, 15.3] as const;
/** The drums and the jerrycan on the west wall, between the last window's bean bag and the exit door. */
export const DRUMS_Z = [3.85, 5.55] as const;

const GLASS = MEETING_ROOM.minZ - 0.08;
const RACK_END = POOL_TABLE.rack.x + POOL_TABLE.rack.width / 2;

/** What each pile stands on, as [minX, maxX, minZ, maxZ] on the floor: the tests keep these clear of everything else. */
export const FOOTPRINTS: Record<string, readonly [number, number, number, number]> = {
  sandbagsNorth: [SANDBAGS.north[0], SANDBAGS.north[1], FLOOR.minZ, FLOOR.minZ + 0.45],
  sandbagsWest: [FLOOR.minX, FLOOR.minX + 0.45, SANDBAGS.west[0], SANDBAGS.west[1]],
  sandbagsSouth: [SANDBAGS.south[0], SANDBAGS.south[1], FLOOR.maxZ - 0.45, FLOOR.maxZ],
  workshop: [WORKSHOP.x - WORKSHOP.width / 2, WORKSHOP.x + WORKSHOP.width / 2, WORKSHOP.z, WORKSHOP.z + WORKSHOP.depth],
  crates: [CRATES_X[0], CRATES_X[1], GLASS - 0.75, GLASS],
  cornerCrates: [RACK_END + 0.1, RACK_END + 0.8, FLOOR.maxZ - 0.7, FLOOR.maxZ],
  drums: [FLOOR.minX, FLOOR.minX + 0.7, DRUMS_Z[0], DRUMS_Z[1]],
  fireBarrel: [FLOOR.minX, FIRE_BARREL.x + 0.32, FIRE_BARREL.z - 0.32, FIRE_BARREL.z + 0.32],
};

/** Where one of the office's potted plants stands (in office.group), and how big it is: something else stands there in the bunker. */
export interface PlantSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
}

/**
 * What stands where a plant stood, varied by spot: an oil drum, a stack of ammo-box tins, a fire point
 * or two jerrycans. Each is within 0.3 of its middle, scaled down for a small plant (never up), so it
 * stays inside the plant's collider and blocks nothing new.
 */
function plantStandIn(kit: Kit, i: number, scale: number): THREE.Group {
  const g = new THREE.Group();
  switch (i % 4) {
    case 0:
      g.add(drum(kit, i % 8 === 0 ? '#56643a' : '#2f6690', i % 8 === 0 ? '#d9d2b6' : '#e9c46a'));
      break;
    case 1:
      g.add(ammoBoxes(kit, 7 + i));
      break;
    case 2:
      g.add(extinguisher(kit));
      break;
    default: {
      const a = jerrycan(kit, '#4f5d2f');
      a.position.set(0, 0, -0.08);
      const b = jerrycan(kit, '#c0392b');
      b.position.set(0.04, 0, 0.11);
      b.rotation.y = 0.25;
      g.add(a, b);
    }
  }
  g.scale.setScalar(Math.min(1, scale));
  return g;
}

export interface BunkerProps {
  group: THREE.Group;
  /** The keep-out sign on the elevator's pillar: aiming at it should still find the elevator. */
  elevatorSign: THREE.Object3D;
  update(dt: number): void;
  dispose(): void;
}

/**
 * Merges the untextured meshes under `root` into one per material, the way toon.ts's mergeByMaterial
 * does, but keeping the textured ones (crate sides, signs, the map) as they are.
 */
function bake(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const out = new THREE.Group();
  const byKey = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  const keep: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material & { map?: THREE.Texture | null };
    if (mat.map) {
      keep.push(m);
      return;
    }
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const key = `${mat.uuid}${m.castShadow ? '+' : '-'}`;
    if (!byKey.has(key)) byKey.set(key, { mat, cast: m.castShadow, geos: [] });
    byKey.get(key)!.geos.push(geo);
  });
  for (const m of keep) {
    m.matrix.multiplyMatrices(inv, m.matrixWorld);
    m.matrix.decompose(m.position, m.quaternion, m.scale);
    out.add(m);
  }
  for (const { mat, cast, geos } of byKey.values()) {
    out.add(mesh(mergeGeometries(geos)!, mat, 0, 0, 0, cast));
    for (const geo of geos) geo.dispose();
  }
  // What was merged is no longer needed.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !keep.includes(m)) m.geometry.dispose();
  });
  return out;
}

/** Puts `o` against a wall: at (x, z), turned by `rotY` so its +z faces into the room. */
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rotY = 0): T {
  o.position.set(x, y, z);
  o.rotation.y = rotY;
  return o;
}

export function buildBunkerProps(plants: readonly PlantSpot[] = []): BunkerProps {
  const kit = new Kit();
  const group = new THREE.Group();
  group.name = 'bunker-props';
  const statics = new THREE.Group();
  const animated: Animated[] = [];
  const live = (a: Animated, x: number, y: number, z: number, rotY = 0) => {
    animated.push(a);
    group.add(at(a.group, x, y, z, rotY));
  };

  // Sandbag walls along three walls, low enough to stay under what hangs over them.
  const [n0, n1] = SANDBAGS.north;
  statics.add(at(sandbags(kit, n1 - n0, 2, 1), n0, 0, FLOOR.minZ));
  const [w0, w1] = SANDBAGS.west;
  statics.add(at(sandbags(kit, w1 - w0, 3, 2), FLOOR.minX, 0, w1, Math.PI / 2));
  const [s0, s1] = SANDBAGS.south;
  statics.add(at(sandbags(kit, s1 - s0, 3, 3), s1, 0, FLOOR.maxZ, Math.PI));

  // The workshop corner.
  statics.add(at(workshop(kit), WORKSHOP.x, 0, WORKSHOP.z));

  // Crates stacked along the meeting room's glass, with the radio set on top of them, tuned in.
  const glass = GLASS;
  const [c0] = CRATES_X;
  statics.add(
    crates(kit, [
      { x: c0 + 0.45, z: glass - 0.36, size: [0.9, 0.7, 0.7], label: '07' },
      { x: c0 + 0.42, y: 0.7, z: glass - 0.34, size: [0.62, 0.48, 0.6], label: '113', rotY: -0.12, wood: '#c9a06a' },
      { x: c0 + 1.32, z: glass - 0.36, size: [0.7, 0.66, 0.66], label: '23', rotY: 0.06, wood: '#a77b4a' },
    ]),
  );
  live(radio(kit), c0 + 1.32, 0.66, glass - 0.4, Math.PI + 0.1);
  statics.add(at(jerrycan(kit, '#4f5d2f'), c0 + 2.1, 0, glass - 0.15, 0.2));

  // Two crates in the corner by the window east of the cue rack.
  const rackEnd = RACK_END;
  statics.add(
    crates(kit, [
      { x: rackEnd + 0.45, z: FLOOR.maxZ - 0.33, size: [0.62, 0.6, 0.6], label: '88', rotY: 0.08, wood: '#a77b4a' },
      { x: rackEnd + 0.45, y: 0.6, z: FLOOR.maxZ - 0.3, size: [0.46, 0.36, 0.42], label: '5', rotY: -0.2 },
    ]),
  );

  // Oil drums and a jerrycan by the exit door, and the fire barrel in the corner past the kitchen.
  const [d0] = DRUMS_Z;
  statics.add(at(drum(kit, '#2f6690'), FLOOR.minX + 0.36, 0, d0 + 0.31));
  statics.add(at(drum(kit, '#56643a', '#d9d2b6'), FLOOR.minX + 0.38, 0, d0 + 0.94, 0.7));
  statics.add(at(jerrycan(kit, '#c0392b'), FLOOR.minX + 0.2, 0, d0 + 1.48, Math.PI / 2));
  live(fireBarrel(kit), FIRE_BARREL.x, 0, FIRE_BARREL.z);

  // Where the office's potted plants stand.
  plants.forEach((p, i) => statics.add(at(plantStandIn(kit, i, p.scale), p.x, p.y, p.z, i * 1.3)));

  // The big map on the east wall over the jukebox and the arcade, between the TV and the loft.
  group.add(at(wallMap(kit, 2.6, 1.5), FLOOR.maxX, 3.3, 5.9, -Math.PI / 2));

  // The neon sign high on the north wall, over the PR agent between the task queue and the PR board.
  live(neonSign(kit), 0, 5.1, FLOOR.minZ);

  // On the elevator's left-hand pillar (the call button is on the right): keep out.
  const pillar = ELEVATOR.x - ELEVATOR.width / 2 + (ELEVATOR.width - ELEVATOR.doorWidth) / 4;
  const elevatorSign = at(warningSign(kit, ['AUTHORIZED', 'PERSONNEL', 'ONLY'], 0.5, 0.68), pillar, 1.55, ELEVATOR_FRONT + 0.005);
  group.add(elevatorSign);

  group.add(bake(statics));
  // No ink outline round what's flat or lit up (the way main.ts treats the office's own).
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const flat = m.geometry instanceof THREE.PlaneGeometry || m.geometry instanceof THREE.CircleGeometry;
    const mat = m.material as THREE.Material;
    if (flat || mat instanceof THREE.MeshBasicMaterial || mat.side === THREE.DoubleSide) mat.userData.outlineParameters = { visible: false };
  });

  let t = 0;
  return {
    group,
    elevatorSign,
    update(dt) {
      t += dt;
      for (const a of animated) a.update(dt, t);
    },
    dispose() {
      group.removeFromParent();
      group.traverse((o) => {
        const g = (o as THREE.Mesh | THREE.Points | THREE.Sprite).geometry;
        // Sprites share one geometry across the whole app: leave it be.
        if (g && !(o as THREE.Sprite).isSprite) g.dispose();
      });
      kit.dispose();
    },
  };
}
