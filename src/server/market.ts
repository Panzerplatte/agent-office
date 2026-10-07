import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  HISTORY,
  MAX_OPEN,
  MAX_POSITIONS,
  RECENT,
  SYMBOL,
  autoClose,
  openingFee,
  entryPrice,
  leverageOk,
  modelOk,
  orderOk,
  payout,
  sideOk,
  stakeOk,
  startModel,
  step,
  type CloseWhy,
  type MarketClose,
  type MarketModel,
  type MarketPosition,
  type MarketState,
} from '../shared/market.js';

/** What the desk needs of the chips bank (server/chips.ts): taking a stake, and paying out. */
export interface MarketBank {
  bet(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
  award(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
}

export interface MarketOptions {
  now?: () => number;
  /** Where the price, the chart and everyone's positions are kept between restarts (market.json); none in the tests. */
  dataDir?: string;
  /** The random generator's first seed when there's nothing saved: cryptographically random unless a test says otherwise. */
  seed?: number;
  /** A position opened: the house's edge on it in chips (openingFee, through the spread). The one spot the fee is taken. */
  onFee?: (wallet: string, fee: number) => void;
  /** A position closed for less than its stake: how many chips of it were lost (the whole stake, for a liquidation). */
  onLost?: (wallet: string, chips: number) => void;
}

/** An open position as the office keeps it: whose wallet it's from (and pays back into), and who to name on the screen. */
interface Held extends MarketPosition {
  wallet: string;
  name: string;
  color?: string;
}

/** A position that closed on a tick: whose, and how. */
export interface Closed {
  wallet: string;
  position: MarketPosition;
  close: MarketClose;
}

/** How many ticks between writes of the file while nothing else changes. */
const SAVE_EVERY = 15;

/**
 * The casino's trading desk, one for the whole building. The office moves the price a tick a second
 * (shared/market.ts's step), nonstop, and after every tick closes whatever's been liquidated or hit
 * its take-profit or stop-loss, paying it out through the chips bank (nothing, for a liquidation:
 * the stake's gone, and never more). Opening takes the stake there and then (the bank won't take
 * more than you have) at the price with the spread against you; closing pays the position's value
 * at the price of the last tick. Pages only say "open this" and "close that"; the office's own
 * price decides. The model, the chart, the latest closes and every open position are kept on disk,
 * so after a restart the chart goes on from where it was and positions are still open.
 */
export class Market {
  private model: MarketModel;
  private history: number[] = [];
  private recent: MarketClose[] = [];
  private held: Held[] = [];
  private ids = 0;
  private now: () => number;
  private onFee?: (wallet: string, fee: number) => void;
  private onLost?: (wallet: string, chips: number) => void;
  private file: string | null;
  private sinceSave = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly bank: MarketBank,
    opts: MarketOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.onFee = opts.onFee;
    this.onLost = opts.onLost;
    this.file = opts.dataDir ? path.join(opts.dataDir, 'market.json') : null;
    this.model = startModel(opts.seed ?? randomBytes(4).readUInt32BE(0));
    this.history = [this.model.price];
    this.load();
  }

  /** The price now (the last tick's). */
  get price(): number {
    return this.model.price;
  }

  /** How many ticks the price has run. */
  get n(): number {
    return this.model.n;
  }

  /** The model as it is now (a copy). */
  snapshot(): MarketModel {
    return structuredClone(this.model);
  }

  /** The desk as everyone in the casino sees it: nobody's wallet, nobody's positions. */
  state(): MarketState {
    return {
      symbol: SYMBOL,
      price: this.model.price,
      n: this.model.n,
      history: [...this.history],
      recent: structuredClone(this.recent),
      longs: this.held.filter((p) => p.side === 'long').length,
      shorts: this.held.filter((p) => p.side === 'short').length,
    };
  }

  /** `wallet`'s open positions, oldest first. */
  positions(wallet: string): MarketPosition[] {
    return this.held.filter((p) => p.wallet === wallet).map((p) => this.view(p));
  }

  /**
   * `wallet` (called `name`) opens a position: `o` must be an order within bounds, they can't have
   * MAX_OPEN open already, and the bank must take the stake (no more than they have). It opens at
   * the price now with the spread against them. Says the position, or null if it didn't open.
   */
  open(wallet: string, name: string, o: unknown, color?: string): MarketPosition | null {
    const order = orderOk(o);
    if (!order) return null;
    if (this.held.length >= MAX_POSITIONS || this.held.filter((p) => p.wallet === wallet).length >= MAX_OPEN) return null;
    if (!this.bank.bet(wallet, order.stake, 'market.open', { quiet: true })) return null;
    const p: Held = {
      id: ++this.ids,
      side: order.side,
      lev: order.lev,
      stake: order.stake,
      entry: entryPrice(this.model.price, order.side),
      at: this.now(),
      ...(order.tp !== undefined ? { tp: order.tp } : {}),
      ...(order.sl !== undefined ? { sl: order.sl } : {}),
      wallet,
      name: name.slice(0, 24),
      ...(color ? { color } : {}),
    };
    this.held.push(p);
    // The house's edge: it's in the entry price already, so this only says how much it was.
    this.onFee?.(wallet, openingFee(p.stake, p.lev, p.side));
    this.saveSoon();
    return this.view(p);
  }

  /** `wallet` closes their position `id` at the price now: paid its value. Says how it closed, or null if they've no such position. */
  close(wallet: string, id: unknown): Closed | null {
    const p = this.held.find((h) => h.id === id && h.wallet === wallet);
    if (!p) return null;
    return this.settle(p, 'close');
  }

  /**
   * One tick: the price moves, the chart takes it, and every position that's liquidated or hit its
   * take-profit or stop-loss at the new price closes. Says the ones that did.
   */
  tick(): Closed[] {
    this.model = step(this.model);
    this.history.push(this.model.price);
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
    const closed: Closed[] = [];
    for (const p of [...this.held]) {
      const why = autoClose(p, this.model.price);
      if (why) closed.push(this.settle(p, why));
    }
    if (++this.sinceSave >= SAVE_EVERY) this.save();
    return closed;
  }

  /** Writes it all down now: the office is stopping. Positions stay open, and go on after the restart. */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }

  private settle(p: Held, why: CloseWhy): Closed {
    this.held = this.held.filter((h) => h !== p);
    const won = why === 'liquidated' ? 0 : payout(p, this.model.price);
    // A take-profit or a stop-loss that closes while you're away tells you with the bank's toast.
    if (won > 0) this.bank.award(p.wallet, won, `market.${why}`, { quiet: why === 'close' });
    if (won < p.stake) this.onLost?.(p.wallet, p.stake - won);
    const close: MarketClose = { name: p.name, ...(p.color ? { color: p.color } : {}), side: p.side, lev: p.lev, stake: p.stake, won, price: this.model.price, why };
    this.recent = [close, ...this.recent].slice(0, RECENT);
    this.saveSoon();
    return { wallet: p.wallet, position: this.view(p), close };
  }

  private view({ wallet: _w, name: _n, color: _c, ...p }: Held): MarketPosition {
    return { ...p };
  }

  private load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { model?: unknown; history?: unknown; recent?: unknown; held?: unknown; ids?: unknown };
      if (!modelOk(saved.model)) return;
      this.model = saved.model;
      const hist = Array.isArray(saved.history) ? saved.history.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0) : [];
      this.history = [...hist, this.model.price].slice(-HISTORY);
      if (hist.length && hist[hist.length - 1] === this.model.price) this.history = hist.slice(-HISTORY);
      if (Array.isArray(saved.recent)) this.recent = (saved.recent as MarketClose[]).filter((c) => c && typeof c.name === 'string' && sideOk(c.side) && Number.isSafeInteger(c.won)).slice(0, RECENT);
      if (Array.isArray(saved.held)) {
        this.held = (saved.held as Held[]).filter(
          (p) =>
            p &&
            typeof p.wallet === 'string' &&
            typeof p.name === 'string' &&
            Number.isSafeInteger(p.id) &&
            sideOk(p.side) &&
            leverageOk(p.lev) &&
            stakeOk(p.stake) &&
            typeof p.entry === 'number' &&
            p.entry > 0,
        );
      }
      this.ids = Math.max(Number.isSafeInteger(saved.ids) ? (saved.ids as number) : 0, ...this.held.map((p) => p.id));
    } catch (err) {
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message}`);
    }
  }

  private saveSoon() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, 1000);
    this.timer.unref();
  }

  private save() {
    this.sinceSave = 0;
    if (!this.file) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ model: this.model, history: this.history, recent: this.recent, held: this.held, ids: this.ids }));
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}
