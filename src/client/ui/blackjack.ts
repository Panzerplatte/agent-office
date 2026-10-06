import { locale, t } from '../i18n';
import { MAX_BET, MIN_BET, allowed, handValue, isBlackjack, suitOf, type BjAction, type BjHand, type BjPlayer, type BlackjackState, type Card, type Outcome } from '../../shared/blackjack';
import { rankLabel } from '../world/cards';
import { $, h } from './dom';

export interface BlackjackPanelHooks {
  /** Put `amount` down for the next round (0 takes it back). */
  bet(amount: number): void;
  /** Deal now, without waiting for the others' bets. */
  deal(): void;
  act(action: BjAction): void;
  insure(take: boolean): void;
  /** Stand the hand of whoever's up while they're away. */
  skip(): void;
  /** Get up from the table for good. */
  leave(): void;
}

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
/** The chips you put a bet together from. */
export const CHIPS = [5, 25, 100, 500, 1000, 5000] as const;

/** An amount of chips as it's written in the panels: 10,000 (10.000 in German). */
export const amountText = (v: number) => v.toLocaleString(locale());

/** What's written on a chip: 5, 500, 1k, 5k. */
export const chipLabel = (v: number) => (v >= 1000 ? `${v / 1000}k` : String(v));

/** A hand's total as it's written: "17", "7 / 17" while an ace could still be 1 or 11 (not once it's `done`), "BJ" for a blackjack. */
export function totalLabel(cards: readonly Card[], split = false, done = false): string {
  if (!cards.length) return '';
  if (!split && isBlackjack(cards)) return 'BJ';
  const v = handValue(cards);
  return v.soft && v.total < 21 && !done ? `${v.total - 10} / ${v.total}` : String(v.total);
}

const OUTCOME: Record<Outcome, string> = {
  blackjack: 'menus.bjOutBlackjack',
  win: 'menus.bjOutWin',
  push: 'menus.bjOutPush',
  lose: 'menus.bjOutLose',
  bust: 'menus.bjOutBust',
};

/** A small card, as in the corner of a real one: "10♥" in red, or a back for one that's face down. */
function mini(c: Card | null): HTMLElement {
  if (!c) return h('span.bj-card.back');
  const s = suitOf(c);
  return h(`span.bj-card${s === 'H' || s === 'D' ? '.red' : ''}`, {}, `${rankLabel(c)}${SUIT[s]}`);
}

/** What a hand shows: its cards, its total, its stake, and how it came out. */
function hand(hd: BjHand, up: boolean): HTMLElement {
  const out = hd.outcome ? h(`span.bj-out.${hd.outcome}`, {}, `${t(OUTCOME[hd.outcome] as 'menus.bjOutWin')}${hd.paid ? ` +${hd.paid}` : ''}`) : '';
  return h(
    `div.bj-hand${up ? '.up' : ''}`,
    {},
    h('span.bj-cards', {}, ...hd.cards.map(mini)),
    h('span.bj-total', {}, totalLabel(hd.cards, hd.split, hd.done)),
    h('span.bj-stake', {}, `${amountText(hd.bet)}${hd.doubled ? ' ×2' : ''}`),
    out,
  );
}

/**
 * The panel at the blackjack table, at the bottom of the screen: the dealer's cards and total, each
 * seat with its bet or its hands (totals, stakes, and once the round's over how each came out and
 * what it paid), whose turn it is and the clock, and what you can do now: put a bet together from
 * chips and place it (or the same as last time) while bets are open, insurance under an ace, Hit,
 * Stand, Double and Split on your turn. Skip stands an away player's hand; Leave gives up your seat.
 */
export class BlackjackPanel {
  readonly el: HTMLElement;
  private readonly dealer: HTMLElement;
  private readonly seats: HTMLElement;
  private readonly status: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly betting: HTMLElement;
  private readonly amount: HTMLElement;
  private readonly placeBtn: HTMLButtonElement;
  private readonly againBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly takeBackBtn: HTMLButtonElement;
  private readonly dealBtn: HTMLButtonElement;
  private readonly chipBtns: HTMLButtonElement[];
  private readonly insurance: HTMLElement;
  private readonly insureBtn: HTMLButtonElement;
  private readonly moves: HTMLElement;
  private readonly moveBtns: Record<BjAction, HTMLButtonElement>;
  private readonly skipBtn: HTMLButtonElement;
  private readonly balanceEl: HTMLElement;
  /** The bet you're putting together, before you place it. */
  private pending = 0;
  private shown = '';
  private last: { d: BlackjackState; you: string; balance: number | null } | null = null;

