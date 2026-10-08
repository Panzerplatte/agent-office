// The bunker's pc station: the PC's desk on the south wall. A stub from the bunker's foundation (#118),
// filled in by #122: an empty group at its spot, for now.
import * as THREE from 'three';
import type { StationSpot } from '../../../shared/bunker/index';
import type { StationView } from './station';

export function buildPc(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-pc';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  return { group };
}
