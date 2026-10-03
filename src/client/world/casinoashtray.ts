import * as THREE from 'three';
import { CASINO_ASHTRAY, CASINO_LOUNGE, CASINO_ROOM } from '../../shared/casino';
import type { Interactable } from './office';
import { mesh, toon } from './toon';

// The standing ashtray: the balcony's (see office.ts), and a brass one in the casino's lounge (see
// CASINO_ASHTRAY), where a smoke break goes just as it does out on the balcony. While people smoke
// down there, a haze gathers under the lounge's lights and thins out again after.

/** A standing bin with a sand-filled bowl and a couple of butts in it, its foot at the origin. */
export function standingAshtray(metal: THREE.ColorRepresentation = '#8d99ae'): THREE.Group {
  const tray = new THREE.Group();
  const steel = toon(metal);
  tray.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 16), steel, 0, 0.025, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10), steel, 0, 0.45, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.14, 16), steel, 0, 0.9, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 16), toon('#e9d8a6'), 0, 0.965, 0, false));
  for (const [bx, bz, a] of [
    [0.06, 0.02, 0.4],
    [-0.05, -0.06, 2.1],
    [-0.02, 0.08, 1.2],
  ]) {
    const butt = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 6).rotateZ(Math.PI / 2), toon(a > 1 ? '#fffaf3' : '#e9a03b'), bx, 0.98, bz, false);
    butt.rotation.y = a;
    tray.add(butt);
  }
  return tray;
}

/** A soft round blob for the haze, fading out to nothing at its edge. */
function hazeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** How thick the haze gets: per smoker, and at most. */
const HAZE_PER_SMOKER = 0.09;
const HAZE_MAX = 0.26;

export interface CasinoAshtray {
  /** Every frame, down there: `smokers` is how many in the casino have something lit. */
  update(time: number, dt: number, smokers: number): void;
}

/** Puts the ashtray in the casino's lounge (its footprint is in casinoFootprints), and the haze over it. */
export function addCasinoAshtray(casino: { group: THREE.Group; interactables: Interactable[] }): CasinoAshtray {
  const A = CASINO_ASHTRAY;
  const tray = standingAshtray('#d4a84b');
  tray.position.set(A.x, 0, A.z);
  casino.group.add(tray);
  const it: Interactable = { kind: 'smoke', x: A.x, z: A.z, radius: 1.8 };
  casino.interactables.push(it);
  tray.userData.interact = it;

  // The haze: big soft blobs drifting slowly under the ceiling round the lounge, warm from its lights.
  const tex = hazeTexture();
  const blobs: { sprite: THREE.Sprite; x: number; y: number; z: number; phase: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const mat = new THREE.SpriteMaterial({ map: tex, color: '#e8d6bf', transparent: true, depthWrite: false, opacity: 0 });
    mat.userData.outlineParameters = { visible: false };
    const sprite = new THREE.Sprite(mat);
    const size = 3.2 + (i % 3) * 0.6;
    sprite.scale.set(size, size * 0.6, 1);
    sprite.renderOrder = 2;
    // Nothing to aim at: E goes through it to whatever's behind.
    sprite.raycast = () => {};
    sprite.visible = false;
    const b = { sprite, x: CASINO_LOUNGE.x + Math.cos(a) * 1.8, y: CASINO_ROOM.height - 1.6 - (i % 3) * 0.45, z: CASINO_LOUNGE.z + Math.sin(a) * 1.5, phase: a * 1.7 };
    sprite.position.set(b.x, b.y, b.z);
    blobs.push(b);
    casino.group.add(sprite);
  }
  let haze = 0;

  return {
    update(time, dt, smokers) {
      const target = Math.min(HAZE_MAX, smokers * HAZE_PER_SMOKER);
      // It builds up over half a minute or so, and takes a while longer to clear.
      haze += (target - haze) * (1 - Math.exp(-dt / (target > haze ? 12 : 25)));
      if (haze < 0.003 && target === 0) haze = 0;
      for (const b of blobs) {
        b.sprite.visible = haze > 0;
        if (!haze) continue;
        b.sprite.material.opacity = haze * (0.75 + 0.25 * Math.sin(time * 0.21 + b.phase));
        b.sprite.position.set(b.x + Math.sin(time * 0.05 + b.phase) * 0.7, b.y + Math.sin(time * 0.13 + b.phase) * 0.08, b.z + Math.cos(time * 0.04 + b.phase) * 0.6);
      }
    },
  };
}
