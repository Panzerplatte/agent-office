import * as THREE from 'three';
import { DESK_SIZE, KIOSK, MEETING_TABLE } from '../../../../shared/layout';
import { mesh, roundedBox } from '../../toon';
import { drawCanvasCloth, drawCityMap, drawLeather, drawPlanks, drawSteel, type Kit, rng } from './kit';

// The bunker's furniture, each built in the same local frame (and to the same size) as the office
// piece it stands in for, so seats, colliders and the laptops on top all still line up.

const C = {
  steel: '#59605a',
  steelDark: '#3c423e',
  olive: '#5d6b3a',
  oliveDark: '#47532b',
  leather: '#6b3d24',
  leatherDark: '#4e2a17',
  brass: '#b08d3c',
  rust: '#8a4b2a',
  bulb: '#ffd98a',
  khaki: '#a59a6c',
  enamel: '#ece6d6',
  enamelRim: '#2f4a6b',
  canvas: '#6f7a45',
  cable: '#1f2220',
};

function box(w: number, h: number, d: number) {
  return new THREE.BoxGeometry(w, h, d);
}

function cyl(rTop: number, rBottom: number, h: number, seg = 8) {
  return new THREE.CylinderGeometry(rTop, rBottom, h, seg);
}

/** A straight bar of round tube from a to b. */
function tube(kit: Kit, a: THREE.Vector3, b: THREE.Vector3, r: number, color = C.steelDark): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = mesh(cyl(r, r, len, 6), kit.mat(color), (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A clamp work lamp: a C-clamp on the bench's back edge, two steel arms with a spring at the elbow,
 * and a cone shade tipped down over the bench with a warm bulb in it. `side` mirrors the arm.
 */
export function clampLamp(kit: Kit, side: 1 | -1 = 1): THREE.Group {
  const g = new THREE.Group();
  const dark = kit.mat(C.steelDark);
  // The clamp, gripping the edge of the top.
  g.add(mesh(box(0.06, 0.05, 0.08), dark, 0, 0.025, 0));
  g.add(mesh(box(0.06, 0.16, 0.025), dark, 0, -0.05, -0.05));
  g.add(mesh(box(0.06, 0.03, 0.06), dark, 0, -0.12, -0.02));
  // Arms: up and a little back, then out over the bench.
  const elbow = v(side * 0.04, 0.5, -0.06);
  const head = v(side * 0.12, 0.62, 0.3);
  g.add(tube(kit, v(0, 0.05, 0), elbow, 0.012));
  g.add(tube(kit, elbow, head, 0.012));
  g.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), kit.mat(C.brass), elbow.x, elbow.y, elbow.z));
  // The spring along the lower arm.
  g.add(tube(kit, v(0.02 * side, 0.12, 0.01), v(elbow.x + 0.02 * side, elbow.y - 0.08, elbow.z + 0.01), 0.007, C.brass));
  // The shade, tipped down toward the worker's hands.
  const shade = new THREE.Group();
  shade.add(mesh(cyl(0.04, 0.11, 0.14, 12).translate(0, -0.07, 0), kit.mat(C.olive)));
  shade.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), kit.mat('#fff2c4', C.bulb), 0, -0.12, 0, false));
  shade.position.copy(head);
  shade.rotation.x = 0.55;
  g.add(shade);
  return g;
}

/**
 * A heavy workbench in the desk's place: a thick top of worn planks on two steel trestles, a shelf
 * low down at the back with a toolbox or a crate on it, and a riveted steel apron where the modesty
 * panel was. Same footprint and the same height as the desk: the laptop sits on it just the same.
 */
