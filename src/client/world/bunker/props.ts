import type { BunkerContext, BunkerPart } from './index';
import { buildBunkerProps } from './clutter/place';

// The bunker's props: what makes it a bunker beyond its walls and furniture.
//  - Crates, oil drums, sandbags, camo netting, jerry cans, toolboxes, in corners and along walls,
//    out of the walkways (no new colliders: keep them where nobody walks, or low and against a wall).
//  - A workshop corner (workbench with tools, a vice, a pegboard), a vehicle bay (a cartoony jeep or
//    quad under a tarp), our own "BUNKER" signage, hazard stripes, stencilled numbers.
//  - Cartoony and cosy, toon materials; no weapons on display, no GTA/Rockstar names or logos.
//  - The office's plants (look.plants) can go, or get swapped for something that fits.
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
  const props = buildBunkerProps();
  ctx.group.add(props.group);
  // The keep-out sign is on the elevator's pillar, where aiming at it means the elevator.
  ctx.standIn(ctx.office.elevator.group, props.elevatorSign);
  return {
    update: (dt) => props.update(dt),
    dispose: () => props.dispose(),
  };
}
