import * as THREE from 'three';
import type { BunkerContext, BunkerPart } from './index';
import type { OfficeSound } from '../../sound';
import { DESKS } from '../../../shared/layout';

// The bunker's atmosphere: what it sounds and feels like, and how it comes and goes.
//  - Ambient sound: a low hum of ventilation and a generator far off (the bunker block in sound.ts),
//    faded in while the bunker's on and out again when it's switched off or you leave the floor.
//  - The switching transition: a breaker clunks, the lights cut out for a moment and flicker back on
//    in the new look, both ways (bunker → office too). With prefers-reduced-motion: no flicker, just a
//    quick fade up. Not on arriving on a floor that's already a bunker (see `set` below).
//  - Dust: motes drifting in the lamp light (one Points cloud in ctx.group).
// Not here: anything built to stay (shell.ts, furniture.ts, props.ts).

/** Where the power catches with a tick as the lights come back: the cage lamp over the north-east desk pod. */
const TICK_AT = { x: (DESKS[4].x + DESKS[5].x) / 2, y: 3.9, z: (DESKS[4].z + DESKS[6].z) / 2 };
/** Where the dust drifts: over the desk pods and in the open by the stairs, [x, z, radius]. */
const DUST_COLUMNS: [number, number, number][] = [
  [-10.5, -4, 1.4],
  [-10.5, 4, 1.4],
  [-1.5, 4, 1.4],
  [14, -3, 1.5],
];
const MOTES_PER_COLUMN = 70;
/** How much of a mote shows: barely, a faint glint in the light rather than a dot. */
const DUST_OPACITY = 0.3;
/** How dark it gets while the breaker's out: the screens still glow. */
const DARK = 0.04;
/** The transition, in seconds: dark until HOLD, flickering until DONE. */
const HOLD = 0.5;
const DONE = 1.35;
/** With reduced motion: a plain fade up, this long. */
const FADE = 0.45;

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The bunker's atmosphere, with `transition` to play the switch-over by hand (set() plays it by itself). */
export interface Atmosphere extends BunkerPart {
  /** Plays the switching transition towards `on`: the breaker, lights out, and back on in that look. */
  transition(on: boolean): void;
}

/**
 * The bunker's sound, transition and dust.
 */
