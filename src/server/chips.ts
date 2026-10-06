import { SHOP_ITEMS, nameColorOf, shopItem, shopReason, tidyWorn } from '../shared/shop.js';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HOOP, THREE_POINT, backboard, launch, simulate } from '../shared/hoop.js';
import { CHIPS_TOP, CREDIT_GAMES, CREDIT_MAX, CREDIT_MERGED, CREDIT_PER_MINUTE, EARN, LEDGER_SIZE, ONLINE_EVERY, START_CHIPS, STREAK_PAUSE, chipsAmountOk, chipsDay, creditAmountOk, chipsKeyOk, type ChipsEntry, type ChipsReason, type ChipsState, type ChipsTopRow, type EarnKind, type Earning } from '../shared/chips.js';

/** How long after a change the file is written, gathering a burst of changes into one write (ms). */
const SAVE_AFTER = 1000;
/** A browser nobody has seen in this long is forgotten (an account never is). */
const FORGET_BROWSER_MS = 180 * 24 * 60 * 60_000;
/** How many one-off payouts (see once) are remembered. */
const ONCE_KEPT = 2000;
/** How long after a change the leaderboard is looked at again, gathering a burst of changes into one (ms). */
const TOP_AFTER = 1000;

/** One person's chips, as saved. */
interface Wallet {
  balance: number;
  /** Newest first. */
  ledger: ChipsEntry[];
  /** The day `earned` is for: it starts again on a new one. */
  day: string;
  /** Chips earned that day, per kind (see EARN's perDay). */
  earned: Partial<Record<EarnKind, number>>;
  /** When each kind last paid (see EARN's cooldown). */
  last: Partial<Record<EarnKind, number>>;
  /** Active minutes towards the next `online` payout. */
  online: number;
  /** When they were last about. */
  seen: number;
  /** Their credit from the bank while they still owe on it: when they took it, how much, and what's still owed (chips, not always whole: work pays it off by the minute). */
  credit?: { at: number; amount: number; owed: number };
  /** What they were called, and their colour, when last about: for the leaderboard while they're away. */
  name?: string;
  color?: string;
  /** What they've bought at the shop (item ids, see shared/shop.ts), oldest first, and what of it they have on. */
  items?: string[];
  worn?: string[];
}

/** A place on the leaderboard, with whose it is (`id`, which stays on the server: a browser's id is its key). */
export interface ChipsTopEntry extends ChipsTopRow {
  id: string;
}

interface Saved {
  wallets: Record<string, Wallet>;
  /** One-off payouts already made (a merged pull request pays once, whatever the restarts). */
  once: string[];
}

export interface ChipsOptions {
  now?: () => number;
  /** A balance changed: `entry` is the change (none when only the credit's wait moved on), `quiet` if whoever made it asked for no toast. */
  onChange?: (id: string, state: ChipsState, entry: ChipsEntry | undefined, quiet: boolean) => void;
  /** `id`'s credit is paid back: the bank gives them another. */
  onCredit?: (id: string) => void;
  /** How long after a change it's written to disk (ms); tests pass 0 and call flush. */
  saveAfter?: number;
  /** The leaderboard (see top) changed: sent at most once every `topAfter` ms, and only when it's different. */
  onTop?: (top: ChipsTopEntry[]) => void;
  topAfter?: number;
  /** Someone's name as it is now, when the office knows better than what they were last called (an account's). */
  nameOf?: (id: string) => string | undefined;
  /** Whether `id` is in the office right now. */
  online?: (id: string) => boolean;
}

/** Options for a bet or payout: `quiet` changes the balance without a toast on the person's page (their game shows it). */
export interface ChangeOptions {
  quiet?: boolean;
}

