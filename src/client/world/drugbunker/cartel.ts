// The bunker's cartel station: an old wall phone on a board on the east wall, a red lamp over it, and a
// crate under it where the bulk goes. When the cartel has an offer you haven't picked up for (see
// shared/bunker/cartel.ts's ringing), the phone rings: a trill now and then, the lamp blinking and the
// handset rattling on its hook.
import * as THREE from 'three';
import { stationBox, type BunkerPerson, type StationSpot } from '../../../shared/bunker/index';
import { ringing } from '../../../shared/bunker/cartel';
import { loadSettings } from '../../state';
import { mergeByMaterial, mesh, toon } from '../toon';
import type { StationView } from './station';

/** How high the phone hangs (the middle of its body). */
const PHONE_Y = 1.3;
/** A ring every so often (s), and how long one rings. */
export const RING_EVERY = 4;
const RING_FOR = 1.3;

/** Lit, not outlined: the lamp. */
function glow(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color });
  m.toneMapped = false;
  m.userData.outlineParameters = { visible: false };
  return m;
}

/**
 * The phone's bell, made in Web Audio like the office's own sounds (no files): a warbling trill, at the
 * office sounds' volume (Settings). Quiet until the page has been clicked, as browsers want.
 */
export class Bell {
  private ctx: AudioContext | null = null;
  /** How many times it's rung, for quick checks from the console. */
  rings = 0;

  ring() {
    this.rings++;
    if (typeof AudioContext === 'undefined') return;
    const { volume, muted } = loadSettings();
    if (muted || volume <= 0) return;
    const ctx = (this.ctx ??= new AudioContext());
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.value = 0.09 * volume;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    out.connect(tone).connect(ctx.destination);
    // Two bursts, the bell flipping between two notes.
    for (const start of [0, 0.7]) {
      const t = t0 + start;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      for (let k = 0; k < 12; k++) o.frequency.setValueAtTime(k % 2 ? 1500 : 1180, t + k / 22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.02);
      g.gain.setValueAtTime(1, t + 0.52);
      g.gain.linearRampToValueAtTime(0, t + 0.58);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.6);
    }
  }
}

export interface CartelView extends StationView {
  /** The lamp over the phone (lit while it rings). */
  lamp: THREE.MeshBasicMaterial;
  /** The handset, on its hook. */
  handset: THREE.Object3D;
  /** Whether it's ringing now. */
  isRinging(): boolean;
  bell: Bell;
}

export function buildCartel(spot: StationSpot): CartelView {
  const group = new THREE.Group();
  group.name = 'bunker-cartel';
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rotY;
  const back = -spot.d / 2;

  const wood = toon('#9a7448');
  const crateWood = toon('#8a6a3f');
  const plastic = toon('#2e3236');
  const cream = toon('#d9cfb4');
  const dark = toon('#141618');
  const brass = toon('#b08d3c');

  // ---- What never moves: the board, the phone's body and dial, the lamp's cage, the crate -----------------
  const fixed = new THREE.Group();
  fixed.add(mesh(new THREE.BoxGeometry(0.5, 0.72, 0.025), wood, 0, PHONE_Y + 0.05, back + 0.015, false));
  for (const x of [-0.2, 0.2])
    for (const y of [PHONE_Y - 0.26, PHONE_Y + 0.36]) fixed.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8).rotateX(Math.PI / 2), brass, x, y, back + 0.03, false));
  const bodyZ = back + 0.03 + 0.05;
  fixed.add(mesh(new THREE.BoxGeometry(0.2, 0.28, 0.1), plastic, 0.03, PHONE_Y, bodyZ, false));
  // The dial: a cream face with ten holes round it.
  fixed.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 24).rotateX(Math.PI / 2), cream, 0.03, PHONE_Y - 0.02, bodyZ + 0.056, false));
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * 0.35 + (i / 10) * Math.PI * 1.6;
    fixed.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 8).rotateX(Math.PI / 2), dark, 0.03 + Math.cos(a) * 0.05, PHONE_Y - 0.02 + Math.sin(a) * 0.05, bodyZ + 0.064, false));
  }
  // The hook the handset hangs on, on its left.
  fixed.add(mesh(new THREE.BoxGeometry(0.03, 0.05, 0.04), dark, -0.085, PHONE_Y + 0.08, bodyZ + 0.02, false));
  // The coiled cord, down from the handset and back up into the body.
  const coil = new THREE.Group();
  for (let i = 0; i < 9; i++) coil.add(mesh(new THREE.TorusGeometry(0.012, 0.004, 4, 10).rotateX(Math.PI / 2), plastic, -0.11, PHONE_Y - 0.12 - i * 0.012, bodyZ + 0.01, false));
  fixed.add(coil);
  // The lamp's cage over it.
  fixed.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 12), dark, 0, PHONE_Y + 0.43, back + 0.06, false));
  // The crate under it, where the bulk goes, with a stripe of tape round it.
  fixed.add(mesh(new THREE.BoxGeometry(0.55, 0.4, 0.26), crateWood, 0, 0.2, 0, false));
  for (const y of [0.08, 0.32]) fixed.add(mesh(new THREE.BoxGeometry(0.56, 0.035, 0.27), wood, 0, y, 0, false));
  fixed.add(mesh(new THREE.BoxGeometry(0.1, 0.405, 0.265), toon('#c8a24a'), 0.12, 0.2, 0, false));
  group.add(mergeByMaterial(fixed));

  // ---- What moves: the lamp and the handset ----------------------------------------------------------------
  const lamp = glow('#4a1512');
  const bulb = mesh(new THREE.SphereGeometry(0.04, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lamp, 0, PHONE_Y + 0.44, back + 0.06, false);
  bulb.name = 'cartel-lamp';
  group.add(bulb);
  const handset = new THREE.Group();
  handset.name = 'cartel-handset';
  handset.position.set(-0.11, PHONE_Y + 0.08, bodyZ + 0.03);
  handset.add(mesh(new THREE.BoxGeometry(0.035, 0.2, 0.035), plastic, 0, -0.08, 0, false));
  for (const y of [0.01, -0.17]) handset.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), plastic, 0, y, 0.01, false));
  group.add(handset);

  const box = stationBox(spot);
  const bell = new Bell();
  let ring = false;
  let nextRing = 0;
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    group,
    colliders: [{ ...box, top: 0.4 }],
    lamp,
    handset,
    bell,
    isRinging: () => ring,
    update(t: number, _dt: number, mine: BunkerPerson | null) {
      const now = ringing(mine?.cartel);
      if (now && !ring) nextRing = t;
      ring = now;
      if (ring && t >= nextRing) {
        bell.ring();
        nextRing = t + RING_EVERY;
      }
      // While it rings: the lamp blinks and the handset rattles on its hook.
      const phase = ring ? t - (nextRing - RING_EVERY) : RING_FOR;
      const sounding = ring && phase < RING_FOR;
      lamp.color.set(ring && (still || Math.floor(t * 3) % 2 === 0) ? '#ff2a1a' : '#4a1512');
      handset.rotation.z = sounding && !still ? Math.sin(t * 60) * 0.06 : 0;
    },
  };
}
