// The bunker's lab station: a steel bench against the north wall with a pegboard over it. What's on it
// is your own kit (see shared/bunker/lab.ts): the burner with a flask on a ring stand over it, a second
// flask for the drops, and the tablet press, each there once you've bought it. While a batch is on the
// bench its flask fills, the burner's flame burns while it's being heated, and steam (or a puff of
// powder at the press) rises off it.
import * as THREE from 'three';
import { countItem, stationBox, type BunkerPerson, type StationSpot } from '../../../shared/bunker/index';
import { playing, recipe } from '../../../shared/bunker/lab';
import { mergeByMaterial, mesh, toon } from '../toon';
import type { StationView } from './station';

/** The bench top's height. */
const TOP = 0.92;
/** Where each piece of kit stands along the bench (x in the station's frame). */
const AT = { burner: -1.05, nebula: -0.1, press: 1.0 } as const;
/** How many puffs of steam rise at once. */
const PUFFS = 10;

/** See-through and not outlined: glass, liquid, steam. */
function clear(color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** A round-bottomed flask: a bulb and a neck, with the liquid in it (hidden until there's a batch). */
function flask(glass: THREE.Material, liquid: THREE.MeshBasicMaterial): { group: THREE.Group; fill: THREE.Mesh } {
  const group = new THREE.Group();
  group.add(mesh(new THREE.SphereGeometry(0.09, 16, 12), glass, 0, 0.09, 0, false));
  group.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.14, 12), glass, 0, 0.24, 0, false));
  const fill = mesh(new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), liquid, 0, 0.09, 0, false);
  fill.visible = false;
  group.add(fill);
  return { group, fill };
}

