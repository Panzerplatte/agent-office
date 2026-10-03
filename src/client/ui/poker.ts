import { locale, t, type Key } from '../i18n';
import { BIG_BLIND, MAX_BOTS, MAX_BUY_IN, MIN_BUY_IN, SMALL_BLIND, bestHand, type Card, type HandCategory, type LastAction, type PokerAction, type PokerState, type Street } from '../../shared/poker';
import { isRed, rankLabel, suitGlyph } from '../world/pokercards';
import { $, h } from './dom';

export interface PokerPanelHooks {
  /** Sit down in the seat you're in with `buyIn` chips. */
  sit(buyIn: number): void;
  act(a: PokerAction): void;
  topUp(amount: number): void;
  bot(add: boolean): void;
  /** Leave the table, with your chips. */
  leave(): void;
}

/** "1,250" or "1.250", as your language writes it. */
export const chipsText = (n: number) => n.toLocaleString(locale());

export const handName = (c: HandCategory) => t(`menus.pokerHand_${c}` as Key);
const lastName = (l: LastAction) => t(`menus.pokerLast_${l}` as Key);
const streetName = (s: Street) => t(`menus.pokerStreet_${s}` as Key);

/** A card as the panel shows it: white, rank and suit, red or black; face down without one. */
export function cardEl(c: Card | null, big = false): HTMLElement {
  if (!c) return h(`span.poker-card.back${big ? '.big' : ''}`);
  return h(`span.poker-card${isRed(c) ? '.red' : ''}${big ? '.big' : ''}`, {}, h('b', {}, rankLabel(c)), h('i', {}, suitGlyph(c)));
}

/**
 * The panel at the bottom while you sit at the poker table. Not in the game yet: what you buy in
 * with, and Sit down. In it: the board and the pot, your two cards (and what they make), everyone at
 * the table with their chips, bet and last move, whose turn it is with the clock, and on your turn
 * Fold, Check or Call, and Bet or Raise with a slider (½ pot, pot, all-in). Dealer-Bots come and go
 * from here, you top up between hands, and Leave (or Esc) cashes you out. Standing up keeps your seat.
 */
export class PokerPanel {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly table: HTMLElement;
  private readonly seats: HTMLElement;
  private readonly mine: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly fold: HTMLButtonElement;
  private readonly call: HTMLButtonElement;
  private readonly raise: HTMLButtonElement;
  private readonly allIn: HTMLButtonElement;
  private readonly slider: HTMLInputElement;
  private readonly sizes: HTMLElement;
  private readonly join: HTMLElement;
  private readonly buyIn: HTMLInputElement;
  private readonly buyInText: HTMLElement;
  private readonly sitBtn: HTMLButtonElement;
  private readonly tools: HTMLElement;
  private readonly addBot: HTMLButtonElement;
  private readonly dropBot: HTMLButtonElement;
  private readonly topUp: HTMLButtonElement;
  private readonly back: HTMLButtonElement;
  private readonly leave: HTMLButtonElement;
  private state: PokerState | null = null;
  private shown = '';
  /** When the turn's clock runs out (performance.now()), for the countdown. */
  private deadline = 0;

