// The bunker's cartel station: the cartel's phone on the east wall. A stub from the bunker's foundation (#118),
// filled in by #124: an empty group at its spot, for now.
import * as THREE from 'three';
import type { StationSpot } from '../../../shared/bunker/index';
import type { StationView } from './station';

export function buildCartel(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-cartel';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  return { group };
}
