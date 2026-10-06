import {
  AUTO_EVERY,
  BET_CHOICES,
  MAX_BET,
  MAX_ROWS,
  MAX_YOURS,
  MIN_BET,
  MIN_ROWS,
  RISKS,
  fallMs,
  multText,
  riskOk,
  rowsOk,
  type PlinkoBall,
  type PlinkoDrop,
  type PlinkoRisk,
} from '../../shared/plinko';
import { t } from '../i18n';
import { drawBoard, type ShownBall } from '../world/plinkoboard';
import { h, openModal, type Modal } from './dom';

// The panel for Plinko, opened with E at the machine in the casino's main hall: pick a bet, how many
// rows of pegs and the risk, and drop a ball (Space or Enter, or the button) as often as you like,
// several falling at once; Auto keeps dropping one every AUTO_EVERY ms until you stop it, run out of
// chips or close the panel. Your board is drawn in it with your balls falling through it, and what
// the last one paid. Rows and risk can't change while a ball of yours is still falling. It sits in
// the bottom right corner, with no dimming, so the machine stays in view.

export interface PlinkoPanelHooks {
  drop(d: PlinkoDrop): void;
  /** The panel's closed. */
  closed(): void;
  /** Your balance, as the office last said. */
  balance(): number;
  /** Your page's peer id. */
  you(): string;
  /** Every ball on the machine now (yours are the ones with your peer id). */
  balls(): readonly ShownBall[];
}

const KEY = 'agent-office.plinko';

/** What you last played with: the bet, the rows and the risk. */
function saved(): PlinkoDrop {
  const fallback: PlinkoDrop = { bet: 100, rows: 16, risk: 'medium' };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PlinkoDrop> | null;
    return {
      bet: Number.isSafeInteger(o?.bet) && o!.bet! >= MIN_BET && o!.bet! <= MAX_BET ? o!.bet! : fallback.bet,
      rows: rowsOk(o?.rows) ? o!.rows! : fallback.rows,
      risk: riskOk(o?.risk) ? o!.risk! : fallback.risk,
    };
  } catch {
    return fallback;
  }
}

/** "1k", "10k": how a chip button writes its amount. */
function short(n: number): string {
  return n >= 1000 ? `${n / 1000}k` : String(n);
}

export class PlinkoPanel {
  private modal: Modal | null = null;
  private pick = saved();
  private auto = false;
  private autoAt = 0;
  /** What your last ball paid, to say under the board. */
  private last: PlinkoBall | null = null;
  private els: {
    canvas: HTMLCanvasElement;
    balance: HTMLElement;
    result: HTMLElement;
    input: HTMLInputElement;
    chips: HTMLButtonElement[];
    rows: HTMLInputElement;
    rowsText: HTMLElement;
    risks: HTMLButtonElement[];
    drop: HTMLButtonElement;
    autoBtn: HTMLButtonElement;
    note: HTMLElement;
  } | null = null;
  /** What the controls last showed, so a frame that changes nothing touches nothing. */
  private drawn = '';

  constructor(private readonly hooks: PlinkoPanelHooks) {}

  get open(): boolean {
    return !!this.modal;
  }

  /** Whether Auto is dropping balls. */
  get autoOn(): boolean {
    return this.auto;
  }

  show() {
    if (this.modal) return;
    const canvas = h('canvas.plinko-canvas', { width: '840', height: '560' }) as HTMLCanvasElement;
    const balance = h('div.plinko-balance');
    const result = h('div.plinko-result');
    const input = h('input', { type: 'number', min: String(MIN_BET), max: String(MAX_BET), step: '1', value: String(this.pick.bet), 'aria-label': t('menus.plinkoAmount') }) as HTMLInputElement;
    const chips = BET_CHOICES.map(
      (n) => h('button.btn.crash-chip', { type: 'button', title: t('menus.plinkoBetOf', { n: n.toLocaleString() }), onclick: () => this.set({ bet: n }) }, short(n)) as HTMLButtonElement,
    );
    const rows = h('input', { type: 'range', min: String(MIN_ROWS), max: String(MAX_ROWS), step: '1', value: String(this.pick.rows), 'aria-label': t('menus.plinkoRows') }) as HTMLInputElement;
    const rowsText = h('span.plinko-rows-n');
    const risks = RISKS.map((r) => h('button.btn.plinko-risk', { type: 'button', onclick: () => this.set({ risk: r }) }, t(`menus.plinkoRisk_${r}`)) as HTMLButtonElement);
    const drop = h('button.btn.primary.plinko-drop', { type: 'button', title: t('menus.plinkoDropKeys'), onclick: () => this.drop() }) as HTMLButtonElement;
    const autoBtn = h('button.btn.plinko-auto', { type: 'button', title: t('menus.plinkoAutoKey'), onclick: () => this.toggleAuto() }) as HTMLButtonElement;
    const note = h('p.setting-note');
    input.addEventListener('input', () => {
      const n = Math.floor(Number(input.value));
      if (Number.isFinite(n)) this.pick.bet = Math.min(MAX_BET, Math.max(MIN_BET, n));
      this.remember();
      this.drawn = '';
    });
    rows.addEventListener('input', () => this.set({ rows: Number(rows.value) }));
    const el = h(
      'div.modal.crash-panel.plinko-panel',
      { role: 'dialog', 'aria-label': t('menus.plinko') },
      h('header', {}, h('h2', {}, `🔻 ${t('menus.plinko')}`)),
      h(
        'div.body',
        {},
        canvas,
        h('div.crash-top', {}, balance, result),
        h('div.crash-chips', {}, ...chips),
        h('div.crash-row', {}, input),
        h('div.plinko-row', {}, h('label.plinko-label', {}, t('menus.plinkoRows'), ' ', rowsText), rows),
        h('div.plinko-row', {}, h('span.plinko-label', {}, t('menus.plinkoRisk')), h('div.plinko-risks', {}, ...risks)),
        h('div.crash-row', {}, drop, autoBtn),
        note,
      ),
    );
    this.els = { canvas, balance, result, input, chips, rows, rowsText, risks, drop, autoBtn, note };
    this.drawn = '';
    window.addEventListener('keydown', this.onKey, true);
    this.modal = openModal(el, {
      onClose: () => {
        window.removeEventListener('keydown', this.onKey, true);
        this.modal = null;
        this.els = null;
        this.auto = false;
        this.hooks.closed();
      },
    });
    this.modal.backdrop.classList.add('crash-backdrop');
    this.update(performance.now());
  }

