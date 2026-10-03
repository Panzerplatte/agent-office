import { locale, t } from '../i18n';
import { BETS, LINES, MAX_BET, PAY_CHERRY, PAY_THREE, SYMBOL_GLYPH, returnToPlayer, type SlotBet, type SlotSpin, type SlotsState } from '../../shared/slots';
import { $, h } from './dom';

export interface SlotsPanelHooks {
  /** Pull the lever at the bet picked. */
  spin(): void;
  /** Pick what a spin costs. */
  bet(bet: SlotBet): void;
  /** Leave the machine, for anyone to play. */
  leave(): void;
}

const n = (v: number) => v.toLocaleString(locale());

/**
 * The panel on the right while you're at a slot machine: the jackpot all the machines share, what a
 * spin costs (each bet you can't afford greyed out), Spin, what the last spin won, the paytable (opened
 * by its button) and Leave, which gives the machine up for someone else.
 */
export class SlotsPanel {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly jackpot: HTMLElement;
  private readonly status: HTMLElement;
  private readonly bets: HTMLButtonElement[];
  private readonly spinBtn: HTMLButtonElement;
  private readonly table: HTMLElement;
  private readonly tableBtn: HTMLButtonElement;
  private shown = '';

  constructor(hooks: SlotsPanelHooks) {
    this.title = h('div.slots-title');
    this.jackpot = h('div.slots-jackpot');
    this.status = h('div.slots-status');
    this.bets = BETS.map((b) => {
      const btn = h('button.btn', { type: 'button' }, String(b));
      btn.addEventListener('click', () => hooks.bet(b));
      return btn;
    });
    this.spinBtn = h('button.btn.primary.slots-spin', { type: 'button' }, t('menus.slotsSpin'));
    this.spinBtn.addEventListener('click', () => hooks.spin());
    this.table = h('div.slots-table.hidden', {}, ...paytable());
    this.tableBtn = h('button.btn.slots-paytable', { type: 'button', 'aria-expanded': 'false' }, t('menus.slotsPaytable'));
    this.tableBtn.addEventListener('click', () => {
      const open = this.table.classList.toggle('hidden') === false;
      this.tableBtn.setAttribute('aria-expanded', String(open));
    });
    const leave = h('button.btn.slots-leave', { type: 'button', title: t('menus.slotsLeaveNote') }, t('menus.slotsLeave'));
    leave.addEventListener('click', () => hooks.leave());
    this.el = h(
      'div.slots.panel.hidden',
      { id: 'slots', 'aria-label': t('menus.slots') },
      this.title,
      this.jackpot,
      h('div.slots-bet-label', {}, t('menus.slotsBet')),
      h('div.slots-bets', {}, ...this.bets),
      this.spinBtn,
      this.status,
      h('div.slots-foot', {}, this.tableBtn, leave),
      this.table,
    );
    // A click on a button mustn't leave it focused, or Space (which spins) would press it again.
    this.el.addEventListener('pointerdown', (e) => e.preventDefault());
    $('hud').append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) this.shown = '';
  }

  /**
   * The machine as it is: `machine` which one you're at, `bet` the one picked, `balance` your chips,
   * `spinning` while its reels go round, and `result` the spin that's just stopped (null while one
   * spins, or before the first).
   */
  render(s: SlotsState, machine: number, bet: SlotBet, balance: number, spinning: boolean, result: SlotSpin | null) {
    const k = JSON.stringify([s.jackpot, machine, bet, balance, spinning, result?.n]);
    if (k === this.shown) return;
    this.shown = k;
    this.title.textContent = `🎰 ${t('menus.slotsMachine', { n: machine + 1 })}`;
    this.jackpot.textContent = `⭐ ${t('menus.slotsJackpot', { n: n(s.jackpot) })}`;
    this.bets.forEach((b, i) => {
      b.classList.toggle('on', BETS[i] === bet);
      b.disabled = BETS[i] > balance;
    });
    this.spinBtn.disabled = spinning || bet > balance;
    let status = '';
    let cls = '';
    if (spinning) status = t('menus.slotsSpinning');
    else if (bet > balance) status = t('menus.slotsBroke');
    else if (result?.jackpot) {
      status = t('menus.slotsJackpotWon', { n: n(result.win) });
      cls = 'jackpot';
    } else if (result && result.win > 0) {
      status = t('menus.slotsWon', { n: n(result.win), lines: result.lines.length });
      cls = 'won';
    } else if (result) status = t('menus.slotsNoWin');
    else status = t('menus.slotsHowTo');
    this.status.textContent = status;
    this.status.className = `slots-status ${cls}`;
  }
}

/** The paytable: what three of a kind on a line pay, times the line's bet, the cherries, and the jackpot. */
function paytable(): HTMLElement[] {
  const row = (symbols: string, pays: string) => h('div.slots-pay', {}, h('span.slots-pay-symbols', {}, symbols), h('span', {}, pays));
  const three = (Object.keys(PAY_THREE) as (keyof typeof PAY_THREE)[]).sort((a, b) => PAY_THREE[b] - PAY_THREE[a]);
  const glyph = (s: keyof typeof SYMBOL_GLYPH) => SYMBOL_GLYPH[s];
  return [
    row(`${glyph('star')} ${glyph('star')} ${glyph('star')}`, t('menus.slotsPayJackpot', { max: MAX_BET })),
    ...three.map((s) => row(`${glyph(s)} ${glyph(s)} ${glyph(s)}`, `× ${PAY_THREE[s]}`)),
    row(`${glyph('cherry')} ${glyph('cherry')} –`, `× ${PAY_CHERRY[2]}`),
    row(`${glyph('cherry')} – –`, `× ${PAY_CHERRY[1]}`),
    h('div.slots-note', {}, t('menus.slotsPayNote', { lines: LINES.length, rtp: (returnToPlayer() * 100).toLocaleString(locale(), { maximumFractionDigits: 1 }) })),
  ];
}
