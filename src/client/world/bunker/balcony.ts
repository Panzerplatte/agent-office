import * as THREE from 'three';
import type { BunkerContext, BunkerPart } from './index';
import { BALCONY, BALCONY_DOOR, FLOOR, SEATING_BY_ID } from '../../../shared/layout';
import { Kit, drawLeather, merge } from './furniture-parts/kit';
import { slabTexture, stencilTexture } from './shellparts/textures';
import { buildPuttingGreen } from '../minigolf';

// The balcony, underground: an enclosed smokers' room. shell.ts walls it in (the airlock: the far
// wall, the two ends and a roof, and the blast door in the doorway), and exterior.ts's facade is the
// building's wall on this side; this dresses it as a room:
//  - the balcony's deck, glass railing, string lights, plants, bistro set and sign go (not the
//    ashtray, where a smoke break starts, nor the seats, which stay where they are, hidden, under
//    their leather stand-ins); a steel frame round the doorway, and the floor is a concrete slab;
//  - a smokers' lounge: a worn leather sofa over the bench, a club chair by the ashtray, two club
//    chairs and a side table where the stools and the bistro table were;
//  - an extractor fan in the far wall, a ledge along it, a dim enamel lamp in a haze of smoke, and a
//    RAUCHERRAUM sign over the door, on both sides of it;
//  - mini golf (world/minigolf.ts): one hole on a strip of putting carpet, from the tee's spot. The
//    office's tee goes (hidden, it's still what E at the tee aims at); main.ts plays golf there as
//    putting while the bunker's on (client/minigolf.ts).
// No rain or snow falls in here, though the sky's weather goes on all round the building, and the
// string lights' halos go with them.

/** The room: the airlock's walls (see shellparts/build.ts) and its roof. */
const ROOM = { x0: BALCONY.minX - 0.12, x1: BALCONY.maxX + 0.12, z0: BALCONY.minZ, z1: BALCONY.maxZ + 0.12, y1: 3.2 } as const;
/** The doorway in the building's wall. */
const DOOR = { x0: BALCONY_DOOR.u - BALCONY_DOOR.width / 2, x1: BALCONY_DOOR.u + BALCONY_DOOR.width / 2, y1: BALCONY_DOOR.y1 } as const;
const noRaycast = () => {};

/** The sky's weather, which it moves every frame (world/sky.ts): what falls in here is put out of sight after. And its halos round the bulbs at night, which it doesn't move. */
interface Weather {
  rainLines?: THREE.LineSegments;
  flakes?: THREE.Points;
  halos?: THREE.Points[];
}

/** Whether (x, y, z) is inside the smokers' room. */
const inRoom = (x: number, y: number, z: number) => x > ROOM.x0 && x < ROOM.x1 && z > ROOM.z0 && z < ROOM.z1 + 0.05 && y < ROOM.y1 + 0.05;