export function workbench(kit: Kit, index: number): THREE.Group {
  const g = new THREE.Group();
  const { width, depth, height } = DESK_SIZE;
  const top = kit.painted(`planks-${index % 4}`, () => drawPlanks(index % 4 + 1));
  const steel = kit.painted(`steel-${index % 2}`, () => drawSteel(index % 2 ? C.steel : '#4f5a4c', index % 2 + 3));
  const dark = kit.mat(C.steelDark);
  g.add(mesh(box(width - 0.04, 0.1, depth - 0.02), top, 0, height - 0.05, 0));
  // An edge strip of steel along the front, where the work gets clamped.
  g.add(mesh(box(width - 0.02, 0.07, 0.03), dark, 0, height - 0.06, depth / 2 - 0.01));
  // The trestles: an A of square tube at each end, with a cross bar under the top and feet on the floor.
  for (const sx of [-1, 1]) {
    const x = sx * (width / 2 - 0.18);
    for (const sz of [-1, 1]) {
      const leg = mesh(box(0.06, height - 0.1, 0.06), steel, x, (height - 0.1) / 2, sz * (depth / 2 - 0.2));
      leg.rotation.x = sz * 0.12;
      g.add(leg);
    }
    g.add(mesh(box(0.08, 0.06, depth - 0.12), dark, x, height - 0.13, 0));
    g.add(mesh(box(0.1, 0.04, depth - 0.06), dark, x, 0.02, 0));
    g.add(mesh(box(0.05, 0.05, depth - 0.3), steel, x, 0.32, 0));
  }
  // The shelf low at the back, between the trestles.
  g.add(mesh(box(width - 0.42, 0.04, 0.4), kit.painted(`planks-${(index + 1) % 4}`, () => drawPlanks(((index + 1) % 4) + 1)), 0, 0.17, -depth / 2 + 0.3));
  // The steel apron facing away from the worker, with a row of rivets.
  g.add(mesh(box(width - 0.4, 0.32, 0.025), steel, 0, height - 0.27, -depth / 2 + 0.08));
  for (let i = 0; i < 6; i++) {
    g.add(mesh(new THREE.SphereGeometry(0.012, 5, 4), kit.mat(C.brass), -width / 2 + 0.32 + (i * (width - 0.64)) / 5, height - 0.15, -depth / 2 + 0.066, false));
  }
  // On the shelf: a toolbox or a little crate.
  if (index % 2) {
    const tb = new THREE.Group();
    tb.add(mesh(box(0.46, 0.18, 0.22), kit.mat('#a3392b'), 0, 0.09, 0));
    tb.add(mesh(box(0.3, 0.02, 0.03), dark, 0, 0.22, 0));
    tb.add(mesh(box(0.02, 0.05, 0.03), dark, -0.15, 0.2, 0));
    tb.add(mesh(box(0.02, 0.05, 0.03), dark, 0.15, 0.2, 0));
    tb.position.set(0.35, 0.19, -depth / 2 + 0.3);
    g.add(tb);
  } else {
    const crate = mesh(box(0.4, 0.24, 0.3), kit.mat('#8a6a3e'), -0.4, 0.31, -depth / 2 + 0.3);
    g.add(crate);
    g.add(mesh(box(0.41, 0.03, 0.31), kit.mat('#6e5230'), -0.4, 0.33, -depth / 2 + 0.3));
  }

  // On top, at the back, clear of the laptop and the dancer's spot: a tin mug, a field radio or manuals.
  const deco = index % 3;
  if (deco === 0) {
    const mug = new THREE.Group();
    mug.add(mesh(cyl(0.055, 0.055, 0.11, 12), kit.mat(C.enamel), 0, 0.055, 0));
    mug.add(mesh(cyl(0.057, 0.057, 0.012, 12), kit.mat(C.enamelRim), 0, 0.11, 0, false));
    const handle = mesh(new THREE.TorusGeometry(0.03, 0.008, 4, 8, Math.PI), kit.mat(C.enamel), 0.06, 0.055, 0, false);
    handle.rotation.z = -Math.PI / 2;
    mug.add(handle);
    mug.position.set(width / 2 - 0.25, height, -0.2);
    g.add(mug);
  } else if (deco === 1) {
    // A field radio with its antenna up.
    const radio = new THREE.Group();
    radio.add(mesh(box(0.3, 0.18, 0.16), kit.mat(C.olive), 0, 0.09, 0));
    radio.add(mesh(box(0.22, 0.08, 0.005), kit.mat('#2a2f22'), 0, 0.1, 0.081, false));
    for (const x of [-0.07, 0.07]) radio.add(mesh(cyl(0.018, 0.018, 0.02, 8).rotateX(Math.PI / 2), kit.mat(C.khaki), x, 0.1, 0.09, false));
    radio.add(tube(kit, v(0.11, 0.18, -0.04), v(0.16, 0.6, -0.08), 0.005, C.steelDark));
    radio.position.set(-width / 2 + 0.3, height, -0.28);
    radio.rotation.y = 0.2;
    g.add(radio);
  } else {
    const books = new THREE.Group();
    ['#6b7340', '#8a7a52', '#5a4632'].forEach((col, i) => {
      const b = mesh(box(0.26, 0.045, 0.19), kit.mat(col), 0, 0.0225 + i * 0.046, 0);
      b.rotation.y = (i - 1) * 0.15;
      books.add(b);
    });
    books.position.set(width / 2 - 0.35, height, -0.3);
    g.add(books);
  }
  // The clamp lamp on the back edge, at the end the bench's own clutter isn't.
  const lampSide = deco === 1 ? 1 : -1;
  const lamp = clampLamp(kit, lampSide === 1 ? -1 : 1);
  lamp.position.set(lampSide * (width / 2 - 0.2), height, -depth / 2 + 0.06);
  g.add(lamp);
  // A few cables trailing off the back of the bench to the floor.
  g.add(tube(kit, v(lampSide * (width / 2 - 0.22), height - 0.1, -depth / 2 + 0.03), v(lampSide * (width / 2 - 0.4), 0.02, -depth / 2 - 0.08), 0.01, C.cable));
  g.add(tube(kit, v(-0.1, height - 0.02, -depth / 2 + 0.04), v(0.1, 0.02, -depth / 2 - 0.1), 0.01, C.cable));
  return g;
}

