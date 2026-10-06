import * as THREE from 'three';
import { scoreText } from '../../shared/cabinet';
import {
  SNAKE_COLS,
  SNAKE_GAME,
  SNAKE_NAME_MAX,
  SNAKE_ROWS,
  SNAKE_SCORES_KEPT,
  START_LENGTH,
  cleanName,
  frameOf,
  newGame,
  pause,
  resume,
  snakeCells,
  step,
  tickMs,
  turn,
  type Dir,
  type SnakeFrame,
  type SnakeGame,
  type SnakeScore,
} from '../../shared/snake';
import type { Net } from '../net';
import { store } from '../state';
import { t } from '../i18n';
import { h, openModal, toast, type Modal } from './dom';
import { ScreenZoom } from './arcade';

/** What the Snake machine makes a noise about: food, golden food, a turn, the crash, and making the high-score table. */
export type SnakeSound = 'eat' | 'golden' | 'turn' | 'crash' | 'record';

/** The screen is painted in these fixed units, whatever size it shows at. */
export const W = 800;
export const H = 600;

/** Keys for the game, by `code`. */
const KEYS: Record<string, Dir | 'pause' | 'go'> = {
  ArrowUp: 'u',
  KeyW: 'u',
  ArrowDown: 'd',
  KeyS: 'd',
  ArrowLeft: 'l',
  KeyA: 'l',
  ArrowRight: 'r',
  KeyD: 'r',
  Space: 'pause',
  KeyP: 'pause',
  Enter: 'go',
};

/** A swipe has to go this far (CSS px) to count; less is a tap. */
const SWIPE = 24;

/**
 * Where you are with your own game: waiting for the office to name it, ready for the first arrow,
 * playing (or paused), typing your name in for the high-score table, or done with it.
 */
type Phase = 'wait' | 'ready' | 'play' | 'name' | 'over';

/** Whether a game that ended at `score` makes the high-score table as it stands. */
export function qualifies(score: number, scores: readonly SnakeScore[]): boolean {
  return score > 0 && (scores.length < SNAKE_SCORES_KEPT || score > scores[scores.length - 1].score);
}

/** The way a swipe of (dx, dy) CSS px points, or null for a tap. */
export function swipeDir(dx: number, dy: number): Dir | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'd' : 'u';
}

/**
 * The Snake machine in the lounge. Press E there and the camera glides up to its screen, where you
 * play Snake (shared/snake.ts) with the arrows, WASD or a swipe. Everyone else on the floor sees your
 * game on the machine as you play, and can walk up and press E to watch it up close. At the end a
 * score good enough for the building's table asks for your name; with nobody playing the screen
 * cycles between its title and the table.
 */
