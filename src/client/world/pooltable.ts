import * as THREE from 'three';
import { FLOOR, POOL_TABLE, WALL_HEIGHT } from '../../shared/layout';
import { BALL_R, POCKETS, TABLE as SHARED } from '../../shared/pool';
import type { Collider } from './office';
import { bulb, type NightParts } from './outside';
import { mergeByMaterial, mesh, roundedBox, toon, toonUnique } from './toon';

// The pool table out on the floor in front of the balcony doors: an 8-ft table for 8-ball, with a
// wooden frame on turned legs, green cloth, cushions, six drop pockets with nets under them, the
// diamonds on the rails, the head string and the foot spot. A billiard lamp hangs over it, and the
// cues and the triangle wait in a rack on the south wall.

const L = SHARED.length;
const W = SHARED.width;
const CUSHION_W = SHARED.cushion;

/**
 * The table's size, in meters, in its own frame: (x, y) on the cloth from its middle, x along the
 * long side (the head end at -x, the foot at +x), y across. Heights are above the cloth. All of it is
 * the game's own table (see shared/pool.ts), so the balls drop where the holes are drawn.
 */
export const TABLE = {
  /** The playing surface, between the cushions' noses: 2.24 × 1.12 m (88 × 44 in) for an 8-ft table. */
  length: L,
  width: W,
  /** A ball: 57.15 mm across. Its centre is this high over the cloth when it's lying on it. */
  ballR: BALL_R,
  /** The cushions: `width` from nose to back, their nose `nose` up (63.5 % of a ball), their top `top`. */
  cushion: { width: CUSHION_W, nose: SHARED.cushionHeight, top: 0.04 },
  /** The wooden rails outside the cushions: `width` across the top, which is `top` up. */
  rail: { width: (POOL_TABLE.outer.width - W) / 2 - CUSHION_W, top: 0.046 },
  /**
   * The six pockets, round the table from the head end's corner at -y (see POCKETS). (x, y) is the
   * middle of the hole, `r` its radius; `mouth` is how wide it is between the cushions' noses.
   */
  pockets: POCKETS,
  /** The head string, across the table a quarter of the way in from the head end: break from behind it. */
  headString: SHARED.headString,
  /** The foot spot, where the apex ball of the rack goes. */
  footSpot: SHARED.footSpot,
} as const;

/** How far the side pockets' jaws are set back at the cushions' backs, and the corner ones on (see cushions()). */
const SIDE_JAW = -0.0125;
const CORNER_JAW = 0.045;

const CLOTH = '#1f7a4c';
const CUSHION = '#1b6d43';
const WOOD = '#7a4a2a';
const WOOD_DARK = '#5a3420';
const LEATHER = '#1d1a18';
const BRASS = '#c9a24a';
const PEARL = '#f4efe1';
const SHADE = '#24543a';

export interface PoolTableView {
  group: THREE.Group;
  /** The table (its frame up to the cloth, and the rails a little higher), the lamp over it and the cue rack. */
  colliders: Collider[];
  /**
   * The world point at table-local (x, y) meters from the middle of the cloth (x along the long side
   * toward the foot, y across), `h` meters up from the cloth: by default a ball's centre lying there.
   */
  toWorld(x: number, y: number, h?: number, target?: THREE.Vector3): THREE.Vector3;
  /** The other way: where a world point is, in the table's own meters. */
  toTable(p: THREE.Vector3): { x: number; y: number; h: number };
  /** The cues standing in the rack on the wall, each along its own +y from the butt, to take one down. */
  cues: THREE.Object3D[];
  /** The triangle, hanging on its peg by the cues. */
  triangle: THREE.Object3D;
  /** The billiard lamp over the table: its shade, rods and glow. */
  lamp: THREE.Object3D;
}

/**
 * Round the cloth's edge (out at the cushions' backs), anticlockwise, with the pockets taken out of
 * it (`into` false: the cloth, which the pockets bite into) or added to it (`into` true: the hole the
 * rails go round, which takes in the pockets).
 */