/**
 * An old workshop chair for a bench: a round, cracked leather seat on a steel post with four splayed
 * feet, and a curved leather back pad on two steel bars. Same seat height as the office chair; its
 * back is on +z, the way the office chair's is.
 */
export function workshopChair(kit: Kit, index: number): THREE.Group {
  const g = new THREE.Group();
  const leather = kit.painted(`leather-${index % 3}`, () => drawLeather(['#6b3d24', '#5a3420', '#7a4a2a'][index % 3], index % 3 + 11));
  const dark = kit.mat(C.steelDark);
  g.add(mesh(cyl(0.3, 0.28, 0.1, 16), leather, 0, 0.5, 0));
  g.add(mesh(cyl(0.3, 0.3, 0.015, 16), dark, 0, 0.445, 0, false));
  g.add(mesh(cyl(0.035, 0.035, 0.36, 8), dark, 0, 0.26, 0));
  g.add(mesh(cyl(0.06, 0.06, 0.06, 8), dark, 0, 0.42, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(tube(kit, v(0, 0.12, 0), v(Math.sin(a) * 0.3, 0.02, Math.cos(a) * 0.3), 0.02));
    g.add(mesh(new THREE.SphereGeometry(0.03, 6, 4), dark, Math.sin(a) * 0.3, 0.02, Math.cos(a) * 0.3, false));
  }
  // The back: two bars up from under the seat to a curved pad.
  for (const sx of [-1, 1]) g.add(tube(kit, v(sx * 0.12, 0.45, 0.18), v(sx * 0.14, 0.9, 0.28), 0.016));
  const pad = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 12, 1, true, -0.55, 1.1), leather, 0, 0.88, -0.06);
  (pad.material as THREE.Material).side = THREE.DoubleSide;
  g.add(pad);
  return g;
}

/** A metal folding chair for the war room: olive steel, a slatted seat, back on +z. */
export function foldingChair(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const frame = kit.mat(C.oliveDark);
  const seat = kit.mat(C.olive);
  g.add(mesh(box(0.46, 0.04, 0.44), seat, 0, 0.48, 0));
  g.add(mesh(box(0.44, 0.24, 0.03), seat, 0, 0.84, 0.25));
  for (const sx of [-1, 1]) {
    // Front legs, angled forward, and the back legs running up into the back frame.
    g.add(tube(kit, v(sx * 0.21, 0.47, 0.18), v(sx * 0.22, 0, -0.22), 0.016, C.oliveDark));
    g.add(tube(kit, v(sx * 0.22, 0, 0.26), v(sx * 0.21, 0.98, 0.25), 0.016, C.oliveDark));
  }
  g.add(mesh(box(0.42, 0.02, 0.02), frame, 0, 0.08, -0.2));
  g.add(mesh(box(0.42, 0.02, 0.02), frame, 0, 0.08, 0.26));
  return g;
}

/**
 * A worn leather chesterfield, the lounge couch's size and shape (seat along z, back on -x): a
 * buttoned back, rolled arms, and an army blanket thrown over one end.
 */
