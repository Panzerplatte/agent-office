import {
  LEVERAGES,
  MAX_LEVERAGE,
  MAX_OPEN,
  MAX_STAKE,
  MIN_LEVERAGE,
  MIN_STAKE,
  SL_MAX,
  STAKE_CHOICES,
  changeOf,
  TP_MAX,
  leverageOk,
  liquidationPrice,
  pctText,
  priceText,
  profit,
  trendOf,
  value,
  type MarketClose,
  type MarketOrder,
  type MarketPosition,
  type MarketState,
  type Side,
} from '../../shared/market';
import { t } from '../i18n';
import { drawChart, trendColor } from '../world/marketscreen';
import { h, openModal, type Modal } from './dom';

// The panel for the trading desk, opened with E at the desk (or its screen) on the casino's east
// wall: the live chart with your positions on it, the price, a stake, the leverage (1× to 10×), a
// take-profit and stop-loss if you want them, and Long or Short to open; under that your open
// positions with what each has made right now, where it's liquidated, and Close. It sits in the
// bottom right corner, with no dimming, so the big screen stays in view.

export interface MarketPanelHooks {
  open(o: MarketOrder): void;
  close(id: number): void;
  /** The panel's closed. */
  closed(): void;
  /** Your balance, as the office last said. */
  balance(): number;
  market(): MarketState;
  mine(): readonly MarketPosition[];
  /** Your last position that closed, and how. */
  lastClosed(): { position: MarketPosition; close: MarketClose } | null;
}

const KEY = 'agent-office.market';

interface Pick {
  stake: number;
  lev: number;
  tp?: number;
  sl?: number;
}

/** What you last traded with: the stake, the leverage, and the take-profit and stop-loss. */
function saved(): Pick {
  const fallback: Pick = { stake: 100, lev: 5 };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Pick> | null;
    const tp = Number.isInteger(o?.tp) && o!.tp! >= 1 && o!.tp! <= TP_MAX ? o!.tp : undefined;
    const sl = Number.isInteger(o?.sl) && o!.sl! >= 1 && o!.sl! <= SL_MAX ? o!.sl : undefined;
    return {
      stake: Number.isSafeInteger(o?.stake) && o!.stake! >= MIN_STAKE && o!.stake! <= MAX_STAKE ? o!.stake! : fallback.stake,
      lev: leverageOk(o?.lev) ? o!.lev! : fallback.lev,
      ...(tp !== undefined ? { tp } : {}),
      ...(sl !== undefined ? { sl } : {}),
    };
  } catch {
    return fallback;
  }
}

/** "1k", "10k": how a chip button writes its amount. */
function short(n: number): string {
  return n >= 1000 ? `${n / 1000}k` : String(n);
}

