/**
 * Online blackjack at the office PCs (the boss's monitor on each floor; see ui/arcade.ts): the casino's
 * game at a virtual table, with everyone else sitting at a PC on any floor, against the dealer. The
 * office deals every card and takes every bet (see server/onlineblackjack.ts); this draws the table on
 * the screen, in fixed 960×540 units, so the same picture goes up close while you play and on the
 * monitor for everyone on your floor, and puts the bets, moves and faces you can pull under it.
 */
import { MAX_BET, MAX_SEATS, MIN_BET, handValue, isBlackjack, suitOf, type BjAction, type BlackjackSeat, type Card } from '../../shared/blackjack';
import { EMOTE_SHOWN, ONLINE_EMOTES, atFloor, canSkip, controlsFor, mmss, netOf, seatOf, type OnlineControls, type OnlineTable } from '../../shared/onlineblackjack';
import type { ClientMsg } from '../../shared/protocol';
import { chips } from '../chips';
import { t } from '../i18n';
import { store } from '../state';
import { rankLabel } from '../world/cards';
import type { ScreenZoom } from './arcade';
import { CHIPS, totalLabel } from './blackjack';
import { h, openModal, type Modal } from './dom';

export const W = 960;
export const H = 540;

const FONT = "Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
const CW = 50;
const CH = 72;
/** How far along each card in a hand sits from the one before. */
const STEP = 28;
/** Each seat's middle across the screen: seat 0 is on the dealer's left, which is your right. */
const SEAT_X = [836, 658, 480, 302, 124];
/** And how far down its cards are: the seats sit round the table's curve. */
const SEAT_Y = [262, 292, 302, 292, 262];
/** The chips' colours, by what they're worth (as on the casino's panel). */
const CHIP_COLOR: Record<number, string> = { 5: '#d0263a', 25: '#2a9d4b', 100: '#22232e', 500: '#7b3fbf' };

/** The game picker at the PC: Minesweeper, or online blackjack (with how many are at a table, and whether your seat's kept). */
export function pickGame(onPick: (game: 'minesweeper' | 'blackjack') => void): Modal {
  const playing = store.onlinebj.tables.reduce((n, tb) => n + tb.seats.filter((s) => s.peer).length, 0);
  const kept = store.onlinebj.tables.some((tb) => tb.kept.some((k) => k.name === store.profile.name) || tb.seats.some((s) => !s.peer && s.name === store.profile.name));
  const choice = (game: 'minesweeper' | 'blackjack', icon: string, name: string, note: string) => {
    const b = h('button.btn.pc-game', { type: 'button' }, h('span.pc-game-icon', {}, icon), h('b', {}, name), h('small', {}, note));
    b.addEventListener('click', () => {
      modal.close();
      onPick(game);
    });
    return b;
  };
  const box = h(
    'div.modal.pc-pick',
    { role: 'dialog', 'aria-label': t('windows.onlinebj.pickTitle') },
    h('header', {}, h('h2', {}, t('windows.onlinebj.pickTitle'))),
    h(
      'div.body.pc-games',
      {},
      choice('minesweeper', '💣', 'Minesweeper', t('windows.onlinebj.pickMinesweeper')),
      choice('blackjack', '🃏', t('windows.onlinebj.title'), kept ? t('windows.onlinebj.pickKept') : playing ? t('windows.onlinebj.pickPlaying', { n: playing }) : t('windows.onlinebj.pickAlone')),
    ),
  );
  const modal = openModal(box, {});
  return modal;
}

/**
 * Online blackjack on the PC's screen. `open` sits you down at a table (back in your seat if it's kept)
 * and glides the camera up to the screen; Esc or ✕ (or getting up) steps away, your seat kept for a
 * while; Leave gives it up. While someone on your floor plays it, the monitor shows their table.
 */
