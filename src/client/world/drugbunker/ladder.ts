// The steel ladder between the casino's secret room and the bunker: the same ladder at both ends.
import * as THREE from 'three';
import { mesh } from '../toon';

/**
 * A ladder `width` between its rails, from `y0` up to `y1`, its rungs every 0.3 m, facing +z (you
 * climb it from the +z side), its middle at the origin. Merged per material by whoever adds it.
 */
export function buildLadder(y0: number, y1: number, width: number, rail: THREE.Material, rung: THREE.Material = rail): THREE.Group {
  const g = new THREE.Group();
  const h = y1 - y0;
  for (const side of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.05, h, 0.06), rail, (side * width) / 2, y0 + h / 2, 0));
  for (let y = y0 + 0.3; y < y1 - 0.05; y += 0.3) {
    const r = mesh(new THREE.CylinderGeometry(0.018, 0.018, width, 8), rung, 0, y, 0, false);
    r.rotation.z = Math.PI / 2;
    g.add(r);
  }
  return g;
}
