import type * as THREE from 'three';
import { CHECKPOINTS, COURSE, COURSE_AREA, GOAL, atFlag, checkpointPiece, crossesStart, formatTime, pieceUnder, pieceX, type JumpRunScore } from '../shared/jumprun';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import type { PlayerController } from './player';
import type { OfficeSound } from './sound';
import type { Collider } from './world/office';
import { buildJumpRun, type JumpRunWorld } from './world/jumprun';
import { toast } from './ui/dom';
import { t } from './i18n';

/** How far from a piece's edge your middle can be and still stand on it (the player's radius). */
const REACH = 0.32;
/** Walk this far from the course with a run on and it's off. */
const WANDER = 14;

/** Where you are this frame, as the run sees it. */
export interface RunInput {
  x: number;
  y: number;
  z: number;
  /** How far down the street is from the floor you're on (player.street). */
  street: number;
  grounded: boolean;
  /** The course's clock (s), for where the moving platforms are. */
  t: number;
  /** Down on an office floor's street, on your feet, not riding anywhere. */
  here: boolean;
}

export type RunEvent =
  | { e: 'start' }
  | { e: 'checkpoint'; n: number }
  /** Fell off after checkpoint `n`: back up on it, at `to`. */
  | { e: 'back'; n: number; to: { x: number; y: number; z: number } }
  /** Fell off before the first checkpoint: the run's over. */
  | { e: 'fell' }
  | { e: 'finish' }
  /** Walked away or left: the run's off. */
  | { e: 'quit' };

/**
 * Your run on the course, frame by frame: crossing the start line starts it, landing on the next
 * checkpoint saves your place, falling to the street after that puts you back on it (before it, the
 * run's over), and reaching the flag with every checkpoint behind you finishes it.
 */
export class RunTracker {
  running = false;
  /** Checkpoints reached on this run. */
  reached = 0;
  /** You've stood on a piece of the course since the start (or since being put back): the street under it now means you fell. */
  private onCourse = false;
  private lastZ: number | null = null;

  step(i: RunInput): RunEvent[] {
    const out: RunEvent[] = [];
    const lastZ = this.lastZ;
    this.lastZ = i.here ? i.z : null;
    if (!i.here) {
      if (this.running) out.push(this.stop('quit'));
      return out;
    }
    if (lastZ !== null && i.y < i.street + 0.6 && crossesStart(i.x, lastZ, i.z)) {
      this.running = true;
      this.reached = 0;
      this.onCourse = false;
      out.push({ e: 'start' });
      return out;
    }
    if (!this.running) return out;
    const a = COURSE_AREA;
    if (i.x < a.minX - WANDER || i.x > a.maxX + WANDER || i.z < a.minZ - WANDER || i.z > a.maxZ + WANDER) {
      out.push(this.stop('quit'));
      return out;
    }
    if (!i.grounded) return out;
    const k = pieceUnder(i.x, i.z, REACH, i.t);
    const p = COURSE[k];
    if (p && Math.abs(i.y - (i.street + p.h)) < 0.1) {
      this.onCourse = true;
      if (p.checkpoint === this.reached + 1) {
        this.reached = p.checkpoint;
        out.push({ e: 'checkpoint', n: p.checkpoint });
      }
      if (p === GOAL && this.reached === CHECKPOINTS && atFlag(i.x, i.z)) out.push(this.stop('finish'));
      return out;
    }
    if (this.onCourse && i.y <= i.street + 0.05) {
      const back = checkpointPiece(this.reached);
      if (!back) return [this.stop('fell')];
      out.push({ e: 'back', n: this.reached, to: { x: back.x, y: i.street + back.h, z: back.z } });
    }
    return out;
  }

  private stop(e: 'quit' | 'fell' | 'finish'): RunEvent {
    this.running = false;
    this.onCourse = false;
    return { e };
  }
}

/** Puts the course's colliders down on the street `street` below the floor you're on (its group goes down with the office's ground). */
export function setStreet(world: JumpRunWorld, street: number) {
  for (const c of world.colliders) {
    c.c.top = street + c.top;
    c.c.bottom = street + c.bottom;
  }
}

/** Slides the moving platforms to where they are at `time` (s), carrying `player` along if they're standing on one. */
export function stepMovers(world: JumpRunWorld, player: Pick<PlayerController, 'pos' | 'grounded'>, time: number, here = true) {
  for (const m of world.movers) {
    const p = COURSE[m.piece];
    const x = pieceX(p, time);
    const c = m.collider.c;
    const dx = x - (c.minX + p.w / 2);
    const riding =
      here &&
      player.grounded &&
      Math.abs(player.pos.y - c.top) < 0.06 &&
      player.pos.x > c.minX - REACH &&
      player.pos.x < c.maxX + REACH &&
      player.pos.z > c.minZ - REACH &&
      player.pos.z < c.maxZ + REACH;
    c.minX += dx;
    c.maxX += dx;
    m.mesh.position.x = x;
    if (riding) player.pos.x += dx;
  }
}

/** The board's canvas: the best times, quickest first. */
export function drawBoard(canvas: HTMLCanvasElement, board: JumpRunScore[]) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width;
  const H = canvas.height;
  g.fillStyle = '#2b2d42';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#ffd166';
  g.lineWidth = 8;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = '#ffd166';
  g.font = '800 38px Nunito, ui-rounded, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(t('jumprun.boardTitle'), W / 2, 52);
  g.font = '700 30px Nunito, ui-rounded, system-ui, sans-serif';
  if (!board.length) {
    g.fillStyle = '#fffaf3';
    g.fillText(t('jumprun.boardEmpty'), W / 2, H / 2 + 20);
    return;
  }
  const rowH = (H - 110) / 10;
  board.slice(0, 10).forEach((s, i) => {
    const y = 100 + rowH * i + rowH / 2;
    g.textAlign = 'left';
    g.fillStyle = i === 0 ? '#ffd166' : '#adb5bd';
    g.fillText(`${i + 1}.`, 36, y);
    g.fillStyle = s.color;
    const name = s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name;
    g.fillText(name, 96, y);
    g.textAlign = 'right';
    g.fillStyle = '#fffaf3';
    g.fillText(formatTime(s.ms), W - 36, y);
  });
}

