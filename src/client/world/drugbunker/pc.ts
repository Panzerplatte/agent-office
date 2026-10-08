// The bunker's pc station: a battered desk against the south wall with an old beige computer on it,
// its CRT glowing green in the gloom (a desktop of app icons and a blinking cursor), a beige
// keyboard and a mouse, and a worn office chair pushed back from it. E in front of it opens the PC
// (ui/bunker/pc.ts).
import * as THREE from 'three';
import { stationToWorld, type StationSpot } from '../../../shared/bunker/index';
import type { Collider } from '../office';
import { mergeByMaterial, mesh, toon } from '../toon';
import type { StationView } from './station';

/** The desk: how wide, deep and high its top is, and where its middle is (z, in the station's frame). */
export const PC_DESK = { w: 1.5, d: 0.72, top: 0.74, z: -0.08 } as const;

/** What the CRT shows: a green desktop with three app icons and a prompt. Its cursor is a mesh of its own (it blinks). */
function screenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const g = c.getContext('2d')!;
  const glow = g.createRadialGradient(128, 90, 10, 128, 96, 170);
  glow.addColorStop(0, '#1f5a35');
  glow.addColorStop(1, '#08180e');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 192);
  // The app icons: little boxes with a label line under each.
  g.fillStyle = '#9cf5b4';
  for (let i = 0; i < 3; i++) {
    const x = 34 + i * 74;
    g.fillRect(x, 36, 40, 32);
    g.fillRect(x - 2, 76, 44, 5);
  }
  g.fillStyle = '#0c2a17';
  g.fillRect(40, 42, 28, 20);
  g.fillRect(114, 42, 28, 20);
  g.fillRect(188, 42, 28, 20);
  // A prompt line along the bottom.
  g.fillStyle = '#9cf5b4';
  g.fillRect(24, 140, 18, 6);
  g.fillRect(48, 140, 80, 6);
  // Scanlines.
  g.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let y = 0; y < 192; y += 3) g.fillRect(0, y, 256, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft round falloff, white in the middle to nothing at the edge: the glow's shape. */
function softTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, 'rgba(255, 255, 255, 1)');
  fade.addColorStop(0.45, 'rgba(255, 255, 255, 0.45)');
  fade.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** A light-giving surface: not lit itself, not outlined. */
function glowing(color: THREE.ColorRepresentation, opts: { map?: THREE.Texture; opacity?: number } = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, map: opts.map ?? null });
  if (opts.opacity !== undefined) {
    m.transparent = true;
    m.opacity = opts.opacity;
    m.depthWrite = false;
    m.blending = THREE.AdditiveBlending;
  }
  m.toneMapped = false;
  m.userData.outlineParameters = { visible: false };
  return m;
}

