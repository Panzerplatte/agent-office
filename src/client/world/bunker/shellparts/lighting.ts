import * as THREE from 'three';

// Underground, the bunker's light is the same at noon and at midnight: its own lamps, and no sun.
//
// The sky (world/sky.ts) sets the scene's sun, hemisphere and ambient lights every frame for the time
// of day, and at night also adds the office's lamplight to everything indoors, in the shaders (more
// the darker it is out, and more on what faces up than on what faces down). Right after it, each
// frame, this puts out the sun and sets the soft lights to the bunker's own low light, less however
// much of that lamplight the sky is adding (the hemisphere light takes it off the same way it goes
// on, by which way things face), so the room comes out the same day or night and the bunker's lamps
// do the rest. When the bunker's off, the sky's next frame has everything back as it was.

/** The bunker's own soft light: low, so the lamps make the pools of light and the corners stay dark. */
const HEMI = { intensity: 0.75, sky: new THREE.Color('#fff0dc'), ground: new THREE.Color('#5d5a55') };
const AMBIENT = { intensity: 0.42, color: new THREE.Color('#f4efe8') };
/** No sky to fade into down here: a faint dusty haze over the far end of the room, the same at any hour. */
const HAZE = { color: new THREE.Color('#2a2622'), near: 26, far: 110 };

/** The sky's numbers (sky.ts): how strong a clear day is, and the lamplight it adds indoors in the dark. */
const FULL_DAY = 1.5 + 0.5 + 0.6 * 2.2;
const OFFICE_LAMPS = 3.2;
const OFFICE = new THREE.Color('#fff2de');
const OFFICE_NIGHT = new THREE.Color('#ffd49c');

const lamplight = new THREE.Color();

/** Sets the color of a light `intensity` strong to `base` less `k` of the lamplight: it may go below zero, which Color.sub won't. */
function less(c: THREE.Color, base: THREE.Color, k: number, intensity: number) {
  const f = k / intensity;
  c.setRGB(base.r - f * lamplight.r, base.g - f * lamplight.g, base.b - f * lamplight.b);
}

/**
 * Lights the scene the bunker's way for this frame. Call it right after the sky's update. Gives back
 * the lamplight it took off: what's outdoors (the walled-in balcony) never had it to begin with, and
 * needs it put back.
 */
export function lightBunker(lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight }, scene: THREE.Scene): THREE.Color {
  const { sun, hemi, ambient } = lights;
  // How dark it is out, from what the sky just set, and so how much lamplight it's adding indoors:
  // (0.65 + 0.35 × up) of it, `up` being how much a surface faces up (sky.ts's LIGHT).
  const level = Math.min(1, Math.max(0, (hemi.intensity + ambient.intensity + 0.6 * sun.intensity) / FULL_DAY));
  const need = 1 - level;
  lamplight.copy(OFFICE).lerp(OFFICE_NIGHT, need).multiplyScalar(need * OFFICE_LAMPS);
  sun.intensity = 0;
  // A hemisphere light gives its sky color to what faces up and its ground color to what faces down:
  // taking off all of the lamplight above and 0.3 of it below takes off just what the sky adds.
  hemi.intensity = HEMI.intensity;
  less(hemi.color, HEMI.sky, 1, HEMI.intensity);
  less(hemi.groundColor, HEMI.ground, 0.3, HEMI.intensity);
  ambient.intensity = AMBIENT.intensity;
  ambient.color.copy(AMBIENT.color);
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.copy(HAZE.color);
    scene.fog.near = HAZE.near;
    scene.fog.far = HAZE.far;
  }
  if (scene.background instanceof THREE.Color) scene.background.copy(HAZE.color);
  return lamplight;
}

/** The office's lamps' glow at night (OfficeLook.glows), as the sky draws it. */
interface Glows {
  halos: { at: THREE.Vector3; size: number }[];
  lamps: { power: number }[];
}

/**
 * Puts out the glow the sky gives the office's own lamps at night while the bunker's on, and back as
 * it was when it's off: their halos (the sky's points round the bulbs, made black, which adds nothing)
 * and the light they cast (the sky reads each lamp's power every frame). Their fittings are hidden,
 * and the bunker's own lamps light the room the same at any hour.
 */
export function officeGlows(glows: Glows, scene: THREE.Scene): (on: boolean) => void {
  const was: { color: THREE.BufferAttribute; i: number; rgb: [number, number, number] }[] = [];
  const power = new Map<{ power: number }, number>();
  return (on) => {
    if (!on) {
      for (const { color, i, rgb } of was) {
        color.setXYZ(i, ...rgb);
        color.needsUpdate = true;
      }
      was.length = 0;
      for (const [l, p] of power) l.power = p;
      power.clear();
      return;
    }
    if (was.length || power.size) return;
    // The sky adds its halos to the scene itself, one set of points per size, at the bulbs' places.
    for (const o of scene.children) {
      const points = o as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
      const color = points.isPoints ? (points.geometry.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
      if (!color) continue;
      const pos = points.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const ours = glows.halos.some((h) => h.size === points.material.size && Math.abs(h.at.x - pos.getX(i)) < 1e-3 && Math.abs(h.at.y - pos.getY(i)) < 1e-3 && Math.abs(h.at.z - pos.getZ(i)) < 1e-3);
        if (!ours) continue;
        was.push({ color, i, rgb: [color.getX(i), color.getY(i), color.getZ(i)] });
        color.setXYZ(i, 0, 0, 0);
        color.needsUpdate = true;
      }
    }
    for (const l of glows.lamps) {
      power.set(l, l.power);
      l.power = 0;
    }
  };
}