/**
 * Everyone's chips, in .agent-office/chips.json: each person's balance, their latest changes, and
 * what they've earned today. A person (`id`) is `account:<id>` when they're signed in with an account,
 * else `browser:<key>`, the key their browser keeps (see the client's chips.ts); `conn:<id>`, for a
 * page that couldn't keep one, lasts as long as the office runs and is never saved.
 *
 * Every change to a balance goes through here. `bet` and `award` are what the casino's games use:
 * whole, positive amounts only, and a bet that's more than the balance changes nothing. `earn` pays
 * for things done round the office, from the EARN table, with its cooldowns and daily caps; `basket`
 * pays for baskets, counting each person's streak of them in a row.
 */
export class Chips {
  private data: Saved = { wallets: {}, once: [] };
  private file: string;
  private now: () => number;
  private onChange: ChipsOptions['onChange'];
  private saveAfter: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onTop: ChipsOptions['onTop'];
  private topAfter: number;
  private nameOf: ChipsOptions['nameOf'];
  private online: ChipsOptions['online'];
  private onCredit: ChipsOptions['onCredit'];
  private topTimer: ReturnType<typeof setTimeout> | null = null;
  /** The leaderboard as last sent, to send it only when it's different. */
  private lastTop = '';
  /** The file is there but couldn't be read: never write over it, or everyone's chips are gone. */
  private unreadable = false;
  /** Each person's streak of baskets in a row, and when the last one went in: kept while the office runs. */
  private streaks = new Map<string, { n: number; at: number }>();

  constructor(dataDir: string, opts: ChipsOptions = {}) {
    this.file = path.join(dataDir, 'chips.json');
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.saveAfter = opts.saveAfter ?? SAVE_AFTER;
    this.onTop = opts.onTop;
    this.topAfter = opts.topAfter ?? TOP_AFTER;
    this.nameOf = opts.nameOf;
    this.online = opts.online;
    this.onCredit = opts.onCredit;
    this.load();
  }

  /** What `id` has: START_CHIPS for someone new. */
  balance(id: string): number {
    return this.data.wallets[id]?.balance ?? START_CHIPS;
  }

  /** `id`'s balance and latest changes, newest first, for their page. */
  state(id: string): ChipsState {
    const w = this.data.wallets[id];
    if (!w) return { balance: START_CHIPS, ledger: [] };
    return {
      balance: w.balance,
      ledger: w.ledger.map((e) => ({ ...e })),
      ...(w.credit ? { credit: { amount: w.credit.amount, owed: wholeChips(w.credit.owed) } } : {}),
      ...(w.items?.length ? { items: [...w.items], worn: [...(w.worn ?? [])] } : {}),
    };
  }

  /**
   * `id` buys `itemId` at the shop (see shared/shop.ts): its price comes off their balance (credit
   * chips spend like any others), with "shop:<id>" in their ledger, and it's theirs for good, put on
   * straight away. Says why not ('item': there's no such thing, 'owned': they have it already,
   * 'chips': they haven't enough), changing nothing, or null when it's bought.
   */
  buy(id: string, itemId: unknown): 'item' | 'owned' | 'chips' | null {
    const item = shopItem(itemId);
    if (!item || !idOk(id)) return 'item';
    const w = this.wallet(id);
    if (w.items?.includes(item.id)) return 'owned';
    if (w.balance < item.price) return 'chips';
    w.items = [...(w.items ?? []), item.id];
    w.worn = tidyWorn([...(w.worn ?? []), item.id], w.items);
    this.change(id, w, -item.price, shopReason(item), false);
    return null;
  }

  /** `id` puts on (or takes off) something they bought. Says false, changing nothing, unless they have it and it changes what they wear. */
  wear(id: string, itemId: unknown, on: boolean): boolean {
    const item = shopItem(itemId);
    const w = this.data.wallets[id];
    if (!item || !w?.items?.includes(item.id)) return false;
    const was = w.worn ?? [];
    const worn = tidyWorn(on ? [...was, item.id] : was.filter((x) => x !== item.id), w.items);
    if (worn.join() === was.join()) return false;
    w.worn = worn;
    this.dirty();
    this.onChange?.(id, this.state(id), undefined, true);
    this.topCheck();
    return true;
  }

