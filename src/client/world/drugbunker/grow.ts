// The bunker's grow station: a row of fabric pots down the west wall, under a rail of grow lamps, with
// a watering can, a spray bottle and a sack of soil at the end. What's in the pots is yours (each
// person sees their own): soil, a plant growing seedling → vegetative → flowering → ready, drooping
// and going yellow when it's dry, brown when it's dead, with bugs on it when it has pests, and the lamp
// you hung over it lit. Between the office's updates the plants go on growing by the same model
// (shared/bunker/grow.ts), so nothing jumps.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BunkerPerson, StationSpot } from '../../../shared/bunker/index';
import { DIES_AFTER, MAX_POTS, growStep, type Plant, type Pot } from '../../../shared/bunker/grow';
import type { Collider } from '../office';
import { mergeByMaterial, mesh, toon, toonUnique } from '../toon';
import type { StationView } from './station';

/** Where the pots stand in the station's frame: spaced along its front, a little off the wall. */
export function potSlot(i: number, w: number, d: number): { x: number; z: number } {
  const step = w / MAX_POTS;
  return { x: -w / 2 + step * (i + 0.5), z: -d / 2 + 0.55 };
}

const POT_H = 0.3;
const POT_R = 0.17;
/** How high the lamps hang, and the rail they hang from. */
const LAMP_Y = 1.72;
const RAIL_Y = 1.98;

/** Each strain's look: its leaves, and its buds when they're ready. */
const LOOKS: Record<string, { leaf: string; bud: string }> = {
  'seed-skunk': { leaf: '#5aa83a', bud: '#d6e0a0' },
  'seed-kush': { leaf: '#3f7d3a', bud: '#c4a2d4' },
  'seed-haze': { leaf: '#78bd3a', bud: '#e8eea0' },
};
const WILTED = new THREE.Color('#b59a3a');
const DEAD = new THREE.Color('#6b4a2a');
const BUD_YOUNG = new THREE.Color('#a8d860');

/** A fan leaf: seven narrow leaflets spread from one point, in the xz plane, pointing +x; 1 m long. */
function fanLeaf(): THREE.BufferGeometry {
  const leaflet = new THREE.Shape();
  leaflet.moveTo(0, 0);
  leaflet.quadraticCurveTo(0.17, 0.4, 0, 1);
  leaflet.quadraticCurveTo(-0.17, 0.4, 0, 0);
  const parts: THREE.BufferGeometry[] = [];
  const fan: [number, number][] = [
    [0, 1],
    [0.42, 0.85],
    [-0.42, 0.85],
    [0.85, 0.62],
    [-0.85, 0.62],
    [1.25, 0.35],
    [-1.25, 0.35],
  ];
  for (const [angle, len] of fan) {
    const g = new THREE.ShapeGeometry(leaflet, 4);
    g.scale(len, len, 1);
    g.rotateZ(-Math.PI / 2 + angle);
    parts.push(g);
  }
  const leaf = mergeGeometries(parts)!;
  leaf.rotateX(-Math.PI / 2);
  for (const g of parts) g.dispose();
  return leaf;
}

/** One plant's model, made once per pot and shaped every frame to how it's doing. */
interface PlantModel {
  group: THREE.Group;
  set(plant: Plant, t: number): void;
}

/** Three leaves at each node up the stem, turned a little each node; buds at the nodes and a cola on top. */
const NODES = 7;
const PER_NODE = 3;

