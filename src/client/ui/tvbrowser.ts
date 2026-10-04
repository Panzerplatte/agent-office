import type * as THREE from 'three';
import type { ClientMsg } from '../../shared/protocol';
import { t } from '../i18n';
import { store } from '../state';
import { fitRect, modsOf, pagePoint, wheelPixels, type Rect, type TvBrowser } from '../tvbrowser';
import { ScreenZoom } from './arcade';
import { h, openModal, type Modal } from './dom';

type Input = Extract<ClientMsg, { t: 'tvbrowser.input' }>;

/** Keys that mean something on the page without a character: they go as keys, never as text. */
const NAMED = /^(Enter|Tab|Backspace|Delete|Arrow\w+|Home|End|PageUp|PageDown|Insert|F\d+|Shift|Control|Alt|Meta|CapsLock|ContextMenu)$/;

/**
 * The website on the TV, up close: the camera glides to the TV (like the boss's monitor) and the
 * page is drawn big exactly over it. The mouse and keyboard go to the page on the server, and a bar
 * under it goes back, forward, reloads, switches desktop/phone size and takes it off the TV.
 */
export class TvViewer {
  private modal: Modal | null = null;
  private readonly view: ScreenZoom;

  constructor(
    screen: THREE.Mesh,
    private readonly tv: TvBrowser,
    private readonly send: (msg: ClientMsg) => void,
  ) {
    this.view = new ScreenZoom(screen);
  }

  get open(): boolean {
    return !!this.modal;
  }

  /** Anywhere between your view and the TV: your first-person hands would cover it. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** Moves the camera toward the TV while the viewer is open, and back after. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    this.view.update(camera, dt, !!this.modal);
  }

  /** The TV browser went off (or someone took it off the TV): nothing left to look at. */
  close() {
    this.modal?.close();
  }