export class SnakeMachine {
  private mode: 'play' | 'watch' | null = null;
  private modal: Modal | null = null;
  private readonly view: ScreenZoom;
  private game: SnakeGame | null = null;
  /** The game's id on the table, as the office named it. */
  private id = '';
  private phase: Phase = 'wait';
  /** Milliseconds banked toward the next step. */
  private acc = 0;
  /** The last frame sent, so the same one doesn't go twice. */
  private sent = '';
  /** Who you're watching. */
  private watching = '';
  /** What the machine in the office shows. */
  private readonly picture = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.picture);
  /** The screen up close, drawn at the size it shows on the page so it stays crisp. */
  private board: HTMLCanvasElement | null = null;
  /** Where you type your name for the table. */
  private nameBox: HTMLElement | null = null;
  private nameInput: HTMLInputElement | null = null;
  private dirty = true;
  /** The screen's animation tick (blinking, the attract snake): it's repainted when this moves on. */
  private tick = -1;
  /** The last frame from whoever's playing, to hear what changed. */
  private heard: SnakeFrame | null = null;

  constructor(
    screen: THREE.Mesh,
    private readonly net: Net,
    private readonly opts: { sound(kind: SnakeSound): void },
  ) {
    this.view = new ScreenZoom(screen);
    this.picture.width = 512;
    this.picture.height = 384;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set('#ffffff');
    void document.fonts.ready.then(() => (this.dirty = true));
    store.on('snake', () => this.onState());
    store.on('snakeFrame', () => this.onFrame());
    // Clicked off into another window: the snake waits for you.
    window.addEventListener('blur', () => {
      if (this.mode === 'play') this.setPaused(true);
    });
    // Closing the tab mid-game: what you scored still counts.
    window.addEventListener('pagehide', () => {
      if (this.mode === 'play') this.finish();
    });
  }

  /** Anywhere between your view and the screen: your first-person hands would cover it. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** The picture on the machine, for checking it from a script. */
  get screenPicture(): HTMLCanvasElement {
    return this.picture;
  }

  /** E at the machine: play, or watch whoever's on it already. */
  play() {
    if (this.modal || !store.floor) return;
    const p = store.snake.player;
    if (p && p.id !== store.you) return this.open('watch');
    this.open('play');
    this.ask();
  }

  /** Runs your game, sends it to everyone watching, keeps the screens drawn and moves the camera. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    let g = this.game;
    if (this.mode === 'play' && g && this.phase === 'play' && g.state === 'play') {
      this.acc = Math.min(this.acc + dt * 1000, 250);
      while (g.state === 'play' && this.acc >= tickMs(g.snake.length)) {
        this.acc -= tickMs(g.snake.length);
        this.advance();
        g = this.game!;
      }
    }
    const tick = Math.floor(performance.now() / 125);
    if (tick !== this.tick) {
      this.tick = tick;
      this.dirty = true;
    }
    if (this.dirty) this.paint();
    this.view.update(camera, dt, !!this.modal);
  }

  /** Asks the office for a new game: it says which in `snake`. */
  private ask() {
    this.game = null;
    this.id = '';
    this.phase = 'wait';
    this.sent = '';
    this.renderName();
    this.net.send({ t: 'snake.play' });
    this.dirty = true;
  }

  /** One step of your game, and the noises it makes. */
  private advance() {
    const was = this.game!;
    const g = step(was);
    this.game = g;
    if (g.golds > was.golds) this.opts.sound('golden');
    else if (g.eaten > was.eaten) this.opts.sound('eat');
    this.sendFrame();
    this.dirty = true;
    if (g.state === 'over') this.ended();
  }

  /** The snake crashed: a name for the table if it made it, else the score goes in as it is. */
  private ended() {
    this.opts.sound('crash');
    const g = this.game!;
    if (!qualifies(g.score, store.snake.scores)) return this.submit();
    this.phase = 'name';
    this.renderName();
    setTimeout(() => this.opts.sound('record'), 600);
  }

  /** Your game's result to the office, under the name you typed (if you did). */
  private submit(name?: string) {
    const g = this.game;
    if (!g || !this.id || (this.phase !== 'play' && this.phase !== 'name')) return;
    this.phase = 'over';
    this.net.send({
      t: 'snake.over',
      game: this.id,
      result: {
        score: g.score,
        eaten: g.eaten,
        golds: g.golds,
        ticks: g.ticks,
      },
      name: cleanName(name) ?? undefined,
    });
    this.renderName();
    this.dirty = true;
  }

  /** Stepping away or closing the tab mid-game: what you scored so far still counts. */
  private finish() {
    const g = this.game;
    if (!g) return;
    if (this.phase === 'name') return this.submit(this.nameInput?.value);
    if (this.phase === 'play' && g.score > 0) {
      this.sendFrame();
      this.submit();
    }
  }

  /** Your game as it looks now, to everyone watching (and the office, which follows it by them). */
  private sendFrame() {
    const g = this.game;
    if (!g || !this.id) return;
    const key = `${g.ticks}|${g.state}`;
    if (key === this.sent) return;
    this.sent = key;
    this.net.send({ t: 'snake.frame', frame: frameOf(g) });
  }

  private setPaused(on: boolean) {
    const g = this.game;
    if (!g || this.phase !== 'play') return;
    this.game = on ? pause(g) : resume(g);
    if (this.game !== g) {
      this.acc = 0;
      this.sendFrame();
      this.dirty = true;
    }
  }

  private open(mode: 'play' | 'watch') {
    this.mode = mode;
    this.watching = mode === 'watch' ? (store.snake.player?.name ?? '') : '';
    const board = h('canvas', {
      'aria-label':
        mode === 'play'
          ? SNAKE_GAME
          : t('windows.snake.watchingLabel', {
              name: this.watching,
              game: SNAKE_GAME,
            }),
    });
    const stop = h('button.btn', { type: 'button' }, t(mode === 'play' ? 'windows.snake.stopPlaying' : 'windows.snake.stopWatching'));
    const tip = mode === 'play' ? t('windows.snake.controls') : t('windows.snake.watching', { name: this.watching });
    const input = h('input', {
      type: 'text',
      maxlength: String(SNAKE_NAME_MAX),
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': t('windows.snake.nameLabel'),
    }) as HTMLInputElement;
    const save = h('button.btn.primary', { type: 'button' }, t('windows.snake.save'));
    const nameBox = h('form.snake-name.hidden', {}, h('span', {}, t('windows.snake.nameLabel')), input, save);
    const box = h(
      'div.arcade.snake',
      { role: 'dialog', 'aria-label': SNAKE_GAME },
      h('div.arcade-screen', {}, board),
      nameBox,
      h('div.arcade-bar', {}, h('span', {}, `🐍 ${SNAKE_GAME}`), h('span.tip', {}, tip), stop),
    );

    const fit = () => {
      const { width, height } = this.view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      board.width = Math.round(width * devicePixelRatio);
      board.height = Math.round(height * devicePixelRatio);
      this.dirty = true;
    };
    const onKey = (e: KeyboardEvent) => this.key(e);
    // Swipes on the screen steer; a tap starts, carries on or plays again.
    let touch: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const p = e.changedTouches[0];
      touch = { x: p.clientX, y: p.clientY };
    };
    const onTouchMove = (e: TouchEvent) => e.preventDefault();
    const onTouchEnd = (e: TouchEvent) => {
      const p = e.changedTouches[0];
      if (!touch || !p) return;
      this.command(swipeDir(p.clientX - touch.x, p.clientY - touch.y) ?? 'go');
      touch = null;
    };
    this.board = board;
    this.nameBox = nameBox;
    this.nameInput = input;
    fit();
    window.addEventListener('resize', fit);
    if (mode === 'play') {
      window.addEventListener('keydown', onKey, true);
      board.addEventListener('touchstart', onTouchStart, { passive: true });
      board.addEventListener('touchmove', onTouchMove, { passive: false });
      board.addEventListener('touchend', onTouchEnd);
    }
    nameBox.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit(input.value);
    });
    save.addEventListener('click', () => this.submit(input.value));
    input.addEventListener('input', () => (this.dirty = true));
    this.modal = openModal(box, {
      backdropCloses: false,
      onClose: () => {
        window.removeEventListener('resize', fit);
        window.removeEventListener('keydown', onKey, true);
        this.closed();
      },
    });
    this.modal.backdrop.classList.add('clear');
    stop.addEventListener('click', () => this.modal?.close());
  }

  /** Stepped away: a game on ends there, and what it scored goes on the table if it's good enough. */
  private closed() {
    const was = this.mode;
    this.mode = null;
    this.modal = this.board = this.nameBox = this.nameInput = null;
    this.watching = '';
    this.dirty = true;
    if (was !== 'play') return;
    this.finish();
    this.net.send({ t: 'snake.leave' });
    this.game = null;
    this.id = '';
    this.phase = 'wait';
  }

  private key(e: KeyboardEvent) {
    // Typing your name: the box has the keys (Esc still steps away, keeping what's typed).
    if (this.phase === 'name') return;
    const k = KEYS[e.code];
    if (!k || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat && (k === 'pause' || k === 'go')) return;
    this.command(k);
  }

  /** A key or a swipe: a way to turn, pause (Space, P) or go (Enter, a tap). */
  private command(k: Dir | 'pause' | 'go') {
    const g = this.game;
    if (this.phase === 'over') {
      if (k === 'go' || k === 'pause') this.ask();
      return;
    }
    if (!g || this.phase === 'wait' || this.phase === 'name') return;
    if (this.phase === 'ready') {
      // Off it goes on the first key, turning that way if it can.
      this.phase = 'play';
      this.acc = 0;
      if (k !== 'go' && k !== 'pause') this.game = turn(g, k);
      this.sendFrame();
      this.dirty = true;
      return;
    }
    if (g.state === 'paused') {
      this.setPaused(false);
      if (k !== 'go' && k !== 'pause') this.game = turn(this.game!, k);
      return;
    }
    if (k === 'pause') return this.setPaused(true);
    if (k === 'go') return;
    const turned = turn(g, k);
    if (turned === g) return;
    this.game = turned;
    this.opts.sound('turn');
  }

  /** Who's at the machine changed. */
  private onState() {
    const p = store.snake.player;
    this.heard = store.snakeFrame;
    if (this.mode === 'play') {
      if (p && p.id !== store.you) {
        // Someone else got there first: watch them instead.
        this.modal?.close();
        this.open('watch');
      } else if (!p) {
        // The office forgot you (a dropped connection): a new game, unless this one's done with.
        if (this.phase !== 'over') {
          if (this.phase !== 'wait') toast(t('notices.arcadeLostGame'));
          this.ask();
        }
      } else if (p.game && p.game !== this.id) {
        if (this.phase !== 'wait' && this.phase !== 'over') toast(t('notices.arcadeLostGame'));
        if (this.phase === 'over' && this.id) return;
        this.id = p.game;
        this.game = newGame((Math.random() * 2 ** 32) | 0);
        this.phase = 'ready';
        this.sent = '';
        this.renderName();
        this.sendFrame();
      }
    } else if (this.mode === 'watch' && (!p || p.id === store.you || p.name !== this.watching)) {
      if (!p) toast(t('notices.arcadeLeft', { name: this.watching }));
      this.modal?.close();
    }
    this.dirty = true;
  }

  /** Someone else's game moved on: hear it eat and crash. */
  private onFrame() {
    const f = store.snakeFrame;
    const was = this.heard;
    this.heard = f;
    this.dirty = true;
    if (!f || !was || this.mode === 'play') return;
    if (f.golds > was.golds) this.opts.sound('golden');
    else if (f.eaten > was.eaten) this.opts.sound('eat');
    if (f.state === 'over' && was.state !== 'over') this.opts.sound('crash');
  }

  /** Shows the name box while you're typing your name, and puts the keys in it. */
  private renderName() {
    const box = this.nameBox;
    const input = this.nameInput;
    if (!box || !input) return;
    const on = this.phase === 'name';
    if (on === !box.classList.contains('hidden')) return;
    box.classList.toggle('hidden', !on);
    if (on) {
      input.value = [...store.profile.name].slice(0, SNAKE_NAME_MAX).join('');
      input.focus();
      input.select();
    } else input.blur();
  }

  /** What the screen shows: your game, someone else's, or the attract mode with nobody playing. */
  private screen(now: number): SnakeScreen {
    const s = store.snake;
    const g = this.game;
    if (this.mode === 'play') {
      const frame = g ? frameOf(g) : null;
      const rank = s.scores.findIndex((e) => e.game === this.id) + 1;
      const touch = matchMedia('(pointer: coarse)').matches;
      let overlay: SnakeScreen['overlay'];
      if (this.phase === 'wait') overlay = { kind: 'banner', title: SNAKE_GAME, sub: '…' };
      else if (this.phase === 'ready')
        overlay = {
          kind: 'banner',
          title: t('windows.snake.ready'),
          sub: t(touch ? 'windows.snake.swipeToStart' : 'windows.snake.arrowsToStart'),
        };
      else if (frame?.state === 'paused')
        overlay = {
          kind: 'banner',
          title: t('windows.snake.paused'),
          sub: t('windows.snake.pToCarryOn'),
        };
      else if (this.phase === 'name') overlay = { kind: 'name', name: this.nameInput?.value ?? '' };
      else if (this.phase === 'over')
        overlay = {
          kind: 'table',
          sub: rank ? t('windows.snake.ranked', { rank }) : t(touch ? 'windows.snake.tapToPlayAgain' : 'windows.snake.playAgain'),
        };
      return {
        frame: frame ?? emptyFrame(),
        player: store.profile.name,
        scores: s.scores,
        mine: this.id,
        overlay,
        t: now,
      };
    }
    const p = s.player;
    const f = store.snakeFrame;
    if (p && p.id !== store.you && f) {
      return {
        frame: f,
        player: p.name,
        scores: s.scores,
        mine: p.game,
        overlay:
          f.state === 'paused'
            ? {
                kind: 'banner',
                title: t('windows.snake.paused'),
                sub: t('windows.snake.backSoon'),
              }
            : f.state === 'over'
              ? { kind: 'table' }
              : undefined,
        t: now,
      };
    }
    return {
      frame: null,
      player: p && p.id !== store.you ? p.name : undefined,
      scores: s.scores,
      t: now,
    };
  }

  /** Draws the screen up close while you play or watch, and on the machine otherwise (the close one covers it). */
  private paint() {
    this.dirty = false;
    const v = this.screen(performance.now() / 1000);
    const canvas = this.board ?? this.picture;
    const g = canvas.getContext('2d')!;
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    paintSnakeScreen(g, v);
    if (!this.board) this.texture.needsUpdate = true;
  }
}