function buildPlant(leafGeo: THREE.BufferGeometry, seed: number): PlantModel {
  const group = new THREE.Group();
  group.name = 'grow-plant';
  const leafMat = toonUnique('#5aa83a');
  leafMat.side = THREE.DoubleSide;
  const stemMat = toonUnique('#4a7a2c');
  const budMat = toonUnique('#a8d860');
  const stem = mesh(new THREE.CylinderGeometry(0.008, 0.014, 1, 6).translate(0, 0.5, 0), stemMat, 0, 0, 0, false);
  group.add(stem);
  const leaves: { pivot: THREE.Group; leaf: THREE.Mesh; node: number; size: number }[] = [];
  const buds: { m: THREE.Mesh; node: number }[] = [];
  const budGeo = new THREE.SphereGeometry(1, 8, 6).scale(1, 1.6, 1);
  for (let n = 0; n < NODES; n++) {
    for (let k = 0; k < PER_NODE; k++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (k * 2 * Math.PI) / PER_NODE + n * 0.9 + seed * 0.7;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.castShadow = false;
      pivot.add(leaf);
      group.add(pivot);
      // The lowest leaves are the biggest.
      leaves.push({ pivot, leaf, node: n, size: 1 - n * 0.08 });
    }
    const bud = mesh(budGeo, budMat, 0, 0, 0, false);
    group.add(bud);
    buds.push({ m: bud, node: n });
  }
  const cola = mesh(budGeo, budMat, 0, 0, 0, false);
  group.add(cola);
  // Little white bugs, when it has pests.
  const bugs = new THREE.Group();
  const bugMat = toon('#f2f2ea');
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + seed;
    bugs.add(mesh(new THREE.SphereGeometry(0.009, 5, 4), bugMat, Math.cos(a) * (0.05 + (i % 3) * 0.05), 0.15 + (i % 4) * 0.12, Math.sin(a) * (0.05 + (i % 3) * 0.05), false));
  }
  group.add(bugs);
  const color = new THREE.Color();
  return {
    group,
    set(plant, t) {
      const g = plant.growth;
      const look = LOOKS[plant.seed] ?? LOOKS['seed-kush'];
      // How tall: a sprout, then shooting up, then filling out while it flowers.
      const height = g < 1 ? 0.04 + 0.14 * g : g < 2 ? 0.18 + 0.42 * (g - 1) : 0.6 + 0.25 * Math.min(1, g - 2);
      const shown = g < 1 ? 1 : Math.min(NODES, 1 + Math.floor((g - 1) * NODES * 1.2));
      const wilt = plant.dead ? 1 : Math.min(1, plant.dry / DIES_AFTER + (1 - plant.care) * 0.25 * (plant.dry > 0 ? 1 : 0));
      stem.scale.set(1 + height * 2, height, 1 + height * 2);
      for (const l of leaves) {
        const on = l.node < shown;
        l.pivot.visible = on;
        if (!on) continue;
        const y = height * (shown === 1 ? 0.9 : 0.15 + (0.8 * l.node) / Math.max(1, shown - 1));
        l.pivot.position.y = y;
        const s = Math.max(0.035, Math.min(0.24, height * 0.5 * l.size * (g < 1 ? 0.8 : 1)));
        l.leaf.scale.setScalar(s);
        // Up and out when it's fine, hanging down when it's dry; and a little sway.
        l.leaf.rotation.z = 0.25 - wilt * 1.25 + Math.sin(t * 0.9 + l.node + seed) * 0.03;
      }
      color.set(look.leaf).lerp(plant.dead ? DEAD : WILTED, plant.dead ? 1 : wilt);
      leafMat.color.copy(color);
      stemMat.color.copy(color).multiplyScalar(0.8);
      // Buds from the flowering on: bigger and frostier until it's ready.
      const bloom = Math.max(0, Math.min(1, g - 2));
      const budsOn = g >= 2 && !plant.dead;
      budMat.color.copy(BUD_YOUNG).lerp(color.set(look.bud), bloom);
      for (const b of buds) {
        b.m.visible = budsOn && b.node < shown && b.node > 0;
        b.m.position.y = height * (0.15 + (0.8 * b.node) / Math.max(1, shown - 1)) + 0.01;
        b.m.scale.setScalar(0.012 + 0.018 * bloom);
      }
      cola.visible = budsOn;
      cola.position.y = height + 0.02;
      cola.scale.setScalar(0.02 + 0.03 * bloom);
      bugs.visible = !!plant.pests && !plant.dead;
      bugs.scale.setScalar(Math.max(0.3, height / 0.85));
      group.rotation.z = Math.sin(t * 0.6 + seed) * 0.015 * (1 - wilt);
    },
  };
}