export function buildLab(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-lab';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  const w = spot.w - 0.1;
  const d = spot.d - 0.1;
  const back = -spot.d / 2;

  const steel = toon('#8c949b');
  const dark = toon('#3a3f44');
  const board = toon('#b88c5a');
  const paper = toon('#efe9d8');

  // ---- The bench, the shelf under it and the pegboard over it: never moves --------------------------------
  const bench = new THREE.Group();
  bench.add(mesh(new THREE.BoxGeometry(w, 0.04, d), steel, 0, TOP - 0.02, 0));
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) bench.add(mesh(new THREE.BoxGeometry(0.04, TOP - 0.04, 0.04), dark, x, (TOP - 0.04) / 2, z));
  bench.add(mesh(new THREE.BoxGeometry(w - 0.1, 0.03, d - 0.1), dark, 0, 0.22, 0));
  // A crate and a jug on the shelf.
  bench.add(mesh(new THREE.BoxGeometry(0.5, 0.26, 0.4), toon('#8a6a3f'), -1.0, 0.37, 0));
  bench.add(mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.3, 12), toon('#5d87a8'), 0.6, 0.39, 0.05));
  // The pegboard on the wall, a lamp over it, and a few tools hanging there.
  bench.add(mesh(new THREE.BoxGeometry(w - 0.3, 0.7, 0.02), board, 0, TOP + 0.65, back + 0.02, false));
  for (const [x, len] of [
    [-0.9, 0.22],
    [-0.75, 0.18],
    [0.45, 0.25],
    [0.6, 0.2],
    [0.75, 0.16],
  ] as const)
    bench.add(mesh(new THREE.BoxGeometry(0.03, len, 0.02), dark, x, TOP + 0.75 - len / 2, back + 0.045, false));
  bench.add(mesh(new THREE.BoxGeometry(0.6, 0.05, 0.12), dark, 0, TOP + 1.05, back + 0.1, false));
  // A notebook on the bench.
  bench.add(mesh(new THREE.BoxGeometry(0.22, 0.015, 0.3), paper, 0.35, TOP + 0.008, 0.15, false));
  group.add(mergeByMaterial(bench));

  // ---- Your kit -------------------------------------------------------------------------------------------
  const glass = clear('#cfe8f2', 0.35);
  const blue = clear('#3fa7e0', 0.85);
  const violet = clear('#8a5cd6', 0.85);

  // The burner, with its flame (lit while a batch is being heated).
  const burner = new THREE.Group();
  burner.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 14), dark, 0, 0.025, 0));
  burner.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 8), steel, 0, 0.1, 0));
  const flameMat = clear('#58a8ff', 0.8);
  const flame = mesh(new THREE.ConeGeometry(0.025, 0.08, 10), flameMat, 0, 0, 0, false);
  flame.visible = false;
  burner.position.set(AT.burner, TOP, 0);
  group.add(burner);

  // The flask set: one on a ring stand over the burner, one for the drops.
  const flasks = new THREE.Group();
  const stand = new THREE.Group();
  stand.add(mesh(new THREE.BoxGeometry(0.2, 0.015, 0.16), dark, 0.0, 0.008, -0.12));
  stand.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), steel, 0.0, 0.25, -0.17));
  const ring = mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 18), steel, 0, 0.27, 0);
  ring.rotation.x = Math.PI / 2;
  stand.add(ring);
  stand.add(mesh(new THREE.BoxGeometry(0.01, 0.01, 0.17), steel, 0, 0.27, -0.09));
  const heated = flask(glass, blue);
  heated.group.position.set(0, 0.23, 0);
  stand.add(heated.group);
  stand.position.set(AT.burner, TOP, 0);
  flasks.add(stand);
  const swirl = flask(glass, violet);
  swirl.group.position.set(AT.nebula, TOP, 0.05);
  flasks.add(swirl.group);
  // And three little bottles beside it: the drops.
  for (const [i, c] of ['#f2d16b', '#d68a2e', '#3fa7e0'].entries()) {
    flasks.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.09, 10), toon(c), AT.nebula + 0.2 + i * 0.07, TOP + 0.045, -0.05));
  }
  group.add(flasks);

  // The tablet press: a base, a column, the head and its lever.
  const press = new THREE.Group();
  press.add(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.26), dark, 0, 0.03, 0));
  press.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 10), steel, 0, 0.285, -0.08));
  const head = new THREE.Group();
  head.add(mesh(new THREE.BoxGeometry(0.16, 0.1, 0.22), toon('#c0392b'), 0, 0, 0));
  head.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8), steel, 0, -0.08, 0.04));
  const lever = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), steel, 0.17, 0.05, 0);
  lever.rotation.z = Math.PI / 2.6;
  head.add(lever);
  head.position.set(0, 0.42, 0);
  press.add(head);
  press.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 14), steel, 0, 0.068, 0.04));
  press.position.set(AT.press, TOP, 0);
  group.add(press);
  group.add(flame);
  flame.position.set(AT.burner, TOP + 0.19, 0);

  // ---- Steam ----------------------------------------------------------------------------------------------
  const steam = new THREE.Group();
  const puffs: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  for (let i = 0; i < PUFFS; i++) {
    const mat = clear('#f4f6f8', 0);
    const m = mesh(new THREE.SphereGeometry(0.035, 8, 6), mat, 0, 0, 0, false);
    steam.add(m);
    puffs.push({ m, mat, phase: i / PUFFS });
  }
  steam.visible = false;
  group.add(steam);

  const box = stationBox(spot);
  return {
    group,
    colliders: [{ ...box, top: TOP }],
    update(t, _dt, mine: BunkerPerson | null) {
      const inv = mine?.inventory ?? {};
      burner.visible = countItem(inv, 'burner') > 0;
      flasks.visible = countItem(inv, 'flasks') > 0;
      press.visible = countItem(inv, 'press') > 0;
      const batch = mine?.lab?.batch ?? null;
      const r = recipe(batch?.recipe);
      const cooking = !!r && playing(batch);
      heated.fill.visible = r?.id === 'glimmer';
      swirl.fill.visible = r?.id === 'nebula';
      flame.visible = burner.visible && r?.id === 'glimmer' && cooking;
      if (flame.visible) flame.scale.set(1, 0.85 + Math.sin(t * 23) * 0.15, 1);
      // The press's head goes up and down while tablets are being pressed.
      head.position.y = r?.id === 'fizz' && cooking ? 0.39 + Math.abs(Math.sin(t * 4)) * 0.04 : 0.42;
      if (r?.id === 'nebula') swirl.fill.rotation.y = t * (cooking ? 3 : 1.2);
      // Steam off what's on the bench: thick while it's being made, thinner while it rests.
      steam.visible = !!r;
      if (!r) return;
      const x = r.id === 'glimmer' ? AT.burner : r.id === 'nebula' ? AT.nebula : AT.press;
      const y = TOP + (r.id === 'glimmer' ? 0.6 : r.id === 'nebula' ? 0.32 : 0.12);
      const strength = cooking ? 0.55 : 0.25;
      for (const p of puffs) {
        const f = (t * 0.45 + p.phase) % 1;
        p.m.position.set(x + Math.sin((p.phase + f) * 9) * 0.04, y + f * 0.45, Math.cos((p.phase + f) * 7) * 0.03);
        p.m.scale.setScalar(0.6 + f * 1.6);
        p.mat.opacity = strength * Math.sin(f * Math.PI);
      }
    },
  };
}
