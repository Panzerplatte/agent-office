import * as THREE from 'three';
import { FLOOR, SNAKE_CABINET } from '../../shared/layout';
import { mesh, roundedBox, toon, toonUnique } from './toon';
import type { NightParts } from './outside';
import type { Collider, Interactable } from './office';

// The Snake arcade machine in the lounge: an upright whose body is a snake. Green scales all over, a
// big snake's head on top for its marquee (glowing eyes, fangs, a forked tongue), the snake's body
// winding down one side, along the floor in front and up the other, the screen leaning back under the
// head (the game paints it; until then it shows a pixel snake and PRESS START), a joystick and two
// buttons, and S N A K E lit up big on the base.

export interface SnakeCabinetModel {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
  /** The game goes on this: 4:3, leaning back a little. Its material's map is the attract picture until a game paints it. */
  screen: THREE.Mesh;
}

/** The cabinet from the side, front toward +u: floor to the top, round the control panel and the screen. */
const BODY: [number, number][] = [
  [-0.4, 0],
  [0.26, 0],
  [0.26, 0.84],
  [0.4, 0.9],
  [0.4, 0.98],
  [0.13, 1.05],
  [0.01, 1.57],
  [0.16, 1.63],
  [0.16, 1.86],
  [-0.4, 1.86],
];
/** The side panels: the same, standing a little proud of it all round. */
const SIDE: [number, number][] = [
  [-0.4, 0],
  [0.29, 0],
  [0.29, 0.83],
  [0.43, 0.89],
  [0.43, 1.0],
  [0.16, 1.07],
  [0.04, 1.58],
  [0.19, 1.64],
  [0.19, 1.89],
  [-0.4, 1.89],
];
const SIDE_T = 0.04;
const SCREEN_BOTTOM: [number, number] = [0.13, 1.05];
const SCREEN_TOP: [number, number] = [0.01, 1.57];
const LEAN = Math.atan2(SCREEN_BOTTOM[0] - SCREEN_TOP[0], SCREEN_TOP[1] - SCREEN_BOTTOM[1]);
const PANEL_FRONT: [number, number] = [0.4, 0.98];
const PANEL_BACK: [number, number] = [0.13, 1.05];
/** How thick the snake's body is, round the cabinet. */
const COIL_R = 0.065;
const LIME = '#c6ff3d';
const EYE = '#ffe14d';

/** A side-view outline pulled out `thick` wide across the cabinet, from `x0`. */
function slab(points: [number, number][], thick: number, x0: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(x0 + thick, 0, 0);
  return geo;
}

