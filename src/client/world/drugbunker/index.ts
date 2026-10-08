// The bunker under the casino (see shared/bunker/index.ts): a bare concrete room under a low ceiling,
// pipes along it, fluorescent tubes (one of them never quite sure), damp creeping up the walls and a
// puddle in the corner, a heavy steel door that doesn't open, and the ladder up through the hatch in
// the ceiling to the casino's secret room. Each station's spot is marked out on the floor with hazard
// tape and stenciled; what stands there is the station's own (world/drugbunker/<feature>.ts), built
// here. The stash shelf is the room's own.
//
// Not to be confused with world/bunker/, the office floor's other look.
import * as THREE from 'three';
import { BUNKER_DOOR, BUNKER_FEATURES, BUNKER_LADDER, BUNKER_ROOM, BUNKER_STATIONS, BUNKER_STATION_IDS, STATION_REACH, ladderBox, stationBox, stationFront, stationToWorld, type BunkerFeature, type BunkerPerson, type BunkerStationId, type StationSpot } from '../../../shared/bunker/index';
import type { Collider, Interactable } from '../office';
import { mergeByMaterial, mesh, textPlane, toon } from '../toon';
import { buildCartel } from './cartel';
import { buildCustomers } from './customers';
import { buildGrow } from './grow';
import { buildLab } from './lab';
import { buildLadder } from './ladder';
import { buildPack } from './pack';
import { buildPc } from './pc';
import type { StationBuilder, StationView } from './station';

export type { StationView, StationBuilder } from './station';

/** Each feature's station, built at its spot. */
export const STATION_BUILDERS: Readonly<Record<BunkerFeature, StationBuilder>> = { grow: buildGrow, lab: buildLab, pack: buildPack, pc: buildPc, customers: buildCustomers, cartel: buildCartel };

const R = BUNKER_ROOM;
const H = R.height;
/** How thick the walls are drawn (and kept out of). */
const WALL = 0.3;

export interface DrugBunker {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** What looking or clicking can land on. */
  pickables: THREE.Object3D[];
  /** Each feature's station. */
  stations: Record<BunkerFeature, StationView>;
  /** The ladder up (E at it). */
  ladder: Interactable;
  /** The fluorescent tube that flickers. */
  flicker: THREE.MeshBasicMaterial;
  /** Every frame while you're down there: the tube, and each station's own. */
  update(t: number, dt: number, mine: BunkerPerson | null): void;
}

/** What `label` (a station's mark) says on the floor: done by the caller, in your language. */
export type MarkLabel = (station: BunkerStationId) => string;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A toon material with a texture, not outlined (it's a big flat face). */
function toonMap(map: THREE.Texture): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** A light that isn't lit: the tubes' glow, the hole in the ceiling. */
function glow(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color });
  m.toneMapped = false;
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** A little noise, the same every time (the room looks the same on every page). */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.04 + rnd() * 0.06})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
  }
}

/** The floor: poured concrete, a joint every two meters, a few dark stains. One tile is 2 × 2 m. */
function floorTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#80827d';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 2400, 7);
    const stain = g.createRadialGradient(170, 90, 4, 170, 90, 60);
    stain.addColorStop(0, 'rgba(40, 44, 40, 0.1)');
    stain.addColorStop(1, 'rgba(40, 44, 40, 0)');
    g.fillStyle = stain;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(30, 30, 30, 0.25)';
    g.fillRect(0, 0, 256, 2);
    g.fillRect(0, 0, 2, 256);
  });
}