function rim(into: boolean): THREE.Vector2[] {
  const X = L / 2 + CUSHION_W;
  const Y = W / 2 + CUSHION_W;
  const pts: THREE.Vector2[] = [];
  for (const p of TABLE.pockets) {
    const sx = Math.sign(p.x);
    const sy = Math.sign(p.y);
    // Where the hole crosses the edge: coming in along it, and going on.
    const along = (gap: number) => Math.sqrt(p.r * p.r - gap * gap);
    let from: [number, number];
    let to: [number, number];
    if (sx === 0) {
      const h = along(Y - Math.abs(p.y));
      from = [sy * h, sy * Y];
      to = [-sy * h, sy * Y];
    } else {
      const onSide: [number, number] = [sx * X, p.y - sy * along(X - Math.abs(p.x))];
      const onEnd: [number, number] = [p.x - sx * along(Y - Math.abs(p.y)), sy * Y];
      [from, to] = sx * sy < 0 ? [onEnd, onSide] : [onSide, onEnd];
    }
    const a0 = Math.atan2(from[1] - p.y, from[0] - p.x);
    let d = Math.atan2(to[1] - p.y, to[0] - p.x) - a0;
    if (into) while (d <= 0) d += Math.PI * 2;
    else while (d >= 0) d -= Math.PI * 2;
    const n = 12;
    for (let i = 0; i <= n; i++) pts.push(new THREE.Vector2(p.x + Math.cos(a0 + (d * i) / n) * p.r, p.y + Math.sin(a0 + (d * i) / n) * p.r));
  }
  return pts;
}

/** A flat outline in the table's (x, y), stood up `depth` from `y0` (its y becomes -z). */
function slab(shape: THREE.Shape, y0: number, depth: number, curveSegments = 12): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}

/** The six cushions between the pockets, each cut away at its ends into the pockets' jaws. */
function cushions(): THREE.Shape[] {
  const nose = { x: L / 2, y: W / 2 };
  const back = { x: L / 2 + CUSHION_W, y: W / 2 + CUSHION_W };
  const corner = TABLE.pockets[0].mouth / Math.SQRT2;
  const side = TABLE.pockets[1].mouth / 2;
  const shapes: THREE.Shape[] = [];
  const quad = (pts: [number, number][]) => shapes.push(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
  for (const sy of [-1, 1]) {
    // Along each long side, from the side pocket out to a corner either way.
    for (const sx of [-1, 1]) {
      quad([
        [sx * side, sy * nose.y],
        [sx * (nose.x - corner), sy * nose.y],
        [sx * (nose.x - corner + CORNER_JAW), sy * back.y],
        [sx * (side + SIDE_JAW), sy * back.y],
      ]);
    }
  }
  // Across each end, corner to corner.
  for (const sx of [-1, 1]) {
    quad([
      [sx * nose.x, -(nose.y - corner)],
      [sx * nose.x, nose.y - corner],
      [sx * back.x, nose.y - corner + CORNER_JAW],
      [sx * back.x, -(nose.y - corner + CORNER_JAW)],
    ]);
  }
  return shapes;
}

/** The cloth, drawn to a canvas: a little nap in it, the head string and the foot spot. */
function clothTexture(): THREE.CanvasTexture {
  const X = L / 2 + CUSHION_W;
  const Y = W / 2 + CUSHION_W;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const px = c.width / (2 * X);
  g.fillStyle = CLOTH;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 6, 1 + Math.random() * 2);
  }
  // Light from the lamp: brighter in the middle, a touch darker out by the cushions.
  const shade = g.createRadialGradient(c.width / 2, c.height / 2, 40, c.width / 2, c.height / 2, c.width * 0.55);
  shade.addColorStop(0, 'rgba(255,255,230,0.06)');
  shade.addColorStop(1, 'rgba(0,0,0,0.08)');
  g.fillStyle = shade;
  g.fillRect(0, 0, c.width, c.height);
  const at = (x: number, y: number): [number, number] => [(x + X) * px, (Y - y) * px];
  // The head string, faintly, from cushion to cushion.
  g.strokeStyle = 'rgba(235,245,235,0.22)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(...at(TABLE.headString, -W / 2));
  g.lineTo(...at(TABLE.headString, W / 2));
  g.stroke();
  // The foot spot: a little white dot.
  g.fillStyle = 'rgba(245,245,235,0.85)';
  g.beginPath();
  g.arc(...at(TABLE.footSpot.x, TABLE.footSpot.y), 0.011 * px, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // The shape's own (x, y) are its UVs: fit the canvas to the cloth.
  tex.repeat.set(1 / (2 * X), 1 / (2 * Y));
  tex.offset.set(0.5, 0.5);
  return tex;
}

