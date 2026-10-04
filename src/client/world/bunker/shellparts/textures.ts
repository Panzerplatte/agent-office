import * as THREE from 'three';

// The bunker shell's canvas textures: poured concrete for the walls and the vault, the floor's
// painted slab, a hazard stripe and riveted steel. Each call makes a fresh texture, for whoever
// builds with it to dispose of again.

/** A little seeded random, so the stains land in the same places every time. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft round blotches of `color`, wrapped round the edges so the texture still tiles. */
function blotches(g: CanvasRenderingContext2D, size: number, rand: () => number, n: number, color: string, r0: number, r1: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = r0 + rand() * (r1 - r0);
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = alpha * (0.4 + rand() * 0.6);
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  g.globalAlpha = 1;
}

/** Fine speckle: the sand and the air bubbles in poured concrete. */
function speckle(g: CanvasRenderingContext2D, size: number, rand: () => number, n: number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(40,36,30,0.18)' : 'rgba(255,250,240,0.16)';
    const s = 1 + Math.floor(rand() * 3);
    g.fillRect(rand() * size, rand() * size, s, s);
  }
}

/**
 * Poured concrete, one 512 px tile per 4 m of wall: the boards of the formwork it was cast in (seams
 * across every 0.5 m, and the odd butt joint), rows of tie holes, rusty runs down from them and damp
 * patches. It repeats along the wall; up the wall it spans exactly 4 m.
 */
export function concreteTexture(seed = 7): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rand = seeded(seed);
  g.fillStyle = '#a7a59f';
  g.fillRect(0, 0, S, S);
  blotches(g, S, rand, 26, '#bcbab3', 30, 90, 0.5);
  blotches(g, S, rand, 18, '#8d8b85', 25, 80, 0.35);
  // The formwork: a board every 64 px (0.5 m), each a slightly different shade.
  for (let row = 0; row < 8; row++) {
    const y = row * 64;
    g.fillStyle = `rgba(${rand() < 0.5 ? '255,250,240' : '50,45,38'},${0.04 + rand() * 0.06})`;
    g.fillRect(0, y, S, 64);
    g.fillStyle = 'rgba(55,50,44,0.38)';
    g.fillRect(0, y, S, 2);
    g.fillStyle = 'rgba(255,250,240,0.18)';
    g.fillRect(0, y + 2, S, 1);
    // Where two boards met end to end.
    const bx = Math.floor(rand() * S);
    g.fillStyle = 'rgba(55,50,44,0.3)';
    g.fillRect(bx, y, 2, 64);
  }
  // Tie holes in a grid, with rust running down from some of them.
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 64 + col * 128;
      const y = 32 + row * 128;
      if (rand() < 0.45) {
        const run = 30 + rand() * 70;
        const grad = g.createLinearGradient(0, y, 0, y + run);
        grad.addColorStop(0, 'rgba(140,80,40,0.35)');
        grad.addColorStop(1, 'rgba(140,80,40,0)');
        g.fillStyle = grad;
        g.fillRect(x - 3, y, 6, run);
      }
      g.fillStyle = '#5e594f';
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,250,240,0.25)';
      g.beginPath();
      g.arc(x + 1, y + 1.5, 4.5, 0, Math.PI);
      g.fill();
    }
  }
  // Damp, darker toward the bottom of the tile.
  const damp = g.createLinearGradient(0, S * 0.55, 0, S);
  damp.addColorStop(0, 'rgba(60,58,50,0)');
  damp.addColorStop(1, 'rgba(60,58,50,0.22)');
  g.fillStyle = damp;
  g.fillRect(0, 0, S, S);
  blotches(g, S, rand, 6, '#5d6650', 20, 50, 0.25);
  speckle(g, S, rand, 2600);
  // A few hairline cracks.
  g.strokeStyle = 'rgba(45,40,35,0.45)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    let x = rand() * S;
    let y = rand() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rand() - 0.5) * 30;
      y += 8 + rand() * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return texture(c);
}

/**
 * The floor's slab, one tile per 6 m: troweled concrete in squares (the saw cuts every 3 m), oil
 * stains and scuffs, worn where everyone walks.
 */
export function slabTexture(seed = 11): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rand = seeded(seed);
  g.fillStyle = '#93918b';
  g.fillRect(0, 0, S, S);
  blotches(g, S, rand, 30, '#a6a49d', 30, 100, 0.5);
  blotches(g, S, rand, 20, '#7f7d77', 25, 70, 0.35);
  // Trowel swirls.
  g.strokeStyle = 'rgba(255,250,240,0.05)';
  g.lineWidth = 6;
  for (let i = 0; i < 40; i++) {
    const x = rand() * S;
    const y = rand() * S;
    g.beginPath();
    g.arc(x, y, 20 + rand() * 40, rand() * 6, rand() * 6 + 1.5);
    g.stroke();
  }
  // Oil stains.
  blotches(g, S, rand, 7, '#3c3a33', 12, 38, 0.45);
  speckle(g, S, rand, 3000);
  // The saw cuts: a grid every 256 px (3 m).
  for (const p of [0, 256]) {
    g.fillStyle = 'rgba(45,42,36,0.55)';
    g.fillRect(p, 0, 3, S);
    g.fillRect(0, p, S, 3);
    g.fillStyle = 'rgba(255,250,240,0.12)';
    g.fillRect(p + 3, 0, 1, S);
    g.fillRect(0, p + 3, S, 1);
  }
  return texture(c);
}

