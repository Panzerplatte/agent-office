import { t, locale } from '../i18n';
import { DENOMINATIONS, MAX_TOTAL, colorOf, numberAt, spotAt, spotOf, spotPlace, staked, type RouletteState, type Spot } from '../../shared/roulette';
import { CHIP_FACE } from '../world/roulette';
import { $, h } from './dom';

export interface RoulettePanelHooks {
  /** Put `amount` chips on `spot`. */
  bet(spot: string, amount: number): void;
  /** Pick your chips up off `spot`, or off the whole layout. */
  unbet(spot?: string): void;
  /** The same bets as last round, again. */
  rebet(): void;
  /** Leave the table (with your chips, while bets are open). */
  leave(): void;
}

/** What the panel shows besides the table: who you are at it, your balance, how long bets are open, and whether the ball's in. */
export interface RouletteView {
  you: string;
  balance: number;
  /** Seconds left to bet, or of the spin. */
  left: number;
  /** The ball's in its pocket: the winners can be shown. */
  settled: boolean;
  /** There's a last round's bet of yours to put down again. */
  canRebet: boolean;
}

const OUTSIDE: [string, () => string][] = [
  ['low', () => '1–18'],
  ['even', () => t('menus.rouletteEven')],
  ['red', () => '◆'],
  ['black', () => '◆'],
  ['odd', () => t('menus.rouletteOdd')],
  ['high', () => '19–36'],
];

const n = (v: number) => v.toLocaleString(locale());

/** How a spot reads: "17", "Split 17/20", "Red", "1st 12" … */
export function spotName(spot: Spot): string {
  const nums = spot.numbers.join('/');
  switch (spot.kind) {
    case 'straight':
      return nums;
    case 'split':
    case 'street':
    case 'corner':
    case 'line':
      return `${t(`menus.roulette_${spot.kind}`)} ${nums}`;
    case 'dozen':
      return t('menus.rouletteDozen', { n: spot.id.slice(-1) });
    case 'column':
      return t('menus.rouletteColumn', { n: spot.id.slice(-1) });
    default:
      return t(`menus.roulette_${spot.kind}`);
  }
}

/**
 * The panel at the bottom while you sit at the roulette table: the betting layout, laid out like the
 * one on the felt (the zero, the numbers in twelve streets of three, the columns' 2 to 1, the dozens
 * and the even-money bets). Click to put a chip of the value picked down; on the numbers, where you
 * click says what bet it is (the middle of a number, the line between two, the corner of four, the
 * edge for a street or six line), and the numbers it covers light up as you point. Right-click picks
 * your chips on a spot up again. Over it: the clock, what's happening, and the last numbers; under
 * it: the chip values, your balance and what you have down, Clear, Rebet and Leave.
 */
export class RoulettePanel {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly history: HTMLElement;
  private readonly nums: HTMLElement;
  private readonly cells = new Map<number, HTMLElement>();
  private readonly boxes = new Map<string, HTMLElement>();
  private readonly marks: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly balance: HTMLElement;
  private readonly down: HTMLElement;
  private readonly result: HTMLElement;
  private readonly denoms: HTMLButtonElement[];
  private readonly clear: HTMLButtonElement;
  private readonly rebet: HTMLButtonElement;
  private chip: number = DENOMINATIONS[1];
  private state: RouletteState | null = null;
  private view: RouletteView | null = null;
  private shown = '';

