import * as THREE from 'three';
import { CRASH_SCREEN } from '../../shared/casino';
import { BET_TIME, CYCLE, GROWTH, multText, shownMultiplier, timeFor, type CrashOdds, type CrashState } from '../../shared/crash';
import { locale, t } from '../i18n';
import type { Interactable } from './office';
import { mesh, toon } from './toon';

// The Crash screen on the casino's west wall (CRASH_SCREEN): a big canvas everyone down there
// watches. The game never stops: after every crash bets open and it counts down and lists who's in
// (with a "new series" banner at the first round of a series); once the round's off the curve
// climbs with the multiplier in big figures over it, a dot on the curve with the name of everyone who
// cashed out where they did, and when it crashes the curve goes red with where it crashed. Along the
// top, the series' crash points so far, and in the corner which round of the series it is.

const W = 1280;
const H = Math.round((W * CRASH_SCREEN.height) / CRASH_SCREEN.width);
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
/** The graph's box on the canvas, and the player list's to the right of it. */
const G = { x: 96, y: 110, w: 794, h: H - 160 };
const LIST = { x: 930, y: 110, w: W - 960 };

export interface CrashScreen {
  group: THREE.Group;
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  interactable: Interactable;
  /** Where the screen is, for its sounds. */
  where: { x: number; y: number; z: number };
  /** Draws the round `since` ms after the office sent it, with `you`'s row (a peer id) lit up. Cheap enough for every frame while it climbs. */
  draw(s: CrashState, since: number, you: string): void;
}

/** A multiplier's colour: grey near 1, then green, gold, and hot pink for the big ones. */
export function multColor(m: number): string {
  return m < 1.5 ? '#c9c1d6' : m < 2 ? '#7ae582' : m < 10 ? '#ffd166' : '#ff5ca8';
}