/** Chips with their sign: "+1,250", "−80". */
function signed(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString()}`;
}

export class MarketPanel {
  private modal: Modal | null = null;
  private pick = saved();
  private els: {
    canvas: HTMLCanvasElement;
    price: HTMLElement;
    balance: HTMLElement;
    result: HTMLElement;
    input: HTMLInputElement;
    chips: HTMLButtonElement[];
    lev: HTMLInputElement;
    levText: HTMLElement;
    tp: HTMLInputElement;
    sl: HTMLInputElement;
    long: HTMLButtonElement;
    short: HTMLButtonElement;
    list: HTMLElement;
    note: HTMLElement;
  } | null = null;
  /** What the controls and the list last showed, so a tick that changes nothing touches nothing. */
  private drawn = '';
  private listed = '';

  constructor(private readonly hooks: MarketPanelHooks) {}

  get open(): boolean {
    return !!this.modal;
  }

  show() {
    if (this.modal) return;
    const canvas = h('canvas.market-canvas', { width: '840', height: '380' }) as HTMLCanvasElement;
    const price = h('div.market-price');
    const balance = h('div.plinko-balance');
    const result = h('div.market-result');
    const input = h('input', { type: 'number', min: String(MIN_STAKE), max: String(MAX_STAKE), step: '1', value: String(this.pick.stake), 'aria-label': t('menus.marketStake') }) as HTMLInputElement;
    const chips = STAKE_CHOICES.map(
      (n) => h('button.btn.crash-chip', { type: 'button', title: t('menus.marketStakeOf', { n: n.toLocaleString() }), onclick: () => this.set({ stake: n }) }, short(n)) as HTMLButtonElement,
    );
    const lev = h('input', {
      type: 'range',
      min: String(MIN_LEVERAGE),
      max: String(MAX_LEVERAGE),
      step: '1',
      value: String(this.pick.lev),
      'aria-label': t('menus.marketLeverage'),
    }) as HTMLInputElement;
    const levText = h('span.plinko-rows-n');
    const tp = h('input', {
      type: 'number',
      min: '1',
      max: String(TP_MAX),
      step: '1',
      placeholder: t('menus.marketOff'),
      value: this.pick.tp ?? '',
      'aria-label': t('menus.marketTp'),
      title: t('menus.marketTpTip'),
    }) as HTMLInputElement;
    const sl = h('input', {
      type: 'number',
      min: '1',
      max: String(SL_MAX),
      step: '1',
      placeholder: t('menus.marketOff'),
      value: this.pick.sl ?? '',
      'aria-label': t('menus.marketSl'),
      title: t('menus.marketSlTip'),
    }) as HTMLInputElement;
    const long = h('button.btn.market-long', { type: 'button', onclick: () => this.trade('long') }) as HTMLButtonElement;
    const shortBtn = h('button.btn.market-short', { type: 'button', onclick: () => this.trade('short') }) as HTMLButtonElement;
    const list = h('div.market-list');
    const note = h('p.setting-note');
    input.addEventListener('input', () => {
      const n = Math.floor(Number(input.value));
      if (Number.isFinite(n)) this.pick.stake = Math.min(MAX_STAKE, Math.max(MIN_STAKE, n));
      this.remember();
      this.drawn = '';
    });
    lev.addEventListener('input', () => this.set({ lev: Number(lev.value) }));
    const limit = (el: HTMLInputElement, max: number, k: 'tp' | 'sl') =>
      el.addEventListener('input', () => {
        const n = Math.floor(Number(el.value));
        if (!el.value || !Number.isFinite(n) || n < 1) delete this.pick[k];
        else this.pick[k] = Math.min(max, n);
        this.remember();
        this.drawn = '';
      });
    limit(tp, TP_MAX, 'tp');
    limit(sl, SL_MAX, 'sl');
    const el = h(
      'div.modal.crash-panel.market-panel',
      { role: 'dialog', 'aria-label': t('menus.market') },
      h('header', {}, h('h2', {}, `📈 ${t('menus.market', { symbol: this.hooks.market().symbol })}`)),
      h(
        'div.body',
        {},
        h('div.crash-top', {}, price, balance),
        canvas,
        h('div.crash-chips', {}, ...chips),
        h('div.crash-row', {}, input),
        h('div.plinko-row', {}, h('label.plinko-label', {}, t('menus.marketLeverage'), ' ', levText), lev),
        h('div.plinko-row.market-limits', {}, h('label', {}, t('menus.marketTp'), tp), h('label', {}, t('menus.marketSl'), sl)),
        h('div.crash-row', {}, long, shortBtn),
        note,
        result,
        list,
      ),
    );
    this.els = { canvas, price, balance, result, input, chips, lev, levText, tp, sl, long, short: shortBtn, list, note };
    this.drawn = '';
    this.listed = '';
    this.modal = openModal(el, {
      onClose: () => {
        this.modal = null;
        this.els = null;
        this.hooks.closed();
      },
    });
    this.modal.backdrop.classList.add('crash-backdrop');
    this.update();
  }

  close() {
    this.modal?.close();
  }

  /** On every tick, and whenever your positions or your chips change: the chart, the price, the controls and your positions. */
  update() {
    const els = this.els;
    if (!els) return;
    const m = this.hooks.market();
    const mine = this.hooks.mine();
    const balance = this.hooks.balance();
    const { stake, lev } = this.pick;

    const g = els.canvas.getContext('2d')!;
    g.fillStyle = '#0b1118';
    g.fillRect(0, 0, els.canvas.width, els.canvas.height);
    drawChart(g, { x: 12, y: 12, w: els.canvas.width - 24, h: els.canvas.height - 24 }, m.history, { positions: mine, scale: 1 });
    const trend = trendOf(m.history);
    els.price.textContent = `${m.symbol} ${priceText(m.price)}  ${pctText(changeOf(m.history))}`;
    els.price.style.color = trendColor(trend) === '#c9c1d6' ? '' : trendColor(trend);

    const last = this.hooks.lastClosed();
    const full = mine.length >= MAX_OPEN;
    const key = [balance, stake, lev, this.pick.tp, this.pick.sl, full, last?.position.id].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      els.balance.textContent = t('menus.marketBalance', { n: balance.toLocaleString() });
      if (document.activeElement !== els.input) els.input.value = String(stake);
      for (const [i, b] of els.chips.entries()) {
        b.disabled = STAKE_CHOICES[i] > balance;
        b.classList.toggle('on', STAKE_CHOICES[i] === stake);
      }
      els.lev.value = String(lev);
      els.levText.textContent = `${lev}×`;
      const liq = pctText(-1 / lev);
      els.long.textContent = t('menus.marketLong', { n: stake.toLocaleString(), lev });
      els.short.textContent = t('menus.marketShort', { n: stake.toLocaleString(), lev });
      els.long.title = t('menus.marketLongTip', { liq });
      els.short.title = t('menus.marketShortTip', { liq: pctText(1 / lev) });
      els.long.disabled = els.short.disabled = stake > balance || full;
      els.note.textContent = stake > balance ? t('menus.marketTooMuch') : full ? t('menus.marketFull', { n: MAX_OPEN }) : '';
      els.note.style.display = els.note.textContent ? '' : 'none';
      if (last) {
        const net = last.close.won - last.position.stake;
        els.result.textContent = t(`menus.marketClosed_${last.close.why}`, { n: signed(net), price: priceText(last.close.price) });
        els.result.classList.toggle('up', net > 0);
        els.result.classList.toggle('down', net < 0);
      }
      els.result.style.display = last ? '' : 'none';
    }

    // Your positions: rebuilt when they change, their figures every tick.
    const ids = mine.map((p) => p.id).join(',');
    if (ids !== this.listed) {
      this.listed = ids;
      els.list.replaceChildren(
        ...(mine.length
          ? mine.map((p) =>
              h(
                'div.market-pos',
                { 'data-id': String(p.id) },
                h(`span.market-side.${p.side}`, {}, `${p.side === 'long' ? '↑' : '↓'} ${p.lev}×`),
                h(
                  'span.market-what',
                  {},
                  h('b', {}, p.stake.toLocaleString()),
                  ' @ ',
                  priceText(p.entry),
                  h('small', {}, ` · ${t('menus.marketLiq', { price: priceText(liquidationPrice(p)) })}`, limitsText(p)),
                ),
                h('span.market-pnl'),
                h('button.btn.market-close', { type: 'button', onclick: () => this.hooks.close(p.id) }, t('menus.marketClose')),
              ),
            )
          : [h('p.setting-note', {}, t('menus.marketNone'))]),
      );
    }
    for (const row of els.list.querySelectorAll<HTMLElement>('.market-pos')) {
      const p = mine.find((x) => String(x.id) === row.dataset.id);
      const pnl = row.querySelector<HTMLElement>('.market-pnl');
      if (!p || !pnl) continue;
      const made = value(p, m.price) - p.stake;
      pnl.textContent = `${signed(Math.trunc(made))} (${pctText(profit(p, m.price) / p.stake)})`;
      pnl.classList.toggle('up', made > 0);
      pnl.classList.toggle('down', made < 0);
    }
  }

  /** Changes the stake or the leverage. */
  private set(p: Partial<Pick>) {
    if (p.stake !== undefined) this.pick.stake = p.stake;
    if (p.lev !== undefined && leverageOk(p.lev)) this.pick.lev = p.lev;
    if (p.stake !== undefined && this.els) this.els.input.value = String(p.stake);
    this.remember();
    this.drawn = '';
    this.update();
  }

  private remember() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.pick));
    } catch {
      // Just not remembered for next time.
    }
  }

  private trade(side: Side) {
    const { stake, lev, tp, sl } = this.pick;
    if (stake < MIN_STAKE || stake > MAX_STAKE || stake > this.hooks.balance() || !LEVERAGES.includes(lev)) return;
    this.hooks.open({ stake, side, lev, ...(tp !== undefined ? { tp } : {}), ...(sl !== undefined ? { sl } : {}) });
  }
}

/** A position's take-profit and stop-loss, after its liquidation price: " · TP +50 % · SL −20 %". */
function limitsText(p: MarketPosition): string {
  return `${p.tp !== undefined ? ` · TP +${p.tp} %` : ''}${p.sl !== undefined ? ` · SL −${p.sl} %` : ''}`;
}