export function chesterfield(kit: Kit, length: number): THREE.Group {
  const g = new THREE.Group();
  const leather = kit.painted('chesterfield', () => drawLeather('#5c2f1c', 21));
  const dark = kit.mat(C.leatherDark);
  g.add(mesh(roundedBox(1, 0.32, length, 0.08), leather, 0, 0.26, 0));
  // Seat cushions, a little sagged.
  const n = Math.max(2, Math.round(length / 1.3));
  const span = length - 0.7;
  for (let i = 0; i < n; i++) {
    const cz = -span / 2 + (i + 0.5) * (span / n);
    g.add(mesh(roundedBox(0.66, 0.14, span / n - 0.03, 0.06), leather, 0.12, 0.47, cz));
  }
  g.add(mesh(roundedBox(0.35, 0.86, length, 0.1), leather, -0.45, 0.55, 0));
  // Buttons tufting the back, in rows.
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < Math.round(length * 2.4); i++) {
      const z = -length / 2 + 0.35 + (i + (row % 2) * 0.5) * ((length - 0.7) / Math.round(length * 2.4));
      if (Math.abs(z) > length / 2 - 0.3) continue;
      g.add(mesh(new THREE.SphereGeometry(0.018, 5, 4), dark, -0.27, 0.72 + row * 0.16, z, false));
    }
  }
  // Rolled arms, the same height as the office couch's.
  for (const sz of [-1, 1]) {
    g.add(mesh(roundedBox(1, 0.62, 0.3, 0.08), leather, 0, 0.41, sz * (length / 2 - 0.15)));
    g.add(mesh(cyl(0.17, 0.17, 1, 12).rotateZ(Math.PI / 2), leather, 0, 0.74, sz * (length / 2 - 0.12)));
  }
  // Squat dark feet.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(cyl(0.05, 0.04, 0.1, 8), dark, sx * 0.42, 0.05, sz * (length / 2 - 0.1)));
  // An army blanket thrown over the back at one end.
  const blanket = kit.painted('blanket', () => drawCanvasCloth('#55603a', 5));
  const throwOver = new THREE.Group();
  throwOver.add(mesh(box(0.42, 0.04, 0.8), blanket, 0, 0, 0));
  throwOver.add(mesh(box(0.04, 0.5, 0.8), blanket, 0.22, -0.24, 0));
  throwOver.position.set(-0.45, 0.99, length / 2 - 0.85);
  g.add(throwOver);
  return g;
}

/**
 * An army duffel bag to sit on: a fat canvas roll lying on its side with a smaller one slumped
 * behind it as a back rest, strapped and stencilled. Sits in a bean bag's place (about 1.2 m across),
 * facing -z.
 */
export function duffel(kit: Kit, index: number): THREE.Group {
  const g = new THREE.Group();
  const cloth = kit.painted(`duffel-${index % 3}`, () => drawCanvasCloth(['#5d6b3a', '#6b6a42', '#4f5c35'][index % 3], 31 + index, `BNK-${String(index + 1).padStart(2, '0')}`));
  const strap = kit.mat('#2f3324');
  // The seat: lying across, on the floor.
  const seat = mesh(new THREE.CapsuleGeometry(0.3, 0.6, 4, 12).rotateZ(Math.PI / 2), cloth, 0, 0.27, -0.02);
  seat.scale.set(1, 0.85, 1.05);
  g.add(seat);
  // The back rest: a second bag stood up behind it, slumped.
  const back = mesh(new THREE.CapsuleGeometry(0.24, 0.5, 4, 12).rotateZ(Math.PI / 2), cloth, 0, 0.56, 0.3);
  back.rotation.x = -0.35;
  g.add(back);
  // Straps round each, with a buckle.
  for (const x of [-0.25, 0.25]) {
    const s = mesh(new THREE.TorusGeometry(0.27, 0.018, 4, 16), strap, x, 0.27, -0.02, false);
    s.rotation.y = Math.PI / 2;
    s.scale.set(1, 0.88, 1.05);
    g.add(s);
    g.add(mesh(box(0.05, 0.05, 0.02), strap, x, 0.32, -0.3, false));
  }
  // The carry handle on top.
  const handle = mesh(new THREE.TorusGeometry(0.1, 0.015, 4, 10, Math.PI), strap, 0, 0.5, -0.02, false);
  g.add(handle);
  return g;
}

/** A plain wooden supply crate for a lap desk, in the bean bag tray's place (top at 0.445). */
export function crateDesk(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const wood = kit.mat('#9a7448');
  const slat = kit.mat('#7a5a34');
  g.add(mesh(box(0.92, 0.42, 0.56), wood, 0, 0.21, 0));
  g.add(mesh(box(0.95, 0.025, 0.6), slat, 0, 0.433, 0));
  for (const y of [0.08, 0.3]) g.add(mesh(box(0.94, 0.05, 0.58), slat, 0, y, 0, false));
  for (const x of [-0.42, 0.42]) g.add(mesh(box(0.06, 0.42, 0.58), slat, x, 0.21, 0, false));
  return g;
}

