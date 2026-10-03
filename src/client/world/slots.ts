import * as THREE from 'three';
import { LINES, REEL_STOP, REELS, SYMBOL_GLYPH, symbolAt, type SlotSpin, type SlotSymbol, type SlotsState } from '../../shared/slots';
import type { SlotMachineView } from './casino';

// The reels on the slot machines' screens, for everyone in the casino: a new spin from the office sets
// a machine's reels going, and they stop one after the other where it says, left to right; then the
// lines that paid light up, with what it won, and the topper flashes. Each screen is the machine's own
// canvas (see world/casino.ts), drawn again only while something on it moves.

/** The screen's canvas, in pixels (as the casino made it). */
const W = 384;
const H = 256;
/** The strip across the top, with the jackpot on it. */
const TOP = 34;
/** A reel's width and a symbol's height. */
const REEL_W = 116;
const GAP = 6;
const ROW_H = (H - TOP - 10) / 3;
const REEL_X = (r: number) => (W - 3 * REEL_W - 2 * GAP) / 2 + r * (REEL_W + GAP);
/** How fast a reel goes round at full spin (symbols a second). */
const SPEED = 22;
/** How long a win stays lit after the reels have stopped (ms): longer for the jackpot. */
const WIN_SHOW = 4000;
const JACKPOT_SHOW = 12000;
/** How long the lever takes to go down and come back up (s). */
const LEVER_TIME = 0.45;
/** The pay lines' colours, in the order of LINES. */
const LINE_COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff'];

const SYMBOL_COLOR: Record<SlotSymbol, string> = {
  cherry: '#d62839',
  lemon: '#e9c46a',
  orange: '#f4a261',
  bell: '#e9b949',
  bar: '#111111',
  seven: '#d62839',
  star: '#ffb703',
};

/** One machine's reels: where each one is (a whole number at rest, the middle row's index), and the spin they're doing. */
interface Reels {
  view: SlotMachineView;
  pos: number[];
  /** The spin under way: when it started (performance.now()), where each reel set off from and how far it goes. */
  spin: SlotSpin | null;
  startAt: number;
  from: number[];
  travel: number[];
  /** Which reels have stopped (for the clunk as each one does). */
  stopped: boolean[];
  /** The spin's over and what it won is lit, until `litUntil`. */
  lit: SlotSpin | null;
  litUntil: number;
  /** The last spin number seen, to know a new one. */
  n: number;
  /** When the lever was pulled (s, performance.now()/1000), or -Infinity. */
  leverAt: number;
  dirty: boolean;
}

export class SlotScreens {
  private readonly reels: Reels[];
  private jackpot = 0;
  /** A reel stopped (`reel` 0–2) on machine `machine`. */
  onStop: ((machine: number, reel: number) => void) | null = null;
  /** Machine `machine`'s reels have all stopped: here's what it won. */
  onResult: ((machine: number, spin: SlotSpin) => void) | null = null;
  /** Machine `machine`'s lever was pulled (or its button pressed). */
  onPull: ((machine: number) => void) | null = null;

  constructor(views: readonly SlotMachineView[]) {
    this.reels = views.map((view, i) => ({
      view,
      // Each machine at rest on a different line to start with.
      pos: [i * 4 + 1, i * 4 + 5, i * 4 + 9],
      spin: null,
      startAt: 0,
      from: [0, 0, 0],
      travel: [0, 0, 0],
      stopped: [true, true, true],
      lit: null,
      litUntil: 0,
      n: 0,
      leverAt: -Infinity,
      dirty: true,
    }));
  }

  /** Whether machine `i`'s reels are still going. */
  spinning(i: number): boolean {
    return !!this.reels[i]?.spin;
  }

