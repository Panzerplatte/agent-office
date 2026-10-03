// The casino bar's bartender: behind the counter along the east wall (CASINO_BAR), drifting along
// it between customers and coming over to pour when someone orders, as at the rooftop bar. E in
// front of the counter (or on one of its stools) opens the same menu (see ui/bar.ts, main.ts).
import * as THREE from 'three';
import { CASINO_BAR, CASINO_BARTENDER } from '../../shared/casino';
import { t } from '../i18n';
import { Worker } from './character';
import type { Interactable } from './office';

export interface CasinoBartender {
  worker: Worker;
  /** Where drinks are poured, for the sound of one. */
  pourAt: { x: number; y: number; z: number };
  /** Someone ordered a drink at the bar, standing (or sitting) at `z` along it: the bartender comes over. */
  serve(z: number): void;
  update(dt: number, time: number): void;
}

/** The one in the casino, once it's been built. */
let built: CasinoBartender | null = null;

export function casinoBartender(): CasinoBartender | null {
  return built;
}

/** Puts the bartender behind the casino's bar, and the places to order at in front of it. */
export function buildCasinoBartender(group: THREE.Group, interactables: Interactable[]): CasinoBartender {
  const B = CASINO_BAR;
  const front = B.x - B.depth / 2;
  const mid = (B.minZ + B.maxZ) / 2;
  const worker = new Worker(t('world.casinoBartender'), '#e76f51');
  worker.setStatus('idle', false);
  worker.setTask({ name: `🍸 ${t('world.casinoBartender')}`, summary: t('world.casinoBartenderSummary') });
  worker.root.position.set(CASINO_BARTENDER.x, 0, mid);
  worker.root.rotation.y = -Math.PI / 2;
  group.add(worker.root);
  const its = CASINO_BARTENDER.order.map((z): Interactable => ({ kind: 'bar', x: front - 0.7, z, radius: CASINO_BARTENDER.reach }));
  interactables.push(...its);
  // The counter itself is merged in with the rest of the room, so the crosshair finds the bar on a
  // box round it that's never drawn.
  const counter = new THREE.Mesh(new THREE.BoxGeometry(B.depth + 0.2, B.height, B.maxZ - B.minZ + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
  counter.position.set(B.x - 0.05, B.height / 2, mid);
  counter.userData.interact = its[1];
  group.add(counter);

  // Along the counter, clear of its ends.
  const along = (z: number) => THREE.MathUtils.clamp(z, B.minZ + 0.6, B.maxZ - 0.6);
  let tendZ = mid;
  let wander = 0;
  built = {
    worker,
    pourAt: { x: B.x - 0.1, y: B.height + 0.2, z: mid },
    serve(z) {
      tendZ = along(z);
      this.pourAt.z = tendZ;
      wander = 6;
      worker.cheer(1.2);
    },
    update(dt, time) {
      wander -= dt;
      if (wander <= 0) {
        wander = 5 + Math.random() * 6;
        tendZ = along(B.minZ + 1 + Math.random() * (B.maxZ - B.minZ - 2));
      }
      const p = worker.root.position;
      p.z += THREE.MathUtils.clamp(tendZ - p.z, -dt * 1.6, dt * 1.6);
      worker.update(dt, time);
    },
  };
  return built;
}