  show() {
    if (this.modal || !this.tv.state) return;
    const send = this.send;
    const input = (msg: Omit<Input, 't'>) => send({ t: 'tvbrowser.input', ...msg });

    const board = h('canvas', { 'aria-label': t('windows.tvbrowser.page'), tabindex: 0 });
    const back = h('button.btn', { type: 'button', title: t('windows.tvbrowser.back') }, '←');
    const fwd = h('button.btn', { type: 'button', title: t('windows.tvbrowser.forward') }, '→');
    const reload = h('button.btn', { type: 'button', title: t('windows.tvbrowser.reload') }, '⟳');
    const desktop = h('button.btn', { type: 'button' }, t('windows.tvbrowser.desktop'));
    const mobile = h('button.btn', { type: 'button' }, t('windows.tvbrowser.mobile'));
    const where = h('span.tvb-where');
    const off = h('button.btn', { type: 'button' }, t('windows.tvbrowser.takeOff'));
    const leave = h('button.btn', { type: 'button', title: t('windows.tvbrowser.leaveTitle') }, t('windows.tvbrowser.leave'));
    const bar = h('div.arcade-bar.tvb-bar', {}, back, fwd, reload, h('span.tvb-sep'), desktop, mobile, where, off, leave);
    const box = h('div.arcade.tvb', { role: 'dialog', 'aria-label': t('windows.tvbrowser.dialog') }, h('div.arcade-screen', {}, board), bar);

    const click = (b: HTMLButtonElement, fn: () => void) =>
      b.addEventListener('click', () => {
        fn();
        // Keys go to the page, not to a button that kept the focus.
        board.focus();
      });
    click(back, () => send({ t: 'tvbrowser.nav', action: 'back' }));
    click(fwd, () => send({ t: 'tvbrowser.nav', action: 'forward' }));
    click(reload, () => send({ t: 'tvbrowser.nav', action: 'reload' }));
    click(desktop, () => send({ t: 'tvbrowser.view', mode: 'desktop' }));
    click(mobile, () => send({ t: 'tvbrowser.view', mode: 'mobile' }));
    click(off, () => send({ t: 'tvbrowser.close' }));
    click(leave, () => this.modal?.close());

    /** Where the page is on the board, in CSS pixels. */
    let page: Rect = { x: 0, y: 0, w: 1, h: 1 };
    const paint = () => {
      const s = this.tv.state;
      if (s) {
        where.textContent = s.title ? `${s.title} · ${s.url}` : s.url;
        where.title = s.url;
        const phone = s.width < s.height;
        desktop.classList.toggle('on', !phone);
        mobile.classList.toggle('on', phone);
      }
      const g = board.getContext('2d');
      if (!g) return;
      const dpr = board.width / Math.max(1, board.clientWidth);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#0b1320';
      g.fillRect(0, 0, board.width, board.height);
      const pic = this.tv.picture;
      const pw = pic?.width ?? s?.width ?? 1280;
      const ph = pic?.height ?? s?.height ?? 720;
      page = fitRect(board.clientWidth, board.clientHeight, pw, ph);
      if (pic) g.drawImage(pic, page.x * dpr, page.y * dpr, page.w * dpr, page.h * dpr);
      else {
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 ${Math.round(28 * dpr)}px Nunito, ui-rounded, system-ui, sans-serif`;
        g.fillText(s?.error ? `⚠️ ${s.error}` : t('main.tvLoading'), board.width / 2, board.height / 2, board.width - 40);
      }
    };

    const fit = () => {
      const { width, height } = this.view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      board.width = Math.round(width * devicePixelRatio);
      board.height = Math.round(height * devicePixelRatio);
      paint();
    };

    // The mouse, in the page's 0..1. Moves go at most once a frame.
    const at = (e: MouseEvent, clamp = false) => {
      const r = board.getBoundingClientRect();
      return pagePoint(e.clientX - r.left, e.clientY - r.top, page, clamp);
    };
    let held = 0;
    let moved: { x: number; y: number } | null = null;
    let moveQueued = false;
    board.addEventListener('pointermove', (e) => {
      const p = at(e, held > 0);
      if (!p) return;
      moved = p;
      if (moveQueued) return;
      moveQueued = true;
      requestAnimationFrame(() => {
        moveQueued = false;
        if (moved) input({ kind: 'move', ...moved });
      });
    });
    board.addEventListener('pointerdown', (e) => {
      board.focus();
      const p = at(e);
      if (!p || e.button > 2) return;
      held++;
      board.setPointerCapture(e.pointerId);
      input({ kind: 'down', ...p, button: e.button as 0 | 1 | 2, mods: modsOf(e) });
      e.preventDefault();
    });
    board.addEventListener('pointerup', (e) => {
      if (!held || e.button > 2) return;
      held = Math.max(0, held - 1);
      const p = at(e, true)!;
      input({ kind: 'up', ...p, button: e.button as 0 | 1 | 2, mods: modsOf(e) });
    });
    board.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = at(e, true)!;
        input({ kind: 'wheel', ...p, ...wheelPixels(e, this.tv.state?.height), mods: modsOf(e) });
      },
      { passive: false },
    );
    board.addEventListener('contextmenu', (e) => e.preventDefault());

    // The keyboard goes to the page, all of it, while the viewer's open: the office's keys (WASD, E,
    // the emotes) are off anyway behind a window. Esc leaves; Ctrl/⌘+V pastes your clipboard in.
    const onKey = (e: KeyboardEvent) => {
      if (!this.modal || e.key === 'Escape' || e.isComposing) return;
      // Typing in the toolbar's own fields (none yet) or the chat stays there.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mods = modsOf(e);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return; // the paste event below
      e.preventDefault();
      e.stopPropagation();
      const down = e.type === 'keydown';
      // A character typed (no Ctrl/⌘ shortcut): text, so any keyboard layout types what it shows.
      if (down && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !NAMED.test(e.key)) {
        input({ kind: 'text', text: e.key, code: e.code, mods });
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return; // its keyup: the text went already
      input({ kind: 'key', key: e.key, code: e.code, mods, ...(down ? {} : { dx: 0 }) });
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      input({ kind: 'text', text });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('paste', onPaste, true);

    this.tv.onPicture = paint;
    const unsub = store.on('tvBrowser', () => (this.tv.state ? paint() : this.modal?.close()));
    fit();
    window.addEventListener('resize', fit);
    send({ t: 'tvbrowser.watch', on: true });
    this.modal = openModal(box, {
      backdropCloses: false,
      doing: t('world.doingTvBrowser'),
      onClose: () => {
        window.removeEventListener('resize', fit);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKey, true);
        window.removeEventListener('paste', onPaste, true);
        this.tv.onPicture = null;
        unsub();
        this.modal = null;
        send({ t: 'tvbrowser.watch', on: false });
      },
    });
    this.modal.backdrop.classList.add('clear');
    board.focus();
  }
}