  /** What `id` has on from the shop (item ids). */
  worn(id: string): string[] {
    return [...(this.data.wallets[id]?.worn ?? [])];
  }

  /**
   * What everyone has on from the shop, by the name they go by (see top): for the desks of the
   * workers they hired, whether they're about or not. Only people who have something on.
   */
  looks(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [id, w] of Object.entries(this.data.wallets)) {
      const name = this.nameOf?.(id) ?? w.name;
      if (name && w.worn?.length) out[name] = [...(out[name] ?? []), ...w.worn.filter((x) => !out[name]?.includes(x))];
    }
    return out;
  }

  /** What `id` still owes on their credit, in whole chips (0: nothing, they can take one). */
  owed(id: string): number {
    const c = this.data.wallets[id]?.credit;
    return c ? wholeChips(c.owed) : 0;
  }

  /**
   * `id` takes a credit of `amount` chips at the bank (one of CREDIT_AMOUNTS): it goes on their
   * balance, and they owe it until it's paid back (see work and earn). Says why not ('amount', or
   * 'owing' while the last one isn't paid back yet), changing nothing, or null when they've had it.
   */
  credit(id: string, amount: number): 'amount' | 'owing' | null {
    if (!creditAmountOk(amount) || !idOk(id)) return 'amount';
    const w = this.wallet(id);
    if (w.credit) return 'owing';
    w.credit = { at: this.now(), amount, owed: amount };
    this.change(id, w, amount, 'credit', false);
    return null;
  }

  /**
   * Project work, which pays off credit: `minutes` for each of `ids` (a minute active with a task or
   * worker of theirs running, or CREDIT_MERGED for a merged pull request), CREDIT_PER_MINUTE chips of
   * what they owe a minute. Only counts for someone who owes; their page hears what's left.
   */
  work(ids: Iterable<string>, minutes = 1) {
    for (const id of new Set(ids)) {
      const w = this.data.wallets[id];
      if (!w?.credit) continue;
      this.repay(id, w, minutes * CREDIT_PER_MINUTE);
      this.onChange?.(id, this.state(id), undefined, true);
    }
  }

  /** A pull request of `id`'s merged: a chunk of project work towards their credit (see CREDIT_MERGED). */
  merged(id: string) {
    this.work([id], CREDIT_MERGED);
  }

  /** `id`'s latest changes, newest first (at most LEDGER_SIZE). */
  ledger(id: string): ChipsEntry[] {
    return this.state(id).ledger;
  }

  /**
   * `id` stakes `amount` on something (`reason`, like "roulette.bet"): taken off their balance there
   * and then. Nothing changes, and it says false, unless `amount` is a positive whole number they have.
   */
  bet(id: string, amount: number, reason: ChipsReason, opts: ChangeOptions = {}): boolean {
    if (!chipsAmountOk(amount) || !idOk(id)) return false;
    const w = this.wallet(id);
    if (w.balance < amount) return false;
    this.change(id, w, -amount, reason, !!opts.quiet);
    return true;
  }

  /** `id` wins `amount` (`reason`, like "roulette.win"). Says false, changing nothing, unless it's a positive whole number. */
  award(id: string, amount: number, reason: ChipsReason, opts: ChangeOptions = {}): boolean {
    if (!chipsAmountOk(amount) || !idOk(id)) return false;
    this.change(id, this.wallet(id), amount, reason, !!opts.quiet);
    return true;
  }

  /**
   * `id` did something that pays (see EARN): its chips, unless it paid too recently (its cooldown) or
   * they've had its daily cap already today; up to what's left under the cap. Says how many it paid.
   * One of a `streak` (2 and up) pays its chips × the streak, up to its streakMax.
   */
  earn(id: string, kind: EarnKind, streak = 1): number {
    const e: Earning = EARN[kind];
    if (!idOk(id) || !e) return 0;
    const w = this.wallet(id);
    const now = this.now();
    this.newDay(w, now);
    const last = w.last[kind];
    if (e.cooldown && last !== undefined && now - last < e.cooldown) return 0;
    const times = Math.max(1, Math.min(Math.floor(streak), e.streakMax ?? 1));
    const pay = Math.min(e.chips * times, (e.perDay ?? Infinity) - (w.earned[kind] ?? 0));
    if (pay <= 0) return 0;
    w.earned[kind] = (w.earned[kind] ?? 0) + pay;
    w.last[kind] = now;
    this.change(id, w, pay, kind, false, streak > 1 ? streak : undefined);
    // Winnings at the mini games go to paying back a credit, while there's one owed.
    if (w.credit && CREDIT_GAMES.includes(kind)) {
      const back = Math.min(pay, wholeChips(w.credit.owed));
      this.repay(id, w, back);
      this.change(id, w, -back, 'credit.repay', true);
    }
    return pay;
  }

  /**
   * A shot of `id`'s went in (a `basket`, or a `three`): one more in their streak (a new one after
   * STREAK_PAUSE without a basket), paying its chips × the streak (see EARN). Too soon after their
   * last one (its cooldown) it counts for nothing and says null; else their streak and what it paid.
   */
  basket(id: string, kind: 'basket' | 'three'): { streak: number; chips: number } | null {
    if (!idOk(id)) return null;
    const now = this.now();
    const s = this.streaks.get(id);
    if (s && now - s.at < (EARN[kind].cooldown ?? 0)) return null;
    const n = s && now - s.at <= STREAK_PAUSE ? s.n + 1 : 1;
    this.streaks.set(id, { n, at: now });
    return { streak: n, chips: this.earn(id, kind, n) };
  }

  /** `id`'s streak of baskets is over (a shot of theirs missed, or they left the floor). Says whether they had one. */
  streakOver(id: string): boolean {
    return this.streaks.delete(id);
  }

  /**
   * A minute in which each of `ids` was active: every ONLINE_EVERY of them pays `online` (daily cap
   * and all). Ids that are one person on several pages should be passed once.
   */
  minute(ids: Iterable<string>) {
    for (const id of new Set(ids)) {
      if (!idOk(id)) continue;
      const w = this.wallet(id);
      w.seen = this.now();
      if (++w.online >= ONLINE_EVERY) {
        w.online = 0;
        this.earn(id, 'online');
      } else this.dirty();
    }
  }

  /**
   * `id` came in (or changed their name or colour): they have a wallet from now on (START_CHIPS, if
   * they're new), seen now, and they're on the leaderboard under `who`'s name.
   */
  seen(id: string, who: { name?: string; color?: string } = {}) {
    if (!idOk(id)) return;
    const w = this.wallet(id);
    w.seen = this.now();
    if (who.name) w.name = who.name.slice(0, 24);
    if (who.color) w.color = who.color;
    this.dirty();
    this.topCheck();
  }

  /**
   * The `n` biggest balances, most first (the same balance: by name), whether they're online or not.
   * Someone the office has no name for (from before it kept them) isn't on it until they're back.
   */
  top(n = CHIPS_TOP): ChipsTopEntry[] {
    const rows: ChipsTopEntry[] = [];
    for (const [id, w] of Object.entries(this.data.wallets)) {
      const name = this.nameOf?.(id) ?? w.name;
      if (!name) continue;
      const nameColor = nameColorOf(w.worn);
      rows.push({ id, name, chips: w.balance, ...(w.color ? { color: w.color } : {}), ...(this.online?.(id) ? { online: true } : {}), ...(nameColor ? { nameColor } : {}) });
    }
    rows.sort((a, b) => b.chips - a.chips || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
    return rows.slice(0, n);
  }

  /** Something the leaderboard shows may have changed (someone came or went): it's looked at again shortly, and sent if it's different. */
  topCheck() {
    if (!this.onTop || this.topTimer) return;
    this.topTimer = setTimeout(() => {
      this.topTimer = null;
      const top = this.top();
      const json = JSON.stringify(top);
      if (json === this.lastTop) return;
      this.lastTop = json;
      this.onTop?.(top);
    }, this.topAfter);
    this.topTimer.unref?.();
  }

  /** True the first time it's given `key` (like "pr:<floor>:<n>"), false ever after: for payouts that happen once. */
  once(key: string): boolean {
    if (this.data.once.includes(key)) return false;
    this.data.once.push(key);
    if (this.data.once.length > ONCE_KEPT) this.data.once.splice(0, this.data.once.length - ONCE_KEPT);
    this.dirty();
    return true;
  }

  /** Writes any change not on disk yet, now (the office is stopping). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }

  private wallet(id: string): Wallet {
    let w = this.data.wallets[id];
    if (!w) {
      const now = this.now();
      w = this.data.wallets[id] = { balance: START_CHIPS, ledger: [], day: chipsDay(now), earned: {}, last: {}, online: 0, seen: now };
    }
    return w;
  }

  private newDay(w: Wallet, now: number) {
    const day = chipsDay(now);
    if (w.day === day) return;
    w.day = day;
    w.earned = {};
  }

  private change(id: string, w: Wallet, amount: number, reason: ChipsReason, quiet: boolean, streak?: number) {
    w.balance += amount;
    const entry: ChipsEntry = { at: this.now(), amount, reason: String(reason).slice(0, 40), balance: w.balance, ...(streak && { streak }) };
    w.ledger.unshift(entry);
    if (w.ledger.length > LEDGER_SIZE) w.ledger.length = LEDGER_SIZE;
    this.dirty();
    this.onChange?.(id, this.state(id), { ...entry }, quiet);
    this.topCheck();
  }

  /** `chips` of `id`'s credit paid back: once it's all paid, it's gone, and the bank gives them another. */
  private repay(id: string, w: Wallet, chips: number) {
    if (!w.credit) return;
    w.credit.owed -= chips;
    this.dirty();
    // (A sliver left over from adding up minutes of work is nothing.)
    if (w.credit.owed > SLIVER) return;
    delete w.credit;
    this.onCredit?.(id);
  }

  private dirty() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, this.saveAfter);
    this.timer.unref?.();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const now = this.now();
      const wallets: Record<string, Wallet> = {};
      for (const [id, w] of Object.entries(saved.wallets ?? {})) {
        if (!idOk(id) || !w || !Number.isSafeInteger(w.balance) || w.balance < 0) continue;
        const seen = typeof w.seen === 'number' ? w.seen : now;
        if (id.startsWith('browser:') && now - seen > FORGET_BROWSER_MS) continue;
        wallets[id] = {
          balance: w.balance,
          ledger: Array.isArray(w.ledger) ? w.ledger.filter((e) => e && Number.isFinite(e.at) && Number.isSafeInteger(e.amount) && typeof e.reason === 'string').slice(0, LEDGER_SIZE) : [],
          day: typeof w.day === 'string' ? w.day : chipsDay(now),
          earned: w.earned && typeof w.earned === 'object' ? w.earned : {},
          last: w.last && typeof w.last === 'object' ? w.last : {},
          online: Number.isInteger(w.online) ? w.online : 0,
          seen,
          ...(w.credit && Number.isFinite(w.credit.at) && Number.isSafeInteger(w.credit.amount) && Number.isFinite(w.credit.owed) && w.credit.owed > SLIVER ? { credit: { at: w.credit.at, amount: w.credit.amount, owed: Math.min(w.credit.owed, CREDIT_MAX) } } : {}),
          ...(typeof w.name === 'string' && w.name ? { name: w.name.slice(0, 24) } : {}),
          ...(typeof w.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(w.color) ? { color: w.color } : {}),
          ...shopOf(w),
        };
      }
      this.data = { wallets, once: Array.isArray(saved.once) ? saved.once.filter((k) => typeof k === 'string') : [] };
    } catch (err) {
      this.unreadable = true;
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message} — chips won't be saved until it's fixed or moved`);
    }
  }

  private save() {
    if (this.unreadable) return;
    const wallets = Object.fromEntries(Object.entries(this.data.wallets).filter(([id]) => !id.startsWith('conn:')));
    // Written whole and renamed into place, so a crash mid-write never leaves half a file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ wallets, once: this.data.once }), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}

/** Who someone is to the bank (see Chips): their account, else their browser's chips key, else just this connection. */
export function chipsId(accountId: string | undefined, key: unknown, conn: string): string {
  return accountId ? `account:${accountId}` : chipsKeyOk(key) ? `browser:${key}` : `conn:${conn}`;
}

/**
 * Whether a throw at the hoop goes in, as the pages fly it (shared/hoop.ts, off the backboard and the
 * rim): a `three` from behind the three-point line, else a `basket`, and how long after it was let go
 * of (ms); null for a miss.
 */
export function basketOf(s: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): { kind: 'basket' | 'three'; after: number } | null {
  const sim = launch(s);
  const solids = [backboard()];
  while (!sim.scored && !sim.still && !sim.lost && sim.t < 6) simulate(sim, sim.t + 0.25, solids);
  if (!sim.scored) return null;
  const far = Math.hypot(s.x - HOOP.rim.x, s.z - HOOP.rim.z) >= THREE_POINT;
  return { kind: far ? 'three' : 'basket', after: Math.round(sim.t * 1000) };
}

/**
 * Whether a throw is a shot at the hoop (one that misses ends a streak), not a pass or a drop: up and
 * out towards the rim, from no further off than you can shoot from (as the pages aim, main.ts's shotAim).
 */
export function shotAtHoop(s: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): boolean {
  const toRim = Math.atan2(HOOP.rim.x - s.x, HOOP.rim.z - s.z);
  const heading = Math.atan2(s.vx, s.vz);
  const off = Math.abs(Math.atan2(Math.sin(toRim - heading), Math.cos(toRim - heading)));
  return s.vy > 0.5 && Math.hypot(s.vx, s.vz) > 0.5 && off < 0.6 && Math.hypot(HOOP.rim.x - s.x, HOOP.rim.z - s.z) < 16;
}

/** Messages that mean someone's really there (walking, playing, typing, talking), for `online`: not what a page sends by itself. */
export function activeMsg(msg: { t: string; moving?: unknown }): boolean {
  if (msg.t === 'move') return msg.moving === true;
  return ACTIVE.has(msg.t) || /^(ball|darts|pool|golf|cabinet|wb)\./.test(msg.t);
}
const ACTIVE = new Set(['act', 'golf', 'emote', 'chat', 'term.input', 'term.typing', 'worker.prompt', 'worker.spawn', 'whistle']);

/** A saved wallet's shop things, kept tidy: only items that are still in the catalogue, each once, and only what's owned worn. */
function shopOf(w: Partial<Wallet>): Pick<Wallet, 'items' | 'worn'> {
  if (!Array.isArray(w.items)) return {};
  const items = SHOP_ITEMS.filter((i) => w.items!.includes(i.id)).map((i) => i.id);
  if (!items.length) return {};
  return { items, worn: tidyWorn(Array.isArray(w.worn) ? w.worn : [], items) };
}

/** Less than this owed on a credit is paid (chips). */
const SLIVER = 1e-6;

/** What's owed on a credit, in whole chips (rounded up, but not for a sliver). */
function wholeChips(owed: number): number {
  return Math.max(0, Math.ceil(owed - SLIVER));
}

/** Someone's id, as the office makes them (see Chips). */
function idOk(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 100 && /^(account|browser|conn):/.test(id);
}