export function buildGrow(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-grow';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  const statics = new THREE.Group();
  const steel = toon('#5d646a');
  const dark = toon('#2b2f33');
  const fabric = toon('#3b3d3a');
  const tray = toon('#5b4a3a');

  // The rail the lamps hang from, on two uprights at the ends.
  const half = spot.w / 2 - 0.06;
  const railZ = potSlot(0, spot.w, spot.d).z;
  for (const x of [-half, half]) statics.add(mesh(new THREE.BoxGeometry(0.05, RAIL_Y, 0.05), steel, x, RAIL_Y / 2, railZ));
  const rail = mesh(new THREE.CylinderGeometry(0.02, 0.02, half * 2, 8), steel, 0, RAIL_Y, railZ, false);
  rail.rotation.z = Math.PI / 2;
  statics.add(rail);
  // A cable along the wall, down to a power strip.
  statics.add(mesh(new THREE.BoxGeometry(half * 2, 0.02, 0.02), dark, 0, RAIL_Y - 0.06, -spot.d / 2 + 0.02, false));
  statics.add(mesh(new THREE.BoxGeometry(0.4, 0.05, 0.07), toon('#d8d8d0'), half - 0.4, 0.3, -spot.d / 2 + 0.04));

  // The watering can, the spray bottle and a sack of soil, at the south end in front of the row.
  const endX = half - 0.25;
  const front = spot.d / 2 - 0.25;
  const canMat = toon('#3f8f5a');
  statics.add(mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.22, 12), canMat, endX, 0.11, front));
  const spout = mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.28, 6), canMat, endX - 0.16, 0.2, front);
  spout.rotation.z = 0.9;
  statics.add(spout);
  const handle = mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 12, Math.PI), canMat, endX + 0.02, 0.22, front);
  statics.add(handle);
  statics.add(mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.2, 10), toon('#e8eef2'), endX - 0.05, 0.1, front - 0.24));
  statics.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), toon('#d04545'), endX - 0.05, 0.225, front - 0.24));
  const sack = mesh(new THREE.BoxGeometry(0.42, 0.14, 0.3), toon('#7a5a3a'), -half + 0.3, 0.07, front - 0.05);
  sack.rotation.y = 0.2;
  statics.add(sack);

  // Each pot: a fabric pot on a tray, its soil, its plant and its lamp. The ones you haven't got aren't there.
  const leafGeo = fanLeaf();
  const soilMat = toon('#4a3423');
  const premiumMat = toon('#2e2218');
  const potGeo = new THREE.CylinderGeometry(POT_R, POT_R * 0.82, POT_H, 16).translate(0, POT_H / 2, 0);
  const trayGeo = new THREE.CylinderGeometry(POT_R * 0.82 + 0.035, POT_R * 0.82 + 0.02, 0.025, 16).translate(0, 0.0125, 0);
  const rimGeo = new THREE.TorusGeometry(POT_R, 0.014, 6, 20).rotateX(Math.PI / 2).translate(0, POT_H, 0);
  const soilGeo = new THREE.CircleGeometry(POT_R - 0.015, 16).rotateX(-Math.PI / 2);
  const hoodMat = toonUnique('#9aa0a4');
  hoodMat.side = THREE.DoubleSide;
  const ledMat = toon('#20232a');
  const bulbGlow = new THREE.MeshBasicMaterial({ color: '#ffcf7a' });
  bulbGlow.toneMapped = false;
  const ledGlow = new THREE.MeshBasicMaterial({ color: '#ff6ad5' });
  ledGlow.toneMapped = false;
  interface PotModel {
    root: THREE.Group;
    soil: THREE.Mesh;
    plant: PlantModel;
    lamp: THREE.Group;
    led: THREE.Group;
  }
  const pots: PotModel[] = [];
  for (let i = 0; i < MAX_POTS; i++) {
    const at = potSlot(i, spot.w, spot.d);
    const root = new THREE.Group();
    root.name = `grow-pot-${i}`;
    root.position.set(at.x, 0, at.z);
    root.add(mesh(potGeo, fabric, 0, 0, 0));
    root.add(mesh(trayGeo, tray, 0, 0, 0, false));
    root.add(mesh(rimGeo, fabric, 0, 0, 0, false));
    const soil = mesh(soilGeo, soilMat, 0, POT_H - 0.03, 0, false);
    root.add(soil);
    const plant = buildPlant(leafGeo, i * 1.37);
    plant.group.position.y = POT_H - 0.03;
    root.add(plant.group);
    group.add(root);
    // The lamps hang over it on chains from the rail: a reflector hood with a bulb, or a flat LED panel.
    const lamp = new THREE.Group();
    lamp.add(mesh(new THREE.CylinderGeometry(0.06, 0.2, 0.12, 14, 1, true), hoodMat, 0, LAMP_Y, 0, false));
    lamp.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), bulbGlow, 0, LAMP_Y - 0.03, 0, false));
    lamp.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, RAIL_Y - LAMP_Y - 0.06, 4), dark, 0, (RAIL_Y + LAMP_Y + 0.06) / 2, 0, false));
    lamp.position.set(at.x, 0, at.z);
    const led = new THREE.Group();
    led.add(mesh(new THREE.BoxGeometry(0.42, 0.035, 0.3), ledMat, 0, LAMP_Y, 0, false));
    led.add(mesh(new THREE.BoxGeometry(0.38, 0.004, 0.26), ledGlow, 0, LAMP_Y - 0.019, 0, false));
    for (const x of [-0.18, 0.18]) led.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, RAIL_Y - LAMP_Y, 4), dark, x, (RAIL_Y + LAMP_Y) / 2, 0, false));
    led.position.set(at.x, 0, at.z);
    group.add(lamp, led);
    pots.push({ root, soil, plant, lamp, led });
  }
  group.add(mergeByMaterial(statics));

  // You can't walk through the row of pots (the space in front of them is free).
  const reach = potSlot(0, spot.w, spot.d).z + POT_R + 0.08;
  const corners = [
    { x: -spot.w / 2, z: -spot.d / 2 },
    { x: spot.w / 2, z: reach },
  ].map((p) => {
    const c = Math.cos(spot.rotY);
    const s = Math.sin(spot.rotY);
    return { x: spot.x + p.x * c + p.z * s, z: spot.z - p.x * s + p.z * c };
  });
  const colliders: Collider[] = [
    {
      minX: Math.min(corners[0].x, corners[1].x),
      maxX: Math.max(corners[0].x, corners[1].x),
      minZ: Math.min(corners[0].z, corners[1].z),
      maxZ: Math.max(corners[0].z, corners[1].z),
      top: 1.2,
      fence: true,
    },
  ];

  // The office's last word on your pots, and when (on this clock) it came: they go on growing from there.
  let last: BunkerPerson | null = null;
  let since = 0;
  let shownAt = -1;
  const view: Pot = {};
  const show = (mine: BunkerPerson | null, t: number) => {
    const have = mine?.grow?.pots ?? null;
    const elapsed = Math.max(0, t - since);
    for (let i = 0; i < MAX_POTS; i++) {
      const m = pots[i];
      // Before the office has said, four empty pots (what everyone starts with).
      const pot: Pot | undefined = have ? have[i] : i < 4 ? {} : undefined;
      m.root.visible = !!pot;
      m.lamp.visible = pot?.lamp === 'lamp';
      m.led.visible = pot?.lamp === 'lamp-led';
      if (!pot) continue;
      m.soil.visible = !!pot.soil;
      m.soil.material = pot.soil === 'soil-premium' ? premiumMat : soilMat;
      m.plant.group.visible = !!pot.plant;
      if (!pot.plant) continue;
      // The plant as it is by now: the office's, grown on by the time since (no pests guessed).
      view.lamp = pot.lamp;
      view.plant = { ...pot.plant };
      growStep(view, elapsed);
      m.plant.set(view.plant, t);
    }
  };

  return {
    group,
    colliders,
    update(t, _dt, mine) {
      if (mine !== last) {
        last = mine;
        since = t;
      }
      // A few times a second is plenty for something that grows over minutes (the sway with it).
      if (t - shownAt < 0.1 && t >= shownAt) return;
      shownAt = t;
      show(mine, t);
    },
  };
}
