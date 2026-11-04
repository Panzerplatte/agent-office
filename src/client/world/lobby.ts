import * as THREE from 'three';
import { STOREY, STREET_Y, streetBelow } from '../../shared/layout';
import { LOBBY, LOBBY_CAR, LOBBY_DIRECTORY, LOBBY_DOOR, LOBBY_ELEVATOR, LOBBY_HEIGHT, LOBBY_NAME, LOBBY_PLANTS, LOBBY_SOFA, LOBBY_TABLE, LOBBY_WALL, RECEPTION, lobbyBlocks, type DirectoryLine } from '../../shared/lobby';
import type { Elevator } from './elevator';
import type { Collider, Interactable } from './office';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon } from './toon';

// The lobby at street level (see shared/lobby.ts): a glass front with a sliding door onto the lot,
// a stone floor, a reception desk, a sofa, plants, the building's name on the wall, the floor
// directory, and the elevator back up. Built at the street as seen from the bottom floor; setLevel
// moves it down with the street on a floor higher up.

const G = STREET_Y;
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

const GLASS = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
const SHINE = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });

export interface Lobby {
  /** Everything of it, at the street. Goes in the office's group. */
  group: THREE.Group;
  /** Its walls, doors and furniture: add them to the office's. */
  colliders: Collider[];
  /** The elevator, to press E at. */
  interactables: Interactable[];
  /** The lobby's elevator, doors and all: the same handles as the office's. */
  elevator: Elevator;
  /** On floor `index` of the building (0 the bottom one): the street, and the lobby with it, is that many storeys further down. */
  setLevel(index: number): void;
  /** What the directory on the wall lists. */
  setDirectory(lines: DirectoryLine[]): void;
  /** The front door opens for whoever comes up to it (people's feet, in the office's frame). */
  update(dt: number, people: Iterable<{ x: number; y: number; z: number }>): void;
}

/** Big pale stone tiles with thin grout lines, and a darker border round the room. */
function stoneTexture(w: number, d: number): THREE.CanvasTexture {
  const px = 48;
  const c = document.createElement('canvas');
  c.width = Math.round(w * px);
  c.height = Math.round(d * px);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece6da';
  g.fillRect(0, 0, c.width, c.height);
  const tile = 1.2 * px;
  for (let y = 0; y < c.height; y += tile) {
    for (let x = 0; x < c.width; x += tile) {
      g.fillStyle = (Math.round(x / tile) + Math.round(y / tile)) % 2 ? '#e4ddcf' : '#f2ede3';
      g.fillRect(x + 1, y + 1, tile - 2, tile - 2);
    }
  }
  g.strokeStyle = '#a99f8c';
  g.lineWidth = 0.35 * px;
  g.strokeRect(0.2 * px, 0.2 * px, c.width - 0.4 * px, c.height - 0.4 * px);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function plant(scale: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.55, 12), toon('#2b2d42'), 0, 0.275, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 12), toon('#e9b949'), 0, 0.53, 0, false));
  g.add(mesh(new THREE.SphereGeometry(0.42, 12, 10), toon('#5fb760'), 0, 0.95, 0));
  g.add(mesh(new THREE.SphereGeometry(0.3, 12, 10), toon('#3f8f45'), 0.2, 1.22, 0.1));
  g.add(mesh(new THREE.SphereGeometry(0.27, 12, 10), toon('#6fcf6a'), -0.18, 1.28, -0.08));
  g.scale.setScalar(scale);
  return g;
}