/** A snake that hasn't started, for the screen before the office names your game. */
function emptyFrame(): SnakeFrame {
  return frameOf(newGame(0));
}

/** Everything the screen shows. */
export interface SnakeScreen {
  /** The game on it, or null for the attract mode with nobody playing. */
  frame: SnakeFrame | null;
  /** Who's playing. */
  player?: string;
  scores: readonly SnakeScore[];
  /** A game to pick out on the table. */
  mine?: string;
  /** Over the game: a word or two (ready, paused), typing a name in, or the table after a game over. */
  overlay?: { kind: 'banner'; title: string; sub: string } | { kind: 'name'; name: string } | { kind: 'table'; sub?: string };
  /** Seconds, for the blinking and the attract snake. */
  t: number;
}

const FONT = "'Courier New', ui-monospace, monospace";
const CELL = 24;
const X0 = (W - SNAKE_COLS * CELL) / 2;
const Y0 = 84;
const BG = '#06120a';
const GRID = '#0a1d10';
const NEON = '#3ddc5a';
const LIME = '#c6ff3d';
const SCALE_A = '#3ddc5a';
const SCALE_B = '#2fbf4a';
const SCALE_DARK = '#1f8a35';
const TEXT = '#e9ffe0';
const DIM = '#6f9a74';
const GOLD = '#ffd23f';
const RED = '#ff3b3b';

