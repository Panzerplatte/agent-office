// Pictures people hang on the office walls. The server keeps the list; every browser draws them
// in frames, loading each image through the office (GET /api/image), so any image host works.

import { DESKS, DESK_SIZE, FLOOR, LOFT, WALL_HEIGHT, type DeskDef } from './layout.js';

export type WallId = 'north' | 'south' | 'east' | 'west';

/** What a picture shows and how it's framed, wherever it is. */
interface PlacementBase {
  /** The image, somewhere online (http or https). */
  url: string;
  title?: string;
  /** Size of the picture inside its frame, in meters. */
  w: number;
  h: number;
  /** Index into FRAMES. */
  frame: number;
  /**
   * How far it's turned, in degrees: a multiple of ROT_STEP. Missing means 0. On a wall it turns
   * within the wall, counterclockwise as you face it; on a desk it turns around itself,
   * counterclockwise seen from above, from facing the desk's chair.
   */
  rot?: number;
}

/** A poster on a wall. Saved pictures from before desk frames have no `on`: they're all on walls. */
export interface WallPlacement extends PlacementBase {
  on?: 'wall';
  wall: WallId;
  /** The picture's center along the wall: x on the north and south walls, z on the east and west ones. */
  u: number;
  /** Height of the picture's center above the floor. */
  y: number;
}

/** A small photo in a frame on a stand, on a desk top. */
export interface DeskPlacement extends PlacementBase {
  on: 'desk';
  /** Which of DESKS it stands on. */
  desk: string;
  /** The middle of its footprint in the desk's own frame (see DeskDef.rotY): along the desk, and out toward its chair. */
  dx: number;
  dz: number;
}

/** Where a picture is, what it shows and how it's framed: what a client sends. */
export type DecorPlacement = WallPlacement | DeskPlacement;

export type Decoration = DecorPlacement & {
  rot: number;
  id: string;
  /** Who hung it (or stood it on the desk). */
  by: string;
  at: number;
};

export const FRAMES = [
  { name: 'Wood', color: '#c98b5a' },
  { name: 'Black', color: '#2b2d42' },
  { name: 'White', color: '#fffaf3' },
  { name: 'Gold', color: '#e9b949' },
  { name: 'Coral', color: '#ff8a5b' },
  { name: 'Teal', color: '#2a9d8f' },
] as const;

/** How wide the frame is around the picture. */
export const FRAME_BORDER = 0.07;
/** Bounds for the picture's longest side. */
export const PICTURE_MIN = 0.3;
export const PICTURE_MAX = 3.4;
export const MAX_DECOR = 200;
/** Pictures turn in steps of this many degrees. */
export const ROT_STEP = 45;
const FLOOR_GAP = 0.4;
const CEILING_GAP = 0.05;
/** Keeps a frame clear of the frames on the wall around the corner. */
const CORNER_GAP = 0.15;

/** Each wall's inside face: the way it faces and how far it runs along u. (ZONES say where it's tall enough.) */
export const WALLS: Record<WallId, { rotY: number; min: number; max: number }> = {
  north: { rotY: 0, min: FLOOR.minX, max: FLOOR.maxX },
  south: { rotY: Math.PI, min: FLOOR.minX, max: FLOOR.maxX },
  west: { rotY: Math.PI / 2, min: FLOOR.minZ, max: FLOOR.maxZ },
  east: { rotY: -Math.PI / 2, min: FLOOR.minZ, max: FLOOR.maxZ },
};

