// The casino's secret door and the little room behind it (see SECRET_DOOR, SECRET_ROOM in
// shared/casino.ts, the motion in shared/secretdoor.ts). The door is the east end of the hall's south
// wall itself: wallpaper, panelling, dado rail and the wall behind, built twice. Shut, it's the wall in
// one piece, exactly as the rest of the hall's walls are built, so there's nothing to see: no seam, no
// edge, no line. Once it moves, that piece is swapped for the same wall cut round the door, and the
// door (a leaf of the same parts, the wallpaper's pattern running on across it) presses in and swings
// on its pivot. When it's shut again it's put back exactly where it was and the wall is one piece again.
//
// The room behind is lit by its one lamp in its own materials (roomLit), not by a light in the scene:
// a light in there would shine on the hall's side of the wall too (three.js lights go through walls),
// and the hall's lights don't reach in there either. Only people in there get a small real light,
// too short to reach the wall.
import * as THREE from 'three';
import { CASINO_ROOM, SECRET_DOOR, SECRET_ROOM } from '../../shared/casino';
import { DoorMotion, type SecretDoorState } from '../../shared/secretdoor';
import { WALL_T } from '../../shared/layout';
import type { Collider } from './office';
import { mergeByMaterial, mesh, toon } from './toon';

const R = CASINO_ROOM;
const Q = SECRET_ROOM;
const D = SECRET_DOOR;
const H = R.height;
const X0 = D.x - D.width / 2;
const X1 = D.x + D.width / 2;
/** How big a tile of the hall's wallpaper is (m), as the hall's walls have it. */
const PAPER = 1.3;
/** The lamp's bulb. */
export const SECRET_LAMP = new THREE.Vector3(D.x, Q.height - 0.62, (Q.minZ + Q.maxZ) / 2);
/** How far the light for people in there reaches (m): short of the hall's wall. */
export const SECRET_LAMP_REACH = 1.7;

/** The hall's wall, as casino.ts builds the rest of it. */
export interface WallKit {
  /** The wallpaper above the panelling (a tile PAPER meters across). */
  paper: THREE.Texture;
  /** A toon material with a map on it, as the hall's wallpaper has. */
  toonMap(map: THREE.Texture): THREE.Material;
  panel: THREE.Material;
  brass: THREE.Material;
  /** The wall itself, behind. */
  back: THREE.Material;
  /** How high the panelling goes. */
  dado: number;
  /** Where this run of the south wall starts in the west (the shop's doorway's east side). */
  fromX: number;
  /** The carpet, for the room's floor. */
  carpet: THREE.Texture;
}

export interface SecretDoorView {
  group: THREE.Group;
  /** The door: shut, its transform is exactly `closed`'s. */
  leaf: THREE.Group;
  closed: { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion };
  /** The wall in one piece (shown while the door's shut) and cut round the door (while it moves). */
  whole: THREE.Group;
  cut: THREE.Group;
  /** The doorway's collider: in `colliders` while the door's shut. */
  doorway: Collider;
  motion: DoorMotion;
  /** The light for people in the room. */
  lamp: THREE.PointLight;
  /** The office's say: open or shut. `snap` goes straight there (coming down while it's open). */
  set(state: SecretDoorState, snap?: boolean): void;
  /** A frame: the motion, the leaf, the wall, and whether the doorway's solid (never shut on `you`, if you're in it). */
  update(dt: number, you?: { x: number; z: number }): void;
}

/** A plane of the hall's wallpaper from x0 to x1, y0 to y1, facing into the hall (-z), with the pattern where the wall in one piece has it. */
function paperGeometry(x0: number, x1: number, y0: number, y1: number, dado: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0).rotateY(Math.PI).translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (R.maxX - pos.getX(i)) / PAPER, (pos.getY(i) - dado) / PAPER);
  return g;
}

/**
 * A plain material lit only by the room's lamp (and a little of its own): warm, falling off with
 * distance, stronger where a surface faces the bulb, and dimmer above it, where the shade is.
 */
