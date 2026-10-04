import * as THREE from 'three';
import type { TvBrowserState } from '../shared/protocol';
import { t } from './i18n';

/**
 * The office's own browser on the lounge TV (see src/server/tvbrowser.ts): the server opens a
 * worker's site in a headless Chromium and streams it to the floor as JPEG frames. This draws
 * them on one canvas the TV wears as its texture, updated in place, with a caption bar, and
 * keeps the newest picture for the full-screen viewer (ui/tvbrowser.ts).
 */

/** The TV's canvas: its own 16:9, like the screen in the lounge. */
export const TV_W = 1280;
export const TV_H = 720;
/** The caption bar along the bottom of the TV. */
const BAR = 46;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A page of `pw`×`ph` as big as it fits in a `bw`×`bh` box, centered (a phone-sized page gets bars at the sides). */
export function fitRect(bw: number, bh: number, pw: number, ph: number): Rect {
  if (pw <= 0 || ph <= 0) return { x: 0, y: 0, w: bw, h: bh };
  const s = Math.min(bw / pw, bh / ph);
  const w = pw * s;
  const h = ph * s;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

/**
 * Where a point in the viewer (`px`, `py`, from the box's top left) is on the page, 0..1 across and
 * down; null in the bars beside it. `clamp` pins it to the page's edge instead (for a drag that goes out).
 */
export function pagePoint(px: number, py: number, page: Rect, clamp = false): { x: number; y: number } | null {
  let x = (px - page.x) / page.w;
  let y = (py - page.y) / page.h;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  x = Math.min(1, Math.max(0, x));
  y = Math.min(1, Math.max(0, y));
  return { x, y };
}

/** Modifier keys as Chrome's DevTools protocol counts them: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function modsOf(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

/** A wheel turn in pixels, whatever the browser counted it in (lines, pages). */
export function wheelPixels(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>, pageHeight = 720): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? pageHeight : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/** base64 → the bytes of the JPEG. */
export function base64Bytes(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type Picture = ImageBitmap | HTMLCanvasElement | HTMLImageElement;
export type Decoder = (data: string) => Promise<Picture>;

const decodeJpeg: Decoder = (data) => createImageBitmap(new Blob([base64Bytes(data)], { type: 'image/jpeg' }));

export class TvBrowser {
  readonly texture: THREE.CanvasTexture;
  /** What's on: null while the TV browser is off. */
  state: TvBrowserState | null = null;
  /** The newest frame, decoded; null until the first one for what's on arrives. */
  picture: Picture | null = null;
  /** Called with every new picture (the full-screen viewer draws it big). */
  onPicture: (() => void) | null = null;
  private decoding = false;
  /** A frame that came in while the one before was still decoding: only the newest one waits. */
  private next: string | null = null;
  /** Bumped when what's on changes, so a frame decoded for the site before isn't shown. */
  private epoch = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement = Object.assign(document.createElement('canvas'), { width: TV_W, height: TV_H }),
    private readonly decode: Decoder = decodeJpeg,
  ) {
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** On, off, or something about it changed (title, address, loading, an error). */
  setState(state: TvBrowserState | null) {
    const was = this.state;
    this.state = state;
    if (!state || state.port !== was?.port) {
      this.epoch++;
      this.next = null;
      this.drop();
    }
    this.draw();
  }

  /** A frame of the screencast (base64 JPEG). Frames that pile up while one decodes are skipped to the newest. */
  frame(data: string) {
    if (!this.state) return;
    if (this.decoding) {
      this.next = data;
      return;
    }
    void this.decodeNow(data);
  }

  private async decodeNow(data: string) {
    this.decoding = true;
    const epoch = this.epoch;
    try {
      const pic = await this.decode(data);
      if (epoch !== this.epoch || !this.state) {
        if ('close' in pic) pic.close();
      } else {
        this.drop();
        this.picture = pic;
        this.draw();
        this.onPicture?.();
      }
    } catch {
      // a broken frame: the next one will do
    } finally {
      this.decoding = false;
    }
    const next = this.next;
    this.next = null;
    if (next !== null) void this.decodeNow(next);
  }

  private drop() {
    const pic = this.picture;
    this.picture = null;
    if (pic && 'close' in pic) pic.close();
  }

  /** Paints the TV: the page fitted in, the caption bar, or what it's waiting for. */
  draw() {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const s = this.state;
    g.fillStyle = '#0b1320';
    g.fillRect(0, 0, TV_W, TV_H);
    if (s) {
      const pic = this.picture;
      if (pic) {
        const r = fitRect(TV_W, TV_H - BAR, pic.width, pic.height);
        g.drawImage(pic, r.x, r.y, r.w, r.h);
      } else {
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '800 54px Nunito, ui-rounded, system-ui, sans-serif';
        g.fillText(s.error ? `⚠️ ${tvError(s.error)}` : t('main.tvLoading'), TV_W / 2, TV_H / 2 - 30, TV_W - 120);
        g.font = '700 30px Nunito, ui-rounded, system-ui, sans-serif';
        g.fillStyle = '#9fb3c8';
        g.fillText(s.url, TV_W / 2, TV_H / 2 + 40, TV_W - 120);
      }
      // A picture with an error on top (it broke after loading): say so over it.
      if (pic && s.error) {
        g.fillStyle = 'rgba(160,20,40,0.85)';
        g.fillRect(0, 0, TV_W, 56);
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '800 28px Nunito, ui-rounded, system-ui, sans-serif';
        g.fillText(`⚠️ ${tvError(s.error)}`, TV_W / 2, 28, TV_W - 40);
      }
      g.fillStyle = 'rgba(8,12,24,0.92)';
      g.fillRect(0, TV_H - BAR, TV_W, BAR);
      g.fillStyle = '#fff';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = '800 26px Nunito, ui-rounded, system-ui, sans-serif';
      g.fillText(tvCaption(s), 18, TV_H - BAR / 2, TV_W - 36);
    }
    this.texture.needsUpdate = true;
  }
}

/** "📺 My site · 5173", with a ⏳ while it loads. */
export function tvCaption(s: TvBrowserState): string {
  return `📺 ${s.title || s.url} · ${s.port}${s.loading ? ' ⏳' : ''}`;
}

/** The server's error, in words: the ones it names by a code get a translation (see main.tvError*). */
export function tvError(error: string): string {
  return error;
}
