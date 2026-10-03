import { CASINO_JUKEBOX } from '../../shared/casino';
import { JUKEBOX } from '../../shared/layout';
import type { Collider, Interactable } from './office';
import { buildJukebox, type JukeboxView } from './jukebox';
import type * as THREE from 'three';

// The casino's jukebox: the office lounge's, the same way round against the east wall, moved down
// to the corner between the bar and the lounge (CASINO_JUKEBOX). Its lights show what the casino's
// jukebox plays.

/** Builds it into the casino: its model, what stops you walking through it, and E to open it. */
export function addCasinoJukebox(casino: { group: THREE.Group; colliders: Collider[]; interactables: Interactable[] }): JukeboxView {
  const view = buildJukebox();
  const dx = CASINO_JUKEBOX.x - JUKEBOX.x;
  const dz = CASINO_JUKEBOX.z - JUKEBOX.z;
  view.group.position.set(CASINO_JUKEBOX.x, 0, CASINO_JUKEBOX.z);
  // The collider and the spot you use it from move with it (the interactable is the model's userData too).
  Object.assign(view.collider, { minX: view.collider.minX + dx, maxX: view.collider.maxX + dx, minZ: view.collider.minZ + dz, maxZ: view.collider.maxZ + dz });
  Object.assign(view.interactable, { x: view.interactable.x + dx, z: view.interactable.z + dz });
  casino.group.add(view.group);
  casino.colliders.push(view.collider);
  casino.interactables.push(view.interactable);
  return view;
}

/** Where the jukebox you hear stands, for the sound: down in the casino its own, else your floor's. */
export const jukeboxAt = (inCasino: boolean) => (inCasino ? CASINO_JUKEBOX : JUKEBOX);
