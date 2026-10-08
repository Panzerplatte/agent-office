// The bunker's lab station: the lab bench on the north wall. A stub from the bunker's foundation (#118),
// filled in by #120: an empty group at its spot, for now.
import * as THREE from 'three';
import type { StationSpot } from '../../../shared/bunker/index';
import type { StationView } from './station';

export function buildLab(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-lab';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  return { group };
}