/** The walls: cinder blocks, painted once a long time ago, with the damp rising up from the floor. One tile is 1.6 m wide and the room's height. */
function wallTexture(): THREE.CanvasTexture {
  const W = 256;
  const Hpx = Math.round((W * H) / 1.6);
  return canvasTexture(W, Hpx, (g) => {
    g.fillStyle = '#a3a59d';
    g.fillRect(0, 0, W, Hpx);
    speckle(g, W, Hpx, 2600, 11);
    // Blocks 0.4 × 0.2 m, every other course half a block over.
    const bw = W / 4;
    const bh = Hpx / (H / 0.2);
    g.strokeStyle = 'rgba(60, 62, 58, 0.35)';
    g.lineWidth = 2;
    for (let row = 0, y = Hpx; y > 0; row++, y -= bh) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
      for (let x = row % 2 ? bw / 2 : 0; x < W; x += bw) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y - bh);
        g.stroke();
      }
    }
    // The damp, darkest at the floor, and a tide mark where it stops.
    const damp = g.createLinearGradient(0, Hpx, 0, Hpx * 0.68);
    damp.addColorStop(0, 'rgba(52, 62, 48, 0.55)');
    damp.addColorStop(0.75, 'rgba(70, 78, 60, 0.2)');
    damp.addColorStop(1, 'rgba(70, 78, 60, 0)');
    g.fillStyle = damp;
    g.fillRect(0, Hpx * 0.68, W, Hpx * 0.32);
    // A streak or two down from the ceiling.
    g.fillStyle = 'rgba(70, 64, 48, 0.18)';
    g.fillRect(W * 0.62, 0, 6, Hpx * 0.45);
    g.fillRect(W * 0.66, 0, 3, Hpx * 0.3);
  });
}

/** Yellow and black, on the diagonal: the tape the spots are marked out with. */
function tapeTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(64, 16, (g) => {
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#1d1d1b';
    for (let x = -16; x < 64; x += 16) {
      g.beginPath();
      g.moveTo(x, 16);
      g.lineTo(x + 8, 16);
      g.lineTo(x + 16, 0);
      g.lineTo(x + 8, 0);
      g.fill();
    }
  });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Builds the bunker. `mark` says what's stenciled at each station's spot (its name, in your
 * language); `builders` are the stations' own (the tests swap in theirs).
 */
