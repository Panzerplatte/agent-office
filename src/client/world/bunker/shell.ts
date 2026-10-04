import * as THREE from 'three';
import type { BunkerContext, BunkerPart } from './index';

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

const CONCRETE = new THREE.Color('#8f9196');
const WARM = new THREE.Color('#ffcf8a');

/**
 * Builds the bunker's walls, floor, ceiling and lighting into `ctx.group`, and says which office
 * meshes and materials they replace. For now a placeholder: grey concrete walls, floor and ceiling,
 * no rugs, and dimmer, warmer light.
 */
export function buildShell(ctx: BunkerContext): BunkerPart {
  const { look } = ctx;
  const { hemi, ambient, sun } = ctx.deps.lights;
  return {
    hideOffice: [...look.rugs],
    reskin: [
      { material: look.wallMat, props: { color: CONCRETE } },
      { material: look.trimMat, props: { color: new THREE.Color('#5c5f66') } },
      { material: look.floorMat, props: { map: null, color: new THREE.Color('#7a7c80') } },
      { material: look.ceilingMat, props: { map: null, emissiveMap: null, color: new THREE.Color('#6f7176'), emissive: new THREE.Color('#2a2622') } },
    ],
    update() {
      hemi.intensity *= 0.55;
      hemi.color.lerp(WARM, 0.5);
      ambient.intensity *= 0.6;
      ambient.color.lerp(WARM, 0.4);
      sun.intensity *= 0.35;
    },
    dispose() {},
  };
}