/**
 * The lounge's coffee table as an old cable reel turned on its side: two wooden discs and a drum
 * between them, the top at the office table's height.
 */
export function cableReel(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const wood = kit.painted('reel', () => drawPlanks(9));
  const dark = kit.mat('#6e4a2a');
  g.add(mesh(cyl(0.9, 0.9, 0.07, 24), wood, 0, 0.425, 0));
  g.add(mesh(cyl(0.75, 0.75, 0.06, 20), dark, 0, 0.03, 0));
  g.add(mesh(cyl(0.32, 0.32, 0.34, 16), dark, 0, 0.22, 0));
  // Cable still wound round the drum.
  for (const y of [0.12, 0.2, 0.28]) g.add(mesh(new THREE.TorusGeometry(0.34, 0.035, 5, 18).rotateX(Math.PI / 2), kit.mat(C.cable), 0, y, 0, false));
  // Bolts round the top, and an enamel mug and a deck of cards on it.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(mesh(cyl(0.025, 0.025, 0.012, 6), kit.mat(C.steelDark), Math.sin(a) * 0.78, 0.466, Math.cos(a) * 0.78, false));
  }
  g.add(mesh(cyl(0.055, 0.055, 0.11, 12), kit.mat(C.enamel), 0.35, 0.515, -0.25));
  g.add(mesh(box(0.12, 0.04, 0.17), kit.mat('#8f2f2a'), -0.3, 0.48, 0.3));
  return g;
}

/**
 * An oil drum in the war room's corner, full of rolled-up maps and plans standing on end.
 */
export function mapDrum(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const drum = kit.painted('drum', () => drawSteel('#4f5c35', 101));
  g.add(mesh(cyl(0.29, 0.29, 0.86, 16), drum, 0, 0.43, 0));
  for (const y of [0.04, 0.3, 0.58, 0.84]) g.add(mesh(cyl(0.3, 0.3, 0.03, 16), kit.mat(C.oliveDark), 0, y, 0, false));
  const r = rng(5);
  ['#efe6cf', '#e3d6b5', '#d9e2e8', '#efe6cf', '#e8dcc0', '#cfdccb'].forEach((col, i) => {
    const a = (i / 6) * Math.PI * 2;
    const roll = mesh(cyl(0.045, 0.045, 0.5 + r() * 0.3, 8), kit.mat(col), Math.sin(a) * 0.15, 0.95, Math.cos(a) * 0.15);
    roll.rotation.set(Math.cos(a) * 0.18, 0, -Math.sin(a) * 0.18);
    g.add(roll);
  });
  return g;
}

/**
 * The war room's map table: a heavy wooden frame on trestles with a city map under its top, pins
 * stuck in the marked-up places and red string between them. Top at the meeting table's height,
 * the same size, so the laptops still sit on it.
 */