/** Pixel art, 8×8: r red, w shine, b stem, g leaf. */
const APPLE = ['....gg..', '...bgg..', '.rrbrr..', 'rwrrrrrr', 'rwrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..rr.rr.'];

/** Draws the whole screen. */
export function paintSnakeScreen(g: CanvasRenderingContext2D, v: SnakeScreen) {
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';
  if (v.frame) paintGame(g, v.frame, v);
  else paintAttract(g, v);
  // Scan lines, like the tube it would have had.
  g.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1.5);
}

function paintGame(g: CanvasRenderingContext2D, f: SnakeFrame, v: SnakeScreen) {
  // Score and best along the top.
  const best = Math.max(v.scores[0]?.score ?? 0, f.score);
  text(g, t('windows.snake.score'), 40, 26, 18, DIM, 'left');
  text(g, pad(f.score), 40, 56, 32, TEXT, 'left');
  text(g, t('windows.snake.hi'), W - 40, 26, 18, DIM, 'right');
  text(g, pad(best), W - 40, 56, 32, f.score > 0 && f.score >= best ? GOLD : TEXT, 'right');
  text(g, SNAKE_GAME, W / 2, 30, 34, LIME, 'center', true);
  if (v.player) text(g, `▶ ${fit(g, v.player.toUpperCase(), 280, 16)}`, W / 2, 62, 16, GOLD, 'center');
  paintField(g);
  // Length and golden apples down the sides.
  text(g, t('windows.snake.length'), X0 / 2, Y0 + 30, 15, DIM, 'center');
  text(g, String(START_LENGTH + f.eaten), X0 / 2, Y0 + 58, 30, TEXT, 'center');
  apple(g, X0 / 2 - 12, Y0 + 110, 24, false);
  text(g, `×${f.eaten - f.golds}`, X0 / 2, Y0 + 152, 22, TEXT, 'center');
  apple(g, X0 / 2 - 12, Y0 + 200, 24, true);
  text(g, `×${f.golds}`, X0 / 2, Y0 + 242, 22, TEXT, 'center');

  if (f.food >= 0) apple(g, X0 + (f.food % SNAKE_COLS) * CELL, Y0 + Math.floor(f.food / SNAKE_COLS) * CELL, CELL, false);
  if (f.golden >= 0) {
    // The golden one blinks, so you know it won't stay.
    g.globalAlpha = Math.floor(v.t * 5) % 2 ? 0.45 : 1;
    apple(g, X0 + (f.golden % SNAKE_COLS) * CELL, Y0 + Math.floor(f.golden / SNAKE_COLS) * CELL, CELL, true);
    g.globalAlpha = 1;
  }
  const cells = snakeCells(f.head, f.body);
  if (cells) paintSnake(g, cells, f.state === 'over', v.t);

  const o = v.overlay;
  if (!o && f.state !== 'over') return;
  // Over the field, dimmed.
  g.fillStyle = 'rgba(3, 10, 5, 0.72)';
  g.fillRect(X0, Y0, SNAKE_COLS * CELL, SNAKE_ROWS * CELL);
  const cx = W / 2;
  if (o?.kind === 'banner') {
    text(g, o.title, cx, Y0 + 130, 46, LIME, 'center', true);
    if (Math.floor(v.t * 2) % 2 === 0) text(g, fit(g, o.sub, 460, 20), cx, Y0 + 182, 20, GOLD, 'center');
    return;
  }
  text(g, t('windows.snake.gameOver'), cx, Y0 + 48, 50, RED, 'center', true);
  if (o?.kind === 'name') {
    if (Math.floor(v.t * 3) % 2 === 0) text(g, t('windows.snake.newHighScore'), cx, Y0 + 120, 26, GOLD, 'center', true);
    text(g, pad(f.score), cx, Y0 + 170, 34, TEXT, 'center');
    text(g, t('windows.snake.enterName'), cx, Y0 + 240, 18, DIM, 'center');
    const cursor = Math.floor(v.t * 2.5) % 2 === 0 ? '_' : ' ';
    text(g, `${fit(g, o.name.toUpperCase(), 420, 34)}${cursor}`, cx, Y0 + 290, 34, LIME, 'center');
    text(g, t('windows.snake.enterToSave'), cx, Y0 + 360, 18, DIM, 'center');
    return;
  }
  // The table, with this game picked out on it.
  text(g, t('windows.snake.highScores'), cx, Y0 + 104, 20, GOLD, 'center');
  if (v.scores.length) table(g, v.scores, X0 + 24, SNAKE_COLS * CELL - 48, Y0 + 140, 28, 18, v.mine);
  else text(g, t('windows.snake.noScores'), cx, Y0 + 200, 18, DIM, 'center');
  if (o?.kind === 'table' && o.sub && Math.floor(v.t * 2) % 2 === 0) text(g, fit(g, o.sub, 460, 18), cx, Y0 + SNAKE_ROWS * CELL - 22, 18, LIME, 'center');
}