/** Snake skin: rows of overlapping scales, a darker diamond down the back, one tile per `tile` meters. */
function scaleTexture(repeatU: number, repeatV: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f8f3a';
  g.fillRect(0, 0, 128, 128);
  // A diamond of darker green across the tile, under the scales.
  g.fillStyle = '#1f6b2b';
  g.beginPath();
  g.moveTo(64, 8);
  g.lineTo(120, 64);
  g.lineTo(64, 120);
  g.lineTo(8, 64);
  g.closePath();
  g.fill();
  g.fillStyle = '#9be35a';
  g.beginPath();
  g.moveTo(64, 40);
  g.lineTo(88, 64);
  g.lineTo(64, 88);
  g.lineTo(40, 64);
  g.closePath();
  g.fill();
  // The scales: half-round, rows offset by half a scale, each with a dark rim and a lighter middle.
  const s = 16;
  for (let row = 0; row <= 128 / (s / 2) + 1; row++) {
    const y = row * (s / 2);
    const off = row % 2 ? s / 2 : 0;
    for (let x = -s + off; x <= 128 + s; x += s) {
      g.beginPath();
      g.arc(x, y, s / 2 - 1, 0, Math.PI);
      g.strokeStyle = 'rgba(10,40,16,0.55)';
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.arc(x, y + 1, s / 4, 0, Math.PI);
      g.fillStyle = 'rgba(200,255,140,0.18)';
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatU, repeatV);
  tex.anisotropy = 4;
  return tex;
}

/** The belly: pale yellow-green plates across it, one under the other. */
function bellyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 4; i++) {
    const y = i * 16;
    const grad = g.createLinearGradient(0, y, 0, y + 16);
    grad.addColorStop(0, '#eef7a0');
    grad.addColorStop(1, '#a9c95a');
    g.fillStyle = grad;
    g.fillRect(0, y, 128, 16);
    g.fillStyle = '#5f7f2a';
    g.fillRect(0, y + 14, 128, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The body round the cabinet: down the right side in waves, along the floor in front, up the left to the tail. */
function coilCurve(W: number): THREE.CatmullRomCurve3 {
  const sx = W / 2 + COIL_R - 0.01;
  const pts: [number, number, number][] = [
    // From the back of the head, back over the top and over the right side's top corner.
    [0.08, 2.0, -0.1],
    [0.22, 1.98, -0.24],
    [sx, 1.84, -0.3],
    // Down the right side, swinging back and forth.
    [sx, 1.6, -0.05],
    [sx, 1.38, -0.3],
    [sx, 1.14, 0.02],
    [sx, 0.9, -0.3],
    [sx, 0.62, 0.12],
    [sx, 0.36, -0.22],
    [sx, 0.12, 0.2],
    // Round the front corner and along the floor in front of the base.
    [W / 2 - 0.02, COIL_R, 0.29 + COIL_R],
    [0, COIL_R, 0.3 + COIL_R],
    [-W / 2 + 0.02, COIL_R, 0.29 + COIL_R],
    // Up the left side to the tail, which curls at the end.
    [-sx, 0.14, 0.14],
    [-sx, 0.38, -0.24],
    [-sx, 0.66, 0.08],
    [-sx, 0.92, -0.26],
    [-sx, 1.12, -0.02],
    [-sx, 1.24, -0.18],
    [-sx, 1.2, -0.3],
  ];
  return new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'catmullrom', 0.5);
}

/** A tube along `curve` that thins from the neck to the tip of the tail. */
function taperedTube(curve: THREE.Curve<THREE.Vector3>, segments: number, r: number, radial: number): THREE.BufferGeometry {
  const geo = new THREE.TubeGeometry(curve, segments, r, radial, false);
  const pos = geo.getAttribute('position');
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, centre);
    // Full thickness most of the way; the last fifth tapers to a point.
    const k = t < 0.8 ? 1 : Math.max(0.08, 1 - (t - 0.8) / 0.2);
    for (let j = 0; j <= radial; j++) {
      const n = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, n).sub(centre).multiplyScalar(k).add(centre);
      pos.setXYZ(n, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** The snake's head on top, facing +z: skull, jaw, glowing eyes, nostrils, fangs and a forked tongue. */
function buildHead(skin: THREE.Material): THREE.Group {
  const head = new THREE.Group();
  const belly = toon('#d9f27a');
  // The skull: wide at the back, flattening toward the snout.
  const skull = mesh(new THREE.SphereGeometry(0.2, 20, 14), skin, 0, 0, 0);
  skull.scale.set(1.3, 0.62, 1.25);
  head.add(skull);
  const snout = mesh(new THREE.SphereGeometry(0.16, 18, 12), skin, 0, -0.01, 0.17);
  snout.scale.set(1.1, 0.5, 1.05);
  head.add(snout);
  // The lower jaw, dropped open a little, with the dark red of the mouth showing between.
  const jaw = mesh(new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), belly, 0, -0.06, 0.12);
  jaw.scale.set(1.15, 0.45, 1.25);
  jaw.rotation.x = 0.18;
  head.add(jaw);
  const mouth = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 18), toon('#5a0f1c'), 0, -0.065, 0.16, false);
  mouth.scale.set(1.15, 1, 1.05);
  mouth.rotation.x = 0.09;
  head.add(mouth);
  // Fangs, down from the front of the upper jaw.
  const fang = new THREE.ConeGeometry(0.016, 0.075, 8);
  fang.rotateX(Math.PI);
  for (const sx of [-1, 1]) head.add(mesh(fang, toon('#fffdf2'), sx * 0.075, -0.085, 0.27, false));
  // The forked tongue, flicking out and down past the chin.
  const tongueMat = toon('#e0182d', { emissive: '#5a0008' });
  const tongue = mesh(new THREE.BoxGeometry(0.03, 0.01, 0.2), tongueMat, 0, -0.07, 0.36, false);
  tongue.rotation.x = 0.3;
  head.add(tongue);
  for (const sx of [-1, 1]) {
    const fork = mesh(new THREE.BoxGeometry(0.018, 0.008, 0.09), tongueMat, sx * 0.025, -0.11, 0.48, false);
    fork.rotation.set(0.45, sx * 0.45, 0);
    head.add(fork);
  }
  // The eyes: glowing yellow, up on the sides of the head, with black slit pupils and a brow over each.
  const eyeMat = new THREE.MeshBasicMaterial({ color: EYE, toneMapped: false });
  const pupil = toon('#0b0b0b');
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), eyeMat);
    eye.position.set(sx * 0.16, 0.06, 0.1);
    head.add(eye);
    const slit = mesh(new THREE.BoxGeometry(0.012, 0.07, 0.012), pupil, sx * 0.19, 0.06, 0.13, false);
    slit.rotation.y = sx * 0.9;
    head.add(slit);
    const brow = mesh(new THREE.BoxGeometry(0.13, 0.03, 0.05), skin, sx * 0.14, 0.11, 0.1, false);
    brow.rotation.z = sx * -0.35;
    head.add(brow);
    // The nostrils on the snout.
    head.add(mesh(new THREE.SphereGeometry(0.014, 8, 6), pupil, sx * 0.05, 0.05, 0.31, false));
  }
  return head;
}