export function mapTable(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const { width, depth, height } = MEETING_TABLE;
  const wood = kit.painted('maptable', () => drawPlanks(13));
  const dark = kit.mat(C.steelDark);
  g.add(mesh(box(width, 0.08, depth), wood, 0, height - 0.045, 0));
  const map = kit.painted('citymap', drawCityMap);
  // Flat on the table: no ink outline round it (main.ts's noOutline does that for planes built at startup).
  map.userData.outlineParameters = { visible: false };
  g.add(mesh(new THREE.PlaneGeometry(width - 0.14, depth - 0.14).rotateX(-Math.PI / 2), map, 0, height + 0.001, 0, false));
  // A raised rim round the map.
  for (const sz of [-1, 1]) g.add(mesh(box(width, 0.03, 0.07), wood, 0, height + 0.01, sz * (depth / 2 - 0.035)));
  for (const sx of [-1, 1]) g.add(mesh(box(0.07, 0.03, depth - 0.14), wood, sx * (width / 2 - 0.035), height + 0.01, 0));
  // Trestles under each end, braced together.
  for (const sx of [-1, 1]) {
    const x = sx * (width / 2 - 0.5);
    for (const sz of [-1, 1]) {
      const leg = mesh(box(0.08, height - 0.08, 0.08), dark, x, (height - 0.08) / 2, sz * (depth / 2 - 0.25));
      leg.rotation.x = sz * 0.15;
      g.add(leg);
    }
    g.add(mesh(box(0.1, 0.06, depth - 0.15), dark, x, height - 0.12, 0));
    g.add(mesh(box(0.12, 0.05, depth), dark, x, 0.025, 0));
  }
  g.add(mesh(box(width - 1, 0.06, 0.06), dark, 0, 0.3, 0));
  // Pins: the map's marked places, from its texture into the table (u across x, v across z).
  const at = (u: number, w: number) => v((u - 0.5) * (width - 0.14), height, (w - 0.5) * (depth - 0.14));
  const spots = [at(200 / 1024, 90 / 342), at(520 / 1024, 150 / 342), at(880 / 1024, 90 / 342), at(330 / 1024, 260 / 342), at(690 / 1024, 120 / 342), at(760 / 1024, 280 / 342)];
  const colors = ['#d62828', '#d62828', '#d62828', '#2a6fdb', '#f2b705', '#2a6fdb'];
  const heads: THREE.Vector3[] = [];
  spots.forEach((p, i) => {
    g.add(mesh(cyl(0.004, 0.004, 0.05, 4), kit.mat('#c8c8c8'), p.x, p.y + 0.025, p.z, false));
    g.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), kit.mat(colors[i]), p.x, p.y + 0.055, p.z, false));
    heads.push(v(p.x, p.y + 0.045, p.z));
  });
  // String from pin to pin, the red ones joined up and the rest to the nearest red one.
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [0, 3],
    [1, 4],
    [2, 5],
  ]) {
    g.add(tube(kit, heads[a], heads[b], 0.003, '#b3201c'));
  }
  // A brass magnifier and a compass on the corners.
  const glass = new THREE.Group();
  glass.add(mesh(new THREE.TorusGeometry(0.06, 0.008, 5, 16).rotateX(Math.PI / 2), kit.mat(C.brass), 0, 0.01, 0, false));
  glass.add(mesh(box(0.12, 0.012, 0.022), kit.mat('#3b2a1a'), 0.12, 0.008, 0, false));
  glass.position.set(width / 2 - 0.35, height, -depth / 2 + 0.15);
  glass.rotation.y = 0.5;
  g.add(glass);
  return g;
}

/**
 * A rugged steel case round a screen in the wall's plane (the TV, the machine monitor, the boards):
 * a thick frame of `w` x `h` outside, corner brackets bolted on, and a couple of cables hanging out of
 * the bottom down to `drop` below its middle. Faces +z, like the office frames.
 */
export function ruggedFrame(kit: Kit, w: number, h: number, opts: { border?: number; depth?: number; drop?: number; color?: string; back?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const b = opts.border ?? 0.16;
  const d = opts.depth ?? 0.14;
  const steel = kit.painted(`frame-${opts.color ?? C.steel}`, () => drawSteel(opts.color ?? C.steel, 51));
  const dark = kit.mat(C.steelDark);
  // Four bars round the opening, so the screen in the middle stays uncovered.
  g.add(mesh(box(w, b, d), steel, 0, h / 2 - b / 2, 0));
  g.add(mesh(box(w, b, d), steel, 0, -h / 2 + b / 2, 0));
  g.add(mesh(box(b, h - 2 * b, d), steel, -w / 2 + b / 2, 0, 0));
  g.add(mesh(box(b, h - 2 * b, d), steel, w / 2 - b / 2, 0, 0));
  // Corner brackets with bolts.
  const s = Math.min(0.32, b * 2.2);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = sx * (w / 2 - s / 2 + 0.02);
      const cy = sy * (h / 2 - s / 2 + 0.02);
      g.add(mesh(box(s, 0.04, d + 0.02), dark, cx, sy * (h / 2 - 0.02 + 0.02), 0, false));
      g.add(mesh(box(0.04, s, d + 0.02), dark, sx * (w / 2 - 0.02 + 0.02), cy, 0, false));
      g.add(mesh(cyl(0.02, 0.02, 0.02, 6).rotateX(Math.PI / 2), kit.mat(C.brass), sx * (w / 2 - b / 2), sy * (h / 2 - b / 2), d / 2 + 0.01, false));
    }
  }
  // A back, for a screen that's seen from behind too (not one on a wall).
  if (opts.back) g.add(mesh(box(w - 0.02, h - 0.02, 0.03), dark, 0, 0, -d / 2 + 0.015));
  // Cables from under it, sagging down the wall.
  if (opts.drop) {
    for (const [x0, x1] of [
      [-0.2, -0.32],
      [0.05, 0.14],
    ]) {
      const a = v(x0 * Math.min(1, w / 2), -h / 2, -d / 4);
      const m = v((x0 + x1) / 2, -h / 2 - opts.drop * 0.5, 0.02);
      const e = v(x1, -h / 2 - opts.drop, -d / 4);
      g.add(tube(kit, a, m, 0.016, C.cable));
      g.add(tube(kit, m, e, 0.016, C.cable));
    }
  }
  return g;
}

