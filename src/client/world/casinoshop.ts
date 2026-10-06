// The casino's shop (see shared/shop.ts): a little boutique through a doorway at the west end of the
// main hall's south wall. A black-and-white marble floor, teal walls over dark panelling, a counter
// across the back with the shopkeeper behind it and a neon sign over them, the hats on stands down
// the west wall, the desk things in a glass case down the east wall, the crown under a glass dome in
// the middle, the glasses on the counter and the name colours glowing on the back wall. Everything
// on show is the real thing (world/shopitems.ts), with its price on a tag. E at the counter or at a
// display opens the shop (see ui/shop.ts, main.ts).
import * as THREE from 'three';
import { CASINO_ROOM, CASINO_SHOP, SHOP_COUNTER, SHOP_DISPLAYS, shopFootprints } from '../../shared/casino';
import { SHOP_ITEMS, type ShopItem, type ShopSlot } from '../../shared/shop';
import { lang, t } from '../i18n';
import { Worker } from './character';
import type { Collider, Interactable } from './office';
import { shopModel } from './shopitems';
import { mergeByMaterial, mesh, roundedBox, toon } from './toon';

const S = CASINO_SHOP.room;
const D = CASINO_SHOP.door;
const BRASS = '#d4a84b';
const PANEL = '#1f2a2e';
const WALL = '#155e63';

export interface CasinoShop {
  /** Where you stand at the counter, and the shopkeeper behind it. */
  at: { x: number; z: number };
  worker: Worker;
  /** The things on show, by item id (for tests and the curious). */
  shown: ReadonlyMap<string, THREE.Object3D>;
  update(dt: number, time: number): void;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function glow(color: THREE.ColorRepresentation, opts: { transparent?: boolean; map?: THREE.Texture } = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, map: opts.map ?? null, transparent: !!opts.transparent, depthWrite: !opts.transparent });
  m.toneMapped = false;
  return m;
}

function fitFont(g: CanvasRenderingContext2D, text: string, px: number, width: number, weight = 900) {
  const font = (n: number) => `${weight} ${n}px Nunito, ui-rounded, system-ui, sans-serif`;
  g.font = font(px);
  const w = g.measureText(text).width;
  if (w > width) g.font = font(Math.floor((px * width) / w));
}