  constructor(private readonly hooks: RoulettePanelHooks) {
    this.status = h('div.rl-status');
    this.clock = h('div.rl-clock');
    this.history = h('div.rl-history', { title: t('menus.rouletteHistory') });
    // The zero, the numbers (one area, where the pointer says which bet), the columns.
    const zero = this.box('straight:0', h('div.rl-cell.rl-zero.green', {}, '0'));
    this.cells.set(0, zero);
    this.nums = h('div.rl-nums');
    for (let row = 0; row < 3; row++)
      for (let street = 0; street < 12; street++) {
        const num = numberAt(street, row);
        const c = h('div.rl-cell', { class: colorOf(num), style: `grid-column:${street + 1};grid-row:${row + 1}` }, String(num));
        this.cells.set(num, c);
        this.nums.append(c);
      }
    this.marks = h('div.rl-marks');
    this.hover = h('div.rl-hover.hidden');
    this.nums.append(this.marks, this.hover);
    this.nums.addEventListener('pointermove', (e) => this.point(e));
    this.nums.addEventListener('pointerleave', () => this.point(null));
    this.nums.addEventListener('click', (e) => {
      const s = this.spotUnder(e);
      if (s) this.hooks.bet(s.id, this.chip);
    });
    this.nums.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const s = this.spotUnder(e);
      if (s) this.hooks.unbet(s.id);
    });
    const columns = h('div.rl-columns', {}, ...[3, 2, 1].map((c) => this.box(`column:${c}`, h('div.rl-cell.rl-out', {}, '2:1'))));
    const dozens = h('div.rl-dozens', {}, ...[1, 2, 3].map((d) => this.box(`dozen:${d}`, h('div.rl-cell.rl-out', {}, t('menus.rouletteDozenShort', { n: d })))));
    const outside = h('div.rl-outside', {}, ...OUTSIDE.map(([id, label]) => this.box(id, h('div.rl-cell.rl-out', { class: id === 'red' || id === 'black' ? `diamond ${id}` : '' }, label()))));
    const board = h('div.rl-board', {}, zero, this.nums, columns, h('div'), dozens, h('div'), h('div'), outside, h('div'));
    this.denoms = DENOMINATIONS.map((d) => {
      const b = h('button.rl-chip', { type: 'button', style: `--chip:${CHIP_FACE[d]}`, title: t('menus.rouletteChipValue', { n: n(d) }) }, d >= 1000 ? `${d / 1000}k` : String(d));
      b.addEventListener('click', () => {
        this.chip = d;
        this.paintDenoms();
      });
      return b;
    });
    this.balance = h('span.rl-balance');
    this.down = h('span.rl-down');
    this.result = h('div.rl-result.hidden');
    this.clear = h('button.btn', { type: 'button', title: t('menus.rouletteClearNote') }, t('menus.rouletteClear'));
    this.clear.addEventListener('click', () => this.hooks.unbet());
    this.rebet = h('button.btn', { type: 'button', title: t('menus.rouletteRebetNote') }, t('menus.rouletteRebet'));
    this.rebet.addEventListener('click', () => this.hooks.rebet());
    const leave = h('button.btn.rl-leave', { type: 'button', title: t('menus.rouletteLeaveNote') }, t('menus.rouletteLeave'));
    leave.addEventListener('click', () => this.hooks.leave());
    this.el = h(
      'div.roulette.panel.hidden',
      { id: 'roulette', 'aria-label': t('menus.roulette') },
      h('div.rl-top', {}, h('div.rl-title', {}, '🎡 ', t('menus.roulette')), this.status, this.clock),
      this.history,
      board,
      this.result,
      h('div.rl-bottom', {}, h('div.rl-chips', {}, ...this.denoms), h('div.rl-sums', {}, this.balance, this.down), h('div.rl-buttons', {}, this.clear, this.rebet, leave)),
    );
    // A click on a button mustn't leave it focused (Space and Enter would press it again).
    this.el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    $('hud').append(this.el);
    this.paintDenoms();
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) this.shown = '';
  }

  /** The table as it is, and what goes with it (see RouletteView). */
  render(s: RouletteState, v: RouletteView) {
    this.state = s;
    this.view = v;
    const k = JSON.stringify([s.phase, s.round, s.bets, s.seats, s.number, s.history, s.wins, v]);
    if (k === this.shown) return;
    this.shown = k;
    const me = s.seats.find((x) => x.peer === v.you);
    const open = s.phase === 'idle' || s.phase === 'betting';
    const mine = me ? staked(s.bets, me.id) : 0;

    this.status.textContent =
      s.phase === 'idle' ? t('menus.rouletteIdle')
      : s.phase === 'betting' ? t('menus.rouletteBetting')
      : !v.settled ? t('menus.rouletteNoMore')
      : `${s.number} ${t(`menus.roulette_${colorOf(s.number!)}`)}`;
    this.status.className = `rl-status ${s.phase === 'spinning' && !v.settled ? 'closed' : ''}`;
    this.clock.textContent = s.phase === 'betting' ? String(Math.ceil(v.left)) : '';
    this.clock.classList.toggle('soon', s.phase === 'betting' && v.left <= 5);

    this.history.replaceChildren(...(s.history.length ? s.history.map((x, i) => h('span', { class: `${colorOf(x)}${i === 0 && s.phase !== 'spinning' ? ' last' : ''}` }, String(x))) : [h('span.none', {}, t('menus.rouletteNoHistory'))]));

    // The winning number and the bets it won, lit up once the ball's in.
    const won = v.settled && s.number !== null ? s.number : null;
    for (const [num, c] of this.cells) c.classList.toggle('win', num === won);
    for (const [id, b] of this.boxes) b.classList.toggle('win', won !== null && !!spotOf(id)?.numbers.includes(won));

    // Everyone's chips: a disc in their colour with what's on it, a little apart where several share a spot.
    for (const b of this.boxes.values()) b.querySelector('.rl-stack-wrap')?.remove();
    this.marks.replaceChildren();
    const colorOfSeat = new Map(s.seats.map((x) => [x.id, x.color]));
    const count = new Map<string, number>();
    for (const b of s.bets) {
      const spot = spotOf(b.spot);
      if (!spot) continue;
      const nth = count.get(b.spot) ?? 0;
      count.set(b.spot, nth + 1);
      const winner = won !== null && spot.numbers.includes(won);
      const disc = h('span.rl-stack', { class: [b.seat === me?.id && 'mine', winner && 'won', won !== null && !winner && 'lost'].filter(Boolean).join(' '), style: `--who:${colorOfSeat.get(b.seat) ?? '#999'};--nth:${nth}`, title: `${s.seats.find((x) => x.id === b.seat)?.name ?? ''}: ${n(b.amount)} · ${spotName(spot)}` }, short(b.amount));
      const place = spotPlace(spot);
      if (place) {
        disc.style.left = `${(place.u / 12) * 100}%`;
        disc.style.top = `${(place.v / 3) * 100}%`;
        this.marks.append(disc);
      } else {
        const box = this.boxes.get(spot.id);
        if (!box) continue;
        let wrap = box.querySelector<HTMLElement>('.rl-stack-wrap');
        if (!wrap) box.append((wrap = h('span.rl-stack-wrap')));
        wrap.append(disc);
      }
    }

    // What came back to you this round.
    const mineWin = me && v.settled ? s.wins.find((w) => w.seat === me.id) : undefined;
    this.result.classList.toggle('hidden', !mineWin);
    if (mineWin) {
      this.result.textContent = mineWin.paid > 0 ? t('menus.rouletteYouWon', { n: n(mineWin.paid) }) : t('menus.rouletteYouLost', { n: n(mineWin.staked) });
      this.result.className = `rl-result ${mineWin.paid > 0 ? 'won' : 'lost'}`;
    }

    this.balance.textContent = t('menus.rouletteBalance', { n: n(v.balance) });
    this.down.textContent = t('menus.rouletteDown', { n: n(mine), max: n(MAX_TOTAL) });
    this.el.classList.toggle('closed', !open);
    this.clear.disabled = !open || mine === 0;
    this.rebet.disabled = !open || !v.canRebet;
    this.paintDenoms();
  }

  /** The value of chip that goes down on a click. */
  get value(): number {
    return this.chip;
  }

  /** One of the boxes off the numbers (the zero, a column, a dozen, an even-money bet): click to bet, right-click to pick up. */
  private box(id: string, el: HTMLElement): HTMLElement {
    const spot = spotOf(id)!;
    el.title = spotName(spot);
    el.addEventListener('click', () => this.hooks.bet(id, this.chip));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.hooks.unbet(id);
    });
    el.addEventListener('pointerenter', () => this.cover(spot));
    el.addEventListener('pointerleave', () => this.cover(null));
    this.boxes.set(id, el);
    return el;
  }

  /** The bet under the pointer on the numbers. */
  private spotUnder(e: MouseEvent): Spot | undefined {
    const r = this.nums.getBoundingClientRect();
    return spotAt(((e.clientX - r.left) / r.width) * 12, ((e.clientY - r.top) / r.height) * 3);
  }

  /** Pointing at the numbers: the bet there, its numbers lit, and a chip where it would go. */
  private point(e: PointerEvent | null) {
    const s = e ? this.spotUnder(e) : undefined;
    this.cover(s ?? null);
    const place = s && spotPlace(s);
    this.hover.classList.toggle('hidden', !place);
    if (place && s) {
      this.hover.style.left = `${(place.u / 12) * 100}%`;
      this.hover.style.top = `${(place.v / 3) * 100}%`;
      this.hover.style.setProperty('--chip', CHIP_FACE[this.chip]);
      this.nums.title = spotName(s);
    }
  }

  private cover(spot: Spot | null) {
    const on = new Set(spot?.numbers ?? []);
    for (const [num, c] of this.cells) c.classList.toggle('cover', on.has(num));
  }

  private paintDenoms() {
    const v = this.view;
    const room = v && this.state ? Math.min(v.balance, MAX_TOTAL - staked(this.state.bets, this.state.seats.find((x) => x.peer === v.you)?.id ?? '')) : Infinity;
    for (const [i, b] of this.denoms.entries()) {
      b.classList.toggle('on', DENOMINATIONS[i] === this.chip);
      b.classList.toggle('short', DENOMINATIONS[i] > room);
    }
  }
}

/** A stack's amount, short: 5, 25, 1.2k. */
function short(v: number): string {
  return v >= 1000 ? `${(v / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })}k` : String(v);
}