export function roomLit(color: THREE.ColorRepresentation, map: THREE.Texture | null = null): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, map });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.secretLamp = { value: SECRET_LAMP };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSecretPos;\nvarying vec3 vSecretNormal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSecretPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSecretNormal = mat3(modelMatrix) * normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 secretLamp;\nvarying vec3 vSecretPos;\nvarying vec3 vSecretNormal;').replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        vec3 toLamp = secretLamp - vSecretPos;
        float d = length(toLamp);
        float facing = max(dot(normalize(vSecretNormal), toLamp / d), 0.0);
        float under = smoothstep(-0.1, 0.5, toLamp.y / d);
        float lit = 0.13 + (0.25 + 0.75 * under) * (0.3 + 0.7 * facing) * 1.6 / (1.0 + 0.45 * d * d);
        diffuseColor.rgb *= lit * vec3(1.0, 0.87, 0.68);
      }`,
    );
  };
  m.customProgramCacheKey = () => 'secret-room-lit';
  return m;
}

/** The room's walls: dark wood to the dado, a brass line, the hall's wallpaper over it, one tile PAPER across and the room's height tall. */
function roomWallTexture(paper: THREE.Texture, dado: number): THREE.CanvasTexture {
  const px = 200;
  const c = document.createElement('canvas');
  c.width = Math.round(PAPER * px);
  c.height = Math.round(Q.height * px);
  const g = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;
  const rail = h - dado * px;
  const img = paper.image as CanvasImageSource | undefined;
  g.fillStyle = '#4a1222';
  g.fillRect(0, 0, w, rail);
  if (img) for (let y = rail - w; y > -w; y -= w) g.drawImage(img, 0, y, w, w);
  g.fillStyle = '#3b1d12';
  g.fillRect(0, rail, w, h - rail);
  // Panels, a groove round each.
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = 3;
  g.strokeRect(14, rail + 22, w / 2 - 28, h - rail - 44);
  g.strokeRect(w / 2 + 14, rail + 22, w / 2 - 28, h - rail - 44);
  g.fillStyle = '#d4a84b';
  g.fillRect(0, rail - 10, w, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * A wall's face from x0 to x1, y0 to y1, with the doorway (X0 to X1, up from y0 to the door's
 * height) cut out of it: one piece, so there's no seam over the door or beside it. Facing -z (the
 * hall's side, `toward` -1) or +z (the room's), with `uv` giving each corner its place in the pattern.
 */
function notchedGeometry(x0: number, x1: number, y0: number, y1: number, toward: 1 | -1, uv: (x: number, y: number) => [number, number]): THREE.BufferGeometry {
  // Drawn mirrored for the hall's side and turned round, so it faces the right way.
  const m = toward;
  const shape = new THREE.Shape(
    [
      [x0, y0],
      [X0, y0],
      [X0, D.height],
      [X1, D.height],
      [X1, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => new THREE.Vector2(m * x, y)),
  );
  const g = new THREE.ShapeGeometry(shape);
  if (m < 0) g.rotateY(Math.PI);
  const pos = g.attributes.position;
  const uvs = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uvs.setXY(i, ...uv(pos.getX(i), pos.getY(i)));
  return g;
}

/** A plane of the room's wall from a to b along it (meters along `u`), floor to ceiling or y0 to y1, its texture where the wall in one piece has it. */
function roomWallGeometry(a: number, b: number, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(b - a, y1 - y0).translate((a + b) / 2, (y0 + y1) / 2, 0);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / PAPER, pos.getY(i) / Q.height);
  return g;
}

/**
 * Builds the east end of the hall's south wall (from `kit.fromX` to the east wall) with the secret
 * door in it, and the room behind. Its colliders go in `colliders` (the doorway's comes and goes).
 */
export function buildSecretDoor(colliders: Collider[], kit: WallKit): SecretDoorView {
  const group = new THREE.Group();
  group.name = 'secret-door';
  const whole = new THREE.Group();
  const cut = new THREE.Group();
  cut.visible = false;
  group.add(whole, cut);
  const { dado, fromX } = kit;
  const paper = kit.paper.clone();
  paper.repeat.set(1, 1);
  paper.needsUpdate = true;
  const paperMat = kit.toonMap(paper);
  const z = R.maxZ;
  const toX = R.maxX;
  const lining = Q.wall - WALL_T - 0.001;
  // What's behind a face, cut at the door: not outlined, and pushed back in depth by its slope, or its
  // cut ends, seen edge on right behind the face a millimeter in front, would show through it as a
  // dashed line all the way up.
  const hidden = kit.back.clone();
  hidden.userData.outlineParameters = { visible: false };
  hidden.polygonOffset = true;
  hidden.polygonOffsetFactor = 4;
  hidden.polygonOffsetUnits = 4;

  /** The hall's side of the wall from x0 to x1 (up to y1, the panelling and rail only below the dado): wallpaper, panelling, rail, the wall behind; at (ox, oz). */
  const hallSide = (into: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, ox = 0, oz = 0, backTo = x1, paperToo = true, back = kit.back) => {
    if (paperToo && y1 > dado) {
      const p = new THREE.Mesh(paperGeometry(x0, x1, Math.max(y0, dado), y1, dado).translate(-ox, 0, z - 0.001 - oz), paperMat);
      into.add(p);
    }
    if (y0 < dado) {
      into.add(mesh(new THREE.BoxGeometry(x1 - x0, dado, 0.06), kit.panel, (x0 + x1) / 2 - ox, dado / 2, z - 0.03 - oz, false));
      into.add(mesh(new THREE.BoxGeometry(x1 - x0, 0.05, 0.1), kit.brass, (x0 + x1) / 2 - ox, dado + 0.025, z - 0.05 - oz, false));
    }
    into.add(mesh(new THREE.BoxGeometry(backTo - x0, y1 - y0, WALL_T), back, (x0 + backTo) / 2 - ox, (y0 + y1) / 2, z + WALL_T / 2 - oz, false));
  };

  // ---- The room's side of that wall: a lining behind its face, the face lit by the lamp -------------
  const roomWall = roomWallTexture(kit.paper, dado);
  const roomWallMat = roomLit('#ffffff', roomWall);
  const liningMat = hidden;
  const roomSide = (into: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, ox = 0, oz = 0, faceToo = true) => {
    // Facing +z: along it, x runs the usual way.
    if (faceToo) into.add(new THREE.Mesh(roomWallGeometry(x0, x1, y0, y1).translate(-ox, 0, Q.minZ - oz), roomWallMat));
    into.add(mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, lining), liningMat, (x0 + x1) / 2 - ox, (y0 + y1) / 2, z + WALL_T + lining / 2 - oz, false));
  };

  // The wall in one piece, built exactly as the hall's other walls are (casino.ts), to the pixel: its
  // wallpaper's pattern from its own end, its panelling, rail and the wall behind merged into one.
  const wholePaper = kit.paper.clone();
  wholePaper.repeat.set((toX - fromX) / PAPER, (H - dado) / PAPER);
  const wholePlane = new THREE.Mesh(new THREE.PlaneGeometry(toX - fromX, H - dado), kit.toonMap(wholePaper));
  wholePlane.position.set((fromX + toX) / 2, dado + (H - dado) / 2, z + 0.001 * -1);
  wholePlane.rotation.y = Math.PI;
  const wholeBoxes = new THREE.Group();
  hallSide(wholeBoxes, fromX, toX, 0, H, 0, 0, toX + WALL_T, false);
  whole.add(wholePlane, mergeByMaterial(wholeBoxes));
  roomSide(whole, Q.minX, Q.maxX, 0, Q.height);
  // And cut round the door: the faces each one piece with the doorway out of it, what's behind them
  // either side of it and over it.
  const cutPaper = notchedGeometry(fromX, toX, dado, H, -1, (x, y) => [(R.maxX - x) / PAPER, (y - dado) / PAPER]).translate(0, 0, z - 0.001);
  cut.add(new THREE.Mesh(cutPaper, paperMat));
  hallSide(cut, fromX, X0, 0, H, 0, 0, X0, false, hidden);
  hallSide(cut, X1, toX, 0, H, 0, 0, toX + WALL_T, false, hidden);
  hallSide(cut, X0, X1, D.height, H, 0, 0, X1, false, hidden);
  cut.add(new THREE.Mesh(notchedGeometry(Q.minX, Q.maxX, 0, Q.height, 1, (x, y) => [x / PAPER, y / Q.height]).translate(0, 0, Q.minZ), roomWallMat));
  roomSide(cut, Q.minX, X0, 0, Q.height, 0, 0, false);
  roomSide(cut, X1, Q.maxX, 0, Q.height, 0, 0, false);
  roomSide(cut, X0, X1, D.height, Q.height, 0, 0, false);

  // The door: the same parts, from its hinge's corner of the wall's face (x0, 0, z).
  const leaf = new THREE.Group();
  leaf.name = 'secret-door-leaf';
  const closedPosition = new THREE.Vector3(X0, 0, z);
  leaf.position.copy(closedPosition);
  const pivot = new THREE.Group();
  leaf.add(pivot);
  hallSide(pivot, X0, X1, 0, D.height, X0, z);
  roomSide(pivot, X0, X1, 0, D.height, X0, z);
  cut.add(leaf);
  const closed = { position: closedPosition.clone(), quaternion: new THREE.Quaternion() };
  Object.freeze(closed.position);
  Object.freeze(closed.quaternion);

  // ---- Colliders: the wall either side of the door and over it, and the doorway ------------------------
  colliders.push(
    { minX: fromX, maxX: X0, minZ: z, maxZ: z + WALL_T, top: 99 },
    { minX: X1, maxX: toX + WALL_T, minZ: z, maxZ: z + WALL_T, top: 99 },
    { minX: X0, maxX: X1, minZ: z, maxZ: Q.minZ, bottom: D.height, top: 99 },
  );
  const doorway: Collider = { minX: X0, maxX: X1, minZ: z, maxZ: Q.minZ, top: 99 };
  colliders.push(doorway);

  // ---- The room ---------------------------------------------------------------------------------------
  const W = Q.maxX - Q.minX;
  const Dp = Q.maxZ - Q.minZ;
  const cx = (Q.minX + Q.maxX) / 2;
  const cz = (Q.minZ + Q.maxZ) / 2;
  const carpet = kit.carpet.clone();
  // The floor runs on under the doorway, to the hall's.
  carpet.repeat.set(W / 1.6, (Q.maxZ - z) / 1.6);
  carpet.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Q.maxZ - z).rotateX(-Math.PI / 2), roomLit('#ffffff', carpet));
  floor.position.set(cx, 0.002, (z + Q.maxZ) / 2);
  group.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp).rotateX(Math.PI / 2), roomLit('#2a1c24'));
  ceiling.position.set(cx, Q.height, cz);
  group.add(ceiling);
  // The other three walls, each a millimeter in front of the dark box behind it.
  const walls: [number, number, number, number][] = [
    // its middle x, z, length, turn
    [Q.minX + 0.001, cz, Dp, Math.PI / 2],
    [Q.maxX - 0.001, cz, Dp, -Math.PI / 2],
    [cx, Q.maxZ - 0.001, W, Math.PI],
  ];
  for (const [x, wz, len, turn] of walls) {
    const m = new THREE.Mesh(roomWallGeometry(-len / 2, len / 2, 0, Q.height), roomWallMat);
    m.position.set(x, 0, wz);
    m.rotation.y = turn;
    group.add(m);
  }
  const T = 0.3;
  const shell = new THREE.Group();
  shell.add(mesh(new THREE.BoxGeometry(T, Q.height + 0.2, Dp + T), kit.back, Q.minX - T / 2, (Q.height + 0.2) / 2, cz + T / 2, false));
  shell.add(mesh(new THREE.BoxGeometry(T, Q.height + 0.2, Dp + T), kit.back, Q.maxX + T / 2, (Q.height + 0.2) / 2, cz + T / 2, false));
  shell.add(mesh(new THREE.BoxGeometry(W, Q.height + 0.2, T), kit.back, cx, (Q.height + 0.2) / 2, Q.maxZ + T / 2, false));
  shell.add(mesh(new THREE.BoxGeometry(W, 0.2, Dp), kit.back, cx, Q.height + 0.101, cz, false));
  group.add(shell);
  colliders.push(
    { minX: Q.minX, maxX: Q.maxX, minZ: z, maxZ: Q.maxZ, bottom: -0.3, top: 0 },
    { minX: Q.minX - T, maxX: Q.minX, minZ: z + WALL_T, maxZ: Q.maxZ + T, top: 99 },
    { minX: Q.maxX, maxX: Q.maxX + T, minZ: z + WALL_T, maxZ: Q.maxZ + T, top: 99 },
    { minX: Q.minX, maxX: Q.maxX, minZ: Q.maxZ, maxZ: Q.maxZ + T, top: 99 },
    // The room's lining either side of the doorway (over it, the hall's wall's collider goes back to the room).
    { minX: Q.minX, maxX: X0, minZ: z + WALL_T, maxZ: Q.minZ, top: 99 },
    { minX: X1, maxX: Q.maxX, minZ: z + WALL_T, maxZ: Q.minZ, top: 99 },
    { minX: Q.minX, maxX: Q.maxX, minZ: Q.minZ, maxZ: Q.maxZ, bottom: Q.height, top: 99 },
  );

  // ---- The lamp: a cord from the ceiling, a brass shade, a warm bulb under it ------------------------------------------
  const lampGroup = new THREE.Group();
  const L = SECRET_LAMP;
  const cord = Q.height - (L.y + 0.16);
  lampGroup.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, cord, 6), toon('#111111'), L.x, Q.height - cord / 2, L.z, false));
  lampGroup.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), kit.brass, L.x, Q.height - 0.015, L.z, false));
  lampGroup.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), kit.brass, L.x, L.y + 0.14, L.z, false));
  // The shade, lit by the room's lamp like the room (a light in there would only glare on it), warm inside.
  const shadeMat = roomLit('#9a7434');
  lampGroup.add(mesh(new THREE.CylinderGeometry(0.06, 0.24, 0.2, 24, 1, true), shadeMat, L.x, L.y + 0.04, L.z, false));
  const inside = new THREE.MeshBasicMaterial({ color: '#ffe3a8', side: THREE.BackSide });
  inside.toneMapped = false;
  lampGroup.add(mesh(new THREE.CylinderGeometry(0.055, 0.235, 0.19, 24, 1, true), inside, L.x, L.y + 0.04, L.z, false));
  const bulb = new THREE.MeshBasicMaterial({ color: '#fff7e6' });
  bulb.toneMapped = false;
  lampGroup.add(mesh(new THREE.SphereGeometry(0.055, 14, 10), bulb, L.x, L.y, L.z, false));
  group.add(lampGroup);
  const lamp = new THREE.PointLight('#ffd9a0', 2.4, SECRET_LAMP_REACH, 1.4);
  lamp.position.copy(L);
  group.add(lamp);

  // ---- The motion ---------------------------------------------------------------------------------------
  const motion = new DoorMotion();
  let state: SecretDoorState = { open: false, side: 1 };
  let solid = true;
  const setSolid = (on: boolean) => {
    if (on === solid) return;
    solid = on;
    const i = colliders.indexOf(doorway);
    if (on && i < 0) colliders.push(doorway);
    if (!on && i >= 0) colliders.splice(i, 1);
  };
  /** Puts the leaf where the motion has it: pressed in along `side`, turned about the pivot on the side it swings to. */
  const place = () => {
    if (motion.locked) {
      // Shut: exactly where it was built, and the wall in one piece again.
      leaf.position.copy(closed.position);
      leaf.quaternion.copy(closed.quaternion);
      pivot.position.set(0, 0, 0);
      pivot.quaternion.identity();
      whole.visible = true;
      cut.visible = false;
      return;
    }
    whole.visible = false;
    cut.visible = true;
    const s = motion.side;
    // The pivot: the corner of the wall's face on the side it swings to (the room's face, or the hall's rail).
    const pz = s === 1 ? Q.minZ - z : -0.1;
    leaf.position.set(X0, 0, z + s * motion.depth + pz);
    leaf.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -s * motion.angle);
    pivot.position.set(0, 0, -pz);
  };

  return {
    group,
    leaf,
    closed,
    whole,
    cut,
    doorway,
    motion,
    lamp,
    set(next, snap = false) {
      state = { open: next.open, side: next.side };
      if (snap) {
        motion.snap(state);
        place();
        setSolid(!motion.passable);
      }
    },
    update(dt, you) {
      motion.update(dt, state);
      place();
      // Solid unless it's open enough to walk through, but never shut on whoever's in the doorway.
      const block = !motion.passable;
      if (block && you && you.x > X0 - 0.35 && you.x < X1 + 0.35 && you.z > z - 0.35 && you.z < Q.minZ + 0.35) return;
      setSolid(block);
    },
  };
}