export function buildSnakeCabinet(night: NightParts): SnakeCabinetModel {
  const { width: W } = SNAKE_CABINET;
  const group = new THREE.Group();
  const inner = W - 2 * SIDE_T;
  // Scales on everything that's the snake: the body and side panels in meters (4 tiles a meter), the coil along its length.
  const skinMap = scaleTexture(4, 4);
  const body = toonUnique('#6f9a74');
  body.map = skinMap;
  group.add(mesh(slab(BODY, inner, -inner / 2), body));
  const side = toonUnique('#ffffff');
  side.map = skinMap;
  for (const x0 of [-W / 2, W / 2 - SIDE_T]) group.add(mesh(slab(SIDE, SIDE_T, x0), side));

  const curve = coilCurve(W);
  const coilSkin = toonUnique('#ffffff');
  coilSkin.map = scaleTexture(Math.round(curve.getLength() / 0.12), 1);
  group.add(mesh(taperedTube(curve, 180, COIL_R, 10), coilSkin));

  // The head on top, looking out into the room over the screen, its neck running back into the coil.
  const headSkin = toonUnique('#ffffff');
  headSkin.map = scaleTexture(2, 2);
  const head = buildHead(headSkin);
  head.scale.setScalar(1.35);
  head.position.set(0, 2.06, 0.06);
  head.rotation.x = 0.12;
  group.add(head);
  const neck = mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.26, 14), headSkin, 0, 1.96, -0.1);
  neck.rotation.x = 1.2;
  group.add(neck);

  // Under the head, the top front: the snake's belly plates, with a lime trim along the bottom edge.
  const belly = toonUnique('#ffffff');
  belly.map = bellyTexture();
  group.add(mesh(new THREE.PlaneGeometry(inner, 0.22), belly, 0, 1.745, 0.162, false));
  group.add(mesh(new THREE.BoxGeometry(inner, 0.02, 0.02), toon(LIME, { emissive: '#4f7a00' }), 0, 1.64, 0.17, false));

  // The screen, in a black bezel on the slope, showing the attract picture until a game paints it.
  const [bu, bv] = SCREEN_BOTTOM;
  const [tu, tv] = SCREEN_TOP;
  const out = new THREE.Vector2(Math.cos(LEAN), Math.sin(LEAN));
  const bezel = mesh(new THREE.PlaneGeometry(inner - 0.04, 0.5), toon('#07140a'), 0, (bv + tv) / 2 + out.y * 0.002, (bu + tu) / 2 + out.x * 0.002, false);
  bezel.rotation.x = -LEAN;
  group.add(bezel);
  const attract = document.createElement('canvas');
  attract.width = 400;
  attract.height = 300;
  paintAttract(attract);
  const attractTex = new THREE.CanvasTexture(attract);
  attractTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.42), new THREE.MeshBasicMaterial({ map: attractTex, toneMapped: false }));
  screen.position.set(0, (bv + tv) / 2 + out.y * 0.005, (bu + tu) / 2 + out.x * 0.005);
  screen.rotation.x = -LEAN;
  group.add(screen);

  // The control panel: a joystick with a green ball and two buttons.
  const panel = new THREE.Group();
  const [fu, fv] = PANEL_FRONT;
  const [pu, pv] = PANEL_BACK;
  panel.position.set(0, (fv + pv) / 2, (fu + pu) / 2);
  panel.rotation.x = Math.atan2(pv - fv, fu - pu);
  panel.add(mesh(new THREE.BoxGeometry(inner, 0.012, Math.hypot(fu - pu, fv - pv)), toon('#1a1a1a'), 0, 0.006, 0, false));
  panel.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 16), toon('#2b2d42'), -0.14, 0.02, 0.01, false));
  panel.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 8), toon('#adb5bd'), -0.14, 0.075, 0.01, false));
  panel.add(mesh(new THREE.SphereGeometry(0.035, 14, 10), toon('#3ddc5a'), -0.14, 0.135, 0.01));
  ['#ff3b3b', LIME].forEach((c, i) => panel.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 14), toon(c, { emissive: c }), 0.06 + i * 0.12, 0.02, 0, false)));
  group.add(panel);

  // The coin door, its slots lit green.
  group.add(mesh(roundedBox(0.3, 0.26, 0.02, 0.02), toon('#1d2b1f'), 0, 0.64, 0.265, false));
  for (const sx of [-1, 1]) group.add(mesh(new THREE.BoxGeometry(0.03, 0.065, 0.012), toon(LIME, { emissive: '#6fbf00' }), sx * 0.06, 0.69, 0.278, false));
  group.add(mesh(new THREE.BoxGeometry(0.09, 0.02, 0.012), toon('#8d99ae'), 0, 0.57, 0.278, false));

  // S N A K E on the base, lit up big enough to read across the room.
  const sign = document.createElement('canvas');
  sign.width = 512;
  sign.height = 200;
  paintLetters(sign);
  const signTex = new THREE.CanvasTexture(sign);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  const letters = new THREE.Mesh(new THREE.PlaneGeometry(inner, inner * (200 / 512)), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
  letters.position.set(0, 0.155 + (inner * (200 / 512)) / 2, 0.262);
  group.add(letters);
  // Canvas text only picks up the office's font once it has loaded.
  void document.fonts.ready.then(() => {
    paintLetters(sign);
    signTex.needsUpdate = true;
    paintAttract(attract);
    attractTex.needsUpdate = true;
  });

  // Built facing +z; it stands against the east wall facing into the room (-x).
  group.position.set(SNAKE_CABINET.x, 0, SNAKE_CABINET.z);
  group.rotation.y = -Math.PI / 2;
  group.updateMatrixWorld(true);
  // A soft glow at night round the lit letters and the eyes.
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld);
  night.halos.push({ at: at(0, 0.3, 0.36), size: 1.1, color: '#b6ff3a' });
  night.halos.push({ at: at(0, 2.14, 0.3), size: 0.6, color: EYE });

  const half = W / 2 + 2 * COIL_R;
  const collider: Collider = { minX: SNAKE_CABINET.x - 0.45, maxX: FLOOR.maxX, minZ: SNAKE_CABINET.z - half, maxZ: SNAKE_CABINET.z + half, top: SNAKE_CABINET.height };
  const interactable: Interactable = { kind: 'snake', x: SNAKE_CABINET.x - 1.2, z: SNAKE_CABINET.z, radius: 1.3 };
  group.userData.interact = interactable;
  return { group, collider, interactable, screen };
}