  close() {
    this.modal?.close();
  }

  /** One of your balls landed: what it paid goes under the board. */
  landed(ball: PlinkoBall) {
    this.last = ball;
    this.drawn = '';
  }

  /** Your balls still falling, at `now`. */
  private falling(now: number): number {
    const you = this.hooks.you();
    return this.hooks.balls().filter((b) => b.ball.peer === you && now - b.start < fallMs(b.ball.rows)).length;
  }

  /** Every frame while it's open: the board with your balls on it, Auto's next ball, and the controls. */
  update(now: number) {
    const els = this.els;
    if (!els) return;
    const you = this.hooks.you();
    const { rows, risk, bet } = this.pick;
    const balance = this.hooks.balance();
    const falling = this.falling(now);

    if (this.auto && now - this.autoAt >= AUTO_EVERY) {
      if (bet > balance) {
        // Out of chips for another: Auto stops once the last of yours has landed (it might win some back).
        if (!falling) this.auto = false;
      } else if (falling < MAX_YOURS) {
        this.autoAt = now;
        this.hooks.drop({ bet, rows, risk });
      }
    }

    const g = els.canvas.getContext('2d')!;
    g.fillStyle = '#140b20';
    g.fillRect(0, 0, els.canvas.width, els.canvas.height);
    const mine = this.hooks.balls().filter((b) => b.ball.peer === you && b.ball.rows === rows && b.ball.risk === risk);
    drawBoard(g, { x: 10, y: 6, w: els.canvas.width - 20, h: els.canvas.height - 12 }, { rows, risk, balls: mine, now, you });

    const locked = falling > 0;
    const key = [balance, bet, rows, risk, this.auto, locked, falling >= MAX_YOURS, this.last?.id].join('|');
    if (key === this.drawn) return;
    this.drawn = key;
    els.balance.textContent = t('menus.plinkoBalance', { n: balance.toLocaleString() });
    els.result.textContent = this.last ? t('menus.plinkoLast', { m: multText(this.last.m), n: this.last.won.toLocaleString() }) : '';
    els.result.classList.toggle('up', !!this.last && this.last.won > this.last.bet);
    if (document.activeElement !== els.input) els.input.value = String(bet);
    for (const [i, b] of els.chips.entries()) {
      b.disabled = BET_CHOICES[i] > balance;
      b.classList.toggle('on', BET_CHOICES[i] === bet);
    }
    els.rows.value = String(rows);
    els.rows.disabled = locked;
    els.rowsText.textContent = String(rows);
    for (const [i, b] of els.risks.entries()) {
      b.disabled = locked;
      b.classList.toggle('on', RISKS[i] === risk);
    }
    els.drop.textContent = t('menus.plinkoDrop', { n: bet.toLocaleString() });
    els.drop.disabled = bet > balance || falling >= MAX_YOURS;
    els.autoBtn.textContent = this.auto ? t('menus.plinkoAutoStop') : t('menus.plinkoAuto');
    els.autoBtn.classList.toggle('on', this.auto);
    els.note.textContent = bet > balance ? t('menus.plinkoTooMuch') : falling >= MAX_YOURS ? t('menus.plinkoMany', { n: MAX_YOURS }) : locked ? t('menus.plinkoLocked') : '';
    els.note.style.display = els.note.textContent ? '' : 'none';
  }

  /** Changes the bet, rows or risk (rows and risk only while none of your balls is falling). */
  private set(p: Partial<PlinkoDrop>) {
    const locked = this.falling(performance.now()) > 0;
    if (p.bet !== undefined) this.pick.bet = p.bet;
    if (p.rows !== undefined && rowsOk(p.rows) && !locked) this.pick.rows = p.rows;
    if (p.risk !== undefined && !locked) this.pick.risk = p.risk as PlinkoRisk;
    if (p.bet !== undefined && this.els) this.els.input.value = String(p.bet);
    this.remember();
    this.drawn = '';
  }

  private remember() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.pick));
    } catch {
      // Just not remembered for next time.
    }
  }

  private drop() {
    const { bet, rows, risk } = this.pick;
    if (bet < MIN_BET || bet > MAX_BET || bet > this.hooks.balance()) return;
    this.hooks.drop({ bet, rows, risk });
  }

  private toggleAuto() {
    this.auto = !this.auto;
    this.autoAt = -Infinity;
    this.drawn = '';
  }

  /** Space or Enter drops a ball, A turns Auto on or off, while the panel's open (Esc closes it, as any window). */
  private onKey = (e: KeyboardEvent) => {
    if (!this.modal) return;
    const typing = e.target instanceof HTMLInputElement && e.target.type === 'number';
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.drop();
    } else if (e.code === 'KeyA' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.toggleAuto();
    }
  };
}
