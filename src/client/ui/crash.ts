import { BET_CHOICES, MAX_BET, MIN_BET, multText, payout, shownMultiplier, type CrashPlayer, type CrashState } from '../../shared/crash';
import { t } from '../i18n';
import { h, openModal, type Modal } from './dom';

// The panel for Crash, opened with E at the screen on the casino's wall: pick a bet and put it down
// (Enter), take it back while the clock's still running, and cash out (Space, or the big button)
// while the multiplier climbs. It sits in the bottom right corner, with no dimming, so the wall
// screen stays in view.

export interface CrashPanelHooks {
  bet(amount: number): void;
  cancel(): void;
  cashOut(): void;
  /** The panel's open (this page's player is shown as you) or closed. */
  opened(): void;
  closed(): void;
  /** Your balance, as the office last said. */
  balance(): number;
  /** The round as it is now, how long ago (ms) the office sent it, and who you are. */
  state(): { s: CrashState; since: number; you: string };
}

const AMOUNT_KEY = 'agent-office.crash.amount';

function savedAmount(): number {
  try {
    const n = Number(localStorage.getItem(AMOUNT_KEY));
    return Number.isSafeInteger(n) && n >= MIN_BET && n <= MAX_BET ? n : 100;
  } catch {
    return 100;
  }
}

/** "1k", "10k": how a chip button writes its amount. */
function short(n: number): string {
  return n >= 1000 ? `${n / 1000}k` : String(n);
}

export class CrashPanel {
  private modal: Modal | null = null;
  private amount = savedAmount();
  private els: {
    status: HTMLElement;
    mult: HTMLElement;
    balance: HTMLElement;
    input: HTMLInputElement;
    chips: HTMLButtonElement[];
    bet: HTMLButtonElement;
    cancel: HTMLButtonElement;
    cash: HTMLButtonElement;
    note: HTMLElement;
  } | null = null;
  /** What was last drawn, so a frame that changes nothing touches nothing. */
  private drawn = '';

  constructor(private readonly hooks: CrashPanelHooks) {}

  get open(): boolean {
    return !!this.modal;
  }

  show() {
    if (this.modal) return;
    const status = h('div.crash-status');
    const mult = h('div.crash-mult');
    const balance = h('div.crash-balance');
    const input = h('input', { type: 'number', min: String(MIN_BET), max: String(MAX_BET), step: '1', value: String(this.amount), 'aria-label': t('menus.crashAmount') }) as HTMLInputElement;
    const chips = BET_CHOICES.map((n) => h('button.btn.crash-chip', { type: 'button', title: t('menus.crashBetOf', { n: n.toLocaleString() }), onclick: () => this.setAmount(n) }, short(n)) as HTMLButtonElement);
    const bet = h('button.btn.primary', { type: 'button', onclick: () => this.bet() }) as HTMLButtonElement;
    const cancel = h('button.btn', { type: 'button', onclick: () => this.hooks.cancel() }, t('menus.crashCancel')) as HTMLButtonElement;
    const cash = h('button.btn.primary.crash-cash', { type: 'button', onclick: () => this.hooks.cashOut() }) as HTMLButtonElement;
    const note = h('p.setting-note');
    input.addEventListener('input', () => {
      const n = Math.floor(Number(input.value));
      if (Number.isFinite(n)) this.amount = Math.min(MAX_BET, Math.max(MIN_BET, n));
      this.drawn = '';
    });
    const el = h(
      'div.modal.crash-panel',
      { role: 'dialog', 'aria-label': t('menus.crash') },
      h('header', {}, h('h2', {}, `🚀 ${t('menus.crash')}`)),
      h(
        'div.body',
        {},
        h('div.crash-top', {}, h('div', {}, status, balance), mult),
        h('div.crash-chips', {}, ...chips),
        h('div.crash-row', {}, input, bet, cancel),
        cash,
        note,
      ),
      h('footer', {}, h('span.grow', {}, t('menus.crashFooter', { max: MAX_BET.toLocaleString() }))),
    );
    this.els = { status, mult, balance, input, chips, bet, cancel, cash, note };
    this.drawn = '';
    window.addEventListener('keydown', this.onKey, true);
    this.modal = openModal(el, {
      onClose: () => {
        window.removeEventListener('keydown', this.onKey, true);
        this.modal = null;
        this.els = null;
        this.hooks.closed();
      },
    });
    this.modal.backdrop.classList.add('crash-backdrop');
    this.hooks.opened();
    this.update();
  }