export function buildBalcony(ctx: BunkerContext): BunkerPart {
  const { office, look } = ctx;
  const kit = new Kit();
  const group = new THREE.Group();
  group.name = 'smokers-room';
  ctx.group.add(group);
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);

  // ---- What goes ---------------------------------------------------------------------------------
  const interactOf = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.interact) return p.userData.interact as { kind: string };
    return null;
  };
  // The balcony, but the ashtray: deck, railing, string lights, plants, bench, bistro set, sign.
  const hideOffice = look.balcony.filter((m) => interactOf(m)?.kind !== 'smoke');
  // The golf tee: its mat, the tee and the markers, the bag and the ball.
  office.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && interactOf(o)?.kind === 'golf' && !hideOffice.includes(o as THREE.Mesh)) hideOffice.push(o as THREE.Mesh);
  });

  // ---- The room: a concrete floor -------------------------------------------------------------------
  const gradientMap = (kit.mat('#fff') as THREE.MeshToonMaterial).gradientMap;
  const slab = slabTexture(29);
  slab.repeat.set((ROOM.x1 - ROOM.x0) / 4, (ROOM.z1 - ROOM.z0) / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0), kit.own(new THREE.MeshToonMaterial({ map: own(slab), color: '#a8a39a', gradientMap })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((ROOM.x0 + ROOM.x1) / 2, 0.003, (ROOM.z0 + ROOM.z1) / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // ---- The steel door frame round the doorway, the ledge, the fan's housing ------------------------
  const steel = kit.mat('#5d636b');
  const dark = kit.mat('#2f3338');
  const fixed = new THREE.Group();
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = false) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.castShadow = shadow;
    o.receiveShadow = true;
    fixed.add(o);
    return o;
  };
  // A steel door frame on this side, with a threshold plate: the balcony door's a steel door here.
  for (const x of [DOOR.x0 - 0.06, DOOR.x1 + 0.06]) box(0.12, DOOR.y1 + 0.12, 0.08, steel, x, (DOOR.y1 + 0.12) / 2, ROOM.z0 + 0.04);
  box(DOOR.x1 - DOOR.x0 + 0.24, 0.12, 0.08, steel, BALCONY_DOOR.u, DOOR.y1 + 0.06, ROOM.z0 + 0.04);
  box(DOOR.x1 - DOOR.x0, 0.01, 0.3, dark, BALCONY_DOOR.u, 0.005, ROOM.z0 + 0.15);
  // A steel ledge along the far wall, at the old railing's height, on brackets: for a drink, a lighter, a pumpkin.
  box(ROOM.x1 - ROOM.x0 - 0.3, 0.025, 0.3, steel, (ROOM.x0 + ROOM.x1) / 2, 1.092, ROOM.z1 - 0.15, true);
  for (let x = ROOM.x0 + 0.6; x < ROOM.x1 - 0.3; x += 2.2) box(0.04, 0.18, 0.26, dark, x, 0.99, ROOM.z1 - 0.14);
  // The extractor fan, high in the far wall: a square steel housing round a dark hole, behind a grille.
  const FAN = { x: -4.6, y: 2.45, z: ROOM.z1 - 0.07 };
  box(0.66, 0.66, 0.12, steel, FAN.x, FAN.y, FAN.z);
  box(0.54, 0.54, 0.02, kit.mat('#101214'), FAN.x, FAN.y, FAN.z - 0.055);
  for (let i = -2; i <= 2; i++) box(0.012, 0.54, 0.012, dark, FAN.x + i * 0.11, FAN.y, FAN.z - 0.125);
  for (let i = -2; i <= 2; i++) box(0.54, 0.012, 0.012, dark, FAN.x, FAN.y + i * 0.11, FAN.z - 0.125);
  for (const s of [-1, 1]) box(0.54, 0.012, 0.06, dark, FAN.x, FAN.y + s * 0.27, FAN.z - 0.1);
  // A duct from it up into the roof.
  box(0.3, ROOM.y1 - FAN.y - 0.33, 0.3, steel, FAN.x, (ROOM.y1 + FAN.y + 0.33) / 2, ROOM.z1 - 0.18);
  // The lamp's cord, down from the roof over the lounge.
  const LAMP = { x: -8.7, y: 2.45, z: 15.1 };
  box(0.012, ROOM.y1 - LAMP.y - 0.1, 0.012, dark, LAMP.x, (ROOM.y1 + LAMP.y + 0.1) / 2, LAMP.z);
  const fixedMerged = merge(fixed);
  group.add(fixedMerged);

  // The fan's blades: they turn.
  const blades = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.01), kit.mat('#7d848c'));
    b.position.y = 0.13;
    b.rotation.y = 0.5;
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    arm.add(b);
    blades.add(arm);
  }
  blades.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12).rotateX(Math.PI / 2), dark));
  blades.position.set(FAN.x, FAN.y, FAN.z - 0.08);
  group.add(blades);

  // ---- The lamp: a green enamel shade over a dim bulb, a cone of light in the smoke under it --------
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 20, 1, true).translate(0, -0.1, 0), kit.own(new THREE.MeshToonMaterial({ color: '#2f5d46', side: THREE.DoubleSide, gradientMap })));
  shade.position.set(LAMP.x, LAMP.y + 0.1, LAMP.z);
  group.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), kit.own(new THREE.MeshBasicMaterial({ color: '#ffcf7a' })));
  bulb.position.set(LAMP.x, LAMP.y - 0.04, LAMP.z);
  group.add(bulb);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, LAMP.y - 0.05, 24, 1, true).translate(0, -(LAMP.y - 0.05) / 2, 0),
    kit.own(new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })),
  );
  beam.position.set(LAMP.x, LAMP.y - 0.03, LAMP.z);
  group.add(beam);
  // Smoke hanging under the roof, drifting slowly.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const puff = own(new THREE.CanvasTexture(c));
  const haze: { s: THREE.Sprite; x: number; z: number; y: number; k: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(kit.own(new THREE.SpriteMaterial({ map: puff, color: '#c8c2b6', transparent: true, opacity: 0.16, depthWrite: false })));
    const x = ROOM.x0 + 1.2 + (i / 6) * (ROOM.x1 - ROOM.x0 - 2.4);
    const z = 14.4 + (i % 3) * 0.8;
    const y = 2.55 + (i % 2) * 0.3;
    s.scale.setScalar(2.2 + (i % 3) * 0.5);
    s.position.set(x, y, z);
    group.add(s);
    haze.push({ s, x, z, y, k: i * 1.7 });
  }

  // ---- RAUCHERRAUM by the door, on both sides ---------------------------------------------------
  // In here beside it (the floor's number is over it, see exterior.ts); in the bunker over it, standing
  // off the wall on two brackets, clear of the blast door rolling up behind it.
  const signTex = own(stencilTexture('RAUCHERRAUM', { bg: '#7a2a1f', color: '#f2e6c4', w: 1024, h: 160 }));
  const signMat = kit.own(new THREE.MeshToonMaterial({ map: signTex, emissive: '#2a2420', gradientMap }));
  const SIGN_OUT = 0.5;
  for (const [x, z, y, turn] of [
    [DOOR.x0 - 1.05, ROOM.z0 + 0.045, 2.05, 0],
    [BALCONY_DOOR.u, FLOOR.maxZ - SIGN_OUT, 3.0, Math.PI],
  ] as const) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.234), signMat);
    sign.position.set(x, y, z);
    sign.rotation.y = turn;
    group.add(sign);
    // Its back, in steel, so it's not see-through from behind.
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.27, 0.02), dark);
    back.position.set(x, y, z + (turn ? 0.012 : -0.012));
    group.add(back);
  }
  for (const s of [-0.6, 0.6]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, SIGN_OUT), dark);
    bracket.position.set(BALCONY_DOOR.u + s, 3.0 + 0.1, FLOOR.maxZ - SIGN_OUT / 2);
    group.add(bracket);
  }

  // ---- The smokers' lounge -------------------------------------------------------------------------
  const leather = kit.painted('smokers-leather', () => drawLeather('#6b3a22', 41), { repeat: [1.5, 1.5] });
  const wood = kit.mat('#4a3020');
  /** A worn leather club chair (or a sofa `w` wide), facing +z, its seat's front middle at the origin's z + 0.36. */
  const clubChair = (w: number, cushions: number) => {
    const ch = new THREE.Group();
    const part = (gw: number, gh: number, gd: number, m: THREE.Material, x: number, y: number, z: number, tilt = 0) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), m);
      o.position.set(x, y, z);
      o.rotation.x = tilt;
      o.castShadow = true;
      ch.add(o);
    };
    part(w, 0.26, 0.72, leather, 0, 0.21, 0);
    part(w, 0.52, 0.18, leather, 0, 0.6, -0.28, -0.12);
    for (const s of [-1, 1]) part(0.15, 0.3, 0.74, leather, s * (w / 2 - 0.07), 0.47, 0);
    const cw = (w - 0.3) / cushions;
    for (let i = 0; i < cushions; i++) part(cw - 0.02, 0.12, 0.56, leather, -w / 2 + 0.15 + cw * (i + 0.5), 0.4, 0.06);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(0.06, 0.08, 0.06, wood, sx * (w / 2 - 0.08), 0.04, sz * 0.3);
    return ch;
  };
  const lounge = new THREE.Group();
  const place = (o: THREE.Object3D, x: number, z: number, rotY: number) => {
    o.position.set(x, 0, z);
    o.rotation.y = rotY;
    lounge.add(o);
  };
  // Over the seats: the sofa on the bench, a club chair on each stool, set back a little so you sit in it.
  const seatSpot = (id: string, back: number): [number, number, number] => {
    const s = SEATING_BY_ID.get(id)!;
    return [s.x - Math.sin(s.rotY) * back, s.z - Math.cos(s.rotY) * back, s.rotY];
  };
  {
    const [x, z, r] = seatSpot('bench', -0.06);
    place(clubChair(2.1, 2), x, z, r);
  }
  for (const id of ['stool-1', 'stool-2']) {
    const [x, z, r] = seatSpot(id, 0.1);
    place(clubChair(0.8, 1), x, z, r);
  }
  // A club chair turned to the ashtray, in the corner past it.
  place(clubChair(0.8, 1), -9.8, 15.5, 1.2);
  // Side tables: one between the two chairs (where the bistro table was), one by the chair at the ashtray.
  const sideTable = () => {
    const t = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 20), wood);
    top.position.y = 0.56;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.54, 8), dark);
    leg.position.y = 0.27;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.03, 14), dark);
    foot.position.y = 0.015;
    // A glass ashtray and a tumbler on it.
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.03, 14), kit.mat('#9fb7b0'));
    tray.position.set(0.07, 0.595, 0.04);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), kit.mat('#c9822f'));
    glass.position.set(-0.09, 0.625, -0.05);
    t.add(top, leg, foot, tray, glass);
    for (const o of t.children) o.castShadow = true;
    return t;
  };
  const table = SEATING_BY_ID.get('stool-1')!;
  place(sideTable(), (table.x + SEATING_BY_ID.get('stool-2')!.x) / 2, table.z, 0);
  place(sideTable(), -9.95, 16.4, 0);
  const loungeMerged = merge(lounge);
  group.add(loungeMerged);

  // ---- The hole --------------------------------------------------------------------------------------
  const green = buildPuttingGreen();
  group.add(green.group);

  // Nothing in here is aimed at: E goes through to what it stands in for (the seats, the tee), hidden under it.
  group.traverse((o) => (o.raycast = noRaycast));

  const weather = ctx.deps.sky as unknown as Weather;
  /** Puts the rain and snow that's in the room this frame out of sight (the sky moves it all again next frame). */
  const keepDry = () => {
    const rain = weather.rainLines;
    if (rain?.visible) {
      const a = rain.geometry.attributes.position.array as Float32Array;
      const n = Math.min(a.length / 3, rain.geometry.drawRange.count);
      for (let i = 0; i + 1 < n; i += 2) {
        if (!inRoom(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])) continue;
        a[i * 3 + 1] = a[i * 3 + 4] = -1000;
        rain.geometry.attributes.position.needsUpdate = true;
      }
    }
    const snow = weather.flakes;
    if (snow?.visible) {
      const a = snow.geometry.attributes.position.array as Float32Array;
      const n = Math.min(a.length / 3, snow.geometry.drawRange.count);
      for (let i = 0; i < n; i++) {
        if (!inRoom(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])) continue;
        a[i * 3 + 1] = -1000;
        snow.geometry.attributes.position.needsUpdate = true;
      }
    }
  };

  /** The string lights' halos, put out of sight while the bunker's on: where each was, to put it back. */
  const halos: { at: THREE.BufferAttribute; i: number; y: number }[] = [];
  const hideHalos = (on: boolean) => {
    if (!on) {
      for (const h of halos) {
        h.at.setY(h.i, h.y);
        h.at.needsUpdate = true;
      }
      halos.length = 0;
      return;
    }
    for (const p of weather.halos ?? []) {
      const at = p.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < at.count; i++) {
        // The string lights go up to 3.5 m on the wall, over the room's roof.
        if (!inRoom(at.getX(i), Math.min(at.getY(i), ROOM.y1), at.getZ(i)) || at.getY(i) < -0.5 || at.getY(i) > ROOM.y1 + 0.5) continue;
        halos.push({ at, i, y: at.getY(i) });
        at.setY(i, -1000);
        at.needsUpdate = true;
      }
    }
  };

  return {
    hideOffice,
    set: hideHalos,
    update(dt, t) {
      blades.rotation.z -= dt * 7;
      green.update(t);
      for (const h of haze) {
        h.s.position.set(h.x + Math.sin(t * 0.07 + h.k) * 0.6, h.y + Math.sin(t * 0.11 + h.k) * 0.08, h.z + Math.cos(t * 0.05 + h.k) * 0.3);
        h.s.material.opacity = 0.13 + 0.05 * Math.sin(t * 0.2 + h.k);
      }
      keepDry();
    },
    dispose() {
      hideHalos(false);
      green.dispose();
      group.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
      for (const o of owned) o.dispose();
      kit.dispose();
      group.removeFromParent();
    },
  };
}
