import * as THREE from 'three';
import { ROULETTE_WHEEL, WHEEL_ORDER } from '../shared/casino';
import { colorOf } from '../shared/roulette';
import { t } from './i18n';
import { $, h } from './ui/dom';
import type { RouletteTableView } from './world/casino';
import type { RouletteWheelView } from './world/roulette';

// While the ball goes round the roulette wheel (and for a few seconds once it's in its pocket), a
// window in a corner of the screen looks straight down into the wheel from just over it: close enough
// to follow the ball and read the numbers, and once it's in, closer in on its pocket, lit up, with the
// number beside it. For everyone at the table, and anyone standing by it watching. A second camera
// draws it, small, into a picture of its own, and only while it's up. The ✕ closes it for good (in
// this browser); a little button in its place while the ball's going round brings it back.

/** How long the window stays up once the ball's in its pocket (ms). */
const HOLD = 4000;
/** Closed with the ✕, in this browser. */
const CLOSED_KEY = 'agent-office.roulette-wheel-window';
/** How quickly it fades in and out (per second), and goes in on the pocket. */
const FADE = 4;
const ZOOM = 1.6;
/** The camera's field of view, and half the width of what it shows: the whole bowl, or the pocket the ball's in. */
const FOV = 50;
const WHOLE = ROULETTE_WHEEL.r - 0.01;
const CLOSE = 0.17;
/** The layer the lit pocket is on: only this window's camera sees it. */
const LAYER = 3;
/** Draws the picture at most this many pixels per CSS pixel. */
const RESOLUTION = 1;

function closedBefore(): boolean {
  try {
    return localStorage.getItem(CLOSED_KEY) === '1';
  } catch {
    return false;
  }
}

const center = new THREE.Vector3();
const pocket = new THREE.Vector3();
const look = new THREE.Vector3();