export interface JumpRunDeps {
  net: { send(msg: ClientMsg): void; onMessage(h: (msg: ServerMsg) => void): void };
  player: PlayerController;
  /** The office's ground group (which goes down the higher your floor is) and its colliders. */
  ground: THREE.Group;
  colliders: Collider[];
  sound: OfficeSound;
  /** Your name, to tell your own record from someone else's. */
  me: () => string;
}

/**
 * The jump & run down on the street: the course in the office's ground, its moving platforms (which
 * carry you along), the clock on screen while you run, and the board at the start (kept by the
 * office, see server/jumprun.ts).
 */
export class JumpRunGame {
  readonly world: JumpRunWorld;
  readonly run = new RunTracker();
  private street = NaN;
  private startedAt = 0;
  private clock: HTMLElement | null = null;
  private waiting = false;
  private flagT = 0;

  constructor(private readonly deps: JumpRunDeps) {
    this.world = buildJumpRun();
    deps.ground.add(this.world.group);
    for (const c of this.world.colliders) deps.colliders.push(c.c);
    drawBoard(this.world.boardCanvas, []);
    this.world.boardTexture.needsUpdate = true;
    deps.net.onMessage((msg) => this.onMessage(msg));
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome':
        this.deps.net.send({ t: 'jumprun.board' });
        break;
      case 'jumprun':
        drawBoard(this.world.boardCanvas, msg.board);
        this.world.boardTexture.needsUpdate = true;
        if (msg.record && !(this.waiting && msg.record.name === this.deps.me())) toast(t('jumprun.record', { name: msg.record.name, time: formatTime(msg.record.ms) }));
        break;
      case 'jumprun.done': {
        this.waiting = false;
        const time = formatTime(msg.ms);
        const key = msg.rank === 1 && msg.best ? 'jumprun.doneFirst' : msg.rank !== null && msg.best ? 'jumprun.doneBest' : msg.rank !== null ? 'jumprun.doneRank' : 'jumprun.done';
        toast(t(key, { time, rank: msg.rank ?? 0 }));
        break;
      }
      case 'jumprun.void':
        this.waiting = false;
        toast(t('jumprun.void'), 'warn');
        break;
    }
  }

  /** The course's clock (s): the same for everyone, so the moving platforms are where others see them. */
  private now(): number {
    return Date.now() / 1000;
  }

  /** A frame, after you've moved: `here` when you're on an office floor, on your feet and not riding anywhere. */
  update(dt: number, here: boolean) {
    const { player } = this.deps;
    const time = this.now();
    if (player.street !== this.street) {
      this.street = player.street;
      setStreet(this.world, this.street);
    }
    stepMovers(this.world, player, time, here);
    this.flagT += dt;
    this.world.flag.rotation.y = Math.sin(this.flagT * 2.2) * 0.25;

    for (const ev of this.run.step({ x: player.pos.x, y: player.pos.y, z: player.pos.z, street: this.street, grounded: player.grounded, t: time, here })) this.on(ev);
    this.showClock();
  }

  private on(ev: RunEvent) {
    const { net, sound, player } = this.deps;
    switch (ev.e) {
      case 'start':
        this.startedAt = performance.now();
        this.waiting = false;
        net.send({ t: 'jumprun.start' });
        sound.snake('turn');
        break;
      case 'checkpoint':
        net.send({ t: 'jumprun.checkpoint', n: ev.n });
        sound.snake('eat');
        toast(t('jumprun.checkpoint', { n: ev.n, of: CHECKPOINTS }));
        break;
      case 'back':
        player.pos.set(ev.to.x, ev.to.y, ev.to.z);
        player.vy = 0;
        toast(t('jumprun.back', { n: ev.n }));
        break;
      case 'fell':
        net.send({ t: 'jumprun.quit' });
        sound.snake('crash');
        toast(t('jumprun.fell'), 'warn');
        break;
      case 'finish':
        this.waiting = true;
        net.send({ t: 'jumprun.finish' });
        sound.snake('record');
        break;
      case 'quit':
        net.send({ t: 'jumprun.quit' });
        break;
    }
    this.world.checkpoints.forEach((m, i) =>
      (m.material as THREE.MeshToonMaterial).color.copy(this.run.running && i < this.run.reached ? this.world.checkpointColor.on : this.world.checkpointColor.off),
    );
  }

  /** The clock at the top of the screen while you run. */
  private showClock() {
    if (!this.run.running) {
      this.clock?.remove();
      this.clock = null;
      return;
    }
    if (!this.clock) {
      const el = document.createElement('div');
      el.className = 'jumprun-clock';
      Object.assign(el.style, {
        position: 'fixed',
        top: '14px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 16px',
        borderRadius: '999px',
        background: 'rgba(43,45,66,0.85)',
        color: '#ffd166',
        font: '800 20px Nunito, ui-rounded, system-ui, sans-serif',
        fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none',
        zIndex: '20',
      });
      document.body.append(el);
      this.clock = el;
    }
    const time = formatTime(performance.now() - this.startedAt);
    this.clock.textContent = this.run.reached ? t('jumprun.clockCheckpoint', { time, n: this.run.reached, of: CHECKPOINTS }) : t('jumprun.clock', { time });
  }
}
