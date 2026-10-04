import type { BunkerContext, BunkerPart } from './index';
import { buildShellParts } from './shellparts/build';
import { lightBunker } from './shellparts/lighting';

// The bunker's shell: everything the room itself is made of, and its light.
//  - Walls: rough concrete over the outer walls (hide look.walls and build your own, or reskin
//    look.wallMat/trimMat), the loft's walls (look.loft is furniture.ts's, but its wall paint is
//    wallMat), steel doors / blast-door frames round the exits.
//  - Floor: concrete (reskin look.floorMat: the floor's meshes are rebuilt per floor, so don't hide
//    them; mind the ladder hatch and pole holes cut in it). The rugs (look.rugs) go.
//  - Ceiling: a vaulted ceiling with ribs (reskin look.ceilingMat, and/or build the vault under it),
//    pipes and cable trays along it, the cage lamps that light the room (in place of look.lamps).
//  - Windows and outside: no windows underground: hide look.windows (and the rain on them), plug the
//    holes in the walls, and what you'd see through them (look.ground, look.tower, the balcony and its
//    glass doors look.balcony/balconyDoor are yours to hide or wall up; the doors stay usable).
//  - Lighting: dimmer, warm light. A part's update runs every frame after the sky has set
//    ctx.deps.lights, so scale/tint them there; the bunker's own lamps' glow and halos are yours too.
// Not here: desks, chairs, the meeting room and the lounge (furniture.ts), crates, drums, signs and
// the like (props.ts), sound, the switching transition, flicker and dust (atmosphere.ts).
//
// What it builds is in shellparts/: build.ts (the room), textures.ts (its canvas textures) and
// lighting.ts (the same light day and night).

/**
 * Builds the bunker's walls, floor, ceiling and lamps into `ctx.group`: a concrete lining where the
 * outer walls were, with a hazard stripe along the bottom; steel shutters over the windows; a blast
 * door over the balcony doors and a steel exit door, both moving with the office's own (hidden) doors;
 * the balcony walled in and a dark stairwell out of the exit, so nothing outside shows; a concrete
 * floor and a vaulted concrete ceiling on steel ribs, with pipes, a cable tray, a vent duct and fans;
 * cage lamps and fluorescent tubes. The light is the bunker's own, the same at any hour.
 */
export function buildShell(ctx: BunkerContext): BunkerPart {
  const shell = buildShellParts(ctx.office);
  ctx.group.add(shell.group);
  return {
    hideOffice: shell.hideOffice,
    reskin: shell.reskin,
    update(dt, t) {
      shell.update(t, dt, lightBunker(ctx.deps.lights, ctx.deps.scene));
    },
    dispose() {
      shell.dispose();
    },
  };
}