/** A stretch of wall a picture can hang on: [u0, u1] along it, [y0, y1] up it. */
interface Zone {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

/** Underside of the loft's floor slab (see buildLoft in office.ts). */
const LOFT_UNDERSIDE = LOFT.y - 0.25;

/**
 * Where pictures can hang; each one fits inside one of its wall's zones. The loft fills the
 * south-east corner, so the south and east walls run on under its floor and again up inside it.
 */
const ZONES: Record<WallId, Zone[]> = {
  north: [{ u0: FLOOR.minX, u1: FLOOR.maxX, y0: 0, y1: WALL_HEIGHT }],
  west: [{ u0: FLOOR.minZ, u1: FLOOR.maxZ, y0: 0, y1: WALL_HEIGHT }],
  south: [
    { u0: FLOOR.minX, u1: FLOOR.maxX, y0: 0, y1: LOFT_UNDERSIDE },
    { u0: FLOOR.minX, u1: LOFT.minX, y0: 0, y1: WALL_HEIGHT },
    { u0: LOFT.minX, u1: LOFT.maxX, y0: LOFT.y, y1: LOFT.y + LOFT.height },
  ],
  east: [
    { u0: FLOOR.minZ, u1: FLOOR.maxZ, y0: 0, y1: LOFT_UNDERSIDE },
    { u0: FLOOR.minZ, u1: LOFT.minZ, y0: 0, y1: WALL_HEIGHT },
    { u0: LOFT.minZ, u1: LOFT.maxZ, y0: LOFT.y, y1: LOFT.y + LOFT.height },
  ],
};

/** How high the wall goes at u (inside the loft it goes past the ceiling downstairs). */
export function wallTop(wall: WallId, u: number): number {
  let top = 0;
  for (const z of ZONES[wall]) if (u >= z.u0 && u <= z.u1) top = Math.max(top, z.y1);
  return top;
}

/** The world point `out` meters in front of (u, y) on a wall, and the way the wall faces. */
export function wallPose(wall: WallId, u: number, y: number, out = 0): { x: number; y: number; z: number; rotY: number } {
  const rotY = WALLS[wall].rotY;
  switch (wall) {
    case 'north':
      return { x: u, y, z: FLOOR.minZ + out, rotY };
    case 'south':
      return { x: u, y, z: FLOOR.maxZ - out, rotY };
    case 'west':
      return { x: FLOOR.minX + out, y, z: u, rotY };
    case 'east':
      return { x: FLOOR.maxX - out, y, z: u, rotY };
  }
}

/** Which wall something facing `rotY` hangs on. */
export function wallFacing(rotY: number): WallId {
  const a = Math.atan2(Math.sin(rotY), Math.cos(rotY));
  if (Math.abs(a) < Math.PI / 4) return 'north';
  if (Math.abs(a) > (3 * Math.PI) / 4) return 'south';
  return a > 0 ? 'west' : 'east';
}

/** A rectangle on a wall: [u0, u1] along it, [y0, y1] up it. */
export interface WallRect {
  wall: WallId;
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

/** A turn in degrees, snapped to a ROT_STEP and put in [0, 360). Anything that isn't a number is 0. */
export function normalizeRot(rot: unknown): number {
  if (typeof rot !== 'number' || !Number.isFinite(rot)) return 0;
  const r = (Math.round(rot / ROT_STEP) * ROT_STEP) % 360;
  return r < 0 ? r + 360 : r || 0;
}

/** Half the width and height of the box around a w×h picture's frame, turned `rot` degrees. */
export function frameHalf(w: number, h: number, rot = 0): { hw: number; hh: number } {
  const r = normalizeRot(rot);
  const fw = w / 2 + FRAME_BORDER;
  const fh = h / 2 + FRAME_BORDER;
  // Square turns exactly, without cos(90°) being a hair over 0.
  if (r % 180 === 0) return { hw: fw, hh: fh };
  if (r % 90 === 0) return { hw: fh, hh: fw };
  const c = Math.abs(Math.cos((r * Math.PI) / 180));
  const s = Math.abs(Math.sin((r * Math.PI) / 180));
  return { hw: fw * c + fh * s, hh: fw * s + fh * c };
}

/** The outline of a picture's frame on its wall: the box around it, if it's turned. */
export function frameRect(d: Pick<WallPlacement, 'wall' | 'u' | 'y' | 'w' | 'h' | 'rot'>): WallRect {
  const { hw, hh } = frameHalf(d.w, d.h, d.rot);
  return { wall: d.wall, u0: d.u - hw, u1: d.u + hw, y0: d.y - hh, y1: d.y + hh };
}

export function overlaps(a: WallRect, b: WallRect, gap = 0.04): boolean {
  return a.wall === b.wall && a.u0 < b.u1 + gap && b.u0 < a.u1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Slides a w×h picture, turned `rot` degrees, the least it takes for its whole frame to be on one
 * stretch of wall, or null if it's too big for any.
 */
export function clampToWall(wall: WallId, u: number, y: number, w: number, h: number, rot = 0): { u: number; y: number } | null {
  const { hw, hh } = frameHalf(w, h, rot);
  let best: { u: number; y: number } | null = null;
  let bestD = Infinity;
  for (const z of ZONES[wall]) {
    const u0 = z.u0 + CORNER_GAP + hw;
    const u1 = z.u1 - CORNER_GAP - hw;
    const y0 = z.y0 + FLOOR_GAP + hh;
    const y1 = z.y1 - CEILING_GAP - hh;
    if (u0 > u1 + 1e-9 || y0 > y1 + 1e-9) continue;
    const at = { u: clamp(u, u0, Math.max(u0, u1)), y: clamp(y, y0, Math.max(y0, y1)) };
    const d = (at.u - u) ** 2 + (at.y - y) ** 2;
    if (d < bestD) {
      best = at;
      bestD = d;
    }
  }
  return best;
}

/**
 * A picture `size` meters on its longest side, shaped like an image of this aspect (width / height).
 * Shrunk if need be so that, turned `rot` degrees, it still fits between the floor gap and the ceiling.
 */
export function pictureSize(size: number, aspect: number, rot = 0): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? clamp(aspect, 0.2, 5) : 1;
  const s = clamp(size, PICTURE_MIN, PICTURE_MAX);
  let w = a >= 1 ? s : s * a;
  let h = a >= 1 ? s / a : s;
  // The tallest frame that still fits: turned, its box is (w + 2B)·|sin| + (h + 2B)·|cos| high.
  const r = (normalizeRot(rot) * Math.PI) / 180;
  const sin = Math.abs(Math.sin(r));
  const cos = Math.abs(Math.cos(r));
  const room = WALL_HEIGHT - FLOOR_GAP - CEILING_GAP - 2 * FRAME_BORDER * (sin + cos);
  const tall = w * sin + h * cos;
  if (tall > room) {
    w *= room / tall;
    h *= room / tall;
  }
  return { w, h };
}

/** What can be wrong with a link to hang. */
export type ImageUrlIssue = 'empty' | 'long' | 'notUrl' | 'protocol';

/** Each ImageUrlIssue in English. The page says them in your language. */
export const IMAGE_URL_ISSUES: Record<ImageUrlIssue, string> = {
  empty: 'Paste a link to an image',
  long: 'That link is too long',
  notUrl: "That isn't a web link. Paste an address that starts with https://",
  protocol: 'Only http and https links can hang on the wall',
};

/** Checks a link someone wants to hang. Returns the tidied URL, or why it won't do (in English, and as an ImageUrlIssue). */
export function checkImageUrl(raw: unknown): { url: string } | { error: string; issue: ImageUrlIssue } {
  const bad = (issue: ImageUrlIssue) => ({ error: IMAGE_URL_ISSUES[issue], issue });
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return bad('empty');
  if (s.length > 2048) return bad('long');
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return bad('notUrl');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return bad('protocol');
  return { url: u.href };
}

const WALL_IDS = new Set<string>(Object.keys(WALLS));
const DESK_IDS = new Map<string, DeskDef>(DESKS.map((d) => [d.id, d]));

/** Checks and tidies a placement from a client: moves it onto its wall or desk top, or says why it can't go there. */
export function sanitizePlacement(x: unknown): (DecorPlacement & { rot: number }) | string {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const url = checkImageUrl(o.url);
  if ('error' in url) return url.error;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const title = typeof o.title === 'string' ? o.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';
  const frame = Number.isInteger(o.frame) && (o.frame as number) >= 0 && (o.frame as number) < FRAMES.length ? (o.frame as number) : 0;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const rot = normalizeRot(o.rot);
  let w = n(o.w);
  let h = n(o.h);
  if (o.on === 'desk') {
    if (typeof o.desk !== 'string' || !DESK_IDS.has(o.desk)) return 'Pick a desk to stand it on';
    const dx = n(o.dx);
    const dz = n(o.dz);
    if ([w, h, dx, dz].some(Number.isNaN) || w <= 0 || h <= 0) return 'That picture has no size';
    ({ w, h } = deskPictureSize(Math.max(w, h), w / h));
    const at = clampToDesk(dx, dz, w, h, rot);
    if (!deskSpotFree(deskFootprint({ dx: at.dx, dz: at.dz, w, h, rot }))) return "There's something on the desk there";
    return { url: url.url, ...(title ? { title } : {}), on: 'desk', desk: o.desk, dx: round(at.dx), dz: round(at.dz), w: round(w), h: round(h), frame, rot };
  }
  if (o.on !== undefined && o.on !== 'wall') return 'Pick a wall or a desk for it';
  if (typeof o.wall !== 'string' || !WALL_IDS.has(o.wall)) return 'Pick a wall to hang it on';
  const wall = o.wall as WallId;
  const u = n(o.u);
  const y = n(o.y);
  if ([w, h, u, y].some(Number.isNaN) || w <= 0 || h <= 0) return 'That picture has no size';
  ({ w, h } = pictureSize(Math.max(w, h), w / h, rot));
  const at = clampToWall(wall, u, y, w, h, rot);
  if (!at) return "That picture is too big for the wall";
  // Wall pictures are saved the way they were before desk frames, without `on`.
  return { url: url.url, ...(title ? { title } : {}), wall, u: round(at.u), y: round(at.y), w: round(w), h: round(h), frame, rot };
}

// ---- Standing frames on desks -----------------------------------------------------------------------

/** Bounds for a desk picture's longest side: a photo frame, 10 to 30 cm. */
export const DESK_PICTURE_MIN = 0.1;
export const DESK_PICTURE_MAX = 0.3;
/** A desk frame's border is a lot slimmer than a poster's. */
export const DESK_FRAME_BORDER = 0.015;
/** How far a desk frame leans back on its stand, in radians. */
export const DESK_FRAME_LEAN = 0.12;

/** A rectangle on a desk top, in the desk's own frame: [x0, x1] along it, [z0, z1] out toward its chair. */
export interface DeskRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Where a frame's footprint can go: the desk top, a little in from its edges. */
export const DESK_TOP: DeskRect = { x0: -DESK_SIZE.width / 2 + 0.05, x1: DESK_SIZE.width / 2 - 0.05, z0: -DESK_SIZE.depth / 2 + 0.04, z1: DESK_SIZE.depth / 2 - 0.04 };

/**
 * What's already on every desk (see buildDesk in world/office.ts and the bunker's workbench): the
 * laptop, with its screen and keyboard and where the worker's hands go; the back corners, with the
 * desk's mug, plant or books and the holiday pumpkins; and the spot by the laptop where the worker
 * gets up to dance.
 */
export const DESK_KEEPOUT: readonly DeskRect[] = [
  { x0: -0.5, x1: 0.5, z0: -0.6, z1: 0.6 },
  { x0: -1.2, x1: -0.6, z0: -0.6, z1: -0.08 },
  { x0: 0.6, x1: 1.2, z0: -0.6, z1: -0.08 },
  { x0: 0.55, x1: 0.92, z0: -0.02, z1: 0.38 },
];

/** How deep a desk frame's stand reaches back, for a picture h tall. */
export function standDepth(h: number): number {
  return 0.02 + 0.35 * (h + 2 * DESK_FRAME_BORDER);
}

/** A desk picture `size` meters on its longest side, shaped like an image of this aspect (width / height). */
export function deskPictureSize(size: number, aspect: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? clamp(aspect, 0.2, 5) : 1;
  const s = clamp(Number.isFinite(size) ? size : DESK_PICTURE_MIN, DESK_PICTURE_MIN, DESK_PICTURE_MAX);
  return a >= 1 ? { w: s, h: s / a } : { w: s * a, h: s };
}

/** Half the width (along the desk) and depth of the box around a desk frame and its stand, turned `rot` degrees. */
export function deskHalf(w: number, h: number, rot = 0): { hx: number; hz: number } {
  const r = normalizeRot(rot);
  const fw = w / 2 + DESK_FRAME_BORDER;
  const fd = standDepth(h) / 2;
  if (r % 180 === 0) return { hx: fw, hz: fd };
  if (r % 90 === 0) return { hx: fd, hz: fw };
  const c = Math.abs(Math.cos((r * Math.PI) / 180));
  const s = Math.abs(Math.sin((r * Math.PI) / 180));
  return { hx: fw * c + fd * s, hz: fw * s + fd * c };
}

/** The box a desk frame takes up on its desk top. */
export function deskFootprint(d: Pick<DeskPlacement, 'dx' | 'dz' | 'w' | 'h' | 'rot'>): DeskRect {
  const { hx, hz } = deskHalf(d.w, d.h, d.rot);
  return { x0: d.dx - hx, x1: d.dx + hx, z0: d.dz - hz, z1: d.dz + hz };
}

export function deskOverlaps(a: DeskRect, b: DeskRect, gap = 0.02): boolean {
  return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.z0 < b.z1 + gap && b.z0 < a.z1 + gap;
}

/** Slides a desk frame the least it takes for all of it to be on the desk top. */
export function clampToDesk(dx: number, dz: number, w: number, h: number, rot = 0): { dx: number; dz: number } {
  const { hx, hz } = deskHalf(w, h, rot);
  return { dx: clamp(dx, DESK_TOP.x0 + hx, DESK_TOP.x1 - hx), dz: clamp(dz, DESK_TOP.z0 + hz, DESK_TOP.z1 - hz) };
}

/** Whether a footprint is clear of the desk's laptop and knick-knacks (DESK_KEEPOUT) and of `others`. */
export function deskSpotFree(fp: DeskRect, others: readonly DeskRect[] = []): boolean {
  return !DESK_KEEPOUT.some((k) => deskOverlaps(fp, k, 0)) && !others.some((o) => deskOverlaps(fp, o));
}

/** The footprints of the frames standing on `desk`, except the one with id `except`. */
export function deskFrames(items: readonly Decoration[], desk: string, except?: string): DeskRect[] {
  const out: DeskRect[] = [];
  for (const d of items) if (d.on === 'desk' && d.desk === desk && d.id !== except) out.push(deskFootprint(d));
  return out;
}

/** The world point (dx, dz) on a desk top, and the way something there turned `rot` degrees faces. */
export function deskPose(desk: DeskDef, dx: number, dz: number, rot = 0): { x: number; y: number; z: number; rotY: number } {
  const c = Math.cos(desk.rotY);
  const s = Math.sin(desk.rotY);
  return { x: desk.x + dx * c + dz * s, y: DESK_SIZE.height, z: desk.z - dx * s + dz * c, rotY: desk.rotY + (normalizeRot(rot) * Math.PI) / 180 };
}

/** The point (x, z) in a desk's own frame (the other way round from deskPose). */
export function toDesk(desk: DeskDef, x: number, z: number): { dx: number; dz: number } {
  const c = Math.cos(desk.rotY);
  const s = Math.sin(desk.rotY);
  const ox = x - desk.x;
  const oz = z - desk.z;
  return { dx: ox * c - oz * s, dz: ox * s + oz * c };
}

export function deskById(id: string): DeskDef | undefined {
  return DESK_IDS.get(id);
}
