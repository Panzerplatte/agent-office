// The bunker's customers station: where the customers come: the slot in the bunker's metal door. A stub from the bunker's foundation (#118),
// filled in by #123: an empty group at its spot, for now.
import * as THREE from 'three';
import type { StationSpot } from '../../../shared/bunker/index';
import type { StationView } from './station';

export function buildCustomers(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-customers';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  return { group };
}
