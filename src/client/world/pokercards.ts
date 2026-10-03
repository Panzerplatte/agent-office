import * as THREE from 'three';
import type { Card, PokerState } from '../../shared/poker';
import type { PokerTableView } from './casino';
import { mesh, toon } from './toon';

// What's on the poker table's felt (see world/casino.ts), for everyone in the casino: the board's
// cards, each player's two (face down, unless they're yours or shown at the showdown), their chips in
// front of them, their bet, the pot in the middle and the dealer button. Cards fly in from the deck
// as they're dealt, and everything goes back in when the next hand starts.

/** A card on the felt: it fills the boxes printed for the board. */
export const CARD_W = 0.085;
export const CARD_H = 0.12;
const CARD_T = 0.0016;
/** A chip: its radius and how thick it is (m). */
const CHIP_R = 0.019;
const CHIP_T = 0.0055;
/** At most this many chips in one stack: more don't show. */
const STACK_MAX = 16;

/** Chips by what they're worth, biggest first, in the casino's colours. */
export const DENOMS: readonly { value: number; color: string; edge: string }[] = [
  { value: 500, color: '#7c3aed', edge: '#f5d0fe' },
  { value: 100, color: '#111111', edge: '#f8f8f2' },
  { value: 25, color: '#16a34a', edge: '#f8f8f2' },
  { value: 10, color: '#1d4ed8', edge: '#f8f8f2' },
  { value: 5, color: '#d62839', edge: '#f8f8f2' },
  { value: 1, color: '#f4f1ea', edge: '#1d4ed8' },
];

/** How `amount` breaks down into chips, biggest first: [denomination index, how many]. */
export function chipsFor(amount: number): [number, number][] {
  const out: [number, number][] = [];
  let left = Math.max(0, Math.floor(amount));
  DENOMS.forEach((d, i) => {
    const n = Math.floor(left / d.value);
    if (n > 0) out.push([i, n]);
    left -= n * d.value;
  });
  return out;
}

const RED_SUITS = new Set(['h', 'd']);
const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
/** How a card's rank is written on it ('T' is a 10). */
export const rankLabel = (c: Card) => (c[0] === 'T' ? '10' : c[0]);
export const suitGlyph = (c: Card) => SUIT_GLYPH[c[1]];
export const isRed = (c: Card) => RED_SUITS.has(c[1]);

const faces = new Map<string, THREE.Material>();

/** A card's face (or its back, for null), drawn once and kept. */
function faceMaterial(card: Card | null): THREE.Material {
  const k = card ?? 'back';
  let m = faces.get(k);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 180;
  const g = c.getContext('2d')!;
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };
  if (!card) {
    g.fillStyle = '#f8f8f2';
    g.fillRect(0, 0, 128, 180);
    g.fillStyle = '#b91c1c';
    round(8, 8, 112, 164, 10);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 3;
    for (let i = -180; i < 180; i += 16) {
      g.beginPath();
      g.moveTo(8 + i, 8);
      g.lineTo(8 + i + 164, 172);
      g.moveTo(120 - i, 8);
      g.lineTo(120 - i - 164, 172);
      g.stroke();
    }
    g.strokeStyle = '#f8f8f2';
    g.lineWidth = 4;
    round(14, 14, 100, 152, 8);
    g.stroke();
  } else {
    g.fillStyle = '#fbfaf5';
    g.fillRect(0, 0, 128, 180);
    g.fillStyle = isRed(card) ? '#d1192e' : '#16131c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 46px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(rankLabel(card), 32, 34);
    g.font = '40px system-ui, sans-serif';
    g.fillText(suitGlyph(card), 32, 76);
    g.font = '84px system-ui, sans-serif';
    g.fillText(suitGlyph(card), 76, 122);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  m = new THREE.MeshBasicMaterial({ map: tex });
  faces.set(k, m);
  return m;
}