/** S N A K E, in glowing lime on black. */
function paintLetters(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!;
  g.fillStyle = '#050d07';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#2f8f3a';
  g.lineWidth = 6;
  g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 150px Nunito, ui-rounded, system-ui, sans-serif';
  const letters = [...'SNAKE'];
  const step = (c.width - 60) / letters.length;
  letters.forEach((ch, i) => {
    const x = 30 + step * (i + 0.5);
    g.shadowColor = '#7dff2a';
    g.shadowBlur = 26;
    g.fillStyle = i % 2 ? '#ffe14d' : LIME;
    g.fillText(ch, x, c.height / 2 + 8);
    g.shadowBlur = 0;
    g.lineWidth = 3;
    g.strokeStyle = '#173d10';
    g.strokeText(ch, x, c.height / 2 + 8);
  });
}

/** The idle screen: a pixel snake going for an apple, the name, and PRESS START. */
function paintAttract(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!;
  const cell = 20;
  g.fillStyle = '#06120a';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(80,200,90,0.08)';
  g.lineWidth = 1;
  for (let x = 0; x <= c.width; x += cell) g.strokeRect(x, 0, 0, c.height);
  for (let y = 0; y <= c.height; y += cell) g.strokeRect(0, y, c.width, 0);
  // The snake, head last, winding toward the apple.
  const body: [number, number][] = [
    [3, 10], [4, 10], [5, 10], [6, 10], [6, 9], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [10, 9], [10, 10], [11, 10], [12, 10], [13, 10],
  ];
  body.forEach(([x, y], i) => {
    g.fillStyle = i === body.length - 1 ? LIME : i % 2 ? '#2fbf4a' : '#3ddc5a';
    g.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
  });
  const [hx, hy] = body[body.length - 1];
  g.fillStyle = '#06120a';
  g.fillRect(hx * cell + 12, hy * cell + 4, 4, 4);
  g.fillRect(hx * cell + 12, hy * cell + 12, 4, 4);
  g.fillStyle = '#ff3b3b';
  g.fillRect(16 * cell + 3, 10 * cell + 3, cell - 6, cell - 6);
  g.fillStyle = '#3ddc5a';
  g.fillRect(16 * cell + 9, 10 * cell - 2, 3, 6);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 64px Nunito, ui-rounded, system-ui, sans-serif';
  g.shadowColor = '#7dff2a';
  g.shadowBlur = 14;
  g.fillStyle = LIME;
  g.fillText('SNAKE', c.width / 2, 70);
  g.font = '800 26px "Courier New", ui-monospace, monospace';
  g.shadowBlur = 8;
  g.shadowColor = '#ffe14d';
  g.fillStyle = '#ffe14d';
  g.fillText('PRESS START', c.width / 2, 270);
  g.shadowBlur = 0;
}
