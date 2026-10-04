import type { BunkerContext, BunkerPart } from './index';

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

/**
 * Builds the bunker's crates, drums, sandbags, workshop corner, signs and vehicle bay into
 * `ctx.group`. For now: nothing.
 */
export function buildProps(_ctx: BunkerContext): BunkerPart {
  return { dispose() {} };
}