export function buildDrugBunker(mark: MarkLabel = (s) => s.toUpperCase(), builders: Readonly<Record<BunkerFeature, StationBuilder>> = STATION_BUILDERS): DrugBunker {
  const group = new THREE.Group();
  group.name = 'drug-bunker';
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const statics = new THREE.Group();
  const w = R.maxX - R.minX;
  const d = R.maxZ - R.minZ;
  const cx = (R.minX + R.maxX) / 2;
  const cz = (R.minZ + R.maxZ) / 2;
  const steel = toon('#6f767c');
  const darkSteel = toon('#3a3f44');
  const rust = toon('#7a4a2c');

  // ---- The room: floor, walls, ceiling -----------------------------------------------------------------
  const floorTex = floorTexture();
  floorTex.repeat.set(w / 2, d / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), toonMap(floorTex));
  floor.position.set(cx, 0.002, cz);
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push({ minX: R.minX, maxX: R.maxX, minZ: R.minZ, maxZ: R.maxZ, bottom: -0.3, top: 0 });

  const paint = wallTexture();
  const walls: [number, number, number, number][] = [
    // its middle x, z, length, turn (so it faces into the room)
    [cx, R.minZ, w, 0],
    [cx, R.maxZ, w, Math.PI],
    [R.minX, cz, d, Math.PI / 2],
    [R.maxX, cz, d, -Math.PI / 2],
  ];
  for (const [x, z, len, turn] of walls) {
    const p = paint.clone();
    p.repeat.set(len / 1.6, 1);
    p.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), toonMap(p));
    m.position.set(x, H / 2, z);
    m.rotation.y = turn;
    group.add(m);
  }
  // The concrete behind them, so nothing shows through from outside, and what keeps you in.
  const back = toon('#2b2d2a');
  statics.add(mesh(new THREE.BoxGeometry(w + WALL * 2, H + 0.4, WALL), back, cx, H / 2, R.minZ - WALL / 2 - 0.001, false));
  statics.add(mesh(new THREE.BoxGeometry(w + WALL * 2, H + 0.4, WALL), back, cx, H / 2, R.maxZ + WALL / 2 + 0.001, false));
  statics.add(mesh(new THREE.BoxGeometry(WALL, H + 0.4, d), back, R.minX - WALL / 2 - 0.001, H / 2, cz, false));
  statics.add(mesh(new THREE.BoxGeometry(WALL, H + 0.4, d), back, R.maxX + WALL / 2 + 0.001, H / 2, cz, false));
  colliders.push(
    { minX: R.minX - WALL, maxX: R.maxX + WALL, minZ: R.minZ - WALL, maxZ: R.minZ, top: 99 },
    { minX: R.minX - WALL, maxX: R.maxX + WALL, minZ: R.maxZ, maxZ: R.maxZ + WALL, top: 99 },
    { minX: R.minX - WALL, maxX: R.minX, minZ: R.minZ, maxZ: R.maxZ, top: 99 },
    { minX: R.maxX, maxX: R.maxX + WALL, minZ: R.minZ, maxZ: R.maxZ, top: 99 },
    { minX: R.minX, maxX: R.maxX, minZ: R.minZ, maxZ: R.maxZ, bottom: H, top: 99 },
  );
  // A bare concrete ceiling, a slab over the lot.
  const ceilTex = floorTexture();
  ceilTex.repeat.set(w / 2, d / 2);
  const ceilMat = toonMap(ceilTex);
  ceilMat.color.set('#9a9c96');
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2), ceilMat);
  ceiling.position.set(cx, H, cz);
  group.add(ceiling);
  statics.add(mesh(new THREE.BoxGeometry(w + WALL * 2, 0.3, d + WALL * 2), back, cx, H + 0.151, cz, false));
  // A skirting of dark wet along the bottom of the walls.
  const wet = toon('#4b5345');
  statics.add(mesh(new THREE.BoxGeometry(w, 0.06, 0.02), wet, cx, 0.03, R.minZ + 0.01, false));
  statics.add(mesh(new THREE.BoxGeometry(w, 0.06, 0.02), wet, cx, 0.03, R.maxZ - 0.01, false));
  statics.add(mesh(new THREE.BoxGeometry(0.02, 0.06, d), wet, R.minX + 0.01, 0.03, cz, false));
  statics.add(mesh(new THREE.BoxGeometry(0.02, 0.06, d), wet, R.maxX - 0.01, 0.03, cz, false));
  // And a puddle in the south-west corner, where it drips.
  const puddleMat = new THREE.MeshBasicMaterial({ color: '#3d4a52', transparent: true, opacity: 0.55, depthWrite: false });
  puddleMat.userData.outlineParameters = { visible: false };
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24).rotateX(-Math.PI / 2), puddleMat);
  puddle.scale.set(1.4, 1, 0.8);
  puddle.position.set(R.minX + 1.4, 0.004, R.maxZ - 0.7);
  group.add(puddle);

  // ---- Pipes along the ceiling, on brackets ----------------------------------------------------------
  const pipe = (x0: number, x1: number, y: number, z: number, r: number, mat: THREE.Material) => {
    const p = mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 12), mat, (x0 + x1) / 2, y, z, false);
    p.rotation.z = Math.PI / 2;
    statics.add(p);
    for (let x = x0 + 0.6; x < x1; x += 2.4) statics.add(mesh(new THREE.BoxGeometry(0.04, H - y, r * 2 + 0.06), darkSteel, x, (H + y) / 2, z, false));
  };
  pipe(R.minX, R.maxX, H - 0.18, R.minZ + 0.25, 0.07, steel);
  pipe(R.minX, R.maxX, H - 0.32, R.minZ + 0.45, 0.045, rust);
  pipe(R.minX, R.maxX, H - 0.16, R.maxZ - 0.3, 0.055, steel);
  // One across the room, from wall to wall.
  {
    const p = mesh(new THREE.CylinderGeometry(0.06, 0.06, d, 12), darkSteel, -2.6, H - 0.14, cz, false);
    p.rotation.x = Math.PI / 2;
    statics.add(p);
  }

  // ---- Fluorescent tubes, in two rows ----------------------------------------------------------------
  const tube = glow('#eef6ff');
  const flicker = glow('#eef6ff');
  const housing = toon('#c9ccc6');
  const tubes: [number, number][] = [];
  for (const x of [-4.2, 0, 4.2]) for (const z of [-1.6, 2.4]) tubes.push([x, z]);
  tubes.forEach(([x, z], i) => {
    statics.add(mesh(new THREE.BoxGeometry(1.3, 0.06, 0.2), housing, x, H - 0.05, z, false));
    const t = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), i === 3 ? flicker : tube, x, H - 0.1, z, false);
    t.rotation.z = Math.PI / 2;
    group.add(t);
  });

  // ---- The steel door in the east wall that never opens ----------------------------------------------
  {
    const D = BUNKER_DOOR;
    const x = R.maxX - 0.03;
    statics.add(mesh(new THREE.BoxGeometry(0.06, D.height + 0.12, D.width + 0.16), darkSteel, x, (D.height + 0.12) / 2, D.z, false));
    statics.add(mesh(new THREE.BoxGeometry(0.08, D.height, D.width), toon('#58626a'), x - 0.03, D.height / 2, D.z, false));
    // Rivets down its edges, a wheel to open it with (it doesn't), and the slot the customers come to.
    for (const side of [-1, 1]) for (let y = 0.2; y < D.height; y += 0.38) statics.add(mesh(new THREE.SphereGeometry(0.018, 6, 4), steel, x - 0.075, y, D.z + side * (D.width / 2 - 0.07), false));
    const wheel = mesh(new THREE.TorusGeometry(0.17, 0.022, 6, 18), steel, x - 0.1, 1.05, D.z + 0.22, false);
    wheel.rotation.y = Math.PI / 2;
    statics.add(wheel);
    statics.add(mesh(new THREE.BoxGeometry(0.02, 0.06, 0.34), toon('#121416'), x - 0.075, 1.45, D.z - 0.12, false));
  }

  // ---- The ladder up, and the hatch in the ceiling over it -------------------------------------------
  const L = BUNKER_LADDER;
  const ladderZ = R.minZ + L.depth / 2 + 0.05;
  const ladder = buildLadder(0, H + 0.5, L.width, steel, darkSteel);
  ladder.position.set(L.x, 0, ladderZ);
  statics.add(ladder);
  // Bolted to the wall at the top and bottom.
  for (const y of [0.4, H - 0.3]) for (const side of [-1, 1]) statics.add(mesh(new THREE.BoxGeometry(0.04, 0.04, L.depth), darkSteel, L.x + (side * L.width) / 2, y, R.minZ + L.depth / 2, false));
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(L.hatch, L.hatch).rotateX(Math.PI / 2), glow('#050506'));
  hole.position.set(L.x, H - 0.003, R.minZ + L.hatch / 2 + 0.02);
  group.add(hole);
  statics.add(mesh(new THREE.BoxGeometry(L.hatch + 0.1, 0.04, L.hatch + 0.1), darkSteel, L.x, H - 0.02, R.minZ + L.hatch / 2 + 0.02, false).translateY(-0.001));
  const lb = ladderBox();
  colliders.push({ ...lb, top: 99, fence: true });
  const ladderIt: Interactable = { kind: 'hatch', x: L.x, z: R.minZ + L.depth, radius: L.reach };
  interactables.push(ladderIt);
  pickBox(group, ladderIt, L.x, 1.2, ladderZ + 0.05, L.width + 0.3, 2.4, L.depth + 0.3);

  // ---- The stations: each spot marked out on the floor, and what stands there ------------------------------
  const tape = toonMap(tapeTexture());
  for (const id of BUNKER_STATION_IDS) {
    const spot = BUNKER_STATIONS[id];
    markSpot(group, spot, tape, mark(id));
    const front = stationFront(spot);
    const it: Interactable = { kind: 'bunker', station: id, x: front.x, z: front.z, radius: STATION_REACH };
    interactables.push(it);
    const box = stationBox(spot);
    pickBox(group, it, (box.minX + box.maxX) / 2, spot.h / 2, (box.minZ + box.maxZ) / 2, box.maxX - box.minX + 0.1, spot.h, box.maxZ - box.minZ + 0.1);
  }
  const stations = {} as Record<BunkerFeature, StationView>;
  for (const f of BUNKER_FEATURES) {
    const view = builders[f](BUNKER_STATIONS[f]);
    stations[f] = view;
    group.add(view.group);
    if (view.colliders) colliders.push(...view.colliders);
  }
  // The stash shelf is the room's own: steel shelving with a few boxes on it.
  const stash = buildStashShelf(BUNKER_STATIONS.stash, steel, darkSteel);
  statics.add(stash);
  colliders.push({ ...stationBox(BUNKER_STATIONS.stash), top: 99 });

  group.add(mergeByMaterial(statics));

  let next = 0;
  let on = true;
  return {
    group,
    colliders,
    interactables,
    pickables: group.children,
    stations,
    ladder: ladderIt,
    flicker,
    update(t, dt, mine) {
      // Now and then it stutters off and on again.
      if (t >= next) {
        on = !on;
        next = t + (on ? 2 + ((t * 7.3) % 5) : 0.05 + ((t * 3.1) % 0.12));
        flicker.color.set(on ? '#eef6ff' : '#4a4f55');
      }
      for (const f of BUNKER_FEATURES) stations[f].update?.(t, dt, mine);
    },
  };
}