export class WheelWindow {
  private readonly el: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly reopen: HTMLButtonElement;
  private closed = closedBefore();
  /** 0 hidden … 1 fully there. */
  private fade = 0;
  /** 0 the whole wheel … 1 in on the ball's pocket. */
  private zoom = 0;
  private readonly cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 3);
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly picture: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly pictureScene = new THREE.Scene();
  private readonly pictureCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** The winning pocket, lit (on the rotor, so it turns with it), and which number it's lighting. */
  private lit: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  private litNumber: number | null = null;
  private badgeFor = '';

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    /** The camera you're looking through: your side of the wheel goes at the bottom of the window. */
    private readonly eye: THREE.Camera,
    private readonly wheel: () => RouletteWheelView | null,
    private readonly table: () => RouletteTableView | null,
    /** Reduce motion: no fades, no zooming, no pulsing. */
    private readonly still: () => boolean,
  ) {
    this.cam.layers.enable(LAYER);
    this.picture = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
    this.pictureScene.add(this.picture);
    this.badge = h('div.rl-pip-number.hidden');
    const close = h('button.rl-pip-close', { type: 'button', title: t('menus.rouletteWheelClose'), 'aria-label': t('menus.rouletteWheelClose') }, '✕');
    close.addEventListener('click', () => this.setClosed(true));
    this.el = h('div.rl-pip.hidden', { 'aria-label': t('menus.rouletteWheelView') }, h('div.rl-pip-title', {}, t('menus.rouletteWheelView')), close, this.badge);
    this.reopen = h('button.rl-pip-open.btn.hidden', { type: 'button', title: t('menus.rouletteWheelOpenNote') }, t('menus.rouletteWheelOpen'));
    this.reopen.addEventListener('click', () => this.setClosed(false));
    for (const b of [close, this.reopen])
      // A click mustn't leave it focused (Space and Enter would press it again).
      b.addEventListener('pointerdown', (e) => e.preventDefault());
    $('hud').append(this.el, this.reopen);
  }

  private setClosed(closed: boolean) {
    this.closed = closed;
    try {
      localStorage.setItem(CLOSED_KEY, closed ? '1' : '0');
    } catch {
      // Just for this visit, then.
    }
  }

  /** Every frame, after the scene's been drawn: `watching` is whether you're at the table or standing by it. */
  frame(dt: number, watching: boolean) {
    const eye = this.eye.position;
    const wheel = this.wheel();
    const view = this.table();
    const on = !!wheel && !!view && watching && wheel.spinShowing(HOLD);
    const still = this.still();
    const want = on && !this.closed ? 1 : 0;
    if (want && !this.fade && view) {
      // Coming up: in the top corner away from the wheel, so it doesn't cover it.
      view.toWorld(ROULETTE_WHEEL.x, ROULETTE_WHEEL.z, 0, center).project(this.eye);
      this.el.classList.toggle('left', center.x > 0);
      this.reopen.classList.toggle('left', center.x > 0);
    }
    this.fade = still ? want : want > this.fade ? Math.min(1, this.fade + dt * FADE) : Math.max(0, this.fade - dt * FADE);
    this.el.classList.toggle('hidden', !this.fade);
    this.el.style.opacity = String(this.fade);
    this.reopen.classList.toggle('hidden', !(on && this.closed));
    if (!this.fade || !wheel || !view) {
      if (this.lit) this.lit.visible = false;
      return;
    }

    // Once the ball's in: its number beside the window, and its pocket lit in it.
    const n = wheel.settled ? wheel.number : null;
    this.light(view, n);
    const badge = n === null ? '' : `${n} ${t(`menus.roulette_${colorOf(n)}`)}`;
    if (badge !== this.badgeFor) {
      this.badgeFor = badge;
      this.badge.textContent = badge;
      this.badge.className = `rl-pip-number ${n === null ? 'hidden' : colorOf(n)}`;
    }
    if (this.lit) this.lit.material.opacity = still ? 0.6 : 0.45 + 0.2 * Math.sin(performance.now() / 160);

    // The camera: straight down over the wheel, or over the pocket once the ball's in it.
    const w = view.wheel;
    w.bowl.getWorldPosition(center);
    const zoomTo = n === null ? 0 : 1;
    this.zoom = still ? zoomTo : zoomTo > this.zoom ? Math.min(1, this.zoom + dt * ZOOM) : Math.max(0, this.zoom - dt * ZOOM);
    const ease = this.zoom * this.zoom * (3 - 2 * this.zoom);
    let up = Math.atan2(center.z - eye.z, center.x - eye.x);
    if (n !== null) {
      const a = w.rotor.rotation.y + w.pocketAngle(n);
      w.bowl.localToWorld(pocket.set(Math.cos(a) * w.radii.pockets, 0, -Math.sin(a) * w.radii.pockets));
      // In on the pocket: the number's upright, read from outside the wheel.
      const inward = Math.atan2(center.z - pocket.z, center.x - pocket.x);
      up += Math.atan2(Math.sin(inward - up), Math.cos(inward - up)) * ease;
      look.lerpVectors(center, pocket, ease);
    } else look.copy(center);
    const half = WHOLE + (CLOSE - WHOLE) * ease;
    const cam = this.cam;
    cam.position.copy(look);
    cam.position.y += 0.03 + half / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    cam.up.set(Math.cos(up), 0, Math.sin(up));
    cam.lookAt(look);
    this.draw();
  }

  /** Lights number `n`'s pocket on the rotor, or none. */
  private light(view: RouletteTableView, n: number | null) {
    if (n === null) {
      if (this.lit) this.lit.visible = false;
      return;
    }
    const w = view.wheel;
    if (!this.lit) {
      const alpha = (Math.PI * 2) / WHEEL_ORDER.length;
      // A slice of the ring over the pocket and its number, laid flat; turned to the pocket below.
      const geo = new THREE.RingGeometry(w.radii.pockets - 0.04, w.radii.rotor, 4, 1, -alpha / 2, alpha).rotateX(-Math.PI / 2);
      this.lit = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      this.lit.position.y = 0.002;
      this.lit.layers.set(LAYER);
      this.lit.renderOrder = 2;
      w.rotor.add(this.lit);
    }
    if (n !== this.litNumber) {
      this.litNumber = n;
      this.lit.rotation.y = w.pocketAngle(n);
    }
    this.lit.visible = true;
  }

  /** The camera's picture, into a little target of its own, then onto the screen in the window, faded. */
  private draw() {
    const r = this.renderer;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    if (!W || !H) return;
    const px = Math.min(r.getPixelRatio(), RESOLUTION);
    const tw = Math.max(1, Math.round(W * px));
    const th = Math.max(1, Math.round(H * px));
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(tw, th, { samples: 4 });
      this.picture.material.map = this.target.texture;
      this.picture.material.needsUpdate = true;
    } else if (this.target.width !== tw || this.target.height !== th) this.target.setSize(tw, th);
    this.cam.aspect = W / H;
    this.cam.updateProjectionMatrix();

    const before = r.getRenderTarget();
    const shadows = r.shadowMap.autoUpdate;
    const autoClear = r.autoClear;
    // The shadows are the ones the main picture just drew: no need to draw them again.
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(this.scene, this.cam);
    r.shadowMap.autoUpdate = shadows;
    r.setRenderTarget(before);

    // Onto the screen, inside the window's frame (GL counts up from the bottom).
    const box = this.el.getBoundingClientRect();
    const x = box.left + this.el.clientLeft;
    const y = window.innerHeight - (box.top + this.el.clientTop + H);
    this.picture.material.opacity = this.fade;
    r.autoClear = false;
    r.setViewport(x, y, W, H);
    r.setScissor(x, y, W, H);
    r.setScissorTest(true);
    r.render(this.pictureScene, this.pictureCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, window.innerWidth, window.innerHeight);
    r.autoClear = autoClear;
  }
}