  /**
   * The office's latest on the machines: any with a new spin set their reels going. `fresh` (you just
   * came down to the casino, or came back) puts every machine straight where it is, with nothing spinning.
   */
  follow(state: SlotsState, fresh: boolean) {
    if (state.jackpot !== this.jackpot) {
      this.jackpot = state.jackpot;
      for (const m of this.reels) m.dirty = true;
    }
    state.machines.forEach((m, i) => {
      const r = this.reels[i];
      const s = m.spin;
      if (!r || !s || s.n === r.n) return;
      r.n = s.n;
      if (fresh) {
        r.pos = [...s.stops];
        r.spin = null;
        r.lit = null;
        r.dirty = true;
        return;
      }
      this.start(r, s);
      this.onPull?.(i);
    });
  }

  private start(r: Reels, s: SlotSpin) {
    const now = performance.now();
    r.spin = s;
    r.startAt = now;
    r.lit = null;
    r.view.setWin(false);
    r.leverAt = now / 1000;
    r.stopped = [false, false, false];
    r.from = r.pos.map((p) => p);
    // Round to the stop it ends on, going forward: whole turns' worth for as long as the reel spins.
    r.travel = REELS.map((reel, k) => {
      const n = reel.length;
      const at = ((Math.round(r.from[k]) % n) + n) % n;
      const ahead = (((s.stops[k] - at) % n) + n) % n;
      const turns = Math.floor((SPEED * REEL_STOP[k]) / 1000 / n);
      return turns * n + ahead + (Math.round(r.from[k]) - r.from[k]);
    });
  }

  /** Every frame: the reels that are going, the levers, and the lit wins. */
  update() {
    const now = performance.now();
    this.reels.forEach((r, i) => {
      // The lever goes down and comes back up.
      const lt = now / 1000 - r.leverAt;
      r.view.lever.rotation.x = lt >= 0 && lt < LEVER_TIME ? 1.1 * Math.sin((lt / LEVER_TIME) * Math.PI) : 0;
      if (r.spin) {
        const s = r.spin;
        const t = now - r.startAt;
        for (let k = 0; k < 3; k++) {
          const u = Math.min(1, t / REEL_STOP[k]);
          // Up to speed at once, then slowing into the stop with a little kick back past it.
          r.pos[k] = r.from[k] + r.travel[k] * settle(u);
          if (u >= 1 && !r.stopped[k]) {
            r.stopped[k] = true;
            r.pos[k] = s.stops[k];
            this.onStop?.(i, k);
          }
        }
        r.dirty = true;
        if (r.stopped.every(Boolean)) {
          r.spin = null;
          if (s.win > 0) {
            r.lit = s;
            r.litUntil = now + (s.jackpot ? JACKPOT_SHOW : WIN_SHOW);
            r.view.setWin(true);
          }
          this.onResult?.(i, s);
        }
      } else if (r.lit && now > r.litUntil) {
        r.lit = null;
        r.view.setWin(false);
        r.dirty = true;
      } else if (r.lit) r.dirty = true;
      if (r.dirty) this.draw(r, now);
    });
  }

