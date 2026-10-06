import { t } from '../i18n';
import { ENTER_MS, ROW_MS, fallMs, multText, multipliers, type PlinkoBall, type PlinkoLanding, type PlinkoRisk } from '../../shared/plinko';

// Drawing a Plinko board on a canvas: the triangle of pegs, the row of slots along the bottom with
// their multipliers, and the balls falling through it along the paths the office picked. The
// machine's big screen in the casino (everyone's balls) and the panel (your own) both draw it. A
// ball's place is worked out from how long ago it was dropped, so every page shows it in the same
// spot and it lands as the office pays.

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

/** How long a landed ball stays in its slot before it's gone (ms). */
export const LINGER_MS = 500;

/** A ball being shown, and when it was dropped (performance.now()). */
export interface ShownBall {
  ball: PlinkoBall;
  start: number;
}

/** Where a ball is `ms` after its drop: x in peg spacings from the board's middle, y in rows (row r's pegs at y = r), and whether it's in its slot. */
export function ballAt(ball: { rows: number; path: readonly number[] }, ms: number): { x: number; y: number; landed: boolean } {
  const n = ball.rows;
  // Resting on a peg, the ball's middle is this far over it.
  const sit = 0.3;
  if (ms < ENTER_MS) {
    const u = Math.max(0, ms) / ENTER_MS;
    return { x: 0, y: -1.3 + u * u * (1.3 - sit), landed: false };
  }
  if (ms >= fallMs(n)) {
    const rights = ball.path.reduce<number>((k, b) => k + b, 0);
    return { x: rights - n / 2, y: n - sit, landed: true };
  }
  const t = (ms - ENTER_MS) / ROW_MS;
  const r = Math.min(n - 1, Math.floor(t));
  const u = t - r;
  let k = 0;
  for (let i = 0; i < r; i++) k += ball.path[i];
  const dir = ball.path[r] ? 1 : -1;
  // A little hop off the peg and down to the next row: y(0) on row r, y(1) on row r + 1.
  return { x: k - r / 2 + dir * 0.5 * u, y: r - sit - 0.4 * u + 1.4 * u * u, landed: false };
}

/** How many rows of pegs a ball has hit `ms` after its drop (0 to rows): one more is a tick. */
export function pegsHit(rows: number, ms: number): number {
  return ms < ENTER_MS ? 0 : Math.min(rows, Math.floor((ms - ENTER_MS) / ROW_MS) + 1);
}

/** A slot's colour: hot red at the edges, through orange, to yellow in the middle. */
export function slotColor(slot: number, rows: number): string {
  const off = Math.abs(slot - rows / 2) / (rows / 2);
  return `hsl(${Math.round(52 - off * 50)}, 92%, ${Math.round(58 - off * 6)}%)`;
}

/** A multiplier's colour on its own (the strip of landings): grey under 1×, then gold, orange and red for the big ones. */
export function multColor(m: number): string {
  return m < 1 ? '#a69fb3' : m < 2 ? '#ffd166' : m < 10 ? '#ff9f43' : '#ff4d6d';
}

export interface BoardDraw {
  rows: number;
  risk: PlinkoRisk;
  /** The balls to show on it (only ones for this board), and now (performance.now()). */
  balls: readonly ShownBall[];
  now: number;
  /** Your page's peer id: your balls are ringed in white. */
  you: string;
}

/**
 * Draws the board into `box` on `g` (a background's already there): the pegs, the slots with their
 * multipliers (a slot a ball's just landed in bounces and glows), and the balls.
 */
