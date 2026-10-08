// The bunker's customers station: where the customers come: the slot in the bunker's metal door (the
// room builds the door). Here: a little tray under the slot, and a lamp over the door that lights up
// while a customer's order is waiting for you, blinking when one's about to run out.
import * as THREE from 'three';
import { BUNKER_DOOR, type BunkerPerson, type StationSpot } from '../../../shared/bunker/index';
import { inTrouble } from '../../../shared/bunker/customers';
import { mesh, toon } from '../toon';
import type { StationView } from './station';

/** Whether a customer's order is waiting in `mine` at `now`, and whether one's due within a couple of minutes. */
export function ordersWaiting(mine: BunkerPerson | null, now: number): { waiting: number; hurry: boolean } {
  let waiting = 0;
  let hurry = false;
  for (const c of mine?.customers?.list ?? []) {
    if (!c.order || inTrouble(c, now)) continue;
    waiting++;
    if (c.order.due - now < 2 * 60_000) hurry = true;
  }
  return { waiting, hurry };
}

export function buildCustomers(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-customers';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  // In the spot's frame: the door's face is just behind its back edge (-z), and its slot is 0.12 m off its middle.
  const back = -spot.d / 2 + 0.06;
  const steel = toon('#7d868c');
  const tray = mesh(new THREE.BoxGeometry(0.36, 0.03, 0.12), steel, -0.12, 1.36, back + 0.06, false);
  const lip = mesh(new THREE.BoxGeometry(0.36, 0.06, 0.015), steel, -0.12, 1.385, back + 0.12, false);
  // The lamp in a little cage over the door.
  const lampY = BUNKER_DOOR.height + 0.2;
  const housing = mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), toon('#30363b'), 0, lampY - 0.07, back + 0.03, false);
  const light = new THREE.MeshBasicMaterial({ color: '#3a2a1c' });
  light.toneMapped = false;
  light.userData.outlineParameters = { visible: false };
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), light);
  bulb.position.set(0, lampY - 0.03, back + 0.06);
  bulb.rotation.x = Math.PI;
  bulb.name = 'customers-lamp';
  group.add(tray, lip, housing, bulb);
  const off = new THREE.Color('#3a2a1c');
  const on = new THREE.Color('#ffb02e');
  return {
    group,
    update(t, _dt, mine) {
      const { waiting, hurry } = ordersWaiting(mine, Date.now());
      const lit = waiting > 0 && (!hurry || Math.floor(t * 3) % 2 === 0);
      light.color.copy(lit ? on : off);
    },
  };
}
