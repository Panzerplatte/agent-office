import * as THREE from 'three';
import type { BunkerContext, BunkerPart } from './index';
import { buildBunkerProps, type PlantSpot } from './clutter/place';

// The bunker's props: what makes it a bunker beyond its walls and furniture.
//  - Crates, oil drums, sandbags, camo netting, jerry cans, toolboxes, in corners and along walls,
//    out of the walkways (no new colliders: keep them where nobody walks, or low and against a wall).
//  - A workshop corner (workbench with tools, a vice, a pegboard), a vehicle bay (a cartoony jeep or
//    quad under a tarp), our own "BUNKER" signage, hazard stripes, stencilled numbers.
//  - Cartoony and cosy, toon materials; no weapons on display, no GTA/Rockstar names or logos.
//  - The office's potted plants (look.plants, and the two in the boss's office upstairs) are hidden,
//    and a drum, ammo-box tins, a fire point or jerrycans stand in each one's place, inside its
//    collider. The desks' little plants go with the desks (furniture.ts). The balcony's aren't ours.
// Mind what's on the walls already (office.fixtures()) and the floor plan (ctx.layout).
// Not here: walls, floor, ceiling, lights (shell.ts), desks, chairs, meeting room, lounge
// (furniture.ts), sound, transition, flicker, dust (atmosphere.ts).
//
// What goes where, and each thing's builder, are in ./clutter: place.ts puts it all in the free
// corners and along the free walls (tests/bunker-props.test.ts keeps it clear of the floor plan),
// parts.ts builds each kind of thing, kit.ts owns their materials and textures. There's no vehicle
// bay: no corner of the floor is free enough for one without being in somebody's way.

/**
 * Builds the bunker's crates, drums, sandbags, camo netting, workshop corner, wall map, radio and
 * signs into `ctx.group`: built once, shown with the bunker, all disposed with it.
 */
export function buildProps(ctx: BunkerContext): BunkerPart {
  const { office, look } = ctx;
  // The loft's plants are among its meshes: a pot and three balls of leaves, the way office.ts builds one.
  const loftPlants = [...new Set(look.loft.map((m) => m.parent!))].filter(isPlant);
  const plants = [...office.plants, ...loftPlants];
  office.group.updateMatrixWorld(true);
  const spots: PlantSpot[] = plants.map((p) => {
    const at = office.group.worldToLocal(p.getWorldPosition(new THREE.Vector3()));
    return { x: at.x, y: at.y, z: at.z, scale: p.scale.x };
  });
  const props = buildBunkerProps(spots);
  ctx.group.add(props.group);
  // The keep-out sign is on the elevator's pillar, where aiming at it means the elevator.
  ctx.standIn(ctx.office.elevator.group, props.elevatorSign);
  return {
    hideOffice: [...look.plants, ...loftPlants.flatMap((p) => p.children as THREE.Mesh[])],
    update: (dt) => props.update(dt),
    dispose: () => props.dispose(),
  };
}

/** One of office.ts's potted plants: a pot (0.28 at the top, 0.22 at the bottom) and three spheres. */
function isPlant(g: THREE.Object3D): boolean {
  if (g.children.length !== 4) return false;
  const [pot, ...leaves] = g.children as THREE.Mesh[];
  const p = pot.geometry instanceof THREE.CylinderGeometry && pot.geometry.parameters;
  return !!p && p.radiusTop === 0.28 && p.radiusBottom === 0.22 && leaves.every((l) => l.geometry instanceof THREE.SphereGeometry);
}