  constructor(private readonly hooks: BlackjackPanelHooks) {
    this.balanceEl = h('span.bj-balance');
    const title = h('div.darts-title.bj-head', {}, h('span', {}, t('menus.bjTitle')), this.balanceEl);
    this.dealer = h('div.bj-dealer');
    this.seats = h('div.bj-seats');
    this.clock = h('div.bj-clock', {}, h('span'));
    this.status = h('div.pool-status.bj-status');

    this.amount = h('span.bj-amount');
    this.chipBtns = CHIPS.map((c) => {
      const b = h(`button.bj-chip.c${c}`, { type: 'button', title: t('menus.bjAddChip', { n: amountText(c) }) }, chipLabel(c));
      b.addEventListener('click', () => this.add(c));
      return b;
    });
    this.clearBtn = h('button.btn', { type: 'button' }, t('menus.bjClear'));
    this.clearBtn.addEventListener('click', () => this.setPending(0));
    this.placeBtn = h('button.btn.primary', { type: 'button' }, t('menus.bjPlace'));
    this.placeBtn.addEventListener('click', () => this.pending && hooks.bet(this.pending));
    this.againBtn = h('button.btn', { type: 'button' }, '');
    this.againBtn.addEventListener('click', () => {
      const last = this.mySeat()?.last;
      if (last) hooks.bet(last);
    });
    this.takeBackBtn = h('button.btn', { type: 'button' }, t('menus.bjTakeBack'));
    this.takeBackBtn.addEventListener('click', () => hooks.bet(0));
    this.dealBtn = h('button.btn.primary', { type: 'button' }, t('menus.bjDeal'));
    this.dealBtn.addEventListener('click', () => hooks.deal());
    this.betting = h(
      'div.bj-betting',
      {},
      h('div.bj-chips', {}, ...this.chipBtns, this.amount),
      h('div.darts-lobby', {}, this.clearBtn, this.againBtn, this.placeBtn, this.takeBackBtn, this.dealBtn),
    );

    this.insureBtn = h('button.btn.primary', { type: 'button' }, '');
    this.insureBtn.addEventListener('click', () => hooks.insure(true));
    const noInsurance = h('button.btn', { type: 'button' }, t('menus.bjNoInsurance'));
    noInsurance.addEventListener('click', () => hooks.insure(false));
    this.insurance = h('div.darts-lobby', {}, this.insureBtn, noInsurance);

    const move = (a: BjAction, label: string, hotkey: string) => {
      const b = h('button.btn.bj-move', { type: 'button', title: `${label} (${hotkey})` }, h('kbd', {}, hotkey), ` ${label}`);
      b.addEventListener('click', () => hooks.act(a));
      return b;
    };
    this.moveBtns = {
      hit: move('hit', t('menus.bjHit'), '1'),
      stand: move('stand', t('menus.bjStand'), '2'),
      double: move('double', t('menus.bjDouble'), '3'),
      split: move('split', t('menus.bjSplit'), '4'),
    };
    this.moves = h('div.darts-lobby.bj-moves', {}, ...Object.values(this.moveBtns));

    this.skipBtn = h('button.btn.hidden', { type: 'button' }, t('menus.bjSkip'));
    this.skipBtn.addEventListener('click', () => hooks.skip());
    const leaveBtn = h('button.btn.pool-leave', { type: 'button', title: t('menus.bjLeaveNote') }, t('menus.bjLeave'));
    leaveBtn.addEventListener('click', () => hooks.leave());
    const footer = h('div.darts-lobby', {}, this.skipBtn, leaveBtn);

    this.el = h('div.darts.bj.panel.hidden', { id: 'blackjack', 'aria-label': t('menus.bjTitle') }, title, this.dealer, this.seats, this.clock, this.status, this.betting, this.insurance, this.moves, footer);
    // A click on a button mustn't leave it focused, or the keys would press it again.
    this.el.addEventListener('pointerdown', (e) => e.preventDefault());
    $('hud').append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) {
      this.shown = '';
      this.pending = 0;
    }
  }

  /** The keys at the table: 1 Hit, 2 Stand, 3 Double, 4 Split (each only when it's allowed). Says whether it was one. */
  key(code: string): boolean {
    const a = ({ Digit1: 'hit', Digit2: 'stand', Digit3: 'double', Digit4: 'split' } as const)[code as 'Digit1'];
    if (!a) return false;
    const b = this.moveBtns[a];
    if (!this.moves.classList.contains('hidden') && !b.disabled) this.hooks.act(a);
    return true;
  }

  /** The clock alone, every frame (`left` ms of `total`). */
  tick(left: number | null, total: number) {
    this.clock.classList.toggle('hidden', left === null || !total);
    if (left === null || !total) return;
    (this.clock.firstChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, left / total)) * 100}%`;
  }

  /** The table as the office says (`you` your peer id, `balance` your chips, if known). */
  render(d: BlackjackState, you: string, balance: number | null) {
    this.last = { d, you, balance };
    const k = JSON.stringify([d.seats, d.stage, d.round, you, balance, this.pending]);
    if (k === this.shown) return;
    this.shown = k;
    const r = d.round;
    const me = d.seats.find((s) => s.peer === you);
    const mine = r && me ? r.players.find((p) => p.id === me.id) : undefined;
    this.balanceEl.textContent = balance === null ? '' : t('menus.bjBalance', { n: amountText(balance) });

    // The dealer.
    const dealerCards = r?.dealer ?? [];
    const known = dealerCards.filter((c): c is Card => !!c);
    this.dealer.replaceChildren(
      h('span.bj-who', {}, t('menus.bjDealer')),
      h('span.bj-cards', {}, ...dealerCards.map(mini)),
      h('span.bj-total', {}, known.length === dealerCards.length ? totalLabel(known, false, d.stage === 'done') : known.length ? `${totalLabel(known)} + ?` : ''),
    );

    // The seats.
    const upId = r?.turn ? r.players[r.turn.player]?.id : undefined;
    this.seats.replaceChildren(
      ...d.seats.map((s) => {
        const p = r?.players.find((pl) => pl.id === s.id);
        const name = `${s.name}${s.peer === you ? ` ${t('menus.dartsYou')}` : ''}${s.peer ? '' : ` ${t('menus.poolAway')}`}`;
        const cls = ['bj-seat', s.id === upId ? 'up' : '', s.peer ? '' : 'away', s.peer === you ? 'me' : ''].filter(Boolean).join('.');
        const body = p ? this.hands(p, s.id === upId ? r!.turn!.hand : -1) : s.bet ? [h('span.bj-bet', {}, t('menus.bjBetDown', { n: amountText(s.bet) }))] : [h('span.bj-nobet', {}, '—')];
        return h(`div.${cls}`, {}, h('span.bj-seat-name', {}, name), ...body);
      }),
    );
    if (!d.seats.length) this.seats.append(h('div.pool-empty', {}, '—'));

    // What's going on.
    const lines: { text: string; cls: string }[] = [];
    const up = upId ? d.seats.find((s) => s.id === upId) : undefined;
    if (d.stage === 'idle') lines.push({ text: t(me ? 'menus.bjPlaceBets' : 'menus.bjWatching'), cls: '' });
    else if (d.stage === 'betting') lines.push({ text: t('menus.bjBetsOpen'), cls: '' });
    else if (d.stage === 'insurance') lines.push({ text: t(mine && mine.insurance === null ? 'menus.bjInsuranceAsk' : 'menus.bjInsuranceWait'), cls: 'up' });
    else if (d.stage === 'playing' && up) {
      lines.push({ text: up.peer === you ? t('menus.bjYourTurn') : t('menus.bjTheirTurn', { name: up.name }), cls: 'up' });
      if (!up.peer) lines.push({ text: t('menus.bjIsAway', { name: up.name }), cls: 'foul' });
    } else if (d.stage === 'dealer') lines.push({ text: t('menus.bjDealerPlays'), cls: '' });
    else if (d.stage === 'done' && r) {
      const dv = known.length === dealerCards.length ? handValue(known).total : 0;
      lines.push({ text: isBlackjack(known) ? t('menus.bjDealerBlackjack') : dv > 21 ? t('menus.bjDealerBust') : t('menus.bjDealerHas', { n: dv }), cls: '' });
      if (mine) {
        const net = (mine.paid ?? 0) - mine.hands.reduce((a, hd) => a + hd.bet, 0) - (mine.insurance ?? 0);
        lines.push({ text: net > 0 ? t('menus.bjYouWon', { n: amountText(net) }) : net < 0 ? t('menus.bjYouLost', { n: amountText(-net) }) : t('menus.bjYouEven'), cls: net > 0 ? 'won' : net < 0 ? 'foul' : '' });
      }
    }
    if (d.shoe.shuffled && d.stage !== 'idle' && d.stage !== 'betting') lines.push({ text: t('menus.bjShuffled'), cls: '' });
    this.status.replaceChildren(...lines.map((l) => h('div', { class: l.cls || undefined }, l.text)));

    // Betting.
    const open = !!me && (d.stage === 'idle' || d.stage === 'betting');
    this.betting.classList.toggle('hidden', !open);
    if (open) {
      const down = me!.bet;
      const cap = Math.min(MAX_BET, balance ?? MAX_BET);
      if (this.pending > cap) this.pending = 0;
      for (const [i, b] of this.chipBtns.entries()) b.disabled = !!down || this.pending + CHIPS[i] > cap;
      this.amount.textContent = down ? t('menus.bjBetDown', { n: amountText(down) }) : this.pending ? amountText(this.pending) : t('menus.bjMinMax', { min: MIN_BET, max: amountText(MAX_BET) });
      this.amount.classList.toggle('down', !!down);
      this.clearBtn.classList.toggle('hidden', !!down || !this.pending);
      this.placeBtn.classList.toggle('hidden', !!down);
      this.placeBtn.disabled = this.pending < MIN_BET;
      const again = me!.last && me!.last <= cap && !down && !this.pending ? me!.last : 0;
      this.againBtn.classList.toggle('hidden', !again);
      this.againBtn.textContent = t('menus.bjAgain', { n: amountText(again) });
      this.takeBackBtn.classList.toggle('hidden', !down);
      this.dealBtn.classList.toggle('hidden', !down || d.stage !== 'betting');
    }

    // Insurance.
    const askInsurance = d.stage === 'insurance' && !!mine && mine.insurance === null;
    this.insurance.classList.toggle('hidden', !askInsurance);
    if (askInsurance) {
      const cost = Math.floor(mine!.hands[0].bet / 2);
      this.insureBtn.textContent = t('menus.bjInsure', { n: amountText(cost) });
      this.insureBtn.disabled = !cost || (balance !== null && balance < cost);
    }

    // Your moves.
    const can = r && me ? allowed(r, me.id) : [];
    this.moves.classList.toggle('hidden', !can.length);
    if (can.length) {
      const stake = mine!.hands[r!.turn!.hand].bet;
      for (const a of ['hit', 'stand', 'double', 'split'] as const) {
        const ok = can.includes(a) && ((a !== 'double' && a !== 'split') || balance === null || balance >= stake);
        this.moveBtns[a].disabled = !ok;
        this.moveBtns[a].classList.toggle('hidden', !can.includes(a) && (a === 'double' || a === 'split'));
      }
    }

    this.skipBtn.classList.toggle('hidden', !me || d.stage !== 'playing' || !up || !!up.peer);
  }

  private hands(p: BjPlayer, upHand: number): HTMLElement[] {
    const out = p.hands.map((hd, i) => hand(hd, i === upHand));
    if (p.insurance) out.push(h('span.bj-ins', {}, `${t('menus.bjInsurance', { n: amountText(p.insurance) })}${p.insurancePaid ? ` +${amountText(p.insurancePaid)}` : ''}`));
    return out;
  }

  private mySeat() {
    return this.last?.d.seats.find((s) => s.peer === this.last!.you);
  }

  private add(c: number) {
    this.setPending(this.pending + c);
  }

  private setPending(n: number) {
    this.pending = n;
    if (this.last) this.render(this.last.d, this.last.you, this.last.balance);
  }
}