export class OnlineBlackjack {
  private modal: Modal | null = null;
  private board: HTMLCanvasElement | null = null;
  private bar: HTMLElement | null = null;
  /** The bet you're putting together, before you place it. */
  private pending = 0;
  private barKey = '';
  /** When the tables last came, to run their clocks on from. */
  private heardAt = performance.now();
  /** Faces pulled at the tables, by `table:seat`, until when they're shown. */
  private readonly faces = new Map<string, { emote: string; until: number }>();
  /** What the table looked like last, to hear cards come and go. */
  private heard = { cards: -1, hidden: 0, stage: '' };
  /** The monitor (or the screen up close) needs drawing again. */
  onDraw: () => void = () => {};

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly sound: (kind: 'card' | 'flip' | 'win') => void = () => {},
  ) {
    store.on('onlinebj', () => {
      this.heardAt = performance.now();
      this.listen();
      this.changed();
    });
    store.on('onlinebjEmote', () => {
      const e = store.onlinebjEmote;
      if (!e) return;
      this.faces.set(`${e.table}:${e.seat}`, { emote: e.emote, until: performance.now() + EMOTE_SHOWN });
      this.changed();
    });
    // Your floor's PC: whose table it shows depends on the floor you're on.
    store.on('floor', () => this.changed());
    chips.onChange(() => this.changed());
    // The clocks run down, and faces go: drawn again a few times a second while there's one.
    setInterval(() => {
      if (this.ticking()) this.onDraw();
    }, 250);
  }

  /** Playing now, up close. */
  get active(): boolean {
    return !!this.modal;
  }

  /** Whether the monitor on your floor shows a table now (yours, or whoever's at the PC here). */
  get showing(): boolean {
    return this.active || !!(store.floor && atFloor(store.onlinebj, store.floor));
  }

  /** Sits you down at a table and brings the screen up close (`view`); `onClosed` once you step away. */
  open(view: ScreenZoom, onClosed: () => void) {
    if (this.modal) return;
    this.send({ t: 'onlinebj.join' });
    const board = h('canvas', { 'aria-label': t('windows.onlinebj.title') });
    const bar = h('div.arcade-bar.obj-bar');
    const box = h('div.arcade.obj', { role: 'dialog', 'aria-label': t('windows.onlinebj.title') }, h('div.arcade-screen', {}, board), bar);
    // A click on a button mustn't leave it focused, or the number keys would press it again.
    bar.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    const fit = () => {
      const { width, height } = view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      board.width = Math.round(width * devicePixelRatio);
      board.height = Math.round(height * devicePixelRatio);
      this.onDraw();
    };
    const onKey = (e: KeyboardEvent) => {
      const a = ({ Digit1: 'hit', Digit2: 'stand', Digit3: 'double', Digit4: 'split' } as const)[e.code as 'Digit1'];
      if (!a || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      const c = this.controls();
      if (c.kind === 'moves' && c.moves.includes(a)) this.send({ t: 'onlinebj.act', action: a });
    };
    this.board = board;
    this.bar = bar;
    this.barKey = '';
    this.pending = 0;
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey, true);
    this.modal = openModal(box, {
      backdropCloses: false,
      doing: t('world.doingOnlineBlackjack'),
      onClose: () => {
        window.removeEventListener('resize', fit);
        window.removeEventListener('keydown', onKey, true);
        this.modal = this.board = this.bar = null;
        // Away, not gone: the seat waits for you (see Leave for giving it up).
        this.send({ t: 'onlinebj.away' });
        onClosed();
        this.onDraw();
      },
    });
    this.modal.backdrop.classList.add('clear');
    this.renderBar();
  }

  /** Draws your table on the screen up close, while you play. */
  paintBoard() {
    const b = this.board;
    if (!b) return;
    const g = b.getContext('2d')!;
    g.setTransform(b.width / W, 0, 0, b.height / H, 0, 0);
    this.paint(g);
  }

  /**
   * Draws the table: yours while you play, otherwise the one whoever's at your floor's PC is playing
   * at, from their seat. Says whether there was one to draw (if not, the PC shows something else).
   */
  paint(g: CanvasRenderingContext2D): boolean {
    const at = this.active ? seatOf(store.onlinebj, store.you) : store.floor ? atFloor(store.onlinebj, store.floor) : undefined;
    if (!this.active && !at) return false;
    paintTable(g, at?.table, at?.seat, {
      now: performance.now(),
      since: performance.now() - this.heardAt,
      faces: this.faces,
      balance: this.active ? chips.balance : null,
      watcher: !this.active,
    });
    return true;
  }

  /** Something about the table changed: the buttons, and the picture. */
  private changed() {
    this.renderBar();
    this.onDraw();
  }

  private controls(): OnlineControls {
    return controlsFor(seatOf(store.onlinebj, store.you)?.table, store.you, chips.balance);
  }

  /** Whether anything on the table runs down by itself now: a clock, a kept seat's wait, a face. */
  private ticking(): boolean {
    const now = performance.now();
    for (const [k, f] of this.faces) if (f.until < now) this.faces.delete(k);
    if (this.faces.size) return true;
    if (!this.showing) return false;
    const at = this.active ? seatOf(store.onlinebj, store.you) : store.floor ? atFloor(store.onlinebj, store.floor) : undefined;
    return !!at && (at.table.left !== null || at.table.kept.length > 0);
  }

  /** Cards dealt, the hole card turned over and a round won, at your table while you play. */
  private listen() {
    const at = seatOf(store.onlinebj, store.you);
    const r = at?.table.round;
    const cards = r ? r.dealer.length + r.players.reduce((n, p) => n + p.hands.reduce((m, hd) => m + hd.cards.length, 0), 0) : 0;
    const hidden = r ? r.dealer.filter((c) => !c).length : 0;
    const stage = at?.table.stage ?? '';
    if (this.active && this.heard.cards >= 0) {
      if (cards > this.heard.cards) this.sound('card');
      if (hidden < this.heard.hidden && cards >= this.heard.cards) this.sound('flip');
      const mine = r?.players.find((p) => p.id === at!.seat.id);
      if (stage === 'done' && this.heard.stage !== 'done' && mine && netOf(mine) > 0) this.sound('win');
    }
    this.heard = { cards, hidden, stage };
  }

  /** The buttons under the screen, for what you can do now. */
  private renderBar() {
    const bar = this.bar;
    if (!bar) return;
    const table = seatOf(store.onlinebj, store.you)?.table;
    const c = this.controls();
    if (c.kind === 'bet' && this.pending > c.cap) this.pending = 0;
    const skip = canSkip(table, store.you);
    const key = JSON.stringify([c, skip, this.pending, !!table]);
    if (key === this.barKey) return;
    this.barKey = key;

    const btn = (label: string, on: () => void, cls = '', title?: string) => {
      const b = h(`button.btn${cls}`, { type: 'button', title }, label);
      b.addEventListener('click', on);
      return b;
    };
    const parts: HTMLElement[] = [];
    if (c.kind === 'join') parts.push(btn(t('windows.onlinebj.sitAgain'), () => this.send({ t: 'onlinebj.join' }), '.primary'));
    else if (c.kind === 'bet') {
      for (const n of CHIPS) {
        const b = btn(String(n), () => this.setPending(this.pending + n), `.bj-chip.c${n}`, t('menus.bjAddChip', { n }));
        b.disabled = this.pending + n > c.cap;
        parts.push(b);
      }
      parts.push(h('span.obj-amount', {}, this.pending ? String(this.pending) : t('menus.bjMinMax', { min: MIN_BET, max: MAX_BET })));
      if (this.pending) parts.push(btn(t('menus.bjClear'), () => this.setPending(0)));
      const place = btn(t('menus.bjPlace'), () => this.pending && this.send({ t: 'onlinebj.bet', amount: this.pending }), '.primary');
      place.disabled = this.pending < MIN_BET;
      parts.push(place);
      if (c.again && !this.pending) parts.push(btn(t('menus.bjAgain', { n: c.again }), () => this.send({ t: 'onlinebj.bet', amount: c.again })));
    } else if (c.kind === 'down') {
      this.pending = 0;
      parts.push(h('span.obj-amount.down', {}, t('menus.bjBetDown', { n: c.bet })), btn(t('menus.bjTakeBack'), () => this.send({ t: 'onlinebj.bet', amount: 0 })));
      if (c.deal) parts.push(btn(t('menus.bjDeal'), () => this.send({ t: 'onlinebj.deal' }), '.primary'));
    } else if (c.kind === 'insure') {
      const yes = btn(t('menus.bjInsure', { n: c.cost }), () => this.send({ t: 'onlinebj.insure', take: true }), '.primary');
      yes.disabled = !c.cost || chips.balance < c.cost;
      parts.push(yes, btn(t('menus.bjNoInsurance'), () => this.send({ t: 'onlinebj.insure', take: false })));
    } else if (c.kind === 'moves') {
      const labels: Record<BjAction, [string, string]> = { hit: ['1', t('menus.bjHit')], stand: ['2', t('menus.bjStand')], double: ['3', t('menus.bjDouble')], split: ['4', t('menus.bjSplit')] };
      for (const a of c.moves) {
        const [k, label] = labels[a];
        const b = h('button.btn.bj-move', { type: 'button', title: `${label} (${k})` }, h('kbd', {}, k), ` ${label}`);
        b.disabled = (a === 'double' || a === 'split') && chips.balance < c.stake;
        b.addEventListener('click', () => this.send({ t: 'onlinebj.act', action: a }));
        parts.push(b);
      }
    }
    if (skip) parts.push(btn(t('menus.bjSkip'), () => this.send({ t: 'onlinebj.skip' })));
    const faces = h('span.obj-faces', {}, ...ONLINE_EMOTES.map((e) => btn(e, () => this.send({ t: 'onlinebj.emote', emote: e }), '.obj-face', t('windows.onlinebj.emote'))));
    const leave = btn(t('menus.bjLeave'), () => this.send({ t: 'onlinebj.leave' }), '.pool-leave', t('windows.onlinebj.leaveNote'));
    leave.disabled = !table;
    const stop = btn(t('windows.onlinebj.stop'), () => this.modal?.close(), '', t('windows.onlinebj.stopNote'));
    bar.replaceChildren(h('span.obj-do', {}, ...parts), faces, leave, stop);
  }

  private setPending(n: number) {
    this.pending = n;
    this.renderBar();
  }
}