/** A diamond mesh of string, see-through between, for the pocket nets. */
function netTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#e6dcc4';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 3);
  return tex;
}

/** A toon material with a picture on it, lit like the room. */
function toonMap(map: THREE.Texture): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
}

/** A cue, 1.47 m from the butt (at the origin) up +y to the tip. */
function cue(): THREE.Object3D {
  const parts = new THREE.Group();
  const seg = (r0: number, r1: number, y0: number, y1: number, color: string) =>
    parts.add(mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 10), toon(color), 0, (y0 + y1) / 2, 0, false));
  seg(0.0145, 0.0145, 0, 0.012, '#151515'); // the bumper
  seg(0.0145, 0.0138, 0.012, 0.32, '#2b1a12'); // the butt
  seg(0.0138, 0.0134, 0.32, 0.5, '#20201f'); // the wrap
  seg(0.0134, 0.0128, 0.5, 0.72, '#6b3a22'); // the forearm
  seg(0.0128, 0.0127, 0.72, 0.74, '#d8d2c4'); // the joint
  seg(0.0127, 0.0066, 0.74, 1.452, '#e7cf9b'); // the shaft
  seg(0.0066, 0.0066, 1.452, 1.464, '#f7f4ec'); // the ferrule
  seg(0.0065, 0.0062, 1.464, 1.47, '#3a6ea5'); // the tip, chalked
  return mergeByMaterial(parts);
}

/**
 * Built in the table's own frame (the middle of the cloth at the origin, x along the long side, its
 * y across as -z, up +y), then stood at POOL_TABLE; the rack is built on the south wall.
 */
