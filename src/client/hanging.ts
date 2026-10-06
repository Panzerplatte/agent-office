import * as THREE from 'three';
import { DESK_PICTURE_MAX, DESK_PICTURE_MIN, PICTURE_MAX, PICTURE_MIN, ROT_STEP, clampToDesk, clampToWall, deskFootprint, deskPictureSize, deskSpotFree, frameRect, normalizeRot, overlaps, pictureSize } from '../shared/decor';
import type { Net } from './net';
import type { PlayerController } from './player';
import { store } from './state';
import { openHangDialog, openPicture, type HangChoice } from './ui/decor';
import { toast } from './ui/dom';
import { Ghost, aimAtDesk, aimAtWall, brokenTexture, holdPicture, loadPicture, type Gallery, type GhostSpot } from './world/gallery';
import type { Office } from './world/office';
import { t } from './i18n';

interface Hanging {
  url: string;
  title: string;
  frame: number;
  texture: THREE.Texture;
  /** The image's width / height, for cropping it into the frame. */
  aspect: number;
  /** The frame's width / height. */
  shape: number;
  /** Longest side of the picture on a wall, in meters. */
  size: number;
  /** Longest side of the picture standing on a desk: desk frames have their own, smaller, sizes. */
  deskSize: number;
  /** Where you aimed last, so the wheel sizes that one when you're aiming at neither. */
  on: 'wall' | 'desk';
  /** How far it's turned within the wall, in degrees (see DecorPlacement.rot). */
  rot: number;
  /** Set when moving a picture that's already up. */
  moving?: string;
  release(): void;
}

/** Where the picture would go: on a wall or a desk top. `ok` is false when something else is there. */
export type Spot = GhostSpot;

const SIZE_KEY = 'agent-office.picture-size';
const DESK_SIZE_KEY = 'agent-office.desk-picture-size';
function lastSize(key: string, min: number, max: number, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return n >= min && n <= max ? n : fallback;
  } catch {
    return fallback;
  }
}
const lastWallSize = () => lastSize(SIZE_KEY, PICTURE_MIN, PICTURE_MAX, 1.2);
const lastDeskSize = () => lastSize(DESK_SIZE_KEY, DESK_PICTURE_MIN, DESK_PICTURE_MAX, 0.2);

/**
 * Hanging pictures: pick an image, then aim at a wall (the crosshair in first person, the mouse in
 * third) and click. Aim at a desk top instead and it stands there in a small frame. Also looking at
 * one closer, moving, editing and taking it down.
 */
export class Hanger {
  readonly ghost = new Ghost();
  /** Called when hanging starts or stops. */
  onChange: () => void = () => {};
  private cur: Hanging | null = null;
  private at: Spot | null = null;
  private mouse = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  /** A moved picture stays hidden until the office confirms where it went. */
  private revealTimer = 0;