/** The grid in its glowing frame. */
function paintField(g: CanvasRenderingContext2D) {
  g.fillStyle = '#030a05';
  g.fillRect(X0, Y0, SNAKE_COLS * CELL, SNAKE_ROWS * CELL);
  g.fillStyle = GRID;
  for (let y = 0; y < SNAKE_ROWS; y++) for (let x = y % 2; x < SNAKE_COLS; x += 2) g.fillRect(X0 + x * CELL, Y0 + y * CELL, CELL, CELL);
  g.strokeStyle = NEON;
  g.lineWidth = 4;
  g.shadowColor = NEON;
  g.shadowBlur = 14;
  g.strokeRect(X0 - 4, Y0 - 4, SNAKE_COLS * CELL + 8, SNAKE_ROWS * CELL + 8);
  g.shadowBlur = 0;
}

/** Nobody's game on: the title with a snake going round, then the high scores, by turns. */
function paintAttract(g: CanvasRenderingContext2D, v: SnakeScreen) {
  const showTable = v.scores.length > 0 && Math.floor(v.t / 6) % 2 === 1;
  if (showTable) {
    text(g, t('windows.snake.highScores'), W / 2, 52, 36, GOLD, 'center', true);
    table(g, v.scores, 130, W - 260, 112, 38, 24, v.mine);
  } else {
    text(g, SNAKE_GAME, W / 2, 96, 110, LIME, 'center', true);
    // A snake going round and round the screen after an apple it never quite gets.
    const loop = attractLoop();
    const head = Math.floor(v.t * 7) % loop.length;
    const cells = Array.from({ length: 9 }, (_, i) => loop[(head - i + loop.length) % loop.length]);
    const ahead = loop[(head + 6) % loop.length];
    apple(g, X0 + (ahead % SNAKE_COLS) * CELL, Y0 + Math.floor(ahead / SNAKE_COLS) * CELL, CELL, false);
    paintSnake(g, cells, false, v.t);
    const best = v.scores[0];
    if (best) text(g, `${t('windows.snake.hi')} ${pad(best.score)} · ${fit(g, best.name.toUpperCase(), 260, 22)}`, W / 2, 504, 22, TEXT, 'center');
    else text(g, t('windows.snake.noScores'), W / 2, 504, 20, DIM, 'center');
  }
  if (Math.floor(v.t * 1.6) % 2 === 0) text(g, v.player ? `▶ ${fit(g, v.player.toUpperCase(), 500, 30)}` : t('windows.snake.pressToPlay'), W / 2, 560, 30, GOLD, 'center', true);
}

