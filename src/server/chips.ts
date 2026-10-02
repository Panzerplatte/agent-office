import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HOOP, THREE_POINT, backboard, launch, simulate } from '../shared/hoop.js';
import { EARN, LEDGER_SIZE, ONLINE_EVERY, START_CHIPS, chipsAmountOk, chipsDay, chipsKeyOk, type ChipsEntry, type ChipsReason, type ChipsState, type EarnKind } from '../shared/chips.js';

/** How long after a change the file is written, gathering a burst of changes into one write (ms). */
const SAVE_AFTER = 1000;
/** A browser nobody has seen in this long is forgotten (an account never is). */
const FORGET_BROWSER_MS = 180 * 24 * 60 * 60_000;
/** How many one-off payouts (see once) are remembered. */
const ONCE_KEPT = 2000;

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
}

interface Saved {
  wallets: Record<string, Wallet>;
  /** One-off payouts already made (a merged pull request pays once, whatever the restarts). */
  once: string[];
}

export interface ChipsOptions {
  now?: () => number;
  /** A balance changed: `entry` is the change, `quiet` if whoever made it asked for no toast. */
  onChange?: (id: string, state: ChipsState, entry: ChipsEntry, quiet: boolean) => void;
  /** How long after a change it's written to disk (ms); tests pass 0 and call flush. */
  saveAfter?: number;
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
 * for things done round the office, from the EARN table, with its cooldowns and daily caps.
 */
export class Chips {
  private data: Saved = { wallets: {}, once: [] };
  private file: string;
  private now: () => number;
  private onChange: ChipsOptions['onChange'];
  private saveAfter: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The file is there but couldn't be read: never write over it, or everyone's chips are gone. */
  private unreadable = false;

  constructor(dataDir: string, opts: ChipsOptions = {}) {
    this.file = path.join(dataDir, 'chips.json');
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.saveAfter = opts.saveAfter ?? SAVE_AFTER;
    this.load();
  }

  /** What `id` has: START_CHIPS for someone new. */
  balance(id: string): number {
    return this.data.wallets[id]?.balance ?? START_CHIPS;
  }

  /** `id`'s balance and latest changes, newest first, for their page. */
  state(id: string): ChipsState {
    const w = this.data.wallets[id];
    return w ? { balance: w.balance, ledger: w.ledger.map((e) => ({ ...e })) } : { balance: START_CHIPS, ledger: [] };
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
   */
  earn(id: string, kind: EarnKind): number {
    const e: { chips: number; cooldown?: number; perDay?: number } = EARN[kind];
    if (!idOk(id) || !e) return 0;
    const w = this.wallet(id);
    const now = this.now();
    this.newDay(w, now);
    const last = w.last[kind];
    if (e.cooldown && last !== undefined && now - last < e.cooldown) return 0;
    const pay = Math.min(e.chips, (e.perDay ?? Infinity) - (w.earned[kind] ?? 0));
    if (pay <= 0) return 0;
    w.earned[kind] = (w.earned[kind] ?? 0) + pay;
    w.last[kind] = now;
    this.change(id, w, pay, kind, false);
    return pay;
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

  /** `id` came in: they have a wallet from now on (START_CHIPS, if they're new), seen now. */
  seen(id: string) {
    if (!idOk(id)) return;
    this.wallet(id).seen = this.now();
    this.dirty();
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

  private change(id: string, w: Wallet, amount: number, reason: ChipsReason, quiet: boolean) {
    w.balance += amount;
    const entry: ChipsEntry = { at: this.now(), amount, reason: String(reason).slice(0, 40), balance: w.balance };
    w.ledger.unshift(entry);
    if (w.ledger.length > LEDGER_SIZE) w.ledger.length = LEDGER_SIZE;
    this.dirty();
    this.onChange?.(id, this.state(id), { ...entry }, quiet);
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

/** Messages that mean someone's really there (walking, playing, typing, talking), for `online`: not what a page sends by itself. */
export function activeMsg(msg: { t: string; moving?: unknown }): boolean {
  if (msg.t === 'move') return msg.moving === true;
  return ACTIVE.has(msg.t) || /^(ball|darts|pool|golf|cabinet|wb)\./.test(msg.t);
}
const ACTIVE = new Set(['act', 'golf', 'emote', 'chat', 'term.input', 'term.typing', 'worker.prompt', 'worker.spawn', 'whistle']);

/** Someone's id, as the office makes them (see Chips). */
function idOk(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 100 && /^(account|browser|conn):/.test(id);
}