export function buildPoolTable(night: NightParts): PoolTableView {
  const group = new THREE.Group();
  const table = new THREE.Group();
  table.position.set(POOL_TABLE.x, POOL_TABLE.y, POOL_TABLE.z);
  table.rotation.y = POOL_TABLE.rotY;
  group.add(table);
  const parts = new THREE.Group();
  const wood = toon(WOOD);
  const dark = toon(WOOD_DARK);
  const leather = toon(LEATHER);
  const brass = toon(BRASS);
  const OL = POOL_TABLE.outer.length / 2;
  const OW = POOL_TABLE.outer.width / 2;
  const { rail } = TABLE;

  // The cloth on the slate, with the pockets cut into it. The cloth itself is its own mesh, for its texture.
  const bed = new THREE.Shape(rim(false));
  parts.add(mesh(slab(bed, -0.03, 0.03), toon(CUSHION), 0, 0, 0, false));
  const clothMat = toonMap(clothTexture());
  clothMat.userData.outlineParameters = { visible: false };
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(bed).rotateX(-Math.PI / 2), clothMat);
  cloth.position.y = 0.001;
  cloth.receiveShadow = true;
  table.add(cloth);

  // The cushions, in a shade darker green.
  for (const s of cushions()) parts.add(mesh(slab(s, 0, TABLE.cushion.top, 1), toon(CUSHION), 0, 0, 0, false));

  // The rails: wood all round, round the cloth and the pockets.
  const rails = new THREE.Shape([new THREE.Vector2(-OL, -OW), new THREE.Vector2(OL, -OW), new THREE.Vector2(OL, OW), new THREE.Vector2(-OL, OW)]);
  rails.holes.push(new THREE.Path(rim(true)));
  parts.add(mesh(slab(rails, -0.07, 0.07 + rail.top), wood));
  // A darker moulding along the rails' outside edge.
  const lip = 0.012;
  for (const sy of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(2 * OL + 2 * lip, 0.025, lip), dark, 0, -0.02, sy * (OW + lip / 2)));
  for (const sx of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(lip, 0.025, 2 * OW), dark, sx * (OL + lip / 2), -0.02, 0));

  // The diamonds: pearl inlays in the rails, a quarter of a diamond apart from cushion to cushion.
  const mid = W / 2 + CUSHION_W + rail.width / 2;
  const midEnd = L / 2 + CUSHION_W + rail.width / 2;
  const pearl = toonUnique(PEARL);
  pearl.userData.outlineParameters = { visible: false };
  const diamond = (x: number, y: number, along: number) => {
    const geo = new THREE.CircleGeometry(0.011, 4).scale(1.5, 1, 1).rotateZ(along).rotateX(-Math.PI / 2);
    parts.add(mesh(geo, pearl, x, rail.top + 0.001, -y, false));
  };
  for (const k of [-3, -2, -1, 1, 2, 3]) for (const sy of [-1, 1]) diamond((k * L) / 8, sy * mid, 0);
  for (const k of [-1, 0, 1]) for (const sx of [-1, 1]) diamond(sx * midEnd, (k * W) / 4, Math.PI / 2);

  // The pockets: a leather cap over the rail round each, a leather throat down through it, and a
  // net hanging under it to catch the ball.
  const netMat = toonMap(netTexture());
  netMat.alphaTest = 0.5;
  netMat.transparent = false;
  netMat.side = THREE.DoubleSide;
  netMat.userData.outlineParameters = { visible: false };
  const throatMat = toonUnique(LEATHER);
  throatMat.side = THREE.DoubleSide;
  for (const p of TABLE.pockets) {
    const out = Math.atan2(p.y, p.x);
    const arc = p.x === 0 ? Math.PI : 1.5 * Math.PI;
    const cap = new THREE.TorusGeometry(p.r + 0.004, 0.012, 6, 16, arc).rotateZ(out - arc / 2).rotateX(-Math.PI / 2);
    parts.add(mesh(cap, leather, p.x, rail.top, -p.y, false));
    parts.add(mesh(new THREE.CylinderGeometry(p.r - 0.002, p.r - 0.006, 0.12, 16, 1, true), throatMat, p.x, rail.top - 0.06, -p.y, false));
    const r = p.r - 0.006;
    const bag = new THREE.LatheGeometry(
      [
        [0.002, -0.17],
        [r * 0.45, -0.162],
        [r * 0.85, -0.14],
        [r * 1.05, -0.1],
        [r, -0.065],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      14,
    );
    const net = new THREE.Mesh(bag, netMat);
    // The bag's top (0.065 down its profile) hangs from the throat's bottom.
    net.position.set(p.x, rail.top - 0.12 + 0.065, -p.y);
    table.add(net);
    // A leather band round the net's top, where it hangs from the throat.
    parts.add(mesh(new THREE.TorusGeometry(r, 0.006, 4, 16).rotateX(Math.PI / 2), leather, p.x, rail.top - 0.12, -p.y, false));
  }

  // The apron under the rails, notched at the corners and the sides for the nets to hang through,
  // and a dark body under the slate inside it.
  const apronH = 0.15;
  const apronY = -0.07 - apronH / 2;
  const notch = 0.2;
  const sideNotch = 0.11;
  const T = 0.035;
  for (const sy of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const x0 = sideNotch;
      const x1 = OL - notch;
      parts.add(mesh(new THREE.BoxGeometry(x1 - x0, apronH, T), wood, (sx * (x0 + x1)) / 2, apronY, sy * (OW - T / 2)));
    }
  }
  for (const sx of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(T, apronH, 2 * (OW - notch)), wood, sx * (OL - T / 2), apronY, 0));
  parts.add(mesh(new THREE.BoxGeometry(2 * (OL - 0.24), apronH - 0.02, 2 * (OW - 0.2)), dark, 0, apronY + 0.01, 0, false));
  // A bead of darker wood along the apron's bottom edge.
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(OL - notch - sideNotch, 0.02, T + 0.01), dark, (sx * (OL - notch + sideNotch)) / 2, apronY - apronH / 2, sy * (OW - T / 2)));
  for (const sx of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(T + 0.01, 0.02, 2 * (OW - notch)), dark, sx * (OL - T / 2), apronY - apronH / 2, 0));

  // Four turned legs on square feet, under the apron's corners, and a stretcher between each pair.
  const floorY = -POOL_TABLE.y;
  const legTop = apronY - apronH / 2;
  const legH = legTop - floorY - 0.08;
  const profile = [
    [0.07, 0],
    [0.07, 0.04],
    [0.05, 0.07],
    [0.045, 0.2],
    [0.06, 0.28],
    [0.075, 0.36],
    [0.06, 0.44],
    [0.048, 0.5],
    [0.055, 0.55],
    [0.065, 0.58],
    [0.065, 0.6],
  ].map(([r, y]) => new THREE.Vector2(r, (y / 0.6) * legH));
  const legGeo = new THREE.LatheGeometry(profile, 12);
  const legX = OL - 0.3;
  const legZ = OW - 0.22;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.add(mesh(legGeo.clone(), wood, sx * legX, floorY + 0.08, sz * legZ));
      parts.add(mesh(roundedBox(0.2, 0.08, 0.2, 0.02), dark, sx * legX, floorY + 0.04, sz * legZ));
      // A block where the leg meets the apron.
      parts.add(mesh(new THREE.BoxGeometry(0.15, 0.06, 0.15), dark, sx * legX, legTop + 0.03, sz * legZ, false));
    }
    parts.add(mesh(new THREE.BoxGeometry(0.06, 0.05, 2 * legZ), dark, sx * legX, floorY + 0.2, 0));
  }
  parts.add(mesh(new THREE.BoxGeometry(2 * legX, 0.05, 0.06), dark, 0, floorY + 0.2, 0));

  // The billiard lamp: a long green shade with brass ends, a meter over the cloth, hung on two rods
  // from the ceiling and lit underneath.
  const lampY = 1.0;
  const lamp = new THREE.Group();
  const shadeL = 1.5;
  const shadeProfile = new THREE.Shape([new THREE.Vector2(-0.19, 0), new THREE.Vector2(0.19, 0), new THREE.Vector2(0.11, 0.16), new THREE.Vector2(-0.11, 0.16)]);
  const shadeGeo = new THREE.ExtrudeGeometry(shadeProfile, { depth: shadeL, bevelEnabled: false }).translate(0, 0, -shadeL / 2).rotateY(Math.PI / 2);
  lamp.add(mesh(shadeGeo, toon(SHADE), 0, lampY, 0, false));
  for (const sx of [-1, 1]) {
    const end = new THREE.ExtrudeGeometry(shadeProfile, { depth: 0.03, bevelEnabled: false }).scale(1.06, 1.06, 1).translate(0, -0.005, -0.015).rotateY(Math.PI / 2);
    lamp.add(mesh(end, brass, sx * (shadeL / 2), lampY, 0, false));
    const rodH = WALL_HEIGHT - POOL_TABLE.y - lampY - 0.16;
    lamp.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, rodH, 6), brass, sx * 0.55, lampY + 0.16 + rodH / 2, 0, false));
    lamp.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), brass, sx * 0.55, WALL_HEIGHT - POOL_TABLE.y - 0.01, 0, false));
  }
  const glow = bulb(night, '#fff1c1', 0.2);
  lamp.add(mesh(new THREE.BoxGeometry(shadeL - 0.06, 0.01, 0.34), glow, 0, lampY - 0.004, 0, false));
  table.updateWorldMatrix(true, false);
  for (const x of [-0.5, 0, 0.5]) {
    const at = table.localToWorld(new THREE.Vector3(x, lampY - 0.02, 0));
    night.halos.push({ at, size: 0.55, color: '#ffe08a' });
  }
  night.lamps.push({ x: POOL_TABLE.x, y: POOL_TABLE.y + 0.3, z: POOL_TABLE.z, reach: 2.2, color: '#ffe3a3', power: 1.4 });

  table.add(mergeByMaterial(parts));
  const lampMeshes = mergeByMaterial(lamp);
  table.add(lampMeshes);

  // The cue rack on the south wall: a backboard, a rail at the bottom the butts stand in and a clip
  // rail near the top, four cues in it and a slot spare, the triangle on a peg and two cubes of chalk.
  const { rack } = POOL_TABLE;
  const wall = new THREE.Group();
  wall.position.set(rack.x, 0, FLOOR.maxZ);
  wall.rotation.y = Math.PI;
  group.add(wall);
  const rackParts = new THREE.Group();
  const hw = rack.width / 2;
  rackParts.add(mesh(roundedBox(rack.width, 0.02, 1.5, 0.04).rotateX(Math.PI / 2), wood, 0, 0.2 + 0.75, 0.01));
  rackParts.add(mesh(new THREE.BoxGeometry(rack.width + 0.04, 0.05, 0.03), dark, 0, 1.72, 0.02));
  rackParts.add(mesh(new THREE.BoxGeometry(rack.width, 0.04, rack.depth), dark, 0, 0.28, rack.depth / 2));
  rackParts.add(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.06), dark, -hw + 0.27, 1.42, 0.03));
  const slots = [-0.36, -0.27, -0.18, -0.09, 0];
  for (const x of slots) {
    rackParts.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 10), toon('#111111'), x, 0.3, 0.07, false));
    rackParts.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), brass, x, 1.42, 0.065, false));
  }
  // The chalk, on the bottom rail.
  for (const x of [0.2, 0.28]) rackParts.add(mesh(new THREE.BoxGeometry(0.022, 0.022, 0.022), toon('#3a7bd5'), x, 0.311, 0.06, false));
  // The triangle's peg.
  rackParts.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6).rotateX(Math.PI / 2), brass, 0.24, 1.33, 0.045, false));
  wall.add(mergeByMaterial(rackParts));

  const cues: THREE.Object3D[] = [];
  for (const x of slots.slice(0, 4)) {
    const c = cue();
    // Butt in its cup, leaning back a touch onto the clip.
    c.position.set(x, 0.3, 0.07);
    c.rotation.x = -0.02;
    wall.add(c);
    cues.push(c);
  }

  // The triangle: a black frame round five rows of balls, hanging apex-up off its peg.
  const inner = 2 * TABLE.ballR * (4 + Math.sqrt(3));
  const frame = 0.018;
  const outer = inner + 2 * frame * Math.sqrt(3);
  const tri = (side: number) => {
    const h = (side * Math.sqrt(3)) / 2;
    return [new THREE.Vector2(-side / 2, -h / 3), new THREE.Vector2(side / 2, -h / 3), new THREE.Vector2(0, (2 * h) / 3)];
  };
  const triShape = new THREE.Shape(tri(outer));
  triShape.holes.push(new THREE.Path(tri(inner).reverse()));
  const triangle = mesh(new THREE.ExtrudeGeometry(triShape, { depth: 0.035, bevelEnabled: false }), toon('#202022'), 0, 0, 0);
  const apex = (inner * Math.sqrt(3)) / 3;
  triangle.position.set(0.24, 1.33 - apex + 0.006, 0.03);
  wall.add(triangle);

  // The table, its rails a bit higher than the cloth, the lamp's shade over it, and the rack, in the room's axes.
  const colliders: Collider[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, bottom: number, top: number) => {
    const c = Math.cos(POOL_TABLE.rotY);
    const s = Math.sin(POOL_TABLE.rotY);
    const xs: number[] = [];
    const zs: number[] = [];
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      // Table (x, y) is local (x, -y) in x/z; turned by rotY about y.
      xs.push(POOL_TABLE.x + x * c - y * s);
      zs.push(POOL_TABLE.z - x * s - y * c);
    }
    colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), bottom: POOL_TABLE.y + bottom, top: POOL_TABLE.y + top });
  };
  box(-OL, OL, -OW, OW, -POOL_TABLE.y, 0);
  const inY = W / 2 + CUSHION_W;
  const inX = L / 2 + CUSHION_W;
  for (const s of [-1, 1]) {
    box(-OL, OL, s < 0 ? -OW : inY, s < 0 ? -inY : OW, 0, rail.top);
    box(s < 0 ? -OL : inX, s < 0 ? -inX : OL, -inY, inY, 0, rail.top);
  }
  box(-shadeL / 2, shadeL / 2, -0.19, 0.19, lampY, lampY + 0.16);
  colliders.push({ minX: rack.x - hw, maxX: rack.x + hw, minZ: FLOOR.maxZ - rack.depth, maxZ: FLOOR.maxZ, top: rack.height });

  const v = new THREE.Vector3();
  return {
    group,
    colliders,
    cues,
    triangle,
    lamp: lampMeshes,
    toWorld(x, y, h = TABLE.ballR, target = new THREE.Vector3()) {
      table.updateWorldMatrix(true, false);
      return table.localToWorld(target.set(x, h, -y));
    },
    toTable(p) {
      table.updateWorldMatrix(true, false);
      table.worldToLocal(v.copy(p));
      return { x: v.x, y: -v.z, h: v.y };
    },
  };
}