  constructor(private readonly hooks: PokerPanelHooks) {
    this.title = h('div.darts-title', {}, t('menus.pokerTitle', { sb: SMALL_BLIND, bb: BIG_BLIND }));
    this.status = h('div.darts-status');
    this.table = h('div.poker-table');
    this.seats = h('ul.darts-players.poker-seats');
    this.mine = h('div.poker-mine');

    this.fold = h('button.btn', { type: 'button' }, t('menus.pokerFold'));
    this.fold.addEventListener('click', () => hooks.act({ kind: 'fold' }));
    this.call = h('button.btn', { type: 'button' });
    this.call.addEventListener('click', () => {
      const turn = this.state?.turn;
      if (turn) hooks.act(turn.check ? { kind: 'check' } : { kind: 'call' });
    });
    this.raise = h('button.btn.primary', { type: 'button' });
    this.raise.addEventListener('click', () => {
      const turn = this.state?.turn;
      if (!turn) return;
      const to = Number(this.slider.value);
      hooks.act(to >= turn.max ? { kind: 'allin' } : { kind: 'raise', to });
    });
    this.allIn = h('button.btn', { type: 'button' });
    this.allIn.addEventListener('click', () => hooks.act({ kind: 'allin' }));
    this.slider = h('input.poker-slider', { type: 'range', step: String(SMALL_BLIND) });
    this.slider.addEventListener('input', () => this.raiseText());
    const size = (label: string, frac: number) => {
      const b = h('button.btn', { type: 'button' }, label);
      b.addEventListener('click', () => {
        const s = this.state;
        if (!s?.turn) return;
        const me = s.seats[s.you];
        const call = s.turn.call;
        // A bet of `frac` of the pot; a raise of it, on top of calling.
        const to = s.currentBet === 0 ? Math.round(s.pot * frac) : s.currentBet + Math.round((s.pot + call) * frac);
        this.slider.value = String(Math.max(s.turn.min, Math.min(s.turn.max, to, (me?.bet ?? 0) + (me?.stack ?? 0))));
        this.raiseText();
      });
      return b;
    };
    this.sizes = h('div.poker-sizes', {}, size(t('menus.pokerHalfPot'), 0.5), size(t('menus.pokerPot'), 1));
    this.actions = h('div.poker-actions', {}, h('div.poker-row', {}, this.fold, this.call, this.allIn), h('div.poker-row', {}, this.slider), h('div.poker-row', {}, this.sizes, this.raise));

    this.buyIn = h('input.poker-slider', { type: 'range', min: String(MIN_BUY_IN), max: String(MAX_BUY_IN), step: String(BIG_BLIND) });
    this.buyInText = h('span.poker-buyin');
    this.buyIn.addEventListener('input', () => (this.buyInText.textContent = chipsText(Number(this.buyIn.value))));
    this.sitBtn = h('button.btn.primary', { type: 'button' }, t('menus.pokerSitDown'));
    this.sitBtn.addEventListener('click', () => hooks.sit(Number(this.buyIn.value)));
    this.join = h('div.poker-join', {}, h('div.poker-row', {}, h('span', {}, t('menus.pokerBuyIn')), this.buyInText), this.buyIn, this.sitBtn);

    this.addBot = h('button.btn', { type: 'button', title: t('menus.pokerBotNote') }, t('menus.pokerAddBot'));
    this.addBot.addEventListener('click', () => hooks.bot(true));
    this.dropBot = h('button.btn', { type: 'button' }, t('menus.pokerDropBot'));
    this.dropBot.addEventListener('click', () => hooks.bot(false));
    this.topUp = h('button.btn', { type: 'button' });
    this.topUp.addEventListener('click', () => {
      const s = this.state;
      const me = s && s.seats[s.you];
      if (me) hooks.topUp(this.topUpBy(me.stack));
    });
    this.back = h('button.btn.primary', { type: 'button' }, t('menus.pokerBack'));
    this.back.addEventListener('click', () => hooks.sit(0));
    this.leave = h('button.btn.darts-leave', { type: 'button', title: t('menus.pokerLeaveNote') }, t('menus.pokerLeave'));
    this.leave.addEventListener('click', () => hooks.leave());
    this.tools = h('div.poker-row.poker-tools', {}, this.back, this.addBot, this.dropBot, this.topUp, this.leave);

    this.el = h('div.darts.panel.poker.hidden', { id: 'poker', 'aria-label': t('menus.poker') }, this.title, this.table, this.status, this.seats, this.mine, this.actions, this.join, this.tools);
    this.el.addEventListener('pointerdown', (e) => {
      // Keep the focus off the buttons (Space and Enter are the office's), but let the sliders be dragged.
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
    $('hud').append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) this.shown = '';
  }

  /** How much a top-up adds: back up to the most you can sit with, as much as your balance allows. */
  private topUpBy(stack: number): number {
    return Math.max(0, Math.min(MAX_BUY_IN - stack, this.balance));
  }
  private balance = 0;

  /**
   * The table as you see it: `spot` the chair you're in (its seat at the table), `balance` your chips
   * (what you can buy in with).
   */
  render(s: PokerState, spot: number, balance: number) {
    this.balance = balance;
    if (s.toAct >= 0) this.deadline = performance.now() + s.timeLeft;
    const k = JSON.stringify([s, spot, balance]);
    if (k === this.shown) return this.tick();
    const fresh = this.state?.you !== s.you || this.state?.turn === null;
    this.shown = k;
    this.state = s;
    const seated = s.you >= 0;
    const me = seated ? s.seats[s.you] : null;

    // The board and the pot.
    const board = [...s.board.map((c) => cardEl(c, true)), ...Array(Math.max(0, 5 - s.board.length)).fill(0).map(() => h('span.poker-card.slot.big'))];
    this.table.replaceChildren(
      h('div.poker-board', {}, ...board),
      h('div.poker-pot', {}, s.street ? `${streetName(s.street)} · ${t('menus.pokerPotIs', { n: chipsText(s.pot) })}` : ''),
    );
    this.table.classList.toggle('hidden', !s.street);

    // Everyone at the table, in seat order round it.
    this.seats.replaceChildren(
      ...s.seats.flatMap((x, i) => {
        if (!x) return [];
        const you = i === s.you;
        const away = !x.bot && !x.peer;
        const name = `${x.name}${you ? ` ${t('menus.dartsYou')}` : ''}${x.bot ? ' 🤖' : ''}${away ? ` ${t('menus.dartsAway')}` : ''}`;
        const won = s.result?.won[i];
        const what = won ? `+${chipsText(won)}` : x.allIn ? lastName('allin') : x.folded ? lastName('fold') : x.last ? lastName(x.last) : x.out ? t('menus.pokerOut') : '';
        const shownCards = !you && x.cards ? h('span.poker-shown', {}, ...x.cards.map((c) => cardEl(c))) : '';
        const cls = [i === s.toAct && 'up', (away || x.folded || x.out) && 'away', won && 'won'].filter(Boolean).join(' ') || undefined;
        return [
          h('li', { class: cls },
            h('span.darts-name', {}, i === s.button ? h('span.poker-dealer', { title: t('menus.pokerDealer') }, 'D') : '', name),
            shownCards,
            h('span.poker-what', {}, what),
            x.bet ? h('span.poker-bet', {}, chipsText(x.bet)) : '',
            h('span.darts-score.poker-stack', {}, chipsText(x.stack)),
          ),
        ];
      }),
    );

    // Your two cards, and what they make with the board.
    const cards = me?.cards;
    this.mine.classList.toggle('hidden', !cards);
    if (cards) {
      const all = [...cards, ...s.board];
      const made = all.length >= 5 ? handName(bestHand(all).category) : '';
      this.mine.replaceChildren(h('div.poker-hole', {}, ...cards.map((c) => cardEl(c, true))), h('span.poker-made', {}, made));
    }

    // What's going on: your turn, who's up, who won, or what the table's waiting for.
    let status = '';
    let cls = '';
    const people = s.seats.filter((x) => x && !x.out).length;
    if (s.result && s.street === 'showdown') {
      status = this.resultText(s);
      cls = 'won';
    } else if (s.turn) {
      status = t('menus.pokerYourTurn');
      cls = 'won';
    } else if (s.toAct >= 0) status = t('menus.pokerUp', { name: s.seats[s.toAct]?.name ?? '' });
    else if (!seated) status = !s.seats.includes(null) ? t('menus.pokerFull') : spot >= 0 && s.seats[spot] && !s.seats[spot]!.bot ? t('menus.pokerSeatKept', { name: s.seats[spot]!.name }) : balance < MIN_BUY_IN ? t('menus.pokerTooPoor', { n: chipsText(MIN_BUY_IN) }) : '';
    else if (me && me.stack === 0) status = t('menus.pokerBusted');
    else if (me?.out) status = t('menus.pokerIdle');
    else if (people < 2) status = t('menus.pokerWaiting');
    else status = t('menus.pokerNextHand');
    this.status.textContent = status;
    this.status.className = `darts-status ${cls}`;
    this.status.classList.toggle('hidden', !status);

    // On your turn: the actions.
    const turn = s.turn;
    this.actions.classList.toggle('hidden', !turn);
    if (turn) {
      this.call.textContent = turn.check ? t('menus.pokerCheck') : t('menus.pokerCall', { n: chipsText(turn.call) });
      const allInTo = (me?.bet ?? 0) + (me?.stack ?? 0);
      this.allIn.textContent = t('menus.pokerAllIn', { n: chipsText(allInTo) });
      // All-in when raising isn't open is only there when it's a call for everything you have.
      this.allIn.classList.toggle('hidden', !turn.raise && turn.call < (me?.stack ?? 0));
      this.slider.min = String(turn.min);
      this.slider.max = String(turn.max);
      if (fresh || Number(this.slider.value) < turn.min || Number(this.slider.value) > turn.max) this.slider.value = String(turn.min);
      for (const el of [this.slider, this.sizes, this.raise]) el.classList.toggle('hidden', !turn.raise || turn.min >= turn.max);
      this.raiseText();
    }

    // Not at the table yet: what you sit down with.
    // In a chair a Dealer-Bot has, you get the next free seat (and move over to it); one kept for someone who's away is theirs.
    const canSit = !seated && spot >= 0 && (!s.seats[spot] || !!s.seats[spot]!.bot) && s.seats.includes(null) && balance >= MIN_BUY_IN;
    const opening = canSit && this.join.classList.contains('hidden');
    this.join.classList.toggle('hidden', !canSit);
    if (canSit) {
      // 50 big blinds to start with (or all you have), each time it comes up.
      const most = Math.min(MAX_BUY_IN, balance);
      this.buyIn.max = String(most);
      if (opening || Number(this.buyIn.value) > most) this.buyIn.value = String(Math.min(most, 50 * BIG_BLIND));
      this.buyInText.textContent = chipsText(Number(this.buyIn.value));
    }

    const bots = s.seats.filter((x) => x?.bot).length;
    const free = s.seats.filter((x) => !x).length;
    this.tools.classList.toggle('hidden', !seated);
    this.addBot.classList.toggle('hidden', bots >= MAX_BOTS || free === 0);
    this.dropBot.classList.toggle('hidden', bots === 0);
    // Sat out after running out of time: back in from the next hand.
    this.back.classList.toggle('hidden', !me?.out || me.stack === 0);
    const by = me ? this.topUpBy(me.stack) : 0;
    const between = s.toAct < 0 || !me?.inHand;
    this.topUp.classList.toggle('hidden', !me || by < BIG_BLIND || !between || me.stack >= MAX_BUY_IN / 2);
    this.topUp.textContent = t('menus.pokerTopUp', { n: chipsText(by) });
    this.tick();
  }

  /** The clock on whoever's up, every frame. */
  tick() {
    const s = this.state;
    if (!s || s.toAct < 0 || (s.result && s.street === 'showdown')) return;
    const left = Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000));
    const base = s.turn ? t('menus.pokerYourTurn') : t('menus.pokerUp', { name: s.seats[s.toAct]?.name ?? '' });
    const text = `${base} · ${left} s`;
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  /** Who won what, with what: "Ada wins 240 with two pair", a split, or the pot taken unseen. */
  private resultText(s: PokerState): string {
    const r = s.result!;
    return r.pots
      .map((p) => {
        const names = p.winners.map((i) => s.seats[i]?.name ?? '?').join(' & ');
        const n = chipsText(p.amount);
        if (p.winners.length > 1) return t('menus.pokerSplit', { names, n, hand: p.category ? handName(p.category) : '' });
        return p.category ? t('menus.pokerWinsWith', { name: names, n, hand: handName(p.category) }) : t('menus.pokerWins', { name: names, n });
      })
      .join(' · ');
  }

  private raiseText() {
    const s = this.state;
    const turn = s?.turn;
    if (!s || !turn) return;
    const to = Number(this.slider.value);
    this.raise.textContent = to >= turn.max ? t('menus.pokerAllIn', { n: chipsText(to) }) : s.currentBet === 0 ? t('menus.pokerBet', { n: chipsText(to) }) : t('menus.pokerRaise', { n: chipsText(to) });
  }
}