export function buildPc(spot: StationSpot): StationView {
  const group = new THREE.Group();
  group.name = 'bunker-pc';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;

  const parts = new THREE.Group();
  const wood = toon('#6b5236');
  const woodDark = toon('#4a3824');
  const beige = toon('#d8ceb0');
  const beigeDark = toon('#b3a885');
  const black = toon('#232426');
  const fabric = toon('#3c4a5c');
  const chrome = toon('#8a9097');

  // ---- The desk -------------------------------------------------------------------------------------------
  const D = PC_DESK;
  parts.add(mesh(new THREE.BoxGeometry(D.w, 0.05, D.d), wood, 0, D.top - 0.025, D.z));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(0.05, D.top - 0.05, 0.05), woodDark, sx * (D.w / 2 - 0.05), (D.top - 0.05) / 2, D.z + sz * (D.d / 2 - 0.05)));
  }
  // A drawer block on the right, and a modesty panel at the back.
  parts.add(mesh(new THREE.BoxGeometry(0.42, 0.55, D.d - 0.08), woodDark, D.w / 2 - 0.26, D.top - 0.05 - 0.275, D.z));
  for (const y of [0.32, 0.5]) parts.add(mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), chrome, D.w / 2 - 0.26, y, D.z + D.d / 2 - 0.03, false));
  parts.add(mesh(new THREE.BoxGeometry(D.w - 0.1, 0.4, 0.02), woodDark, 0, D.top - 0.3, D.z - D.d / 2 + 0.04, false));

  // ---- The computer: a flat beige case with the CRT on top -------------------------------------------------
  const cx = -0.12;
  const cz = D.z - 0.06;
  const caseTop = D.top + 0.13;
  parts.add(mesh(new THREE.BoxGeometry(0.5, 0.13, 0.42), beige, cx, D.top + 0.065, cz));
  // Its floppy slot and power button.
  parts.add(mesh(new THREE.BoxGeometry(0.14, 0.012, 0.005), black, cx + 0.1, D.top + 0.075, cz + 0.211, false));
  parts.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.006), beigeDark, cx - 0.18, D.top + 0.065, cz + 0.211, false));
  // The CRT: a deep beige box, its bezel and a tapering back.
  const crtW = 0.44;
  const crtH = 0.38;
  const crtY = caseTop + 0.02 + crtH / 2;
  const crtZ = cz + 0.02;
  parts.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.2), beigeDark, cx, caseTop + 0.01, crtZ - 0.04));
  parts.add(mesh(new THREE.BoxGeometry(crtW, crtH, 0.2), beige, cx, crtY, crtZ + 0.08));
  const back = mesh(new THREE.CylinderGeometry(0.12, 0.19, 0.22, 4, 1), beigeDark, cx, crtY, crtZ - 0.12);
  back.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  parts.add(back);
  // The screen's dark glass round the picture.
  parts.add(mesh(new THREE.BoxGeometry(crtW - 0.07, crtH - 0.08, 0.01), black, cx, crtY + 0.01, crtZ + 0.18, false));

  // ---- The keyboard and the mouse ---------------------------------------------------------------------------
  const kz = D.z + 0.22;
  const kb = mesh(new THREE.BoxGeometry(0.46, 0.03, 0.16), beige, cx, D.top + 0.015, kz);
  kb.rotation.x = 0.05;
  parts.add(kb);
  for (let row = 0; row < 4; row++) parts.add(mesh(new THREE.BoxGeometry(0.42, 0.012, 0.022), beigeDark, cx, D.top + 0.034 - row * 0.002, kz - 0.055 + row * 0.035, false));
  parts.add(mesh(new THREE.BoxGeometry(0.06, 0.025, 0.1), beige, cx + 0.36, D.top + 0.012, kz, false));
  parts.add(mesh(new THREE.BoxGeometry(0.5, 0.004, 0.003), black, cx + 0.12, D.top + 0.002, kz - 0.08, false));
  // A mug that's never washed.
  parts.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 12), toon('#8f3b2e'), D.w / 2 - 0.22, D.top + 0.05, D.z - 0.12));

  // ---- The chair, pushed back, a bit askew --------------------------------------------------------------------
  const chair = new THREE.Group();
  chair.add(mesh(new THREE.BoxGeometry(0.46, 0.08, 0.44), fabric, 0, 0.47, 0));
  chair.add(mesh(new THREE.BoxGeometry(0.4, 0.42, 0.07), fabric, 0, 0.8, 0.22));
  chair.add(mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), black, 0, 0.6, 0.2, false));
  chair.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 8), chrome, 0, 0.25, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(new THREE.BoxGeometry(0.04, 0.03, 0.28), black, Math.sin(a) * 0.13, 0.06, Math.cos(a) * 0.13, false);
    leg.rotation.y = a;
    chair.add(leg);
    chair.add(mesh(new THREE.SphereGeometry(0.025, 6, 4), black, Math.sin(a) * 0.26, 0.025, Math.cos(a) * 0.26, false));
  }
  chair.position.set(cx + 0.05, 0, D.z + D.d / 2 + 0.22);
  chair.rotation.y = 0.35;
  parts.add(chair);

  const merged = mergeByMaterial(parts);
  merged.name = 'bunker-pc-furniture';
  group.add(merged);

  // ---- What glows: the picture, its cursor, and the green haze round it ---------------------------------------
  const screenMat = glowing('#ffffff', { map: screenTexture() });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(crtW - 0.1, crtH - 0.11), screenMat);
  screen.name = 'bunker-pc-screen';
  screen.position.set(cx, crtY + 0.01, crtZ + 0.186);
  group.add(screen);
  const cursor = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.012), glowing('#c9ffd6'));
  cursor.position.set(cx + 0.012, crtY + 0.01 - 0.07, crtZ + 0.187);
  group.add(cursor);
  const soft = softTexture();
  const hazeMat = glowing('#3dff7a', { map: soft, opacity: 0.12 });
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(crtW + 0.6, crtH + 0.6), hazeMat);
  haze.position.set(cx, crtY, crtZ + 0.2);
  haze.raycast = () => {};
  group.add(haze);
  // Its light on the desk in front of it.
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24).rotateX(-Math.PI / 2), glowing('#3dff7a', { map: soft, opacity: 0.16 }));
  pool.scale.set(1.2, 1, 0.7);
  pool.position.set(cx, D.top + 0.002, D.z + 0.12);
  pool.raycast = () => {};
  group.add(pool);

  // You walk round the desk (not the chair, which rolls).
  const corners = [stationToWorld(spot, { x: -D.w / 2, z: D.z - D.d / 2 }), stationToWorld(spot, { x: D.w / 2, z: D.z + D.d / 2 })];
  const colliders: Collider[] = [
    { minX: Math.min(corners[0].x, corners[1].x), maxX: Math.max(corners[0].x, corners[1].x), minZ: Math.min(corners[0].z, corners[1].z), maxZ: Math.max(corners[0].z, corners[1].z), top: D.top },
  ];

  return {
    group,
    colliders,
    update(t) {
      // The cursor blinks; the old tube hums, its picture never quite steady.
      cursor.visible = t % 1 < 0.55;
      const hum = 0.93 + 0.05 * Math.sin(t * 7.3) + 0.02 * Math.sin(t * 31);
      screenMat.color.setScalar(hum);
      hazeMat.opacity = 0.11 + 0.03 * Math.sin(t * 2.1);
    },
  };
}