/**
 * A board agent's kiosk as a stencilled steel lectern: a tapered olive box with a band in the
 * agent's color, on a crate base, the same size as the kiosk.
 */
export function steelLectern(kit: Kit, color: string): THREE.Group {
  const g = new THREE.Group();
  const { width, depth, height } = KIOSK;
  g.add(mesh(box(width - 0.16, height - 0.1, depth - 0.12), kit.painted('lectern', () => drawSteel(C.olive, 61)), 0, (height - 0.1) / 2 + 0.04, 0));
  g.add(mesh(box(width - 0.14, 0.06, depth - 0.1), kit.mat(color), 0, height - 0.14, 0));
  g.add(mesh(box(width - 0.02, 0.06, depth + 0.02), kit.mat('#7a5a34'), 0, 0.03, 0));
  g.add(mesh(box(width, 0.05, depth), kit.mat(C.steelDark), 0, height - 0.025, 0));
  return g;
}

/**
 * The camp kitchen in the kitchen corner's place (5 m long, in front of the south wall): steel
 * shelving and crates under a scrubbed plank counter, a camp stove with a kettle, a stack of enamel
 * mugs and tins, and an army-green steel fridge where the fridge was.
 */
export function campKitchen(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const steel = kit.painted('kitchen-steel', () => drawSteel('#5f675f', 71));
  const dark = kit.mat(C.steelDark);
  const crate = kit.mat('#9a7448');
  // The counter: a long plank top on steel uprights, with crates and a shelf under it.
  g.add(mesh(box(5.1, 0.08, 1.1), kit.painted('counter', () => drawPlanks(17)), 0, 0.99, 0));
  for (const x of [-2.45, -0.8, 0.85, 2.45]) {
    for (const z of [-0.42, 0.42]) g.add(mesh(box(0.06, 0.95, 0.06), steel, x, 0.475, z));
  }
  g.add(mesh(box(5, 0.04, 0.95), steel, 0, 0.12, 0));
  g.add(mesh(box(5, 0.04, 0.95), steel, 0, 0.5, 0));
  // A back panel against the wall (+z), behind the crates.
  g.add(mesh(box(5, 0.95, 0.04), dark, 0, 0.475, 0.48));
  for (const [x, y, w] of [
    [-1.9, 0.29, 0.8],
    [-0.1, 0.29, 0.7],
    [1.6, 0.29, 0.75],
    [-1.2, 0.71, 0.6],
    [1.0, 0.71, 0.9],
  ]) {
    g.add(mesh(box(w, 0.3, 0.6), crate, x, y, 0.05));
    g.add(mesh(box(w + 0.01, 0.04, 0.61), kit.mat('#7a5a34'), x, y + 0.07, 0.05, false));
  }
  // The coffee: an old percolator on a two-burner camp stove (it's still where the coffee comes from).
  const coffee = new THREE.Group();
  coffee.add(mesh(box(0.6, 0.12, 0.42), kit.mat('#2f5d3a'), 0, 0.06, 0));
  coffee.add(mesh(box(0.6, 0.3, 0.02), kit.mat('#2f5d3a'), 0, 0.27, 0.2));
  for (const x of [-0.15, 0.15]) coffee.add(mesh(new THREE.TorusGeometry(0.08, 0.012, 4, 12).rotateX(Math.PI / 2), dark, x, 0.13, 0, false));
  coffee.add(mesh(new THREE.SphereGeometry(0.03, 6, 4), kit.mat('#ff9a3c', '#ff7a1a'), 0.27, 0.06, -0.21, false));
  const pot = new THREE.Group();
  pot.add(mesh(cyl(0.07, 0.1, 0.3, 12), kit.mat('#b8bcbc'), 0, 0.15, 0));
  pot.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), kit.mat('#d8dcd8'), 0, 0.32, 0));
  pot.add(tube(kit, v(0.08, 0.2, 0), v(0.15, 0.27, 0), 0.012, '#b8bcbc'));
  const handle = mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI), dark, -0.1, 0.17, 0, false);
  handle.rotation.z = Math.PI / 2;
  pot.add(handle);
  pot.position.set(-0.15, 0.14, 0);
  coffee.add(pot);
  const kettle = new THREE.Group();
  kettle.add(mesh(cyl(0.09, 0.11, 0.14, 12), kit.mat(C.enamel), 0, 0.07, 0));
  kettle.add(mesh(new THREE.TorusGeometry(0.06, 0.01, 4, 10, Math.PI), dark, 0, 0.16, 0, false));
  kettle.position.set(0.15, 0.14, 0);
  coffee.add(kettle);
  coffee.position.set(-1.2, 1.03, 0);
  g.add(coffee);
  // Enamel mugs stacked by the stove, and tins along the back of the counter.
  for (let i = 0; i < 3; i++) {
    g.add(mesh(cyl(0.05, 0.045, 0.1, 10), kit.mat(C.enamel), -0.62, 1.08 + i * 0.085, 0.25 - i * 0.004, false));
    g.add(mesh(cyl(0.052, 0.052, 0.012, 10), kit.mat(C.enamelRim), -0.62, 1.13 + i * 0.085, 0.25 - i * 0.004, false));
  }
  const r = rng(3);
  for (let i = 0; i < 5; i++) {
    const h = 0.12 + r() * 0.06;
    g.add(mesh(cyl(0.06, 0.06, h, 10), kit.mat(['#8a8f5a', '#a8452f', '#c9b77a'][i % 3]), 0.2 + i * 0.16, 1.03 + h / 2, 0.32, false));
  }
  // A water jerrycan at the back by the fridge.
  const can = new THREE.Group();
  can.add(mesh(box(0.34, 0.45, 0.16), kit.mat('#3f5a7a'), 0, 0.225, 0));
  can.add(mesh(box(0.08, 0.06, 0.06), dark, -0.1, 0.48, 0, false));
  can.position.set(2.2, 1.03, 0.3);
  g.add(can);
  // The fridge: an olive steel locker of a fridge with a big lever handle and a stencil.
  const fridge = new THREE.Group();
  fridge.add(mesh(roundedBox(1.1, 2.2, 1, 0.05), kit.painted('fridge', () => drawSteel('#56623e', 81)), 0, 1.1, 0));
  fridge.add(mesh(box(1.02, 0.02, 0.02), dark, 0, 1.4, 0.505, false));
  fridge.add(mesh(box(0.08, 0.5, 0.08), kit.mat('#b8bcbc'), -0.45, 1.4, 0.54));
  for (const y of [0.4, 2.0]) fridge.add(mesh(box(0.1, 0.12, 0.05), dark, 0.5, y, 0.51, false));
  fridge.position.set(3.2, 0, 0);
  g.add(fridge);
  return g;
}