let loopCells: number[] | null = null;
/** The attract snake's way round: a ring under the title. */
function attractLoop(): number[] {
  if (loopCells) return loopCells;
  const out: number[] = [];
  const [x0, x1, y0, y1] = [2, 17, 8, 15];
  for (let x = x0; x < x1; x++) out.push(y0 * SNAKE_COLS + x);
  for (let y = y0; y < y1; y++) out.push(y * SNAKE_COLS + x1);
  for (let x = x1; x > x0; x--) out.push(y1 * SNAKE_COLS + x);
  for (let y = y1; y > y0; y--) out.push(y * SNAKE_COLS + x0);
  return (loopCells = out);
}

/** The snake, head first: green scales, joined up, a head with eyes (crossed out once it crashed) and a flicking tongue. */
function paintSnake(g: CanvasRenderingContext2D, cells: readonly number[], dead: boolean, time: number) {
  const at = (c: number): [number, number] => [X0 + (c % SNAKE_COLS) * CELL, Y0 + Math.floor(c / SNAKE_COLS) * CELL];
  for (let i = cells.length - 1; i >= 0; i--) {
    const [x, y] = at(cells[i]);
    // Thinner toward the tail.
    const tail = i === cells.length - 1 && i > 0;
    const inset = i === 0 ? 1 : tail ? 5 : 3;
    g.fillStyle = i === 0 ? LIME : i % 2 ? SCALE_A : SCALE_B;
    g.fillRect(x + inset, y + inset, CELL - inset * 2, CELL - inset * 2);
    // Joined to the cell in front of it.
    if (i > 0) {
      const [px, py] = at(cells[i - 1]);
      const w = CELL - inset * 2;
      if (px !== x) g.fillRect(Math.min(x, px) + CELL - inset - 1, y + inset, inset * 2 + 2, w);
      else g.fillRect(x + inset, Math.min(y, py) + CELL - inset - 1, w, inset * 2 + 2);
      if (!tail) {
        // A scale on its back.
        g.fillStyle = SCALE_DARK;
        g.fillRect(x + 9, y + 9, 6, 6);
      }
    }
  }
  if (!cells.length) return;
  const [hx, hy] = at(cells[0]);
  const dir: Dir = cells.length > 1 ? headDir(cells[1], cells[0]) : 'r';
  // In the head's own frame, facing right: (lx, ly, w, h) inside the 24-pixel cell.
  const px = (lx: number, ly: number, w: number, h: number) => {
    const [x, y, ww, hh] = dir === 'r' ? [lx, ly, w, h] : dir === 'l' ? [CELL - lx - w, CELL - ly - h, w, h] : dir === 'd' ? [CELL - ly - h, lx, h, w] : [ly, CELL - lx - w, h, w];
    g.fillRect(hx + x, hy + y, ww, hh);
  };
  if (dead) {
    g.fillStyle = '#7a0f0f';
    for (const ey of [5, 15]) {
      px(13, ey, 2, 2);
      px(17, ey, 2, 2);
      px(15, ey + 2, 2, 2);
      px(13, ey + 4, 2, 2);
      px(17, ey + 4, 2, 2);
    }
    return;
  }
  g.fillStyle = '#ffffff';
  px(13, 4, 6, 6);
  px(13, 14, 6, 6);
  g.fillStyle = '#06120a';
  px(16, 5, 3, 4);
  px(16, 15, 3, 4);
  if (Math.floor(time * 3) % 3 === 0) {
    g.fillStyle = RED;
    px(24, 11, 5, 2);
    px(28, 9, 3, 2);
    px(28, 13, 3, 2);
  }
}