  private draw(r: Reels, now: number) {
    r.dirty = false;
    const c = r.view.screenCanvas.getContext('2d');
    if (!c) return;
    c.save();
    c.fillStyle = '#120a1f';
    c.fillRect(0, 0, W, H);
    // The jackpot along the top.
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '900 22px Nunito, ui-rounded, system-ui, sans-serif';
    c.fillStyle = '#ffd166';
    c.fillText(`⭐ JACKPOT ${this.jackpot.toLocaleString()} ⭐`, W / 2, TOP / 2 + 1);
    for (let k = 0; k < 3; k++) {
      const x = REEL_X(k);
      const grad = c.createLinearGradient(0, TOP, 0, H - 6);
      grad.addColorStop(0, '#b8b2c4');
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(1, '#b8b2c4');
      c.fillStyle = grad;
      c.fillRect(x, TOP, REEL_W, H - TOP - 6);
      c.save();
      c.beginPath();
      c.rect(x, TOP, REEL_W, H - TOP - 6);
      c.clip();
      const p = r.pos[k];
      const base = Math.floor(p);
      const frac = p - base;
      const blur = !!r.spin && !r.stopped[k];
      // The row in the middle is `p`: going forward, the symbols move down the screen.
      for (let d = -2; d <= 2; d++) {
        const sym = symbolAt(k, base + d);
        const y = TOP + ROW_H * (1.5 + d - frac);
        drawSymbol(c, sym, x + REEL_W / 2, y, blur);
      }
      c.restore();
    }
    // The lines that paid, in their colours, and what it won.
    const lit = r.lit;
    if (lit) {
      const blink = Math.floor(now / 250) % 2 === 0;
      for (const l of lit.lines) {
        c.strokeStyle = LINE_COLORS[l.line % LINE_COLORS.length];
        c.lineWidth = 5;
        c.globalAlpha = blink || !l.jackpot ? 0.9 : 0.4;
        c.beginPath();
        LINES[l.line].forEach((row, k) => {
          const x = REEL_X(k) + REEL_W / 2;
          const y = TOP + ROW_H * (row + 0.5);
          if (k === 0) c.moveTo(x - REEL_W / 2, y);
          c.lineTo(x, y);
          if (k === 2) c.lineTo(x + REEL_W / 2, y);
        });
        c.stroke();
      }
      c.globalAlpha = 1;
      const text = lit.jackpot ? `JACKPOT! +${lit.win.toLocaleString()}` : `WIN +${lit.win.toLocaleString()}`;
      c.font = `900 ${lit.jackpot ? 40 : 34}px Nunito, ui-rounded, system-ui, sans-serif`;
      c.lineWidth = 7;
      c.strokeStyle = '#2b2d42';
      c.fillStyle = lit.jackpot ? (blink ? '#ffd166' : '#ff4d6d') : '#ffffff';
      c.strokeText(text, W / 2, TOP + ROW_H * 1.5);
      c.fillText(text, W / 2, TOP + ROW_H * 1.5);
    } else {
      // The middle line, faint, to show where it pays.
      c.strokeStyle = 'rgba(255, 77, 109, 0.55)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(4, TOP + ROW_H * 1.5);
      c.lineTo(W - 4, TOP + ROW_H * 1.5);
      c.stroke();
    }
    c.restore();
    const map = r.view.screen.material.map;
    if (map) map.needsUpdate = true;
  }

  /** Where machine `i` is in the world (for its sounds). */
  at(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.reels[i].view.group.getWorldPosition(out);
  }
}

/** How far through its travel a reel is at `u` (0–1) of its time: fast at once, easing into the stop with a little kick past it. */
export function settle(u: number): number {
  if (u >= 1) return 1;
  if (u <= 0) return 0;
  // Steady at full speed for the first part (`a` of it), then an ease-out that overshoots a hair and
  // comes back (`back`), at the same speed where the two meet.
  const a = 0.6;
  const back = 0.8;
  const speed = (back + 3) / (1 - a + a * (back + 3));
  if (u < a) return speed * u;
  const e = 1 - (u - a) / (1 - a);
  return speed * a + (1 - speed * a) * (1 - (back + 1) * e * e * e + back * e * e);
}

function drawSymbol(c: CanvasRenderingContext2D, sym: SlotSymbol, x: number, y: number, blur: boolean) {
  c.globalAlpha = blur ? 0.55 : 1;
  const glyph = SYMBOL_GLYPH[sym];
  if (sym === 'bar') {
    c.fillStyle = '#111111';
    c.fillRect(x - 40, y - 15, 80, 30);
    c.fillStyle = '#ffffff';
    c.font = '900 24px Nunito, ui-rounded, system-ui, sans-serif';
    c.fillText(glyph, x, y + 1);
  } else if (sym === 'seven') {
    c.font = '900 64px Nunito, ui-rounded, system-ui, sans-serif';
    c.lineWidth = 4;
    c.strokeStyle = '#2b2d42';
    c.strokeText(glyph, x, y + 2);
    c.fillStyle = SYMBOL_COLOR[sym];
    c.fillText(glyph, x, y + 2);
  } else {
    c.font = '900 48px Nunito, ui-rounded, system-ui, sans-serif';
    c.fillStyle = SYMBOL_COLOR[sym];
    c.fillText(glyph, x, y + 2);
  }
  c.globalAlpha = 1;
}