/** A box round something that's never drawn, for the crosshair to find it by (E at it). */
function pickBox(group: THREE.Group, it: Interactable, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ visible: false }));
  box.position.set(x, y, z);
  box.userData.interact = it;
  group.add(box);
}

/** Hazard tape round a station's spot, and its name stenciled on the floor in front of it. */
function markSpot(group: THREE.Group, spot: StationSpot, tape: THREE.Material, label: string) {
  const g = new THREE.Group();
  g.position.set(spot.x, 0.006, spot.z);
  g.rotation.y = spot.rotY;
  const pad = 0.12;
  const W = spot.w + pad * 2;
  const D = spot.d + pad * 2;
  const band = 0.07;
  const strip = (len: number, x: number, z: number, along: boolean) => {
    const geo = new THREE.PlaneGeometry(len, band).rotateX(-Math.PI / 2);
    if (!along) geo.rotateY(Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 0.28));
    const m = new THREE.Mesh(geo, tape);
    m.position.set(x, 0, z);
    g.add(m);
  };
  strip(W, 0, D / 2 - band / 2, true);
  strip(D, -W / 2 + band / 2, 0, false);
  strip(D, W / 2 - band / 2, 0, false);
  // (Against a wall, there's no tape along the wall.)
  const back = stationToWorld(spot, { x: 0, z: -spot.d / 2 });
  const againstWall = back.x < R.minX + 0.05 || back.x > R.maxX - 0.05 || back.z < R.minZ + 0.05 || back.z > R.maxZ - 0.05;
  if (!againstWall) strip(W, 0, -D / 2 + band / 2, true);
  // The stencil, in front of the tape, reading from where you stand.
  const text = textPlane(label, { color: '#e8b923', size: 64 });
  text.material.opacity = 0.8;
  text.material.transparent = true;
  text.material.userData.outlineParameters = { visible: false };
  const s = Math.min(0.36 / text.geometry.parameters.height, (spot.w * 0.8) / Math.max(0.01, text.geometry.parameters.width));
  text.scale.setScalar(s);
  text.rotation.x = -Math.PI / 2;
  text.position.set(0, 0.001, D / 2 + 0.28);
  g.add(text);
  group.add(g);
}