/**
 * The boss's desk upstairs as an officer's steel desk: an olive steel pedestal desk with a worn
 * leather top inlay, the same size as the office's (2.6 x 1.2, top at 0.83).
 */
export function officerDesk(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const steel = kit.painted('officer', () => drawSteel('#5b6644', 91));
  g.add(mesh(box(2.6, 0.08, 1.2), steel, 0, 0.79, 0));
  g.add(mesh(box(2.3, 0.01, 0.95), kit.painted('desk-leather', () => drawLeather('#2f3d2a', 92)), 0, 0.835, 0.03, false));
  for (const sx of [-1, 1]) {
    g.add(mesh(box(0.6, 0.74, 1.05), steel, sx * 0.95, 0.37, 0));
    for (const y of [0.18, 0.42, 0.64]) g.add(mesh(box(0.2, 0.03, 0.03), kit.mat('#b8bcbc'), sx * 0.95, y, 0.54, false));
  }
  g.add(mesh(box(1.3, 0.6, 0.04), kit.mat(C.steelDark), 0, 0.44, -0.5));
  // A field telephone on the corner.
  const phone = new THREE.Group();
  phone.add(mesh(box(0.22, 0.12, 0.18), kit.mat('#3c4630'), 0, 0.06, 0));
  phone.add(mesh(cyl(0.03, 0.03, 0.22, 8).rotateZ(Math.PI / 2), kit.mat('#222'), 0, 0.15, 0));
  phone.position.set(-1.0, 0.83, 0.25);
  g.add(phone);
  return g;
}
