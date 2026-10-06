import { AUTO_MAX, AUTO_MIN, AUTO_RAISE_MAX, AUTO_ROUNDS_MAX, BET_CHOICES, CYCLE, MAX_BET, MIN_BET, autoBetOk, multText, payout, shownMultiplier, targetOk, type CrashAutoBet, type CrashAutoState, type CrashPlayer, type CrashState } from '../../shared/crash';
import { t, type Key, type Vars } from '../i18n';
import { h, openModal, type Modal } from './dom';

// The panel for Crash, opened with E at the screen on the casino's wall: pick a bet and put it down
// (Enter) while the clock counts down after every crash, take it back before it runs out, and cash out
// (Space, or the big button) while the multiplier climbs, or let the office cash out at a target ("Auto
// cash-out at"). Auto-Start, folded away under the bet, has the office bet round after round (raising
// the bet after a loss or a win if asked) until it's stopped or hits a stop. The header says which round
// of the series it is. It sits in the bottom right corner, with no dimming, so the wall screen stays in view.

export interface CrashPanelHooks {
  /** Bet `amount`, cashed out by the office at `auto` if it's set. */
  bet(amount: number, auto?: number): void;
  /** Start an auto-bet with these settings, or stop it (null). */
  autoBet(auto: CrashAutoBet | null): void;
  /** Your auto-bet, as the office last said. */
  auto(): CrashAutoState | null;
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
const AUTO_KEY = 'agent-office.crash.auto';

/** The auto cash-out and auto-bet fields, as last typed in (remembered for next time). */
interface AutoFields {
  target: string;
  loss: string;
  win: string;
  rounds: string;
  profit: string;
  limit: string;
}

function savedFields(): AutoFields {
  const none: AutoFields = { target: '', loss: '', win: '', rounds: '', profit: '', limit: '' };
  try {
    const o = JSON.parse(localStorage.getItem(AUTO_KEY) ?? '{}') as Partial<AutoFields>;
    for (const k of Object.keys(none) as (keyof AutoFields)[]) if (typeof o[k] === 'string') none[k] = o[k];
  } catch {
    // Starts empty.
  }
  return none;
}

/** A field's whole number, or undefined when it's empty (or not one). */
function wholeOf(v: string): number | undefined {
  const n = Number(v);
  return v.trim() && Number.isFinite(n) ? Math.floor(n) : undefined;
}

/** The auto cash-out field's target, to the hundredth: undefined when it's empty or off the scale. */
export function targetOf(v: string): number | undefined {
  const n = Math.round(Number(v.replace(',', '.')) * 100) / 100;
  return v.trim() && targetOk(n) ? n : undefined;
}

/** "+120", "−40": a profit the way the panel writes it. */
function signed(n: number): string {
  return n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${(-n).toLocaleString()}` : '0';
}

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
    round: HTMLElement;
    mult: HTMLElement;
    balance: HTMLElement;
    input: HTMLInputElement;
    chips: HTMLButtonElement[];
    bet: HTMLButtonElement;
    cancel: HTMLButtonElement;
    cash: HTMLButtonElement;
    note: HTMLElement;
    target: HTMLInputElement;
    auto: HTMLInputElement[];
    lossMode: HTMLSelectElement;
    winMode: HTMLSelectElement;
    go: HTMLButtonElement;
    autoNote: HTMLElement;
    summary: HTMLElement;
  } | null = null;
  private fields = savedFields();
  /** What was last drawn, so a frame that changes nothing touches nothing. */
  private drawn = '';

  constructor(private readonly hooks: CrashPanelHooks) {}

  get open(): boolean {
    return !!this.modal;
  }

  show() {
    if (this.modal) return;
    const status = h('div.crash-status');
    const round = h('span.crash-round');
    const mult = h('div.crash-mult');
    const balance = h('div.crash-balance');
    const input = h('input', { type: 'number', min: String(MIN_BET), max: String(MAX_BET), step: '1', value: String(this.amount), 'aria-label': t('menus.crashAmount') }) as HTMLInputElement;
    const chips = BET_CHOICES.map((n) => h('button.btn.crash-chip', { type: 'button', title: t('menus.crashBetOf', { n: n.toLocaleString() }), onclick: () => this.setAmount(n) }, short(n)) as HTMLButtonElement);
    const bet = h('button.btn.primary', { type: 'button', onclick: () => this.bet() }) as HTMLButtonElement;
    const cancel = h('button.btn', { type: 'button', onclick: () => this.hooks.cancel() }, t('menus.crashCancel')) as HTMLButtonElement;
    const cash = h('button.btn.primary.crash-cash', { type: 'button', onclick: () => this.hooks.cashOut() }) as HTMLButtonElement;
    const note = h('p.setting-note');
    // Auto cash-out, for a bet by hand and the auto-bet alike.
    const f = this.fields;
    const field = (key: keyof AutoFields, attrs: Record<string, string>) => {
      const el = h('input', { type: 'number', value: f[key], ...attrs }) as HTMLInputElement;
      el.addEventListener('input', () => {
        f[key] = el.value;
        this.saveFields();
      });
      return el;
    };
    const target = field('target', { min: String(AUTO_MIN), max: String(AUTO_MAX), step: '0.01', placeholder: t('menus.crashAutoOff'), 'aria-label': t('menus.crashAutoCash') });
    const mode = (key: 'loss' | 'win', label: string) => {
      const el = h('select', { 'aria-label': label }, h('option', { value: '' }, t('menus.crashReset')), h('option', { value: 'raise' }, t('menus.crashRaise'))) as HTMLSelectElement;
      el.value = f[key] ? 'raise' : '';
      return el;
    };
    const lossMode = mode('loss', t('menus.crashOnLoss'));
    const winMode = mode('win', t('menus.crashOnWin'));
    const pct = (key: 'loss' | 'win', sel: HTMLSelectElement) => {
      const el = field(key, { min: '1', max: String(AUTO_RAISE_MAX), step: '1', placeholder: '%', 'aria-label': `${sel.getAttribute('aria-label')} %` });
      sel.addEventListener('change', () => {
        if (sel.value && !el.value) el.value = '100';
        if (!sel.value) el.value = '';
        f[key] = el.value;
        this.saveFields();
        this.drawn = '';
      });
      return el;
    };
    const loss = pct('loss', lossMode);
    const win = pct('win', winMode);
    const rounds = field('rounds', { min: '1', max: String(AUTO_ROUNDS_MAX), step: '1', placeholder: t('menus.crashStopRounds'), 'aria-label': t('menus.crashStopRounds') });
    const profit = field('profit', { min: '1', step: '1', placeholder: t('menus.crashStopProfit'), 'aria-label': t('menus.crashStopProfit') });
    const limit = field('limit', { min: '1', step: '1', placeholder: t('menus.crashStopLoss'), 'aria-label': t('menus.crashStopLoss') });
    const go = h('button.btn', { type: 'button', onclick: () => this.toggleAuto() }) as HTMLButtonElement;
    const autoNote = h('p.setting-note');
    const summary = h('span.crash-auto-state');
    const details = h(
      'details.crash-auto',
      {},
      h('summary', {}, t('menus.crashAutoStart'), ' ', summary),
      h('div.crash-auto-grid', {}, h('span', {}, t('menus.crashOnLoss')), lossMode, loss, h('span', {}, t('menus.crashOnWin')), winMode, win),
      h('div.crash-auto-stops', {}, h('span', {}, t('menus.crashStopAfter')), rounds, profit, limit),
      go,
      autoNote,
    );
    input.addEventListener('input', () => {
      const n = Math.floor(Number(input.value));
      if (Number.isFinite(n)) this.amount = Math.min(MAX_BET, Math.max(MIN_BET, n));
      this.drawn = '';
    });
    const el = h(
      'div.modal.crash-panel',
      { role: 'dialog', 'aria-label': t('menus.crash') },
      h('header', {}, h('h2', {}, `🚀 ${t('menus.crash')} `, round)),
      h(
        'div.body',
        {},
        h('div.crash-top', {}, h('div', {}, status, balance), mult),
        h('div.crash-chips', {}, ...chips),
        h('div.crash-row', {}, input, bet, cancel),
        h('label.crash-row.crash-target', {}, h('span', {}, t('menus.crashAutoCash')), target, h('span', {}, '×')),
        cash,
        note,
        details,
      ),
    );
    this.els = { status, round, mult, balance, input, chips, bet, cancel, cash, note, target, auto: [target, loss, win, rounds, profit, limit], lossMode, winMode, go, autoNote, summary };
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
    const auto = this.hooks.auto();
    const autoOn = !!auto?.on;
    const key = [s.phase, s.round, s.of, s.odds.back, s.odds.max, m, Math.ceil(left / 100), me?.bet, me?.out, me?.auto, balance, this.amount, s.players.length, JSON.stringify(auto)].join('|');
    if (key === this.drawn) return;
    this.drawn = key;

    els.round.textContent = s.of ? `· ${t('menus.crashRound', { n: s.of, of: CYCLE })}${s.of === 1 && s.phase === 'betting' ? ` · ${t('menus.crashNewSeries')}` : ''}` : '';
    els.status.textContent =
      s.phase === 'betting' ? t('menus.crashBetting', { s: (left / 1000).toFixed(1) })
      : s.phase === 'running' ? t('menus.crashRunning')
      : t('menus.crashCrashedAt', { m: multText(s.crash ?? m) });
    // The multiplier once it's off; before that, the clock.
    els.mult.textContent = s.phase === 'betting' ? `${(left / 1000).toFixed(1)} s` : multText(m);
    els.mult.classList.toggle('crashed', s.phase === 'crashed');
    els.mult.classList.toggle('waiting', s.phase === 'betting');
    els.balance.textContent = t('menus.crashBalance', { n: balance.toLocaleString() });

    const canBet = s.phase === 'betting' && left > 0 && !me && !autoOn;
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
      : me && s.phase === 'betting' ? t('menus.crashYouAreIn', { n: me.bet.toLocaleString() })
      : me && s.phase === 'running' && me.out === undefined ? t('menus.crashSpace')
      : amount > balance && canBet ? t('menus.crashTooMuch')
      : '';
    els.note.style.display = els.note.textContent ? '' : 'none';

    // Auto-Start: its settings are fixed while it runs; the line under it says how it's going, or why it stopped.
    for (const el of [...els.auto, els.lossMode, els.winMode]) el.disabled = autoOn;
    els.auto[1].disabled = autoOn || !els.lossMode.value;
    els.auto[2].disabled = autoOn || !els.winMode.value;
    els.go.textContent = autoOn ? t('menus.crashAutoHalt') : t('menus.crashAutoGo', { n: amount.toLocaleString() });
    els.go.classList.toggle('primary', !autoOn);
    const vars: Vars = auto ? { rounds: auto.rounds, profit: signed(auto.profit), next: auto.next.toLocaleString(), max: MAX_BET.toLocaleString() } : {};
    els.autoNote.textContent = auto?.on ? t('menus.crashAutoOn', vars) : auto?.stopped ? t(`menus.crashStop_${auto.stopped}` as Key, vars) : '';
    els.autoNote.style.display = els.autoNote.textContent ? '' : 'none';
    els.summary.textContent = autoOn ? `· ${signed(auto!.profit)}` : '';
  }

  private saveFields() {
    try {
      localStorage.setItem(AUTO_KEY, JSON.stringify(this.fields));
    } catch {
      // Just not remembered for next time.
    }
  }

  /** The auto-bet's settings from the fields: the bet amount as its base, null if a field doesn't check out. */
  private autoSettings(): CrashAutoBet | null {
    const f = this.fields;
    const els = this.els;
    const s: Record<string, number | undefined> = {
      base: Math.floor(this.amount),
      target: targetOf(f.target),
      onLoss: els?.lossMode.value ? wholeOf(f.loss) : 0,
      onWin: els?.winMode.value ? wholeOf(f.win) : 0,
      rounds: wholeOf(f.rounds),
      profit: wholeOf(f.profit),
      loss: wholeOf(f.limit),
    };
    for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
    if (f.target.trim() && s.target === undefined) return null;
    return autoBetOk(s);
  }

  private toggleAuto() {
    if (this.hooks.auto()?.on) return this.hooks.autoBet(null);
    const s = this.autoSettings();
    if (!s) {
      if (this.els) this.els.autoNote.textContent = t('menus.crashAutoBad');
      if (this.els) this.els.autoNote.style.display = '';
      return;
    }
    this.hooks.autoBet(s);
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
    this.hooks.bet(n, targetOf(this.fields.target));
  }

  /** Space cashes out, Enter bets, while the panel's open (Esc closes it, as any window). */
  private onKey = (e: KeyboardEvent) => {
    if (!this.modal) return;
    // Typing in a field (Enter, a space) is just typing.
    const typing = e.target instanceof HTMLElement && e.target.closest('.crash-auto, .crash-target');
    if (typing) return;
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
