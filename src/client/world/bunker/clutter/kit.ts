import * as THREE from 'three';

// The bunker props' own materials and textures: none of them come from toon()'s shared cache, so
// taking the props down again can dispose every one without touching anything the office uses.

let gradient: THREE.DataTexture | null = null;

/** The same three-step ramp toon() uses, so the props band like everything else. Shared, never disposed. */
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  gradient = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export class Kit {
  private mats = new Map<string, THREE.Material>();
  private extra: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  /** A toon material of this color, one per color (and glow) for the whole bunker. */
  toon(color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation): THREE.MeshToonMaterial {
    const key = `${new THREE.Color(color).getHexString()}|${emissive ?? ''}`;
    let m = this.mats.get(key) as THREE.MeshToonMaterial | undefined;
    if (!m) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
      if (emissive !== undefined) m.emissive = new THREE.Color(emissive);
      this.mats.set(key, m);
    }
    return m;
  }

  /** A material of its own (textured, animated, glowing), disposed with the rest. */
  own<M extends THREE.Material>(m: M): M {
    this.extra.push(m);
    return m;
  }

  /** A canvas `w` × `h` pixels drawn by `draw`, as a texture disposed with the rest. */
  canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.textures.push(t);
    return t;
  }

  dispose() {
    for (const m of [...this.mats.values(), ...this.extra]) m.dispose();
    for (const t of this.textures) t.dispose();
    this.mats.clear();
    this.extra = [];
    this.textures = [];
  }
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** A little seeded random, so the bags and crates come out the same on every page. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stencil lettering, for crates and signs. Headless pages have no Impact, so it falls back to a heavy sans. */
export const STENCIL = 'Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif';