/** A price tag: the item's name, and its price in chips under it. */
function priceTag(item: ShopItem): THREE.Mesh {
  const name = item.name[lang()];
  const price = item.price.toLocaleString(lang() === 'de' ? 'de-DE' : 'en-US');
  const tex = canvasTexture(256, 112, (g) => {
    g.fillStyle = '#fffaf0';
    g.beginPath();
    g.roundRect(4, 4, 248, 104, 14);
    g.fill();
    g.strokeStyle = BRASS;
    g.lineWidth = 5;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#14101a';
    fitFont(g, name, 30, 228, 800);
    g.fillText(name, 128, 38);
    // A little red chip by the price.
    g.font = '900 40px Nunito, ui-rounded, system-ui, sans-serif';
    const w = g.measureText(price).width;
    const cx = 128 - w / 2 - 6;
    g.fillStyle = '#e63946';
    g.beginPath();
    g.arc(cx - 10, 78, 13, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.setLineDash([4, 5]);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#9a6b00';
    g.fillText(price, 128 + 12, 80);
  });
  return mesh(new THREE.PlaneGeometry(0.3, 0.13), glow('#ffffff', { map: tex }), 0, 0, 0, false);
}

/** Puts the shop through its doorway off the main hall: its room, counter, shopkeeper and displays. */
export function buildCasinoShop(group: THREE.Group, colliders: Collider[], interactables: Interactable[]): CasinoShop {
  const statics = new THREE.Group();
  const brass = toon(BRASS);
  const w = S.maxX - S.minX;
  const d = S.maxZ - S.minZ;
  const cx = (S.minX + S.maxX) / 2;
  const cz = (S.minZ + S.maxZ) / 2;
  const H = S.height;
  const T = CASINO_SHOP.wall;
  const shown = new Map<string, THREE.Object3D>();
  const items = (slot: ShopSlot) => SHOP_ITEMS.filter((i) => i.slot === slot);

  // ---- The room: a marble floor, walls, a ceiling ------------------------------------------------------
  const marble = canvasTexture(128, 128, (g) => {
    for (let i = 0; i < 2; i++)
      for (let k = 0; k < 2; k++) {
        g.fillStyle = (i + k) % 2 ? '#15151b' : '#ece6da';
        g.fillRect(i * 64, k * 64, 64, 64);
      }
    g.strokeStyle = 'rgba(160, 150, 140, 0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(6, 20);
    g.bezierCurveTo(30, 40, 40, 10, 60, 50);
    g.moveTo(70, 90);
    g.bezierCurveTo(90, 70, 100, 120, 124, 100);
    g.stroke();
  });
  marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
  // The floor runs on through the doorway, under the main hall's wall.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d + T).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ map: marble, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  marble.repeat.set(w / 1.2, (d + T) / 1.2);
  floor.position.set(cx, 0.002, cz - T / 2);
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push({ minX: S.minX, maxX: S.maxX, minZ: CASINO_ROOM.maxZ, maxZ: S.maxZ, bottom: -0.3, top: 0 });

  const panel = toon(PANEL);
  const paper = toon(WALL);
  const dado = 1.1;
  /** A run of wall from (x0, z0) to (x1, z1), its face toward `n` (a unit along x or z): panelling, a brass rail, the wall over it, and a collider behind. */
  const wall = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const along = nx === 0;
    const box = (thick: number, h: number, y: number, out: number, mat: THREE.Material) =>
      statics.add(mesh(new THREE.BoxGeometry(along ? len : thick, h, along ? thick : len), mat, mx + nx * out, y, mz + nz * out, false));
    // Only its inside face: the main hall's wall is behind the north one, and there's nothing round the rest.
    box(0.06, H, H / 2, -0.03, paper);
    box(0.06, dado, dado / 2, 0.03, panel);
    box(0.1, 0.05, dado + 0.025, 0.05, brass);
    colliders.push({ minX: Math.min(x0, x1) - (along ? 0 : nx > 0 ? T : 0), maxX: Math.max(x0, x1) + (along ? 0 : nx < 0 ? T : 0), minZ: Math.min(z0, z1) - (along ? (nz > 0 ? T : 0) : 0), maxZ: Math.max(z0, z1) + (along ? (nz < 0 ? T : 0) : 0), top: 99 });
  };
  wall(S.minX - T, S.maxZ, S.maxX + T, S.maxZ, 0, -1);
  wall(S.minX, S.minZ, S.minX, S.maxZ, 1, 0);
  wall(S.maxX, S.minZ, S.maxX, S.maxZ, -1, 0);
  // The north wall is the main hall's south wall, from this side: either side of the doorway.
  wall(S.minX, S.minZ, D.x - D.width / 2, S.minZ, 0, 1);
  wall(D.x + D.width / 2, S.minZ, S.maxX, S.minZ, 0, 1);
  statics.add(mesh(new THREE.BoxGeometry(D.width, H - D.height, 0.06), paper, D.x, (H + D.height) / 2, S.minZ + 0.03, false));
  // (From the hall's wall back: not into it, where it would show through as a seam.)
  statics.add(mesh(new THREE.BoxGeometry(w + T * 2, 0.2, d + T), toon('#0e1416'), cx, H + 0.1, cz + T / 2, false));
  // A glowing panel in the ceiling, and lights that make the room brighter than the hall.
  group.add(mesh(new THREE.PlaneGeometry(w - 2.4, d - 2.4).rotateX(Math.PI / 2), glow('#fff4dc'), cx, H - 0.01, cz, false));
  for (const [x, z] of [
    [cx, S.minZ + 2],
    [cx, S.maxZ - 2],
  ]) {
    const l = new THREE.PointLight('#fff1d6', 6, 9, 1.3);
    l.position.set(x, H - 0.4, z);
    group.add(l);
  }

  // ---- The doorway, from the main hall: brass jambs and a lintel, and a sign over it -----------------------
  const hall = CASINO_ROOM.maxZ;
  for (const s of [-1, 1]) statics.add(mesh(new THREE.BoxGeometry(0.12, D.height, T + 0.12), brass, D.x + s * (D.width / 2 + 0.03), D.height / 2, hall + T / 2, false));
  statics.add(mesh(new THREE.BoxGeometry(D.width + 0.18, 0.12, T + 0.12), brass, D.x, D.height + 0.06, hall + T / 2, false));
  // The main hall's wall over the doorway, up to its ceiling.
  statics.add(mesh(new THREE.BoxGeometry(D.width, CASINO_ROOM.height - D.height, T), toon('#3b1d12'), D.x, (CASINO_ROOM.height + D.height) / 2, hall + T / 2, false));
  colliders.push({ minX: D.x - D.width / 2, maxX: D.x + D.width / 2, minZ: hall, maxZ: hall + T, bottom: D.height, top: 99 });
  const signTex = canvasTexture(512, 160, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitFont(g, t('world.casinoShopSign'), 110, 470);
    for (const [blur, color] of [
      [30, '#2ee6c9'],
      [0, '#e6fffb'],
    ] as const) {
      g.shadowColor = '#00c2a8';
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.fillText(t('world.casinoShopSign'), 256, 86);
    }
  });
  const hallSign = mesh(new THREE.PlaneGeometry(2.4, 0.75), glow('#ffffff', { map: signTex, transparent: true }), D.x, D.height + 0.65, hall - 0.06, false);
  hallSign.rotation.y = Math.PI;
  group.add(hallSign);

  // ---- The counter and the shopkeeper ------------------------------------------------------------------------
  const C = SHOP_COUNTER;
  const cMid = C.front + C.depth / 2;
  statics.add(mesh(new THREE.BoxGeometry(C.length, C.height - 0.05, C.depth), toon('#5a2e1c'), C.x, (C.height - 0.05) / 2, cMid));
  statics.add(mesh(new THREE.BoxGeometry(C.length + 0.1, 0.05, C.depth + 0.1), toon('#e8dcc2'), C.x, C.height - 0.025, cMid));
  statics.add(mesh(new THREE.BoxGeometry(C.length, 0.06, 0.03), brass, C.x, 0.25, C.front - 0.01, false));
  // A cash register at one end, a bowl of chips at the other.
  statics.add(mesh(roundedBox(0.4, 0.2, 0.32, 0.03), toon('#2b2d42'), C.x + 1.25, C.height + 0.1, cMid + 0.05));
  statics.add(mesh(new THREE.BoxGeometry(0.3, 0.12, 0.02), toon('#86efac', { emissive: '#14532d' }), C.x + 1.25, C.height + 0.27, cMid + 0.18, false));
  const worker = new Worker(t('world.casinoShopkeeper'), '#0f766e');
  worker.setStatus('idle', false);
  worker.setTask({ name: `🛍️ ${t('world.casinoShopkeeper')}`, summary: t('world.casinoShopkeeperSummary') });
  worker.root.position.set(C.x, 0, C.front + C.depth + 0.5);
  worker.root.rotation.y = Math.PI;
  group.add(worker.root);

  // The counter (and every display) opens the shop: walk up to it, or look at it, and press E. They're
  // merged in with the rest of the room, so the crosshair finds each on a box round it that's never drawn.
  const counter: Interactable = { kind: 'shop', x: C.x, z: C.front - 0.6, radius: C.reach };
  interactables.push(counter);
  const pick = (it: Interactable, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.set(x, y, z);
    box.userData.interact = it;
    group.add(box);
  };
  pick(counter, C.x, 0.95, C.front + (C.depth + 0.9) / 2, C.length, 1.9, C.depth + 0.9);

  // The glasses on the counter, each on a little stand of its own, and the name colours on the back wall.
  const stand = (x: number, y: number, z: number, h: number) => {
    statics.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.03, 16), brass, x, y + 0.015, z, false));
    statics.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, h, 8), brass, x, y + h / 2, z, false));
    statics.add(mesh(new THREE.SphereGeometry(0.2, 16, 12), toon('#f1e4d0'), x, y + h + 0.17, z));
    return y + h + 0.17;
  };
  items('face').forEach((item, i) => {
    const x = C.x - 1.3 + i * 0.55;
    const z = C.front + 0.3;
    const headY = stand(x, C.height, z, 0.12);
    const m = shopModel(item);
    if (!m) return;
    // On a head of 0.2 m rather than a person's 0.34.
    m.scale.setScalar(0.2 / 0.34);
    m.position.set(x, headY, z);
    group.add(m);
    shown.set(item.id, m);
    const tag = priceTag(item);
    tag.position.set(x, C.height + 0.07, C.front - 0.012);
    tag.rotation.y = Math.PI;
    group.add(tag);
  });
  // (Off to the side of the counter, in a column, clear of the shopkeeper's name over their head.)
  items('name').forEach((item, i) => {
    const x = C.x + C.length / 2 + 1;
    const y = 2.35 - i * 0.5;
    const m = shopModel(item);
    if (!m) return;
    m.scale.setScalar(1.6);
    m.rotation.y = Math.PI;
    m.position.set(x, y, S.maxZ - 0.04);
    group.add(m);
    shown.set(item.id, m);
    const tag = priceTag(item);
    tag.position.set(x + 0.55, y + 0.1, S.maxZ - 0.03);
    tag.rotation.y = Math.PI;
    group.add(tag);
  });
  // The shop's own sign over all of it.
  const backSign = mesh(new THREE.PlaneGeometry(2.6, 0.8), glow('#ffffff', { map: signTex, transparent: true }), C.x, 2.85, S.maxZ - 0.05, false);
  backSign.rotation.y = Math.PI;
  group.add(backSign);

  // ---- The displays -------------------------------------------------------------------------------------------
  const [hatsD, deskD, crownD] = SHOP_DISPLAYS;
  const display = (dsp: (typeof SHOP_DISPLAYS)[number], x: number, z: number) => {
    const it: Interactable = { kind: 'shop', x, z, radius: C.reach };
    interactables.push(it);
    pick(it, (dsp.minX + dsp.maxX) / 2, 1, (dsp.minZ + dsp.maxZ) / 2, dsp.maxX - dsp.minX + 0.1, 2, dsp.maxZ - dsp.minZ + 0.1);
  };
  // The hats: a low dark cabinet down the west wall, a head on a stand for each hat.
  {
    const dsp = hatsD;
    const mx = (dsp.minX + dsp.maxX) / 2;
    statics.add(mesh(new THREE.BoxGeometry(dsp.maxX - dsp.minX, dsp.height, dsp.maxZ - dsp.minZ), toon('#2b1a14'), mx, dsp.height / 2, (dsp.minZ + dsp.maxZ) / 2));
    statics.add(mesh(new THREE.BoxGeometry(dsp.maxX - dsp.minX + 0.04, 0.03, dsp.maxZ - dsp.minZ + 0.04), brass, mx, dsp.height + 0.015, (dsp.minZ + dsp.maxZ) / 2, false));
    const hats = items('hat').filter((i) => i.id !== 'crown');
    hats.forEach((item, i) => {
      const z = dsp.minZ + ((i + 0.5) / hats.length) * (dsp.maxZ - dsp.minZ);
      const headY = stand(mx + 0.02, dsp.height, z, 0.22);
      const m = shopModel(item);
      if (!m) return;
      m.scale.setScalar(0.2 / 0.34);
      m.rotation.y = Math.PI / 2;
      m.position.set(mx + 0.02, headY, z);
      group.add(m);
      shown.set(item.id, m);
      const tag = priceTag(item);
      tag.position.set(dsp.maxX + 0.012, dsp.height - 0.12, z);
      tag.rotation.y = Math.PI / 2;
      group.add(tag);
    });
    display(dsp, dsp.maxX + 0.8, (dsp.minZ + dsp.maxZ) / 2);
  }
  // The desk things: a glass case down the east wall, each on the shelf inside it.
  {
    const dsp = deskD;
    const mx = (dsp.minX + dsp.maxX) / 2;
    const mz = (dsp.minZ + dsp.maxZ) / 2;
    const len = dsp.maxZ - dsp.minZ;
    const shelf = 0.6;
    statics.add(mesh(new THREE.BoxGeometry(dsp.maxX - dsp.minX, shelf, len), toon('#2b1a14'), mx, shelf / 2, mz));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(dsp.maxX - dsp.minX - 0.04, dsp.height - shelf, len - 0.04), new THREE.MeshBasicMaterial({ color: '#bdf3ff', transparent: true, opacity: 0.16, depthWrite: false }));
    glass.position.set(mx, shelf + (dsp.height - shelf) / 2, mz);
    group.add(glass);
    for (const s of [-1, 1]) statics.add(mesh(new THREE.BoxGeometry(dsp.maxX - dsp.minX, 0.03, 0.03), brass, mx, dsp.height, mz + (s * len) / 2, false));
    statics.add(mesh(new THREE.BoxGeometry(0.03, 0.03, len), brass, dsp.minX, dsp.height, mz, false));
    const desk = items('desk');
    desk.forEach((item, i) => {
      const z = dsp.minZ + ((i + 0.5) / desk.length) * len;
      const m = shopModel(item);
      if (!m) return;
      m.scale.setScalar(1.3);
      m.rotation.y = -Math.PI / 2;
      m.position.set(mx, shelf, z);
      group.add(m);
      shown.set(item.id, m);
      const tag = priceTag(item);
      tag.position.set(dsp.minX - 0.012, shelf - 0.12, z);
      tag.rotation.y = -Math.PI / 2;
      group.add(tag);
    });
    group.add(mesh(new THREE.BoxGeometry(0.02, 0.02, len - 0.1), glow('#fff4dc'), mx, dsp.height - 0.02, mz, false));
    display(dsp, dsp.minX - 0.8, mz);
  }
  // The crown: on a cushion on a column in the middle of the room, under a glass dome.
  {
    const dsp = crownD;
    const mx = (dsp.minX + dsp.maxX) / 2;
    const mz = (dsp.minZ + dsp.maxZ) / 2;
    statics.add(mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.08, 24), brass, mx, 0.04, mz));
    statics.add(mesh(new THREE.CylinderGeometry(0.28, 0.3, dsp.height - 0.12, 20), toon('#14101a'), mx, dsp.height / 2, mz));
    statics.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 24), brass, mx, dsp.height - 0.03, mz));
    statics.add(mesh(roundedBox(0.4, 0.08, 0.4, 0.04), toon('#9b1d20'), mx, dsp.height + 0.04, mz));
    const crown = SHOP_ITEMS.find((i) => i.id === 'crown');
    const m = crown && shopModel(crown);
    if (crown && m) {
      m.scale.setScalar(0.7);
      m.position.set(mx, dsp.height + 0.08 - 0.2, mz);
      group.add(m);
      shown.set(crown.id, m);
      const tag = priceTag(crown);
      tag.position.set(mx, dsp.height - 0.25, dsp.minZ + 0.06);
      tag.rotation.y = Math.PI;
      group.add(tag);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#d8f6ff', transparent: true, opacity: 0.18, depthWrite: false }));
    dome.position.set(mx, dsp.height + 0.02, mz);
    group.add(dome);
    const spot = new THREE.PointLight('#ffe7a3', 2.5, 3, 1.5);
    spot.position.set(mx, dsp.height + 1.1, mz);
    group.add(spot);
    display(dsp, mx, dsp.minZ - 0.7);
  }

  // A palm in each front corner, as in the hall.
  const leaf = toon('#2f7d4a');
  for (const x of [S.minX + 0.45, S.maxX - 0.45]) {
    const z = S.minZ + 0.45;
    statics.add(mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.42, 12), brass, x, 0.21, z));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const f = mesh(new THREE.ConeGeometry(0.12, 0.75, 4), leaf, x + Math.cos(a) * 0.25, 0.85, z + Math.sin(a) * 0.25, false);
      f.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
      statics.add(f);
    }
    colliders.push({ minX: x - 0.24, maxX: x + 0.24, minZ: z - 0.24, maxZ: z + 0.24, top: 0.5 });
  }

  for (const f of shopFootprints()) colliders.push({ minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ, top: f.top });
  group.add(mergeByMaterial(statics));

  // The crown turns slowly under its dome.
  const crownShown = shown.get('crown');
  return {
    at: { x: counter.x, z: counter.z },
    worker,
    shown,
    update(dt, time) {
      worker.update(dt, time);
      if (crownShown) crownShown.rotation.y = time * 0.4;
    },
  };
}