export function drawBoard(g: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, d: BoardDraw) {
  const n = d.rows;
  const table = multipliers(n, d.risk);
  // The peg spacing across (the bottom row's n + 2 pegs fill the width) and down (n rows plus the
  // drop and the slots fill the height), never more than half as much again one way as the other.
  const sx = Math.min(box.w / (n + 1.4), (box.h / (n + 1.6)) * 1.5);
  const sy = Math.min(box.h / (n + 1.6), sx * 1.5);
  const s = Math.min(sx, sy);
  const cx = box.x + box.w / 2;
  const top = box.y + (box.h - (n + 1.2) * sy) / 2 + sy * 0.9;
  const px = (x: number) => cx + x * sx;
  const py = (y: number) => top + y * sy;

  // Which slots something landed in a moment ago, and how long ago (for the bounce).
  const hit = new Map<number, number>();
  for (const b of d.balls) {
    const ago = d.now - b.start - fallMs(n);
    if (ago >= 0 && ago < 400) hit.set(b.ball.slot, Math.min(hit.get(b.ball.slot) ?? Infinity, ago));
  }

  // The pegs: row r has r + 3, the first row's middle one under the drop.
  g.fillStyle = '#f2ecff';
  const pegR = Math.max(1.5, s * 0.1);
  for (let r = 0; r < n; r++) {
    for (let j = 0; j < r + 3; j++) {
      g.beginPath();
      g.arc(px(j - (r + 2) / 2), py(r), pegR, 0, Math.PI * 2);
      g.fill();
    }
  }

  // The slots, between the bottom row's pegs.
  const slotW = sx * 0.9;
  const slotH = Math.max(10, Math.min(sy * 0.75, sx * 0.7));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let k = 0; k <= n; k++) {
    const ago = hit.get(k);
    const dip = ago !== undefined ? Math.sin((ago / 400) * Math.PI) * slotH * 0.25 : 0;
    const x = px(k - n / 2) - slotW / 2;
    const y = py(n - 1) + sy * 0.5 + dip;
    g.fillStyle = slotColor(k, n);
    if (ago !== undefined) {
      g.shadowColor = slotColor(k, n);
      g.shadowBlur = s * 0.6;
    }
    roundRect(g, x, y, slotW, slotH, Math.min(6, slotH * 0.25));
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#2a1206';
    const text = String(table[k]);
    g.font = `900 ${Math.floor(slotH * 0.5)}px ${FONT}`;
    const w = g.measureText(text).width;
    if (w > slotW * 0.92) g.font = `900 ${Math.floor((slotH * 0.5 * slotW * 0.92) / w)}px ${FONT}`;
    g.fillText(text, x + slotW / 2, y + slotH / 2 + 1);
  }

  // The balls, oldest first so new ones are on top; a landed one fades out in its slot.
  const ballR = Math.max(3, s * 0.22);
  for (const b of d.balls) {
    const ms = d.now - b.start;
    const at = ballAt(b.ball, ms);
    const fade = at.landed ? Math.max(0, 1 - (ms - fallMs(n)) / LINGER_MS) : 1;
    if (fade <= 0) continue;
    g.globalAlpha = fade;
    g.beginPath();
    g.arc(px(at.x), py(at.y), ballR, 0, Math.PI * 2);
    g.fillStyle = b.ball.color ?? '#ff5ca8';
    g.fill();
    if (b.ball.peer === d.you) {
      g.lineWidth = Math.max(1.5, ballR * 0.35);
      g.strokeStyle = '#ffffff';
      g.stroke();
    }
    g.globalAlpha = 1;
  }
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

/** A pill for a landing in a strip of the last ones: its multiplier in its colour. Says how wide it was. */
export function drawLanding(g: CanvasRenderingContext2D, l: PlinkoLanding, x: number, y: number, h: number): number {
  const text = multText(l.m);
  g.font = `900 ${Math.floor(h * 0.6)}px ${FONT}`;
  const w = g.measureText(text).width + h * 0.7;
  g.fillStyle = multColor(l.m);
  roundRect(g, x, y, w, h, h / 2);
  g.fill();
  g.fillStyle = '#1a0d14';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + w / 2, y + h / 2 + 1);
  return w;
}

export interface ScreenDraw extends BoardDraw {
  /** The last balls that landed, newest first. */
  recent: readonly PlinkoLanding[];
}

/**
 * The machine's big screen: PLINKO and the board it's showing (rows and risk) along the top, the
 * last landings under it, and the board with everyone's balls on it.
 */
export function drawScreen(canvas: HTMLCanvasElement, d: ScreenDraw) {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1c0f2e');
  bg.addColorStop(1, '#0b0714');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#ff5ca8';
  g.shadowColor = '#ff5ca8';
  g.shadowBlur = 18;
  g.font = `900 64px ${FONT}`;
  g.fillText('PLINKO', 36, 58);
  g.shadowBlur = 0;
  g.textAlign = 'right';
  g.fillStyle = '#e9e2f5';
  g.font = `800 34px ${FONT}`;
  g.fillText(t('world.plinkoBoard', { rows: d.rows, risk: t(`world.plinkoRisk_${d.risk}`) }), W - 36, 58);
  // The strip of the last landings, newest on the left, as many as fit.
  let x = 36;
  const y = 104;
  if (!d.recent.length) {
    g.textAlign = 'left';
    g.fillStyle = '#8c84a0';
    g.font = `700 30px ${FONT}`;
    g.fillText(t('world.plinkoHowTo'), x, y + 22);
  }
  for (const l of d.recent) {
    if (x > W - 150) break;
    x += drawLanding(g, l, x, y, 44) + 10;
  }
  drawBoard(g, { x: 30, y: 160, w: W - 60, h: H - 180 }, d);
}