/** What a series pays back in the long run, as a percentage: "98.9" (or "98,9" in German). */
export function backText(odds: CrashOdds): string {
  return (odds.back * 100).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Builds it on the casino's wall: the screen, its frame, and somewhere to press E. */
export function addCrashScreen(casino: { group: THREE.Group; interactables: Interactable[] }): CrashScreen {
  const S = CRASH_SCREEN;
  const group = new THREE.Group();
  group.name = 'crash-screen';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  mat.toneMapped = false;
  const screen = mesh(new THREE.PlaneGeometry(S.width, S.height), mat, S.x + 0.06, S.y, S.z, false);
  screen.rotation.y = Math.PI / 2;
  group.add(screen);
  const frame = mesh(new THREE.BoxGeometry(0.08, S.height + 0.22, S.width + 0.22), toon('#15131a'), S.x + 0.01, S.y, S.z, false);
  group.add(frame);
  const trim = new THREE.MeshBasicMaterial({ color: '#ff5ca8' });
  trim.toneMapped = false;
  // A neon strip under it, so it reads as the Crash corner from across the room.
  group.add(mesh(new THREE.BoxGeometry(0.04, 0.05, S.width + 0.22), trim, S.x + 0.06, S.y - S.height / 2 - 0.16, S.z, false));
  const interactable: Interactable = { kind: 'crash', x: S.x + 2.2, z: S.z, radius: 3 };
  // E by crosshair: a box over the screen the ray can land on (the screen's own mesh carries it too).
  const aim = mesh(new THREE.BoxGeometry(0.3, S.height, S.width), new THREE.MeshBasicMaterial({ visible: false }), S.x + 0.2, S.y, S.z, false);
  aim.userData.interact = interactable;
  screen.userData.interact = interactable;
  group.add(aim);
  casino.group.add(group);
  casino.interactables.push(interactable);
  const g = canvas.getContext('2d')!;
  const view: CrashScreen = {
    group,
    mesh: screen,
    canvas,
    interactable,
    where: { x: S.x + 0.5, y: S.y, z: S.z },
    draw(s, since, you) {
      paint(g, s, since, you);
      tex.needsUpdate = true;
    },
  };
  return view;
}

function font(px: number, weight = 900) {
  return `${weight} ${px}px ${FONT}`;
}

/** Sets the font to `px` or smaller so `text` fits in `width`. */
function fit(g: CanvasRenderingContext2D, text: string, px: number, width: number, weight = 900) {
  g.font = font(px, weight);
  const w = g.measureText(text).width;
  if (w > width) g.font = font(Math.max(10, Math.floor((px * width) / w)), weight);
}

function paint(g: CanvasRenderingContext2D, s: CrashState, since: number, you: string) {
  const m = shownMultiplier(s, since);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1b1530');
  bg.addColorStop(1, '#0b0912');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#ff5ca8';
  g.lineWidth = 6;
  g.strokeRect(8, 8, W - 16, H - 16);

  // The title, and the last crash points along the top.
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#ff5ca8';
  g.font = font(54);
  g.fillText(`🚀 ${t('world.crashTitle')}`, 34, 58);
  // Which round of the series, and how high it can go, in the top right corner.
  let end = W - 34;
  if (s.of) {
    const round = t('world.crashRound', { n: s.of, of: CYCLE });
    const cap = t('world.crashUpTo', { m: `${s.odds.max}×` });
    g.textAlign = 'right';
    g.font = font(30);
    g.fillStyle = '#ffd166';
    g.fillText(round, end, 50);
    const rw = g.measureText(round).width;
    g.font = font(18, 800);
    g.fillStyle = '#c9c1d6';
    g.fillText(cap, end, 80);
    end -= Math.max(rw, g.measureText(cap).width) + 24;
  }
  g.font = font(26, 800);
  // Newest first, from just after the title.
  let x = 400;
  g.textAlign = 'left';
  for (const h of s.history) {
    const text = multText(h);
    const w = g.measureText(text).width + 24;
    if (x + w > end) break;
    g.fillStyle = h < 2 ? 'rgba(239, 71, 111, 0.22)' : 'rgba(122, 229, 130, 0.18)';
    g.beginPath();
    g.roundRect(x, 38, w, 40, 20);
    g.fill();
    g.fillStyle = h < 2 ? '#ef476f' : multColor(h);
    g.fillText(text, x + 12, 58);
    x += w + 10;
  }
  if (!s.history.length) {
    g.fillStyle = '#6f6787';
    g.fillText(t('world.crashNoHistory'), 400, 58);
  }

  graph(g, s, m, since);
  players(g, s, you);
}

/** The graph: axes, the curve so far, the cash-outs on it, and the big figure (or the countdown) over it. */
function graph(g: CanvasRenderingContext2D, s: CrashState, m: number, since: number) {
  const crashed = s.phase === 'crashed' && s.crash !== null;
  const ms = crashed ? timeFor(s.crash!) : s.phase === 'running' ? s.elapsed + Math.max(0, since) : 0;
  // The scales grow with the round: at least 10 s and 2×, with room ahead of the rocket.
  const spanT = Math.max(10_000, ms * 1.15);
  const spanM = Math.max(2, 1 + (m - 1) * 1.25);
  const px = (time: number) => G.x + (time / spanT) * G.w;
  const py = (mult: number) => G.y + G.h - ((mult - 1) / (spanM - 1)) * G.h;

  g.fillStyle = 'rgba(255, 255, 255, 0.03)';
  g.fillRect(G.x, G.y, G.w, G.h);
  g.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  g.lineWidth = 2;
  g.font = font(20, 800);
  g.fillStyle = '#6f6787';
  g.textAlign = 'right';
  for (const step of gridSteps(spanM)) {
    const y = py(step);
    g.beginPath();
    g.moveTo(G.x, y);
    g.lineTo(G.x + G.w, y);
    g.stroke();
    g.fillText(multText(step).replace('.00', ''), G.x - 8, y);
  }
  g.textAlign = 'center';
  const secStep = spanT > 40_000 ? 10 : spanT > 20_000 ? 5 : 2;
  for (let sec = secStep; sec * 1000 < spanT; sec += secStep) g.fillText(`${sec}s`, px(sec * 1000), G.y + G.h + 22);

  // The big figure, up on the left where the curve never is (it's drawn over it).
  g.textAlign = 'center';
  const running = s.phase === 'running' || crashed;
  const cx = G.x + (running ? G.w * 0.36 : G.w / 2);
  const cy = G.y + G.h * (running ? 0.24 : 0.38);
  if (s.phase === 'running') {
    g.fillStyle = multColor(m);
    g.font = font(140);
    g.fillText(multText(m), cx, cy);
  } else if (crashed) {
    g.fillStyle = '#ef476f';
    g.font = font(120);
    g.fillText(multText(s.crash!), cx, cy + 10);
    fit(g, t('world.crashCrashed'), 48, G.w * 0.6);
    g.fillText(t('world.crashCrashed'), cx, cy - 80);
  } else if (s.phase === 'betting') {
    const left = Math.max(0, s.left - Math.max(0, since));
    g.fillStyle = '#f4efe1';
    fit(g, t('world.crashStartsIn'), 48, G.w - 40);
    g.fillText(t('world.crashStartsIn'), cx, cy - 50);
    g.fillStyle = '#ffd166';
    g.font = font(130);
    g.fillText(`${(left / 1000).toFixed(1)}s`, cx, cy + 60);
    // The clock as a bar along the graph's bottom.
    g.fillStyle = 'rgba(255, 209, 102, 0.8)';
    g.fillRect(G.x, G.y + G.h - 10, G.w * Math.min(1, left / BET_TIME), 10);
    g.fillStyle = '#c9c1d6';
    fit(g, t('world.crashHowTo'), 30, G.w - 60, 800);
    g.fillText(t('world.crashHowTo'), cx, cy + 160);
    // The first round of a series: its new odds, as a banner over the clock.
    if (s.of === 1) {
      const text = `✨ ${t('world.crashNewSeries', { m: `${s.odds.max}×`, back: backText(s.odds) })}`;
      fit(g, text, 34, G.w - 100);
      const w = g.measureText(text).width + 48;
      g.fillStyle = 'rgba(255, 92, 168, 0.2)';
      g.beginPath();
      g.roundRect(cx - w / 2, G.y + 22, w, 56, 28);
      g.fill();
      g.fillStyle = '#ff5ca8';
      g.fillText(text, cx, G.y + 50);
    }
  }

  if (s.phase === 'running' || crashed) {
    // The curve, filled under, from 1.00× to where it is (or where it crashed).
    const color = crashed ? '#ef476f' : multColor(m);
    g.beginPath();
    g.moveTo(px(0), py(1));
    const steps = 80;
    for (let i = 1; i <= steps; i++) {
      const time = (ms * i) / steps;
      g.lineTo(px(time), py(Math.min(m, Math.exp(GROWTH * time))));
    }
    const endX = px(ms);
    const endY = py(m);
    g.lineTo(endX, py(1));
    g.closePath();
    g.fillStyle = crashed ? 'rgba(239, 71, 111, 0.16)' : 'rgba(255, 209, 102, 0.12)';
    g.fill();
    g.beginPath();
    g.moveTo(px(0), py(1));
    for (let i = 1; i <= steps; i++) {
      const time = (ms * i) / steps;
      g.lineTo(px(time), py(Math.min(m, Math.exp(GROWTH * time))));
    }
    g.strokeStyle = color;
    g.lineWidth = 7;
    g.lineJoin = 'round';
    g.stroke();
    // Everyone who got out, where they did.
    g.font = font(20, 800);
    g.textAlign = 'left';
    const outs = s.players.filter((p) => p.out !== undefined).sort((a, b) => a.out! - b.out!);
    let lastY = Infinity;
    for (const p of outs) {
      const ox = px(timeFor(p.out!));
      const oy = py(p.out!);
      g.fillStyle = p.color ?? '#7ae582';
      g.beginPath();
      g.arc(ox, oy, 9, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#0b0912';
      g.lineWidth = 3;
      g.stroke();
      // Labels up to the right of their dot, stacked so they don't sit on each other; near the
      // graph's right edge, down to the left of it instead (under the curve, clear of the big figure).
      g.fillStyle = '#f4efe1';
      const label = `${clip(p.name, 14)} ${multText(p.out!)}`;
      const right = ox + 12 + g.measureText(label).width < G.x + G.w;
      const ly = right ? Math.min(oy - 18, lastY - 24) : oy + 24;
      if (right) lastY = ly;
      g.textAlign = right ? 'left' : 'right';
      g.fillText(label, right ? ox + 12 : ox - 12, ly);
    }
    // The rocket at the tip (a burst, once it's crashed).
    g.font = font(44);
    g.textAlign = 'center';
    g.fillText(crashed ? '💥' : '🚀', endX, endY - 4);
  }

}

/** Who's in the round: name, bet, and where they got out (or that they didn't). */
function players(g: CanvasRenderingContext2D, s: CrashState, you: string) {
  g.textAlign = 'left';
  g.fillStyle = '#ffd166';
  fit(g, t('world.crashPlayers', { n: s.players.length }), 30, LIST.w);
  g.fillText(t('world.crashPlayers', { n: s.players.length }), LIST.x, LIST.y + 4);
  if (!s.players.length) {
    g.fillStyle = '#6f6787';
    fit(g, t('world.crashNoPlayers'), 24, LIST.w, 800);
    g.fillText(t('world.crashNoPlayers'), LIST.x, LIST.y + 52);
    return;
  }
  const crashed = s.phase === 'crashed';
  const rows = [...s.players].sort((a, b) => (b.won ?? 0) - (a.won ?? 0) || b.bet - a.bet);
  const rowH = 62;
  const fits = Math.floor((H - LIST.y - 80) / rowH);
  rows.slice(0, fits).forEach((p, i) => {
    // Two lines: the name and the bet, then how it went.
    const y = LIST.y + 48 + i * rowH;
    if (p.peer && p.peer === you) {
      g.fillStyle = 'rgba(255, 209, 102, 0.18)';
      g.beginPath();
      g.roundRect(LIST.x - 10, y - 18, LIST.w + 10, rowH - 6, 10);
      g.fill();
    }
    g.fillStyle = p.color ?? '#adb5bd';
    g.beginPath();
    g.arc(LIST.x + 8, y, 8, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'right';
    g.font = font(22, 800);
    g.fillStyle = '#ffd166';
    const bet = p.bet.toLocaleString('en-US');
    g.fillText(bet, LIST.x + LIST.w, y);
    const betW = g.measureText(bet).width;
    g.textAlign = 'left';
    g.fillStyle = '#f4efe1';
    fit(g, p.name, 24, LIST.w - 40 - betW, 800);
    g.fillText(p.name, LIST.x + 24, y);
    g.font = font(19, 800);
    const y2 = y + 24;
    if (p.out !== undefined) {
      g.fillStyle = '#7ae582';
      g.fillText(`${multText(p.out)} · +${(p.won ?? 0).toLocaleString('en-US')}`, LIST.x + 24, y2);
    } else if (crashed) {
      g.fillStyle = '#ef476f';
      g.fillText(t('world.crashLost'), LIST.x + 24, y2);
    } else {
      if (s.phase === 'running') {
        g.fillStyle = '#6f6787';
        g.fillText(t('world.crashStillIn'), LIST.x + 24, y2);
      }
    }
  });
  if (rows.length > fits) {
    g.fillStyle = '#6f6787';
    g.textAlign = 'left';
    g.font = font(20, 800);
    g.fillText(t('world.crashMore', { n: rows.length - fits }), LIST.x, LIST.y + 48 + fits * rowH);
  }
}

/** The lines across the graph for a scale up to `top`×: a handful of round numbers. */
function gridSteps(top: number): number[] {
  const span = top - 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 1 + step; v < top; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}