/** Yellow and black diagonal stripes, one tile per `w` by 1 (repeat it along a run). */
export function hazardTexture(worn = true): THREE.CanvasTexture {
  const W = 256;
  const H = 64;
  const [c, g] = canvas(W, H);
  const rand = seeded(5);
  g.fillStyle = '#f2b51d';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#26241f';
  for (let x = -H; x < W + H; x += 64) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + 32, H);
    g.lineTo(x + 32 + H, 0);
    g.lineTo(x + H, 0);
    g.closePath();
    g.fill();
  }
  if (worn) {
    // Chipped and scuffed: bare concrete showing through here and there.
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(150,145,135,${0.3 + rand() * 0.5})`;
      g.fillRect(rand() * W, rand() * H, 2 + rand() * 9, 1 + rand() * 4);
    }
    const grime = g.createLinearGradient(0, 0, 0, H);
    grime.addColorStop(0, 'rgba(40,35,30,0)');
    grime.addColorStop(1, 'rgba(40,35,30,0.35)');
    g.fillStyle = grime;
    g.fillRect(0, 0, W, H);
  }
  return texture(c);
}

/** Painted floor markings, worn: a solid line with scuffs through it (white or yellow, see `color`). */
export function lineTexture(color: string): THREE.CanvasTexture {
  const W = 256;
  const H = 16;
  const [c, g] = canvas(W, H);
  const rand = seeded(color.length * 13);
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  // Worn off where feet and trolleys go: transparent gaps and thin patches.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 60; i++) {
    g.globalAlpha = 0.3 + rand() * 0.7;
    g.fillRect(rand() * W, rand() * H, 2 + rand() * 14, 1 + rand() * 5);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return texture(c);
}

/** Steel plate: a dull grey with a riveted border and a few scratches, for doors and the elevator's surround. */
export function steelTexture(base = '#6f7782', seed = 3): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rand = seeded(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  blotches(g, S, rand, 12, 'rgba(255,255,255,0.6)', 20, 60, 0.08);
  blotches(g, S, rand, 8, '#7a4a28', 6, 20, 0.25);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    const x = rand() * S;
    const y = rand() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 10);
    g.stroke();
  }
  // A seam round the plate, with rivets along it.
  g.strokeStyle = 'rgba(25,28,32,0.6)';
  g.lineWidth = 3;
  g.strokeRect(6, 6, S - 12, S - 12);
  for (let i = 0; i < 8; i++) {
    const p = 16 + i * ((S - 32) / 7);
    for (const [x, y] of [
      [p, 16],
      [p, S - 16],
      [16, p],
      [S - 16, p],
    ]) {
      g.fillStyle = 'rgba(20,22,26,0.55)';
      g.beginPath();
      g.arc(x + 1, y + 1.5, 4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(220,225,232,0.55)';
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  return texture(c);
}

/** A stencilled sign on a plate: `text` in big letters (our own BUNKER signage, the sector numbers). */
export function stencilTexture(text: string, opts: { bg?: string; color?: string; w?: number; h?: number } = {}): THREE.CanvasTexture {
  const W = opts.w ?? 512;
  const H = opts.h ?? 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = opts.bg ?? '#2f3a2c';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, H - 6);
  g.fillStyle = opts.color ?? '#f2e6c4';
  g.font = `900 ${Math.round(H * 0.62)}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + H * 0.04);
  // Worn paint.
  const rand = seeded(text.length * 31);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) {
    g.globalAlpha = 0.2 + rand() * 0.4;
    g.fillRect(rand() * W, rand() * H, 2 + rand() * 6, 1 + rand() * 3);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return texture(c, false);
}

/** A soft round glow, white in the middle, for the pools of lamplight and the bulbs' halos. */
export function glowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return texture(c, false);
}

/** A rolled-down steel shutter: horizontal slats, a 10 cm one every 64 px, one tile per 1.2 m across. */
export function shutterTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 256;
  const [c, g] = canvas(W, H);
  const rand = seeded(29);
  g.fillStyle = '#7c848c';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 21.333) {
    const grad = g.createLinearGradient(0, y, 0, y + 21.333);
    grad.addColorStop(0, '#9aa2aa');
    grad.addColorStop(0.55, '#7a828a');
    grad.addColorStop(1, '#4e555c');
    g.fillStyle = grad;
    g.fillRect(0, y, W, 21.333);
    g.fillStyle = 'rgba(25,28,32,0.6)';
    g.fillRect(0, y + 19.5, W, 1.8);
  }
  // Rust and grime.
  blotches(g, W, rand, 10, '#7a4a28', 8, 26, 0.3);
  blotches(g, W, rand, 6, '#2f3134', 20, 50, 0.2);
  return texture(c);
}
