// The way down to the bunker: a hatch in the floor of the casino's secret room (SECRET_HATCH in
// shared/casino.ts), its lid standing open against the wall and the top of a ladder sticking up out
// of it. E at it climbs down (see main.ts). Lit by the room's lamp, like the rest of the room
// (roomLit in world/casinosecret.ts).
import * as THREE from 'three';
import { SECRET_HATCH } from '../../../shared/casino';
import type { Collider, Interactable } from '../office';
import { roomLit } from '../casinosecret';
import { mergeByMaterial, mesh } from '../toon';
import { buildLadder } from './ladder';

/** Builds the hatch into `group` (the casino's), with its collider (nobody steps into the hole) and what E finds. */
export function buildSecretHatch(group: THREE.Group, colliders: Collider[], interactables: Interactable[]): Interactable {
  const K = SECRET_HATCH;
  const half = K.size / 2;
  const parts = new THREE.Group();
  const steel = roomLit('#7c8288');
  const dark = roomLit('#3b3f44');
  // The hole: black, a little way down, in a steel frame flush with the carpet.
  const hole = new THREE.MeshBasicMaterial({ color: '#050506' });
  hole.userData.outlineParameters = { visible: false };
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(K.size, K.size).rotateX(-Math.PI / 2), hole);
  pit.position.set(K.x, 0.004, K.z);
  group.add(pit);
  const f = 0.06;
  parts.add(mesh(new THREE.BoxGeometry(K.size + f * 2, 0.02, f), steel, K.x, 0.01, K.z - half - f / 2, false));
  parts.add(mesh(new THREE.BoxGeometry(K.size + f * 2, 0.02, f), steel, K.x, 0.01, K.z + half + f / 2, false));
  parts.add(mesh(new THREE.BoxGeometry(f, 0.02, K.size), steel, K.x - half - f / 2, 0.01, K.z, false));
  parts.add(mesh(new THREE.BoxGeometry(f, 0.02, K.size), steel, K.x + half + f / 2, 0.01, K.z, false));
  // The lid, swung up on its hinges along the west edge, against the wall.
  const lid = mesh(new THREE.BoxGeometry(0.04, K.size, K.size), dark, K.x - half - f - 0.02, K.size / 2 + 0.02, K.z, false);
  parts.add(lid);
  parts.add(mesh(new THREE.BoxGeometry(0.03, 0.04, 0.24), steel, K.x - half - f + 0.01, K.size * 0.75, K.z, false));
  // The ladder, against the hole's back edge, its rails up out of it to grab on to.
  const ladder = buildLadder(-2.4, 1.05, 0.5, steel, dark);
  ladder.position.set(K.x, 0, K.z + half - 0.05);
  parts.add(ladder);
  const merged = mergeByMaterial(parts);
  merged.name = 'secret-hatch';
  group.add(merged);

  // Nobody walks into the hole (or through the ladder or the lid).
  colliders.push({ minX: K.x - half - f - 0.04, maxX: K.x + half + f, minZ: K.z - half - f, maxZ: K.z + half + f, top: 99, fence: true });

  // E at it, or looking at it: a box round it that's never drawn.
  const it: Interactable = { kind: 'hatch', x: K.x, z: K.z, radius: K.reach };
  interactables.push(it);
  const pick = new THREE.Mesh(new THREE.BoxGeometry(K.size + 0.2, 1.2, K.size + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(K.x, 0.6, K.z);
  pick.userData.interact = it;
  group.add(pick);
  return it;
}