/** Which way the head went to get from `from` to `to`. */
function headDir(from: number, to: number): Dir {
  const d = to - from;
  return d === 1 ? 'r' : d === -1 ? 'l' : d === SNAKE_COLS ? 'd' : 'u';
}

/** An apple in pixel art, red or golden, in a `size` box at (x, y). */
function apple(g: CanvasRenderingContext2D, x: number, y: number, size: number, golden: boolean) {
  const p = size / 8;
  const colors: Record<string, string> = golden ? { r: GOLD, w: '#fff6c2', b: '#8a5a00', g: '#7dff2a' } : { r: RED, w: '#ffb3b3', b: '#6b3a10', g: '#3ddc5a' };
  if (golden) {
    g.shadowColor = GOLD;
    g.shadowBlur = 12;
  }
  APPLE.forEach((row, ry) => {
    for (let rx = 0; rx < 8; rx++) {
      const c = colors[row[rx]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(x + rx * p, y + ry * p, Math.ceil(p), Math.ceil(p));
    }
  });
  g.shadowBlur = 0;
}

/** The high-score table: place, name, length and score, `width` wide from `x`, a row every `step`, in `size` px. */
function table(g: CanvasRenderingContext2D, scores: readonly SnakeScore[], x: number, width: number, y: number, step: number, size: number, mine?: string) {
  scores.forEach((s, i) => {
    const cy = y + i * step;
    if (s.game === mine) {
      g.fillStyle = 'rgba(198, 255, 61, 0.2)';
      g.fillRect(x - 8, cy - step / 2 + 2, width + 16, step - 4);
    }
    const score = pad(s.score);
    g.font = `900 ${size}px ${FONT}`;
    const scoreW = g.measureText(score).width;
    const lenW = g.measureText('000').width;
    text(g, `${i + 1}.`.padStart(3, ' '), x, cy, size, i === 0 ? GOLD : DIM, 'left');
    const nameX = x + size * 2.4;
    text(g, fit(g, s.name.toUpperCase(), width - size * 2.4 - scoreW - lenW - size * 2, size), nameX, cy, size, s.color, 'left');
    text(g, String(s.length), x + width - scoreW - size, cy, size, DIM, 'right');
    text(g, score, x + width, cy, size, TEXT, 'right');
  });
}

/** 00120: scores in arcade digits. */
function pad(n: number): string {
  return n < 100_000 ? String(n).padStart(5, '0') : scoreText(n);
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign, glow = false) {
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = align;
  g.fillStyle = color;
  if (glow) {
    g.shadowColor = color;
    g.shadowBlur = 14;
  }
  g.fillText(s, x, y);
  g.shadowBlur = 0;
}

/** `s`, cut short with … to fit in `width` at `size` px. */
function fit(g: CanvasRenderingContext2D, s: string, width: number, size: number): string {
  g.font = `900 ${size}px ${FONT}`;
  if (g.measureText(s).width <= width) return s;
  let out = s;
  while (out.length > 1 && g.measureText(`${out}…`).width > width) out = out.slice(0, -1);
  return `${out}…`;
}