  constructor(
    private net: Net,
    private camera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
    private player: PlayerController,
    private office: Office,
    private gallery: Gallery,
  ) {
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    // The wheel sizes the picture instead of zooming the camera. On window, in the capture phase,
    // so it runs before the player's own wheel handler on the canvas.
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.cur || e.target !== canvas) return;
        e.preventDefault();
        e.stopPropagation();
        this.resize(e.deltaY < 0 ? 1 : -1);
      },
      { capture: true, passive: false },
    );
    // Esc frees the mouse before the page ever sees the key; treat that as cancel too.
    document.addEventListener('pointerlockchange', () => {
      if (this.cur && this.player.view === 'first' && !this.player.locked) this.cancel();
    });
    store.on('decor', () => {
      const moving = this.cur?.moving;
      if (moving && !store.decor.some((d) => d.id === moving)) {
        toast(t('notices.pictureGone'), 'warn');
        this.cancel();
      }
      if (this.revealTimer) this.reveal();
    });
  }

  get active(): boolean {
    return !!this.cur;
  }

  get moving(): boolean {
    return !!this.cur?.moving;
  }

  /** Where the picture would go right now, if you're aiming at a wall or a desk. */
  get spot(): Spot | null {
    return this.at;
  }

  /** Pick an image, then a spot on a wall or a desk. */
  start() {
    openHangDialog({ onDone: (c) => this.begin(c) });
  }

  /** A closer look at a picture. */
  view(id: string) {
    const d = store.decor.find((x) => x.id === id);
    if (!d) return;
    openPicture(d, {
      move: () => this.move(id),
      edit: () => this.edit(id),
      remove: () => this.net.send({ t: 'decor.remove', id }),
    });
  }

  move(id: string) {
    const d = store.decor.find((x) => x.id === id);
    if (!d) return;
    const release = holdPicture(d.url);
    const go = (texture: THREE.Texture, aspect: number) => {
      if (!store.decor.some((x) => x.id === id)) return release();
      this.stop();
      const desk = d.on === 'desk';
      const size = Math.max(d.w, d.h);
      this.cur = { url: d.url, title: d.title ?? '', frame: d.frame, texture, aspect, shape: d.w / d.h, size: desk ? lastWallSize() : size, deskSize: desk ? size : lastDeskSize(), on: desk ? 'desk' : 'wall', rot: d.rot ?? 0, moving: id, release };
      this.gallery.hide(id);
      this.onChange();
    };
    loadPicture(d.url).then(
      (pic) => go(pic.texture, pic.aspect),
      // Still movable when its image won't load.
      () => go(brokenTexture(), 4 / 3),
    );
  }

  edit(id: string) {
    const d = store.decor.find((x) => x.id === id);
    if (!d) return;
    openHangDialog({
      initial: d,
      onDone: (c) => {
        // A new image keeps the picture's size along its longest side, in the new image's shape.
        const { w, h } = c.picture.url === d.url ? d : d.on === 'desk' ? deskPictureSize(Math.max(d.w, d.h), c.picture.aspect) : pictureSize(Math.max(d.w, d.h), c.picture.aspect, c.rot);
        this.net.send({ t: 'decor.update', id, decor: { url: c.picture.url, title: c.title, frame: c.frame, w, h, rot: c.rot } });
      },
    });
  }

  /** Bigger (+1) or smaller (-1): on a desk, the desk frame; otherwise the poster. */
  resize(dir: number) {
    const cur = this.cur;
    if (!cur) return;
    const k = dir > 0 ? 1.1 : 1 / 1.1;
    if ((this.at?.on ?? cur.on) === 'desk') {
      const { w, h } = deskPictureSize(cur.deskSize * k, cur.shape);
      cur.deskSize = Math.max(w, h);
      return;
    }
    // A tall picture tops out below PICTURE_MAX; start shrinking from where it stopped growing.
    const { w, h } = pictureSize(cur.size * k, cur.shape, cur.rot);
    cur.size = Math.max(w, h);
  }

  /** Turns the picture one step: counterclockwise (+1) or clockwise (-1). */
  rotate(dir: number) {
    if (!this.cur) return;
    this.cur.rot = normalizeRot(this.cur.rot + (dir > 0 ? ROT_STEP : -ROT_STEP));
  }

  /** Hangs the picture where you aim. `ndc` is where you clicked, in third person. */
  place(ndc?: THREE.Vector2) {
    const cur = this.cur;
    if (!cur) return;
    if (ndc && this.player.view === 'third') this.mouse.copy(ndc);
    this.update();
    const at = this.at;
    if (!at) return toast(t('notices.hangAim'));
    if (!at.ok) return toast(t(at.on === 'desk' ? 'notices.hangTakenDesk' : 'notices.hangTaken'), 'warn');
    const spot = at.on === 'desk' ? { on: 'desk' as const, desk: at.desk, dx: at.dx, dz: at.dz, w: at.w, h: at.h, rot: at.rot } : { on: 'wall' as const, wall: at.wall, u: at.u, y: at.y, w: at.w, h: at.h, rot: at.rot };
    if (cur.moving) {
      this.net.send({ t: 'decor.update', id: cur.moving, decor: spot });
      // Reveal it when the office says where it went (or soon anyway, if it refused).
      this.revealTimer = window.setTimeout(() => this.reveal(), 1500);
    } else {
      this.net.send({ t: 'decor.add', decor: { url: cur.url, title: cur.title || undefined, frame: cur.frame, ...spot } });
    }
    try {
      if (at.on === 'desk') localStorage.setItem(DESK_SIZE_KEY, String(cur.deskSize));
      else localStorage.setItem(SIZE_KEY, String(cur.size));
    } catch {
      // storage blocked
    }
    this.stop(!!cur.moving);
  }

  cancel() {
    if (!this.cur) return;
    this.stop();
  }

  /** Every frame: move the ghost to where you aim. */
  update() {
    const cur = this.cur;
    if (!cur) return;
    this.raycaster.setFromCamera(this.player.view === 'first' ? new THREE.Vector2(0, 0) : this.mouse, this.camera);
    // A desk top in front of the wall you're aiming past takes the picture instead, in a standing frame.
    const desk = aimAtDesk(this.raycaster.ray);
    const hit = aimAtWall(this.raycaster.ray, desk?.t);
    if (desk && !hit) {
      const { w, h } = deskPictureSize(cur.deskSize, cur.shape);
      const on = clampToDesk(desk.dx, desk.dz, w, h, cur.rot);
      const ok = deskSpotFree(deskFootprint({ ...on, w, h, rot: cur.rot }), this.gallery.deskRects(desk.desk, cur.moving));
      this.at = { on: 'desk', desk: desk.desk, dx: on.dx, dz: on.dz, w, h, rot: cur.rot, ok };
      cur.on = 'desk';
      this.ghost.show(this.at, cur.frame, cur.texture, cur.aspect);
      return;
    }
    // Turned, a picture may have to hang smaller to fit under the ceiling; `size` stays as you set it.
    const { w, h } = pictureSize(cur.size, cur.shape, cur.rot);
    const on = hit && clampToWall(hit.wall, hit.u, hit.y, w, h, cur.rot);
    if (!hit || !on) {
      this.at = null;
      this.ghost.hide();
      return;
    }
    const rect = frameRect({ wall: hit.wall, u: on.u, y: on.y, w, h, rot: cur.rot });
    const ok = ![...this.office.fixtures(), ...this.gallery.rects(cur.moving)].some((r) => overlaps(rect, r));
    this.at = { on: 'wall', wall: hit.wall, u: on.u, y: on.y, w, h, rot: cur.rot, ok };
    cur.on = 'wall';
    this.ghost.show(this.at, cur.frame, cur.texture, cur.aspect);
  }

  private begin(c: HangChoice) {
    this.stop();
    const aspect = c.picture.aspect;
    this.cur = { url: c.picture.url, title: c.title, frame: c.frame, texture: c.picture.texture, aspect, shape: aspect, size: lastWallSize(), deskSize: lastDeskSize(), on: 'wall', rot: c.rot, release: holdPicture(c.picture.url) };
    this.onChange();
  }

  /** Stops hanging. A moved picture stays hidden (`keepHidden`) until the office says where it went. */
  private stop(keepHidden = false) {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    this.at = null;
    this.ghost.clear();
    cur.release();
    if (cur.moving && !keepHidden) this.gallery.hide(null);
    this.onChange();
  }

  private reveal() {
    clearTimeout(this.revealTimer);
    this.revealTimer = 0;
    if (!this.cur?.moving) this.gallery.hide(null);
  }
}