const cardGeo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
const edgeMat = new THREE.MeshBasicMaterial({ color: '#e9e5d8' });

/** A card lying on the felt, face up (`card`) or face down (null): its top is the face, or the back. */
export function cardMesh(card: Card | null): THREE.Mesh {
  // A box's faces: +x, -x, +y (top), -y, +z, -z.
  const top = faceMaterial(card);
  return new THREE.Mesh(cardGeo, [edgeMat, edgeMat, top, faceMaterial(null), edgeMat, edgeMat]);
}

const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_T, 18);
const chipMats = DENOMS.map((d) => toon(d.color));
const chipEdgeGeo = new THREE.CylinderGeometry(CHIP_R * 1.002, CHIP_R * 1.002, CHIP_T * 0.4, 18, 1, true);
const chipEdgeMats = DENOMS.map((d) => toon(d.edge));

/** `amount` in chips, in a little row of stacks (one for each kind of chip), centred on its origin. */
export function chipStacks(amount: number): THREE.Group {
  const g = new THREE.Group();
  const kinds = chipsFor(amount);
  kinds.forEach(([i, n], k) => {
    const x = (k - (kinds.length - 1) / 2) * CHIP_R * 2.1;
    for (let j = 0; j < Math.min(n, STACK_MAX); j++) {
      const y = CHIP_T / 2 + j * CHIP_T;
      g.add(mesh(chipGeo, chipMats[i], x, y, 0, false));
      g.add(mesh(chipEdgeGeo, chipEdgeMats[i], x, y, 0, false));
    }
  });
  return g;
}

/** Something on the felt that slides from where it was to where it's going. */
interface Moving {
  obj: THREE.Object3D;
  to: THREE.Vector3;
}

/**
 * What's on the poker table's felt. `render` puts it all where the latest state says; `update`
 * slides the cards and chips there. Everything is in the felt's own frame (x along the table, y
 * across it toward the players), a child of the table's top.
 */
export class PokerFelt {
  readonly group = new THREE.Group();
  private moving: Moving[] = [];
  private cards = new Map<string, THREE.Mesh>();
  private stacks = new Map<string, { amount: number; group: THREE.Group }>();
  private hand = -1;
  private deckAt: THREE.Vector3;

  constructor(private readonly table: PokerTableView) {
    table.button.parent!.add(this.group);
    this.deckAt = table.deck.position.clone().setY(0.02);
    table.button.visible = false;
  }

  /** The table as the office says it is now (`you` your seat, whose cards you see). */
  render(s: PokerState, still = false) {
    const fresh = s.hand !== this.hand;
    if (fresh) {
      // A new hand: everything back in (it'll come out again from the deck).
      for (const m of this.cards.values()) this.group.remove(m);
      this.cards.clear();
      this.hand = s.hand;
    }
    const want = new Set<string>();
    // The board's cards, in their boxes in the middle.
    s.board.forEach((c, i) => {
      const at = this.table.board[i];
      this.card(`b${i}`, c, at.x, at.y, 0, want, still);
    });
    // Each player's two: face down unless you can see them (yours, or shown). Folded ones go.
    s.seats.forEach((seat, i) => {
      if (!seat?.inHand || seat.folded || s.street === null) return;
      const spot = this.table.spots[i].cards;
      const across = this.across(i);
      for (let k = 0; k < 2; k++) {
        const off = (k - 0.5) * CARD_W * 0.75;
        this.card(`s${i}.${k}`, seat.cards?.[k] ?? null, spot.x + across.x * off, spot.y + across.y * off, k * CARD_T * 1.1, want, still, this.angle(i) + (k - 0.5) * 0.12);
      }
    });
    for (const [k, m] of this.cards) if (!want.has(k)) {
      this.group.remove(m);
      this.cards.delete(k);
    }

    // The chips: each player's in front of them, their bet nearer the middle, and the pot.
    const chips = new Set<string>();
    s.seats.forEach((seat, i) => {
      if (!seat) return;
      const spot = this.table.spots[i];
      const across = this.across(i);
      const off = CARD_W * 2;
      this.stack(`st${i}`, seat.stack, spot.cards.x + across.x * off, spot.cards.y + across.y * off, chips);
      if (seat.bet > 0) this.stack(`bet${i}`, seat.bet, spot.bet.x, spot.bet.y, chips);
    });
    const inBets = s.seats.reduce((n, x) => n + (x?.bet ?? 0), 0);
    if (s.street && s.street !== 'showdown' && s.pot - inBets > 0) this.stack('pot', s.pot - inBets, this.table.pot.x, this.table.pot.y, chips);
    for (const [k, v] of this.stacks) if (!chips.has(k)) {
      this.group.remove(v.group);
      this.stacks.delete(k);
    }

    // The dealer button, just inside the felt from the button's seat.
    const b = this.table.button;
    b.visible = s.button >= 0 && !!s.seats[s.button];
    if (b.visible) {
      const spot = this.table.spots[s.button];
      const across = this.across(s.button);
      b.position.set(spot.bet.x - across.x * 0.09, 0, spot.bet.y - across.y * 0.09);
    }
  }

