import { t } from '../i18n';
import { HISTORY, TICK_MS, changeOf, liquidationPrice, pctText, priceText, trendOf, type MarketClose, type MarketPosition, type MarketState, type Trend } from '../../shared/market';

// Drawing the trading desk's chart on a canvas: the price line over the last few minutes in the
// colour of the trend (green going up, red going down, grey sideways), the price now, and the
// change over the chart. The big screen on the casino's east wall (with how many are long and short,
// and the latest closes with their names) and the panel (with your own positions' entries and
// liquidation prices) both draw it.

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

/** A trend's colour on the chart. */
export function trendColor(trend: Trend): string {
  return trend === 'up' ? '#3ddc84' : trend === 'down' ? '#ff4d6d' : '#c9c1d6';
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The chart in `box`: a grid with prices down the right, the line with a soft fill under it, and a
 * dot on the price now. Your positions (if given) are lines across it at their entries (green Long,
 * red Short) and dashed at their liquidation prices, when those are on the chart.
 */
export function drawChart(g: CanvasRenderingContext2D, box: Box, history: readonly number[], opts: { positions?: readonly MarketPosition[]; scale?: number } = {}) {
  const k = opts.scale ?? 1;
  const pts = history.length ? history : [0];
  let lo = Math.min(...pts);
  let hi = Math.max(...pts);
  for (const p of opts.positions ?? []) {
    lo = Math.min(lo, p.entry);
    hi = Math.max(hi, p.entry);
  }
  // At least ±0.5 % of room, and a margin, so a quiet chart isn't all noise.
  const mid = (lo + hi) / 2;
  const span = Math.max(hi - lo, mid * 0.01) * 1.15;
  lo = mid - span / 2;
  hi = mid + span / 2;
  const labelW = 92 * k;
  const plot = { x: box.x, y: box.y, w: box.w - labelW, h: box.h };
  const yOf = (p: number) => plot.y + plot.h - ((p - lo) / (hi - lo)) * plot.h;
  const xOf = (i: number) => plot.x + (i / Math.max(1, HISTORY - 1)) * plot.w + (HISTORY - pts.length) * (plot.w / Math.max(1, HISTORY - 1));

  // The grid, and the prices along the right.
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1 * k;
  g.fillStyle = '#8c84a0';
  g.font = `700 ${18 * k}px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const p = lo + ((hi - lo) * i) / 4;
    const y = yOf(p);
    g.beginPath();
    g.moveTo(plot.x, y);
    g.lineTo(plot.x + plot.w, y);
    g.stroke();
    g.fillText(priceText(p), plot.x + plot.w + 10 * k, y);
  }
  // A minute a line, down the chart.
  for (let s = 60; s < (HISTORY * TICK_MS) / 1000; s += 60) {
    const x = plot.x + plot.w - (s / ((HISTORY * TICK_MS) / 1000)) * plot.w;
    g.beginPath();
    g.moveTo(x, plot.y);
    g.lineTo(x, plot.y + plot.h);
    g.stroke();
  }

  // Your positions: where each came in, and where it's liquidated.
  for (const p of opts.positions ?? []) {
    const color = p.side === 'long' ? '#3ddc84' : '#ff4d6d';
    g.strokeStyle = color;
    g.globalAlpha = 0.8;
    g.lineWidth = 2 * k;
    g.setLineDash([]);
    const y = yOf(p.entry);
    g.beginPath();
    g.moveTo(plot.x, y);
    g.lineTo(plot.x + plot.w, y);
    g.stroke();
    const liq = liquidationPrice(p);
    if (liq > lo && liq < hi) {
      g.setLineDash([8 * k, 6 * k]);
      g.strokeStyle = '#ffb347';
      g.beginPath();
      g.moveTo(plot.x, yOf(liq));
      g.lineTo(plot.x + plot.w, yOf(liq));
      g.stroke();
      g.setLineDash([]);
    }
    g.globalAlpha = 1;
  }

  if (history.length < 2) return;
  const color = trendColor(trendOf(history));
  // The fill under the line, fading down.
  const fill = g.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
  fill.addColorStop(0, `${color}55`);
  fill.addColorStop(1, `${color}00`);
  g.beginPath();
  g.moveTo(xOf(0), plot.y + plot.h);
  history.forEach((p, i) => g.lineTo(xOf(i), yOf(p)));
  g.lineTo(xOf(history.length - 1), plot.y + plot.h);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.beginPath();
  history.forEach((p, i) => (i ? g.lineTo(xOf(i), yOf(p)) : g.moveTo(xOf(i), yOf(p))));
  g.strokeStyle = color;
  g.lineWidth = 3 * k;
  g.lineJoin = 'round';
  g.stroke();
  // The price now: a dot, and a line out to its label.
  const last = history[history.length - 1];
  const x = xOf(history.length - 1);
  const y = yOf(last);
  g.setLineDash([4 * k, 4 * k]);
  g.lineWidth = 1 * k;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(plot.x + plot.w + 6 * k, y);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, 6 * k, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.fillRect(plot.x + plot.w + 4 * k, y - 13 * k, labelW - 4 * k, 26 * k);
  g.fillStyle = '#0b0912';
  g.font = `900 ${18 * k}px ${FONT}`;
  g.fillText(priceText(last), plot.x + plot.w + 10 * k, y);
}

/** A close as the screen's strip writes it: "Ann ↑10× +4,520" or "Bob ↓5× liquidated". */
export function closeText(c: MarketClose): string {
  const arrow = c.side === 'long' ? '↑' : '↓';
  const net = c.won - c.stake;
  const what = c.why === 'liquidated' ? t('world.marketLiquidated') : `${net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}`;
  return `${c.name} ${arrow}${c.lev}× ${what}`;
}

/** The big screen on the east wall: the ticker and price, the change, the chart, who's long and short, and the latest closes. */
export function drawScreen(canvas: HTMLCanvasElement, s: MarketState) {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0f1a24');
  bg.addColorStop(1, '#070b10');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const trend = trendOf(s.history);
  const color = trendColor(trend);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(8, 8, W - 16, H - 16);

  // The ticker, the price and the change.
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#4cc9f0';
  g.font = `900 54px ${FONT}`;
  g.fillText(`📈 ${s.symbol}`, 34, 58);
  const tickerW = g.measureText(`📈 ${s.symbol}`).width;
  g.fillStyle = color;
  g.font = `900 64px ${FONT}`;
  g.fillText(priceText(s.price), 34 + tickerW + 30, 60);
  const priceW = g.measureText(priceText(s.price)).width;
  g.font = `800 34px ${FONT}`;
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '▶';
  g.fillText(`${arrow} ${pctText(changeOf(s.history))}`, 34 + tickerW + 30 + priceW + 24, 62);
  g.textAlign = 'right';
  g.fillStyle = '#e9e2f5';
  g.font = `800 30px ${FONT}`;
  g.fillText(t('world.marketCrowd', { longs: s.longs, shorts: s.shorts }), W - 34, 58);

  // The chart, and the latest closes down the right.
  const listW = 330;
  drawChart(g, { x: 34, y: 116, w: W - 68 - listW - 24, h: H - 150 }, s.history, { scale: 1.3 });
  const lx = W - 34 - listW;
  g.textAlign = 'left';
  g.fillStyle = '#8c84a0';
  g.font = `800 26px ${FONT}`;
  g.fillText(t('world.marketLatest'), lx, 132);
  if (!s.recent.length) {
    g.font = `700 24px ${FONT}`;
    g.fillText(t('world.marketHowTo'), lx, 178, listW);
  }
  s.recent.forEach((c, i) => {
    const y = 178 + i * 52;
    if (y > H - 30) return;
    const good = c.won > c.stake;
    g.fillStyle = c.why === 'liquidated' ? 'rgba(255,77,109,0.18)' : good ? 'rgba(61,220,132,0.14)' : 'rgba(255,255,255,0.05)';
    g.fillRect(lx - 8, y - 22, listW + 8, 44);
    g.fillStyle = c.color ?? '#e9e2f5';
    g.beginPath();
    g.arc(lx + 8, y, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.why === 'liquidated' ? '#ff4d6d' : good ? '#3ddc84' : '#e9e2f5';
    g.font = `800 26px ${FONT}`;
    g.fillText(closeText(c), lx + 24, y, listW - 28);
  });
}
