// The bunker's pack station: the packing table (and its scale) in the middle of the room. A stub from the bunker's foundation (#118),
// filled in by #121: an empty group at its spot, for now.
import * as THREE from 'three';
import type { StationSpot } from '../../../shared/bunker/index';
import type { StationView } from './station';

export function buildPack(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-pack';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  return { group };
}