export function buildAtmosphere(ctx: BunkerContext): Atmosphere {
  const { group, office, deps } = ctx;
  const { scene } = deps;
  // Partial: tests build the bunker with a stand-in for the sound.
  const sound: Partial<OfficeSound> = deps.sound;
  const disposables: { dispose(): void }[] = [];

  // ---- Dust ----------------------------------------------------------------------------------------
  const count = DUST_COLUMNS.length * MOTES_PER_COLUMN;
  /** Each mote's home [x, y, z], and its drift: [phase, speed, reach]. */
  const home = new Float32Array(count * 3);
  const drift = new Float32Array(count * 3);
  DUST_COLUMNS.forEach(([cx, cz, r], c) => {
    for (let i = 0; i < MOTES_PER_COLUMN; i++) {
      const n = c * MOTES_PER_COLUMN + i;
      const y = rand(0.4, 3.6);
      // Wider lower down, like the light spreading from above.
      const spread = r * (0.35 + 0.65 * (1 - y / 3.6)) * Math.sqrt(Math.random());
      const a = rand(0, Math.PI * 2);
      home.set([cx + Math.cos(a) * spread, y, cz + Math.sin(a) * spread], n * 3);
      drift.set([rand(0, Math.PI * 2), rand(0.08, 0.22), rand(0.08, 0.25)], n * 3);
    }
  });
  const dustGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(home);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dustMap = moteTexture();
  // Warm white, added on top of the light: no fog or tone mapping, which tint an added colour (the
  // haze's blue at night, ACES pushing it orange) and made the motes read as coloured dots.
  const dustMat = new THREE.PointsMaterial({
    color: '#fff6ea',
    map: dustMap,
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: DUST_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  // Motes right in front of your face would swell into blobs, and far ones just add noise: fade both.
  dustMat.onBeforeCompile = function (shader, renderer) {
    THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vDustFade;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDustFade = smoothstep( 0.9, 2.2, - mvPosition.z ) * ( 1.0 - smoothstep( 9.0, 14.0, - mvPosition.z ) );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDustFade;')
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vDustFade;\n#include <alphatest_fragment>');
  };
  disposables.push(dustGeo, dustMat, dustMap);
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = 'bunker-dust';
  dust.frustumCulled = false;
  group.add(dust);

  // ---- The lights, dimmed for the transition -------------------------------------------------------
  /** How bright the room is right now (1 = as the sky and the shell set it). */
  let level = 1;
  /** Lights we've dimmed: what they were, and what we wrote, to tell our own value from a new one. */
  const dimmed = new Map<THREE.Light, { base: number; wrote: number }>();
  const glows = new Map<THREE.Material & { emissiveIntensity: number }, { base: number; wrote: number }>();
  /**
   * Scales every light in the scene by `level`, just before they're uploaded for a frame (the scene's
   * onBeforeRender runs after the sky and the parts have set them, and also while the bunker's off,
   * so the transition back to the office darkens it too). Safe to run more than once a frame.
   */
  const dim = () => {
    if (level >= 1 && !dimmed.size) return;
    scene.traverseVisible((o) => {
      if (!(o instanceof THREE.Light) || o instanceof THREE.LightProbe) return;
      let d = dimmed.get(o);
      if (!d) dimmed.set(o, (d = { base: o.intensity, wrote: NaN }));
      else if (o.intensity !== d.wrote) d.base = o.intensity;
      o.intensity = d.wrote = d.base * level;
    });
    if (group.visible) {
      group.traverseVisible((o) => {
        const m = (o as THREE.Mesh).material as (THREE.Material & { emissiveIntensity?: number }) | undefined;
        if (!m || Array.isArray(m) || typeof m.emissiveIntensity !== 'number') return;
        const e = m as THREE.Material & { emissiveIntensity: number };
        let d = glows.get(e);
        if (!d) glows.set(e, (d = { base: e.emissiveIntensity, wrote: NaN }));
        else if (e.emissiveIntensity !== d.wrote) d.base = e.emissiveIntensity;
        e.emissiveIntensity = d.wrote = d.base * Math.max(level, 0.15);
      });
    }
    if (level >= 1) undim();
  };
  /** Puts back everything dim() changed that nobody's changed since. */
  const undim = () => {
    for (const [l, d] of dimmed) if (l.intensity === d.wrote) l.intensity = d.base;
    for (const [m, d] of glows) if (m.emissiveIntensity === d.wrote) m.emissiveIntensity = d.base;
    dimmed.clear();
    glows.clear();
  };
  const before = scene.onBeforeRender;
  const hook: typeof scene.onBeforeRender = function (this: THREE.Scene, ...args) {
    before.apply(this, args);
    tick();
    dim();
  };
  scene.onBeforeRender = hook;

  // ---- The transition ------------------------------------------------------------------------------
  /** The transition running: since when (performance.now), towards which look, and its flicker pattern. */
  let switching: { since: number; on: boolean; calm: boolean; blinks: [start: number, end: number][]; ticked: number } | null = null;
  let clock = 0;

  /** A few off-blinks between `from` and `to`, getting shorter as the power settles. */
  const blinksBetween = (from: number, to: number, n: number): [number, number][] => {
    const out: [number, number][] = [];
    let at = from;
    for (let i = 0; i < n && at < to; i++) {
      const off = rand(0.03, 0.12) * (1 - i / (n + 1));
      out.push([at, Math.min(to, at + off)]);
      at += off + rand(0.04, 0.16);
    }
    return out;
  };
  const inBlink = (blinks: [number, number][], s: number) => blinks.some(([a, b]) => s >= a && s < b);

  /** Moves the transition on, on the page's clock (it runs while the bunker's off too). */
  const tick = () => {
    if (!switching) return;
    const s = (performance.now() - switching.since) / 1000;
    if (switching.calm) {
      level = Math.min(1, 0.3 + 0.7 * (s / FADE));
      if (s >= FADE) switching = null;
      return;
    }
    if (s >= DONE) {
      level = 1;
      switching = null;
      return;
    }
    if (s < HOLD) level = DARK;
    else {
      const out = inBlink(switching.blinks, s);
      level = out ? rand(DARK, 0.3) : 1;
      // A tick each time the power catches.
      if (!out && switching.on && s - switching.ticked > 0.12) {
        switching.ticked = s;
        sound.tubeTick?.(TICK_AT);
      }
    }
  };

  const transition = (on: boolean) => {
    sound.breaker?.();
    const calm = reduceMotion();
    switching = { since: performance.now(), on, calm, blinks: calm ? [] : blinksBetween(HOLD, DONE - 0.15, 4), ticked: 0 };
    tick();
  };

  // ---- Arrivals --------------------------------------------------------------------------------------
  /**
   * set() is called both when someone switches this floor's look and when you arrive on a floor with
   * the other look (the welcome, the elevator, back from the roof or the casino). Only a switch gets the
   * breaker: an arrival changes the floor (office.stack) or whether the office shows at all within the
   * same message, so look again once that message is done. The first set() after loading is always an
   * arrival.
   */
  const loadedBy = performance.now() + 6000;
  let seen = false;
  const isSwitch = (on: boolean) => {
    const first = !seen && performance.now() < loadedBy;
    seen = true;
    if (first) return;
    const was = { ...office.stack.state, shown: office.group.visible };
    queueMicrotask(() => {
      const now = office.stack.state;
      if (!was.shown || !office.group.visible || now.index !== was.index || now.count !== was.count) return;
      transition(on);
    });
  };

  return {
    set(on) {
      sound.setBunker?.(on);
      isSwitch(on);
    },
    transition,
    update(dt) {
      clock += dt;
      // Every frame, since audio only starts after a click or a key: the hum then fades in.
      sound.setBunker?.(true);
      // The dust drifts and turns slowly in the light.
      const t = clock;
      for (let n = 0; n < count; n++) {
        const i = n * 3;
        const ph = drift[i];
        const sp = drift[i + 1];
        const reach = drift[i + 2];
        positions[i] = home[i] + Math.sin(t * sp + ph) * reach;
        positions[i + 1] = home[i + 1] + Math.sin(t * sp * 0.7 + ph * 2) * reach * 0.8;
        positions[i + 2] = home[i + 2] + Math.cos(t * sp * 0.9 + ph) * reach;
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.opacity = DUST_OPACITY * Math.max(0.2, level);
    },
    dispose() {
      sound.setBunker?.(false);
      switching = null;
      level = 1;
      undim();
      if (scene.onBeforeRender === hook) scene.onBeforeRender = before;
      group.remove(dust);
      for (const d of disposables) d.dispose();
    },
  };
}

/** A soft round dot for the dust: no bright core or edge, it just fades out. */
function moteTexture(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