// ---- The picture ------------------------------------------------------------------------------------

interface PaintOpts {
  now: number;
  /** How long since the table came (ms), to run its clocks on by. */
  since: number;
  faces: Map<string, { emote: string; until: number }>;
  /** Your chips while you play; null on the monitor. */
  balance: number | null;
  /** On the monitor, for everyone else on the floor: whose table it is goes in the top bar. */
  watcher: boolean;
}

/** Draws `table` from `me`'s seat (none yet: you're sitting down) in 960×540. */
export function paintTable(g: CanvasRenderingContext2D, table: OnlineTable | undefined, me: BlackjackSeat | undefined, o: PaintOpts) {
  // The felt, darker to the edges, and the rail round the dealer's side.
  const felt = g.createRadialGradient(W / 2, 120, 60, W / 2, 220, 620);
  felt.addColorStop(0, '#2c8a58');
  felt.addColorStop(1, '#14502f');
  g.fillStyle = felt;
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // The top bar: the game and the table, and your chips (or whose table it is, on the monitor).
  g.fillStyle = 'rgba(8, 20, 14, 0.72)';
  g.fillRect(0, 0, W, 40);
  g.fillStyle = '#ffd166';
  g.font = `900 20px ${FONT}`;
  g.textAlign = 'left';
  g.fillText(`🃏 ${t('windows.onlinebj.title').toUpperCase()}`, 16, 21);
  g.textAlign = 'right';
  g.fillStyle = '#f1ede4';
  g.font = `800 18px ${FONT}`;
  if (o.watcher && me) g.fillText(t('windows.onlinebj.playing', { name: me.name }), W - 16, 21);
  else if (o.balance !== null) g.fillText(`🪙 ${o.balance.toLocaleString()}`, W - 16, 21);
  g.textAlign = 'center';
  if (table) {
    g.fillStyle = 'rgba(241, 237, 228, 0.7)';
    g.font = `800 16px ${FONT}`;
    g.fillText(t('windows.onlinebj.table', { n: table.id }), W / 2, 21);
  }

  // The house rules printed on the felt.
  g.fillStyle = 'rgba(255, 209, 102, 0.55)';
  g.font = `900 15px ${FONT}`;
  g.fillText(t('windows.onlinebj.felt'), W / 2, 192);

  if (!table || !me) {
    g.fillStyle = '#f1ede4';
    g.font = `900 30px ${FONT}`;
    g.fillText(t('windows.onlinebj.sitting'), W / 2, H / 2);
    return;
  }
  const r = table.round;

  // The dealer.
  const dealer = r?.dealer ?? [];
  g.fillStyle = 'rgba(241, 237, 228, 0.8)';
  g.font = `900 14px ${FONT}`;
  g.fillText(t('menus.bjDealer').toUpperCase(), W / 2, 58);
  cardRow(g, dealer, W / 2, 70, 1);
  const known = dealer.filter((c): c is Card => !!c);
  if (known.length) badge(g, known.length === dealer.length ? totalLabel(known, false, table.stage === 'done') : `${totalLabel(known)} + ?`, W / 2 + rowWidth(dealer.length, 1) / 2 + 32, 106, '#0b1320');

  // What's going on, and the clock.
  const [line, color] = status(table, o.watcher ? undefined : me);
  g.fillStyle = color;
  g.font = `900 22px ${FONT}`;
  g.fillText(line, W / 2, 222);
  if (table.left !== null && table.clock) {
    const left = Math.max(0, table.left - o.since);
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    round(g, W / 2 - 150, 240, 300, 8, 4);
    g.fill();
    g.fillStyle = left < 5000 ? '#ff5a5f' : '#ffd166';
    round(g, W / 2 - 150, 240, (300 * Math.min(1, left / table.clock)) | 0, 8, 4);
    g.fill();
  }

  // The seats.
  const upId = r?.turn ? r.players[r.turn.player]?.id : undefined;
  for (let i = 0; i < MAX_SEATS; i++) {
    const x = SEAT_X[i];
    const y = SEAT_Y[i];
    const s = table.seats.find((o2) => o2.seat === i);
    const kept = table.kept.find((k) => k.seat === i);
    if (!s) {
      plate(g, x, kept ? `${kept.name} · ${mmss(kept.left - o.since)}` : t('windows.onlinebj.free'), kept ? 'kept' : 'free');
      continue;
    }
    const p = r?.players.find((pl) => pl.id === s.id);
    const up = s.id === upId;
    if (p) {
      const two = p.hands.length > 1;
      p.hands.forEach((hd, hi) => {
        const hx = two ? x + (hi ? 44 : -44) : x;
        const scale = two ? 0.72 : 1;
        if (up && r!.turn!.hand === hi) {
          g.strokeStyle = '#ffd166';
          g.lineWidth = 3;
          round(g, hx - rowWidth(hd.cards.length, scale) / 2 - 6, y - 6, rowWidth(hd.cards.length, scale) + 12, CH * scale + 12, 8);
          g.stroke();
        }
        cardRow(g, hd.cards, hx, y, scale);
        if (hd.cards.length) badge(g, totalLabel(hd.cards, hd.split, hd.done), hx, y + CH * scale + 16, '#0b1320');
        if (hd.outcome) {
          const won = (hd.paid ?? 0) > hd.bet || hd.outcome === 'blackjack' || hd.outcome === 'win';
          const push = hd.outcome === 'push';
          const text = won ? `+${(hd.paid ?? 0) - hd.bet}` : push ? t('menus.bjOutPush') : t(hd.outcome === 'bust' ? 'menus.bjOutBust' : 'menus.bjOutLose');
          badge(g, text, hx, y - 14, won ? '#2a9d4b' : push ? '#5a6b7a' : '#d0263a');
        }
      });
      stack(g, x, 434, p.hands.reduce((a, hd) => a + hd.bet, 0) + (p.insurance ?? 0));
    } else if (s.bet) stack(g, x, 434, s.bet);
    else {
      g.strokeStyle = 'rgba(241, 237, 228, 0.35)';
      g.setLineDash([5, 5]);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, 434, 22, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    const name = `${s.name}${s.id === me.id && !o.watcher ? ` ${t('menus.dartsYou')}` : ''}${s.peer ? '' : ` ${t('menus.poolAway')}`}`;
    plate(g, x, name, s.id === me.id ? 'me' : s.peer ? 'other' : 'away', up);
    const face = o.faces.get(`${table.id}:${i}`);
    if (face && face.until > o.now) {
      g.fillStyle = '#fbf8f0';
      g.beginPath();
      g.arc(x + 62, y - 18, 26, 0, Math.PI * 2);
      g.fill();
      g.font = `34px ${FONT}`;
      g.fillStyle = '#22232e';
      g.fillText(face.emote, x + 62, y - 16);
    }
  }
}

/** The line in the middle of the table: what's going on (for `me`, or for someone watching on the monitor), and its colour. */
function status(table: OnlineTable, me: BlackjackSeat | undefined): [string, string] {
  const r = table.round;
  const mine = me && r?.players.find((p) => p.id === me.id);
  const plain = '#f1ede4';
  switch (table.stage) {
    case 'idle':
      return [t('windows.onlinebj.placeBet'), plain];
    case 'betting':
      return [t('windows.onlinebj.betsOpen'), plain];
    case 'insurance':
      return [t(mine && mine.insurance === null ? 'windows.onlinebj.insurance' : 'menus.bjInsuranceWait'), '#ffd166'];
    case 'playing': {
      const up = r?.turn ? r.players[r.turn.player] : undefined;
      const seat = up && table.seats.find((s) => s.id === up.id);
      if (!up) return ['', plain];
      if (up.id === me?.id) return [t('menus.bjYourTurn'), '#ffd166'];
      if (seat && !seat.peer) return [t('windows.onlinebj.away', { name: up.name }), '#ff9f9f'];
      return [t('menus.bjTheirTurn', { name: up.name }), plain];
    }
    case 'dealer':
      return [t('menus.bjDealerPlays'), plain];
    case 'done': {
      if (mine) {
        const net = netOf(mine);
        return [net > 0 ? t('menus.bjYouWon', { n: net }) : net < 0 ? t('menus.bjYouLost', { n: -net }) : t('menus.bjYouEven'), net > 0 ? '#9ef0b5' : net < 0 ? '#ff9f9f' : plain];
      }
      const dealer = (r?.dealer ?? []).filter((c): c is Card => !!c);
      return [isBlackjack(dealer) ? t('menus.bjDealerBlackjack') : handValue(dealer).total > 21 ? t('menus.bjDealerBust') : t('menus.bjDealerHas', { n: handValue(dealer).total }), plain];
    }
  }
}

/** How wide a row of `n` cards is at `scale`, each overlapping the one before. */
function rowWidth(n: number, scale: number): number {
  return n ? (CW + (n - 1) * STEP) * scale : CW * scale;
}

/** A row of cards centred on `x`, from `y` down; null is one face down. */
function cardRow(g: CanvasRenderingContext2D, cards: readonly (Card | null)[], x: number, y: number, scale: number) {
  const w = rowWidth(cards.length, scale);
  cards.forEach((c, i) => card(g, c, x - w / 2 + i * STEP * scale, y, scale));
}

function card(g: CanvasRenderingContext2D, c: Card | null, x: number, y: number, scale: number) {
  const w = CW * scale;
  const hgt = CH * scale;
  g.fillStyle = 'rgba(0, 0, 0, 0.3)';
  round(g, x + 2, y + 3, w, hgt, 5 * scale);
  g.fill();
  if (!c) {
    g.fillStyle = '#9e1b2c';
    round(g, x, y, w, hgt, 5 * scale);
    g.fill();
    g.strokeStyle = '#fbf8f0';
    g.lineWidth = 3 * scale;
    round(g, x + 4 * scale, y + 4 * scale, w - 8 * scale, hgt - 8 * scale, 3 * scale);
    g.stroke();
    return;
  }
  g.fillStyle = '#fbf8f0';
  round(g, x, y, w, hgt, 5 * scale);
  g.fill();
  g.strokeStyle = '#cfc6b4';
  g.lineWidth = 1;
  g.stroke();
  const s = suitOf(c);
  g.fillStyle = s === 'H' || s === 'D' ? '#d0263a' : '#22232e';
  g.textAlign = 'left';
  g.font = `900 ${Math.round(17 * scale)}px ${FONT}`;
  g.fillText(rankLabel(c), x + 5 * scale, y + 13 * scale);
  g.font = `${Math.round(14 * scale)}px ${FONT}`;
  g.fillText(SUIT[s], x + 6 * scale, y + 29 * scale);
  g.textAlign = 'center';
  g.font = `${Math.round(30 * scale)}px ${FONT}`;
  g.fillText(SUIT[s], x + w / 2 + 4 * scale, y + hgt / 2 + 10 * scale);
}

/** A little rounded label: a total, or how a hand came out. */
function badge(g: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string) {
  g.font = `900 15px ${FONT}`;
  const w = Math.max(30, g.measureText(text).width + 14);
  g.fillStyle = bg;
  round(g, x - w / 2, y - 11, w, 22, 11);
  g.fill();
  g.fillStyle = '#ffffff';
  g.fillText(text, x, y + 1);
}

/** The chips on a seat's betting spot, coloured by the biggest chip in them, and how many. */
function stack(g: CanvasRenderingContext2D, x: number, y: number, amount: number) {
  if (!amount) return;
  const top = [...CHIPS].reverse().find((c) => amount >= c) ?? 5;
  const n = Math.min(5, Math.max(1, Math.round(Math.log2(amount / 5 + 1))));
  for (let i = n - 1; i >= 0; i--) {
    g.fillStyle = CHIP_COLOR[top];
    g.beginPath();
    g.ellipse(x, y - i * 4, 22, 22, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.setLineDash([6, 5]);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y - i * 4, 17, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  g.fillStyle = '#ffffff';
  g.font = `900 14px ${FONT}`;
  g.fillText(String(amount), x, y - (n - 1) * 4 + 1);
}

/** A seat's name plate at the table's edge: yours, someone else's, someone away, kept for someone, or free. */
function plate(g: CanvasRenderingContext2D, x: number, text: string, kind: 'me' | 'other' | 'away' | 'kept' | 'free', up = false) {
  const y = 470;
  const w = 164;
  g.fillStyle = kind === 'me' ? '#ffd166' : kind === 'other' ? '#f1ede4' : 'rgba(8, 20, 14, 0.45)';
  round(g, x - w / 2, y, w, 34, 17);
  g.fill();
  if (up || kind === 'kept' || kind === 'free' || kind === 'away') {
    g.strokeStyle = up ? '#ffd166' : 'rgba(241, 237, 228, 0.45)';
    g.lineWidth = up ? 4 : 2;
    if (!up) g.setLineDash([6, 5]);
    g.stroke();
    g.setLineDash([]);
  }
  g.fillStyle = kind === 'me' || kind === 'other' ? '#22232e' : 'rgba(241, 237, 228, 0.8)';
  g.font = `900 15px ${FONT}`;
  let label = text;
  while (label.length > 4 && g.measureText(label).width > w - 18) label = label.slice(0, -2);
  g.fillText(label === text ? text : `${label}…`, x, y + 18);
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, hgt, r);
}