/** Draws the directory: a dark board with a line per level, top to bottom. */
function drawDirectory(c: HTMLCanvasElement, lines: DirectoryLine[], title: string) {
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  g.fillStyle = '#2b2d42';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e9b949';
  g.lineWidth = 8;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = '#e9b949';
  g.font = '800 44px Nunito, ui-rounded, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(title, W / 2, 56);
  g.fillRect(40, 92, W - 80, 3);
  const top = 112;
  const row = Math.min(58, (H - top - 24) / Math.max(1, lines.length));
  const size = Math.round(row * 0.55);
  lines.forEach((l, i) => {
    const y = top + row * (i + 0.5);
    g.fillStyle = l.kind === 'lobby' ? '#ffd166' : l.kind === 'floor' ? '#8ecae6' : '#f4acb7';
    g.beginPath();
    g.roundRect(36, y - row * 0.4, row * 1.3, row * 0.8, row * 0.2);
    g.fill();
    g.fillStyle = '#2b2d42';
    g.font = `800 ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText(l.level, 36 + row * 0.65, y + 2);
    g.fillStyle = l.kind === 'lobby' ? '#ffd166' : '#fffaf3';
    g.textAlign = 'left';
    let name = l.name;
    const room = W - 70 - (36 + row * 1.5);
    while (name.length > 3 && g.measureText(name).width > room) name = `${name.slice(0, -2)}…`;
    g.fillText(name, 36 + row * 1.6, y + 2);
  });
}

export function buildLobby(names: { sign: string; directory: string; building: string }): Lobby {
  const group = new THREE.Group();
  group.name = 'lobby';
  const parts = new THREE.Group();
  const L = LOBBY;
  const w = LOBBY_WALL;
  const H = LOBBY_HEIGHT;
  const E = LOBBY_ELEVATOR;
  const D = LOBBY_DOOR;
  const cx = (L.minX + L.maxX) / 2;
  const cz = (L.minZ + L.maxZ) / 2;

  // The floor: stone, a little over the garage's concrete.
  const floorW = L.maxX - L.minX - 2 * w;
  const floorD = L.maxZ - L.minZ - 2 * w;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), new THREE.MeshToonMaterial({ map: stoneTexture(floorW, floorD), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, G + 0.012, cz);
  floor.receiveShadow = true;
  group.add(floor);
  // A doormat inside the door.
  parts.add(mesh(box(D.width + 0.2, 0.012, 0.9), toon('#7a4e2d'), D.x, G + 0.02, L.maxZ - w - 0.55, false));

  // The walls: warm plaster inside, the garage's concrete outside, a wood skirting along the bottom.
  const plaster = toon('#f3e7cf');
  const concrete = toon('#d3d6dd');
  const skirting = toon('#8a5a3b');
  const wall = (x0: number, x1: number, z0: number, z1: number, inside: number) => {
    // A box's faces go +x, -x, +y, -y, +z, -z.
    const mats = Array.from({ length: 6 }, (_, i) => (i === inside ? plaster : concrete));
    const m = new THREE.Mesh(box(x1 - x0, H, z1 - z0), mats);
    m.position.set((x0 + x1) / 2, G + H / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  wall(L.minX, L.minX + w, L.minZ, L.maxZ, 0);
  wall(L.maxX - w, L.maxX, L.minZ, L.maxZ, 1);
  wall(L.minX, L.maxX, L.minZ, L.minZ + w, 4);
  parts.add(mesh(box(0.03, 0.14, floorD), skirting, L.minX + w + 0.015, G + 0.07, cz, false));
  parts.add(mesh(box(0.03, 0.14, floorD), skirting, L.maxX - w - 0.015, G + 0.07, cz, false));

  // The glass front: a dark frame, glass from the floor to a transom, the door's opening in it.
  const frame = toon('#3d405b');
  const frontZ = L.maxZ - w / 2;
  const transom = D.height + 0.12;
  parts.add(mesh(box(L.maxX - L.minX, 0.1, w), frame, cx, G + 0.05, frontZ));
  parts.add(mesh(box(L.maxX - L.minX, 0.12, w), frame, cx, G + transom, frontZ));
  parts.add(mesh(box(L.maxX - L.minX, 0.1, w), frame, cx, G + H - 0.05, frontZ));
  const glassRun = (x0: number, x1: number, y0: number, y1: number) => {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), GLASS);
    pane.position.set((x0 + x1) / 2, G + (y0 + y1) / 2, frontZ);
    group.add(pane);
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.12, (y1 - y0) * 0.6), SHINE);
    glint.position.set(x0 + (x1 - x0) * 0.3, G + (y0 + y1) / 2, frontZ + 0.01);
    glint.rotation.z = -0.4;
    group.add(glint);
  };
  const doorL = D.x - D.width / 2;
  const doorR = D.x + D.width / 2;
  const mullions = [L.minX + w, doorL - 0.04, doorR + 0.04, L.maxX - w];
  for (const x of mullions) parts.add(mesh(box(0.08, H, w + 0.02), frame, x, G + H / 2, frontZ));
  glassRun(L.minX + w, doorL - 0.08, 0.1, transom - 0.06);
  glassRun(doorR + 0.08, L.maxX - w, 0.1, transom - 0.06);
  glassRun(L.minX + w, L.maxX - w, transom + 0.06, H - 0.1);

  // The door: two glass panels in thin frames that slide apart along the front.
  const half = D.width / 2;
  const panels = [-1, 1].map((side) => {
    const p = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(half - 0.04, D.height - 0.06), GLASS);
    p.add(pane);
    for (const sx of [-1, 1]) p.add(mesh(box(0.04, D.height, 0.05), frame, (sx * half) / 2, 0, 0, false));
    p.add(mesh(box(half, 0.05, 0.05), frame, 0, D.height / 2 - 0.02, 0, false));
    p.add(mesh(box(half, 0.08, 0.05), frame, 0, -D.height / 2 + 0.04, 0, false));
    // A push bar across it.
    p.add(mesh(box(half * 0.7, 0.04, 0.07), toon('#c7ced8'), 0, -0.15, 0, false));
    p.position.set(D.x + (side * half) / 2, G + D.height / 2, frontZ + 0.08);
    group.add(p);
    return { group: p, side };
  });
  // Over the door outside: the lobby's sign.
  const sign = textPlane(names.sign, { bg: '#2b2d42', color: '#ffd166', size: 64, border: '#ffd166' });
  sign.scale.multiplyScalar(1.1);
  sign.position.set(D.x, G + (transom + H) / 2, L.maxZ + 0.02);
  group.add(sign);
  // And a canopy over it, out over the lot.
  parts.add(mesh(box(D.width + 1.2, 0.08, 1.1), frame, D.x, G + H - 0.25, L.maxZ + 0.55));

  // Ceiling lights: warm panels, lit day and night.
  const light = toon('#fffaf0', { emissive: '#ffe9b8' });
  for (const z of [4.5, 8.2, 11.6]) parts.add(mesh(box(1.8, 0.05, 0.5), light, cx, G + H - 0.03, z, false));

  // The reception desk: a wood front with a stone top, a bell and a little screen on it.
  const R = RECEPTION;
  const wood = toon('#b07a4f');
  const stone = toon('#f7f3ea');
  parts.add(mesh(box(R.maxX - R.minX, R.height - 0.05, R.maxZ - R.minZ), wood, (R.minX + R.maxX) / 2, G + (R.height - 0.05) / 2, (R.minZ + R.maxZ) / 2));
  parts.add(mesh(box(R.maxX - R.minX + 0.12, 0.05, R.maxZ - R.minZ + 0.12), stone, (R.minX + R.maxX) / 2, G + R.height - 0.025, (R.minZ + R.maxZ) / 2));
  const ret = { minX: R.minX, maxX: L.maxX - w, minZ: R.maxZ - 0.5, maxZ: R.maxZ };
  parts.add(mesh(box(ret.maxX - ret.minX, R.height - 0.05, ret.maxZ - ret.minZ), wood, (ret.minX + ret.maxX) / 2, G + (R.height - 0.05) / 2, (ret.minZ + ret.maxZ) / 2));
  parts.add(mesh(box(ret.maxX - ret.minX, 0.05, ret.maxZ - ret.minZ + 0.06), stone, (ret.minX + ret.maxX) / 2, G + R.height - 0.025, (ret.minZ + ret.maxZ) / 2));
  parts.add(mesh(box(0.04, 0.5, R.maxZ - R.minZ - 0.3), toon('#e9b949'), R.minX - 0.01, G + 0.55, (R.minZ + R.maxZ) / 2, false));
  parts.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 14), toon('#e9b949'), R.minX + 0.2, G + R.height + 0.03, R.minZ + 0.5, false));
  parts.add(mesh(new THREE.SphereGeometry(0.02, 8, 6), toon('#e9b949'), R.minX + 0.2, G + R.height + 0.07, R.minZ + 0.5, false));
  const screen = mesh(box(0.04, 0.32, 0.5), toon('#2b2d42'), R.minX + 0.45, G + R.height + 0.22, (R.minZ + R.maxZ) / 2 - 0.3, false);
  screen.rotation.z = -0.15;
  parts.add(screen);
  parts.add(mesh(box(0.012, 0.26, 0.44), toon('#8ecae6', { emissive: '#3a86ff' }), R.minX + 0.43, G + R.height + 0.22, (R.minZ + R.maxZ) / 2 - 0.3, false));

  // The building's name on the wall behind the desk.
  const name = textPlane(names.building, { color: '#2b2d42', size: 72 });
  name.scale.multiplyScalar(1.2);
  name.rotation.y = -Math.PI / 2;
  name.position.set(L.maxX - w - 0.02, G + LOBBY_NAME.y, LOBBY_NAME.z);
  group.add(name);
  parts.add(mesh(box(0.03, 0.04, 2.6), toon('#e9b949'), L.maxX - w - 0.02, G + LOBBY_NAME.y - 0.42, LOBBY_NAME.z, false));

  // The sofa along the west wall, and a low table in front of it with a stack of magazines.
  const S = LOBBY_SOFA;
  const sofa = toon('#3a86ff');
  const sofaDark = toon('#2f6fd6');
  const sx = (S.minX + S.maxX) / 2;
  const sz = (S.minZ + S.maxZ) / 2;
  const sd = S.maxZ - S.minZ;
  parts.add(mesh(roundedBox(S.maxX - S.minX, 0.42, sd, 0.08), sofa, sx, G + 0.21, sz));
  parts.add(mesh(roundedBox(0.22, 0.85, sd, 0.08), sofaDark, S.minX + 0.11, G + 0.42, sz));
  for (const z of [S.minZ + 0.11, S.maxZ - 0.11]) parts.add(mesh(roundedBox(S.maxX - S.minX, 0.6, 0.22, 0.08), sofaDark, sx, G + 0.3, z));
  for (const z of [sz - sd / 4, sz + sd / 4]) parts.add(mesh(roundedBox(0.5, 0.12, sd / 2 - 0.25, 0.05), toon('#5c9dff'), sx + 0.1, G + 0.47, z, false));
  const T = LOBBY_TABLE;
  parts.add(mesh(box(T.maxX - T.minX, 0.05, T.maxZ - T.minZ), toon('#2b2d42'), (T.minX + T.maxX) / 2, G + T.height - 0.025, (T.minZ + T.maxZ) / 2));
  for (const [dx, dz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    parts.add(mesh(box(0.04, T.height - 0.05, 0.04), toon('#e9b949'), (T.minX + T.maxX) / 2 + dx * ((T.maxX - T.minX) / 2 - 0.05), G + (T.height - 0.05) / 2, (T.minZ + T.maxZ) / 2 + dz * ((T.maxZ - T.minZ) / 2 - 0.05), false));
  }
  parts.add(mesh(box(0.3, 0.03, 0.4), toon('#ef476f'), (T.minX + T.maxX) / 2, G + T.height + 0.015, (T.minZ + T.maxZ) / 2 - 0.15, false));
  parts.add(mesh(box(0.28, 0.02, 0.38), toon('#06d6a0'), (T.minX + T.maxX) / 2 + 0.02, G + T.height + 0.04, (T.minZ + T.maxZ) / 2 - 0.13, false));

  // Plants in the corners and either side of the elevator.
  for (const [x, z, s] of LOBBY_PLANTS) {
    const p = plant(s);
    p.position.set(x, G, z);
    parts.add(p);
  }

  // The floor directory on the west wall, by the elevator.
  const dirCanvas = document.createElement('canvas');
  dirCanvas.width = 512;
  dirCanvas.height = 608;
  const dirTex = new THREE.CanvasTexture(dirCanvas);
  dirTex.colorSpace = THREE.SRGBColorSpace;
  dirTex.anisotropy = 8;
  const Dir = LOBBY_DIRECTORY;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(Dir.width, Dir.height), new THREE.MeshBasicMaterial({ map: dirTex }));
  board.rotation.y = Math.PI / 2;
  board.position.set(L.minX + w + 0.05, G + Dir.y, Dir.z);
  board.name = 'lobby-directory';
  group.add(board);
  parts.add(mesh(box(0.04, Dir.height + 0.1, Dir.width + 0.1), toon('#e9b949'), L.minX + w + 0.01, G + Dir.y, Dir.z, false));
  const setDirectory = (lines: DirectoryLine[]) => {
    drawDirectory(dirCanvas, lines, names.directory);
    dirTex.needsUpdate = true;
  };
  setDirectory([]);

  group.add(mergeByMaterial(parts));

  // ---- The elevator ----
  const lift = new THREE.Group();
  const steel = toon('#b8c1cc');
  const steelDark = toon('#8d99ae');
  const brass = toon('#e9b949');
  const minX = E.x - E.width / 2;
  const maxX = E.x + E.width / 2;
  const back = L.minZ + w;
  const midZ = (back + E.front) / 2;
  const depth = E.front - back;
  for (const x of [minX + E.wall / 2, maxX - E.wall / 2]) lift.add(mesh(box(E.wall, H, depth), steel, x, G + H / 2, midZ));
  const pillar = (E.width - E.doorWidth) / 2;
  for (const x of [minX + pillar / 2, maxX - pillar / 2]) lift.add(mesh(box(pillar, H, E.wall), steel, x, G + H / 2, E.front - E.wall / 2));
  lift.add(mesh(box(E.doorWidth, H - E.doorHeight, E.wall), steel, E.x, G + E.doorHeight + (H - E.doorHeight) / 2, E.front - E.wall / 2));
  lift.add(mesh(box(E.width, 0.06, depth), steelDark, E.x, G + H - 0.03, midZ, false));
  const fT = 0.07;
  lift.add(mesh(box(E.doorWidth + fT * 2, fT, 0.05), brass, E.x, G + E.doorHeight + fT / 2, E.front + 0.02, false));
  for (const s of [-1, 1]) lift.add(mesh(box(fT, E.doorHeight, 0.05), brass, E.x + s * (E.doorWidth / 2 + fT / 2), G + E.doorHeight / 2, E.front + 0.02, false));
  // Inside: a dark floor, a mirror, a handrail and a light.
  const inW = LOBBY_CAR.maxX - LOBBY_CAR.minX;
  const inD = LOBBY_CAR.maxZ - LOBBY_CAR.minZ;
  lift.add(mesh(box(inW, 0.02, inD), toon('#3d405b'), E.x, G + 0.022, (LOBBY_CAR.minZ + LOBBY_CAR.maxZ) / 2, false));
  lift.add(mesh(new THREE.PlaneGeometry(inW - 0.3, 1.4), new THREE.MeshBasicMaterial({ color: '#cfe8f5' }), E.x, G + 1.5, back + 0.02, false));
  const rail = mesh(new THREE.CylinderGeometry(0.025, 0.025, inW - 0.2, 8), brass, E.x, G + 0.95, back + 0.08, false);
  rail.rotation.z = Math.PI / 2;
  lift.add(rail);
  lift.add(mesh(box(inW - 0.2, 0.05, 0.14), toon('#fff7d6', { emissive: '#ffe08a' }), E.x, G + E.doorHeight + 0.2, E.front - E.wall - 0.1, false));
  // The call button, on the pillar right of the doors.
  const call = new THREE.Group();
  call.add(mesh(roundedBox(0.2, 0.36, 0.04, 0.02), brass, 0, 0, 0, false));
  const up = mesh(new THREE.ConeGeometry(0.045, 0.06, 3), toon('#fff7d6', { emissive: '#7cf29a' }), 0, 0.07, 0.03, false);
  call.add(up);
  const down = mesh(new THREE.ConeGeometry(0.045, 0.06, 3), toon('#fff7d6', { emissive: '#6c7288' }), 0, -0.07, 0.03, false);
  down.rotation.z = Math.PI;
  call.add(down);
  call.position.set(E.x + E.doorWidth / 2 + pillar / 2, G + 1.2, E.front + 0.02);
  lift.add(call);
  const merged = mergeByMaterial(lift);
  group.add(merged);
  // Its doors, sliding apart behind the pillars.
  const dHalf = E.doorWidth / 2 + 0.02;
  const doorMat = toon('#d9dee4');
  const liftDoors = [-1, 1].map((side) => {
    const d = new THREE.Group();
    d.add(mesh(box(dHalf, E.doorHeight - 0.02, 0.05), doorMat, 0, 0, 0));
    d.add(mesh(box(0.02, E.doorHeight - 0.1, 0.055), steelDark, (-side * dHalf) / 2 + side * 0.01, 0, 0, false));
    d.add(mesh(box(dHalf - 0.2, 0.05, 0.055), steelDark, 0, 0.35, 0, false));
    d.position.set(E.x + (side * dHalf) / 2, G + E.doorHeight / 2, E.front - E.wall - 0.03);
    group.add(d);
    return { group: d, side };
  });
  // The sign over the doors.
  const liftSign = textPlane(names.sign, { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#fffaf3' });
  liftSign.scale.multiplyScalar(Math.min(1.1, (E.width + 0.4) / liftSign.geometry.parameters.width));
  liftSign.position.set(E.x, G + E.doorHeight + 0.42, E.front + 0.03);
  group.add(liftSign);

  // ---- What's in the way ----
  const colliders: Collider[] = [];
  let frontDoor: Collider | null = null;
  let liftDoor: Collider | null = null;
  for (const b of lobbyBlocks()) {
    const c: Collider = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, bottom: G, top: G + b.height };
    if (b.what === 'door') frontDoor = c;
    if (b.what === 'lift-door') liftDoor = c;
    colliders.push(c);
  }
  const base = colliders.map((c) => ({ c, top: c.top, bottom: c.bottom! }));
  /** How far down the street is from the floor you're on, below the bottom floor's. */
  let drop = 0;
  const OPEN = -1e4;

  const interactable: Interactable = { kind: 'elevator', x: E.x, y: G, z: E.front + 0.4, radius: 1.9 };
  // The doors and the front of it are what you aim at.
  merged.userData.interact = interactable;
  for (const d of liftDoors) d.group.userData.interact = interactable;

  let open = false;
  let openness = 0;
  const shut = (c: Collider | null, b: (typeof base)[number] | undefined) => {
    if (c && b) c.top = b.top - drop;
  };
  const baseOf = (c: Collider | null) => base.find((b) => b.c === c);
  const elevator: Elevator = {
    group,
    colliders: liftDoor ? [liftDoor] : [],
    interactable,
    setOpen(v: boolean) {
      open = v;
      if (!v) shut(liftDoor, baseOf(liftDoor));
    },
    get open() {
      return open;
    },
    get settled() {
      return openness === (open ? 1 : 0);
    },
    setSign() {},
    update(dt: number) {
      const target = open ? 1 : 0;
      if (openness !== target) {
        openness = target > openness ? Math.min(1, openness + dt / 0.7) : Math.max(0, openness - dt / 0.6);
        const e = openness * openness * (3 - 2 * openness);
        for (const d of liftDoors) d.group.position.x = E.x + (d.side * dHalf) / 2 + d.side * e * (pillar - 0.03);
      }
      if (open && openness > 0.85 && liftDoor) liftDoor.top = OPEN;
    },
  };

  let doorOpen = 0;
  const update = (dt: number, people: Iterable<{ x: number; y: number; z: number }>) => {
    let near = false;
    const y = G - drop;
    for (const p of people) if (Math.abs(p.y - y) < 1.6 && Math.abs(p.x - D.x) < 1.6 && Math.abs(p.z - L.maxZ) < 2.2) near = true;
    const want = near ? 1 : 0;
    if (doorOpen !== want) {
      doorOpen = want > doorOpen ? Math.min(1, doorOpen + dt * 2.5) : Math.max(0, doorOpen - dt * 1.6);
      for (const p of panels) p.group.position.x = D.x + (p.side * half) / 2 + p.side * doorOpen * (half - 0.06);
    }
    // Open enough to step through: it's out of the way.
    if (frontDoor) frontDoor.top = doorOpen > 0.6 ? OPEN : (baseOf(frontDoor)?.top ?? 0) - drop;
    elevator.update(dt);
  };

  const setLevel = (index: number) => {
    drop = Math.max(0, index) * STOREY;
    group.position.y = -drop;
    for (const b of base) {
      if (b.c.top > OPEN / 2) b.c.top = b.top - drop;
      b.c.bottom = b.bottom - drop;
    }
    interactable.y = streetBelow(index);
  };
  setLevel(0);

  return { group, colliders, interactables: [interactable], elevator, setLevel, setDirectory, update };
}
