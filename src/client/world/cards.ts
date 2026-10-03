import * as THREE from 'three';
import { rankOf, suitOf, type Card, type Suit } from '../../shared/blackjack';
import { toon, toonUnique } from './toon';

// Playing cards in 3D, lying on a table's felt: a thin card with its face on top (+y) and the back
// underneath, so a face-down card is one turned over. Any card game can use them (blackjack, poker):
// TableCards keeps a set of cards where a game says they are, deals new ones in from the shoe with a
// little arc, turns over the ones that are revealed and gathers in the ones that are gone.

/** A card's size on the table (m): a poker-size card, a touch bigger than life so it reads from a step back. */
export const CARD_W = 0.075;
export const CARD_H = 0.105;
const THICK = 0.0012;

const TW = 256;
const TH = 358;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const RED = '#d0263a';
const BLACK = '#22232e';

const red = (s: Suit) => s === 'H' || s === 'D';

/** Draws suit `s` centred on (x, y), `size` px tall. */
function pip(g: CanvasRenderingContext2D, s: Suit, x: number, y: number, size: number) {
  const r = size / 2;
  g.save();
  g.translate(x, y);
  g.fillStyle = red(s) ? RED : BLACK;
  g.beginPath();
  if (s === 'D') {
    g.moveTo(0, -r);
    g.lineTo(r * 0.72, 0);
    g.lineTo(0, r);
    g.lineTo(-r * 0.72, 0);
    g.closePath();
    g.fill();
  } else if (s === 'H') {
    g.moveTo(0, r);
    g.bezierCurveTo(-r * 1.25, -r * 0.05, -r * 0.6, -r * 1.15, 0, -r * 0.45);
    g.bezierCurveTo(r * 0.6, -r * 1.15, r * 1.25, -r * 0.05, 0, r);
    g.fill();
  } else if (s === 'S') {
    g.moveTo(0, -r);
    g.bezierCurveTo(r * 1.3, -r * 0.05, r * 0.6, r * 0.85, 0, r * 0.3);
    g.bezierCurveTo(-r * 0.6, r * 0.85, -r * 1.3, -r * 0.05, 0, -r);
    g.fill();
    g.beginPath();
    g.moveTo(0, r * 0.2);
    g.lineTo(r * 0.32, r);
    g.lineTo(-r * 0.32, r);
    g.closePath();
    g.fill();
  } else {
    const c = r * 0.42;
    for (const [cx, cy] of [
      [0, -r * 0.48],
      [-r * 0.5, r * 0.08],
      [r * 0.5, r * 0.08],
    ]) {
      g.beginPath();
      g.arc(cx, cy, c, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.moveTo(0, -r * 0.1);
    g.lineTo(r * 0.3, r);
    g.lineTo(-r * 0.3, r);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** How a card's rank is written in its corners: "10" for a ten. */
export function rankLabel(c: Card): string {
  const r = rankOf(c);
  return r === 'T' ? '10' : r;
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = TW;
  cv.height = TH;
  return [cv, cv.getContext('2d')!];
}

function texture(cv: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A card's face: the rank and suit in two corners, and a big suit (or the face's letter) in the middle. */
function faceCanvas(c: Card): HTMLCanvasElement {
  const [cv, g] = canvas();
  const s = suitOf(c);
  const label = rankLabel(c);
  g.fillStyle = '#fbf8f0';
  roundRect(g, 2, 2, TW - 4, TH - 4, 22);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#c9c3b4';
  g.stroke();
  const corner = () => {
    g.fillStyle = red(s) ? RED : BLACK;
    g.font = `900 ${label.length > 1 ? 58 : 66}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 40, 48);
    pip(g, s, 40, 104, 46);
  };
  corner();
  g.save();
  g.translate(TW, TH);
  g.rotate(Math.PI);
  corner();
  g.restore();
  const r = rankOf(c);
  if (r === 'J' || r === 'Q' || r === 'K') {
    g.strokeStyle = red(s) ? RED : BLACK;
    g.lineWidth = 5;
    roundRect(g, 78, 70, TW - 156, TH - 140, 14);
    g.stroke();
    g.fillStyle = red(s) ? RED : BLACK;
    g.font = `900 120px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(r, TW / 2, TH / 2 - 26);
    pip(g, s, TW / 2, TH / 2 + 66, 58);
  } else pip(g, s, TW / 2, TH / 2, r === 'A' ? 150 : 112);
  return cv;
}

/** The back every card shares: a deep red with a fine lattice inside a white border. */
function backCanvas(): HTMLCanvasElement {
  const [cv, g] = canvas();
  g.fillStyle = '#fbf8f0';
  roundRect(g, 2, 2, TW - 4, TH - 4, 22);
  g.fill();
  g.fillStyle = '#9e1b2c';
  roundRect(g, 18, 18, TW - 36, TH - 36, 14);
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 3;
  for (let i = -TH; i < TW + TH; i += 22) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + TH, TH);
    g.moveTo(i, TH);
    g.lineTo(i + TH, 0);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = '#fbf8f0';
  g.lineWidth = 4;
  roundRect(g, 30, 30, TW - 60, TH - 60, 10);
  g.stroke();
  return cv;
}

let geo: THREE.BoxGeometry | null = null;
let edge: THREE.Material | null = null;
let back: THREE.Material | null = null;
const faces = new Map<Card, THREE.Material>();

function faceMaterial(c: Card): THREE.Material {
  let m = faces.get(c);
  if (!m) {
    const t = toonUnique('#ffffff');
    t.map = texture(faceCanvas(c));
    // The rounded corners are see-through on the canvas: cut them out.
    t.alphaTest = 0.5;
    faces.set(c, (m = t));
  }
  return m;
}

function backMaterial(): THREE.Material {
  if (!back) {
    const t = toonUnique('#ffffff');
    t.map = texture(backCanvas());
    t.alphaTest = 0.5;
    back = t;
  }
  return back;
}

/**
 * A card lying face up (its face on +y, the long side along z), or face down showing its back on both
 * sides while nobody knows it (`null`). Materials and the geometry are shared: dispose of nothing.
 */
export function cardMesh(c: Card | null): THREE.Mesh {
  geo ??= new THREE.BoxGeometry(CARD_W, THICK, CARD_H);
  edge ??= toon('#ece6d6');
  const top = c ? faceMaterial(c) : backMaterial();
  // Box faces go +x, -x, +y, -y, +z, -z.
  const m = new THREE.Mesh(geo, [edge, edge, top, backMaterial(), edge, edge]);
  m.castShadow = true;
  return m;
}

/** Turns `m` (from cardMesh) into card `c`'s face (or a back, for null). */
function setFace(m: THREE.Mesh, c: Card | null) {
  (m.material as THREE.Material[])[2] = c ? faceMaterial(c) : backMaterial();
}

/**
 * Where a card should be: `key` names it for as long as it's on the table (a game's "seat 2, hand 0,
 * card 1"), `card` is its face (null: face down), at (`x`, `z`) on the table's top (in the group's
 * space), turned `rot` round the vertical, and `y` up (for cards that overlap: later ones on top).
 */
export interface CardSpot {
  key: string;
  card: Card | null;
  x: number;
  z: number;
  rot?: number;
  y?: number;
}

/** How long a card takes from the shoe to its place (s), and between one card dealt and the next. */
const FLY = 0.38;
const GAP = 0.2;
/** How long turning a card over takes (s), and gathering one in. */
const FLIP = 0.32;
const GATHER = 0.4;

interface Shown {
  spot: CardSpot;
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** How far along its way it is: below 0 it's still waiting in the shoe. */
  t: number;
  flip: number;
  /** Being gathered in, to go. */
  gone: boolean;
}

/**
 * Cards on a table, where a game says they are (`show`): new ones are dealt in from `shoe` one after
 * the other, a face-down card that's now known is turned over, a card that moved slides there, and
 * cards no longer on it are gathered towards `discard` and go. `update(dt)` every frame moves them.
 * Add `group` to the table, with its top at y = 0.
 */
export class TableCards {
  readonly group = new THREE.Group();
  private shown = new Map<string, Shown>();
  /** Each card as it lands (to play a sound): its spot, and where it is in the world. */
  onLand?: (spot: CardSpot, at: THREE.Vector3) => void;
  /** Each card as it's turned over. */
  onFlip?: (spot: CardSpot, at: THREE.Vector3) => void;

  constructor(
    private readonly shoe: THREE.Vector3,
    private readonly discard: THREE.Vector3 = shoe,
  ) {}

  /** Whether any card's still on its way somewhere. */
  get busy(): boolean {
    for (const s of this.shown.values()) if (s.t < 1 || s.flip < 1 || s.gone) return true;
    return false;
  }

  /**
   * The cards on the table now. New ones are dealt in the order they come in `spots`; `instant` puts
   * everything straight where it goes (you just walked up, and it's been there all along).
   */
  show(spots: readonly CardSpot[], instant = false) {
    const keep = new Set(spots.map((s) => s.key));
    for (const [k, s] of this.shown) {
      if (keep.has(k) || s.gone) continue;
      if (instant) this.drop(k);
      else {
        s.gone = true;
        s.from.copy(s.mesh.position);
        s.to.copy(this.discard);
        s.t = 0;
      }
    }
    let wait = 0;
    for (const [i, spot] of spots.entries()) {
      const y = spot.y ?? 0.0015 + i * 0.0002;
      const to = new THREE.Vector3(spot.x, THICK / 2 + y, spot.z);
      const s = this.shown.get(spot.key);
      if (!s || s.gone) {
        if (s) this.drop(spot.key);
        const mesh = cardMesh(spot.card);
        mesh.rotation.y = spot.rot ?? 0;
        const n: Shown = { spot, mesh, from: this.shoe.clone(), to, t: instant ? 1 : -wait / FLY, flip: 1, gone: false };
        mesh.position.copy(instant ? to : this.shoe);
        mesh.visible = instant;
        this.group.add(mesh);
        this.shown.set(spot.key, n);
        if (!instant) wait += GAP;
        continue;
      }
      if (!s.spot.card && spot.card) {
        setFace(s.mesh, spot.card);
        if (!instant) {
          s.flip = 0;
          s.mesh.rotation.z = Math.PI;
        }
      } else if (s.spot.card !== spot.card) setFace(s.mesh, spot.card);
      if (!s.to.equals(to)) {
        s.from.copy(s.mesh.position);
        s.to.copy(to);
        if (s.t >= 1) s.t = instant ? 1 : 0;
      }
      s.mesh.rotation.y = spot.rot ?? 0;
      s.spot = spot;
    }
  }

  /** Moves every card on along its way. */
  update(dt: number) {
    for (const [k, s] of this.shown) {
      if (s.t < 1) {
        const was = s.t;
        s.t = Math.min(1, s.t + dt / (s.gone ? GATHER : FLY));
        if (s.t <= 0) continue;
        s.mesh.visible = true;
        const e = 1 - (1 - s.t) ** 3;
        s.mesh.position.lerpVectors(s.from, s.to, e);
        s.mesh.position.y += Math.sin(Math.PI * s.t) * (s.gone ? 0.06 : 0.12);
        if (!s.gone && was < 1 && s.t >= 1) this.onLand?.(s.spot, s.mesh.getWorldPosition(new THREE.Vector3()));
        if (s.gone && s.t >= 1) {
          this.drop(k);
          continue;
        }
      }
      if (s.flip < 1 && s.t >= 1) {
        if (s.flip === 0) this.onFlip?.(s.spot, s.mesh.getWorldPosition(new THREE.Vector3()));
        s.flip = Math.min(1, s.flip + dt / FLIP);
        // Turned over along its long side: from face down (π) to face up, lifting off the felt half way.
        s.mesh.rotation.z = Math.PI * (1 - s.flip);
        s.mesh.position.y = s.to.y + Math.sin(Math.PI * s.flip) * CARD_W * 0.6;
      }
    }
  }

  /** Every card off the table at once. */
  clear() {
    for (const k of [...this.shown.keys()]) this.drop(k);
  }

  private drop(key: string) {
    const s = this.shown.get(key);
    if (!s) return;
    this.group.remove(s.mesh);
    this.shown.delete(key);
  }
}
