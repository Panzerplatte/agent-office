// The bunker's grow station: the grow area: a row of pots and tents down the west wall. A stub from the bunker's foundation (#118),
// filled in by #119: an empty group at its spot, for now.
import * as THREE from 'three';
import type { StationSpot } from '../../../shared/bunker/index';
import type { StationView } from './station';

export function buildGrow(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-grow';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  return { group };
}