  /** Slides everything on toward where it's going. */
  update(dt: number) {
    const k = 1 - Math.exp(-dt * 10);
    this.moving = this.moving.filter((m) => {
      m.obj.position.lerp(m.to, k);
      if (m.obj.position.distanceToSquared(m.to) > 1e-7) return true;
      m.obj.position.copy(m.to);
      return false;
    });
  }

  /** Along the table's edge at seat `i`: a unit vector across in front of them, for laying things side by side. */
  private across(i: number): { x: number; y: number } {
    const s = this.table.spots[i].cards;
    const l = Math.hypot(s.x, s.y) || 1;
    return { x: -s.y / l, y: s.x / l };
  }

  /** The turn that lays a card square to seat `i`, its foot toward them. */
  private angle(i: number): number {
    const s = this.table.spots[i].cards;
    return Math.atan2(s.x, s.y);
  }

  /** A card at (x, y) on the felt: dealt out of the deck if it's new, turned over if it's been shown since. */
  private card(key: string, card: Card | null, x: number, y: number, h: number, want: Set<string>, still: boolean, rot = 0) {
    want.add(key);
    let m = this.cards.get(key);
    if (m && m.userData.card !== card) {
      const at = m.position.clone();
      this.group.remove(m);
      m = undefined;
      this.cards.delete(key);
      const n = cardMesh(card);
      n.position.copy(at);
      m = n;
      m.userData.card = card;
      this.cards.set(key, m);
      this.group.add(m);
    }
    if (!m) {
      m = cardMesh(card);
      m.userData.card = card;
      m.position.copy(still ? new THREE.Vector3(x, CARD_T / 2 + h, y) : this.deckAt);
      this.cards.set(key, m);
      this.group.add(m);
    }
    m.rotation.y = rot;
    this.slide(m, new THREE.Vector3(x, CARD_T / 2 + h, y), still);
  }

  /** `amount` chips at (x, y) on the felt, rebuilt when the amount changes. */
  private stack(key: string, amount: number, x: number, y: number, keep: Set<string>) {
    if (amount <= 0) return;
    keep.add(key);
    let s = this.stacks.get(key);
    if (s && s.amount !== amount) {
      this.group.remove(s.group);
      s = undefined;
    }
    if (!s) {
      s = { amount, group: chipStacks(amount) };
      this.stacks.set(key, s);
      this.group.add(s.group);
    }
    s.group.position.set(x, 0.001, y);
  }

  private slide(obj: THREE.Object3D, to: THREE.Vector3, still: boolean) {
    this.moving = this.moving.filter((m) => m.obj !== obj);
    if (still) obj.position.copy(to);
    else this.moving.push({ obj, to });
  }
}