  close() {
    this.modal?.close();
  }

  /** Brings the panel up to date with the round (every frame while it's open: the multiplier climbs). */
  update() {
    const els = this.els;
    if (!els) return;
    const { s, since, you } = this.hooks.state();
    const me = mine(s, you);
    const m = shownMultiplier(s, since);
    const balance = this.hooks.balance();
    const left = s.phase === 'betting' ? Math.max(0, s.left - since) : 0;
    const key = [s.phase, s.round, m, Math.ceil(left / 100), me?.bet, me?.out, balance, this.amount, s.players.length].join('|');
    if (key === this.drawn) return;
    this.drawn = key;

    els.status.textContent =
      s.phase === 'idle' ? t('menus.crashIdle')
      : s.phase === 'betting' ? t('menus.crashBetting', { s: (left / 1000).toFixed(1) })
      : s.phase === 'running' ? t('menus.crashRunning')
      : t('menus.crashCrashedAt', { m: multText(s.crash ?? m) });
    // The multiplier once it's off; before that, the clock.
    els.mult.textContent = s.phase === 'betting' ? `${(left / 1000).toFixed(1)} s` : s.phase === 'idle' ? '—' : multText(m);
    els.mult.classList.toggle('crashed', s.phase === 'crashed');
    els.mult.classList.toggle('waiting', s.phase === 'betting' || s.phase === 'idle');
    els.balance.textContent = t('menus.crashBalance', { n: balance.toLocaleString() });

    const canBet = (s.phase === 'idle' || s.phase === 'betting') && !me;
    const amount = Math.min(this.amount, MAX_BET);
    els.bet.textContent = t('menus.crashBet', { n: amount.toLocaleString() });
    els.bet.disabled = !canBet || amount > balance || amount < MIN_BET;
    els.input.disabled = !canBet;
    for (const [i, b] of els.chips.entries()) {
      const n = BET_CHOICES[i];
      b.disabled = !canBet || n > balance;
      b.classList.toggle('on', n === this.amount);
    }
    els.cancel.style.display = s.phase === 'betting' && me ? '' : 'none';

    const canCash = s.phase === 'running' && !!me && me.out === undefined;
    els.cash.disabled = !canCash;
    els.cash.textContent =
      me?.out !== undefined ? t('menus.crashCashedOut', { m: multText(me.out), n: (me.won ?? 0).toLocaleString() })
      : canCash ? t('menus.crashCashOut', { n: payout(me!.bet, m).toLocaleString() })
      : t('menus.crashCashOutIdle');

    els.note.textContent =
      me && s.phase === 'crashed' && me.out === undefined ? t('menus.crashYouLost', { n: me.bet.toLocaleString() })
      : me && (s.phase === 'betting' || s.phase === 'idle') ? t('menus.crashYouAreIn', { n: me.bet.toLocaleString() })
      : me && s.phase === 'running' && me.out === undefined ? t('menus.crashSpace')
      : amount > balance && canBet ? t('menus.crashTooMuch')
      : t('menus.crashRules');
  }

  private setAmount(n: number) {
    this.amount = n;
    if (this.els) this.els.input.value = String(n);
    try {
      localStorage.setItem(AMOUNT_KEY, String(n));
    } catch {
      // Just not remembered for next time.
    }
    this.drawn = '';
    this.update();
  }

  private bet() {
    const n = Math.floor(this.amount);
    if (n < MIN_BET || n > MAX_BET || n > this.hooks.balance()) return;
    this.setAmount(n);
    this.hooks.bet(n);
  }

  /** Space cashes out, Enter bets, while the panel's open (Esc closes it, as any window). */
  private onKey = (e: KeyboardEvent) => {
    if (!this.modal) return;
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.hooks.cashOut();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.bet();
    }
  };
}

/** Your entry in the round, if you're in it. */
export function mine(s: CrashState, you: string): CrashPlayer | undefined {
  return s.players.find((p) => p.peer === you);
}