/** The stash shelf: steel uprights, four shelves, cardboard boxes and a crate or two. Built in the spot's frame and placed. */
function buildStashShelf(spot: StationSpot, steel: THREE.Material, dark: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const w = spot.w - 0.1;
  const d = spot.d - 0.15;
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) g.add(mesh(new THREE.BoxGeometry(0.04, spot.h, 0.04), dark, x, spot.h / 2, z, false));
  for (const y of [0.12, 0.62, 1.12, 1.62]) g.add(mesh(new THREE.BoxGeometry(w, 0.03, d), steel, 0, y, 0, false));
  const card = toon('#b98a52');
  const crate = toon('#8a6a3f');
  const boxes: [number, number, number, number, number, THREE.Material][] = [
    // x, shelf y, width, height, depth
    [-0.7, 0.135, 0.45, 0.32, 0.4, card],
    [-0.2, 0.135, 0.35, 0.25, 0.35, card],
    [0.6, 0.135, 0.6, 0.4, 0.45, crate],
    [-0.55, 0.635, 0.5, 0.3, 0.38, card],
    [0.35, 0.635, 0.4, 0.22, 0.3, card],
    [0.1, 1.135, 0.7, 0.3, 0.42, crate],
    [-0.8, 1.635, 0.32, 0.22, 0.3, card],
  ];
  for (const [x, y, bw, bh, bd, mat] of boxes) g.add(mesh(new THREE.BoxGeometry(bw, bh, bd), mat, x, y + bh / 2, 0, false));
  g.position.set(spot.x, 0, spot.z);
  g.rotation.y = spot.rotY;
  return g;
}
