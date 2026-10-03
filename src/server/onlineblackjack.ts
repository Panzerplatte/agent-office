import { MAX_SEATS, type Rand } from '../shared/blackjack.js';
import { EMOTE_EVERY, ONLINE_KEEP, isOnlineEmote, type OnlineBlackjackState, type OnlineEmote, type OnlineTable } from '../shared/onlineblackjack.js';
import { SEATING_BY_ID } from '../shared/layout.js';
import { BlackjackTable, type BlackjackBank } from './blackjack.js';

/** Whether someone sitting on seat place `seat` (a PeerInfo seat key, "boss-chair:0") is at a PC: the boss's chair, facing its monitor. */
export function atPc(seat: string | undefined): boolean {
  return !!seat && !!SEATING_BY_ID.get(seat.split(':')[0])?.game;
}

export interface OnlineBlackjackOptions {
  /** Something changed on its own (a table's clock, a kept seat let go): tell everyone. */
  changed?: () => void;
  now?: () => number;
  rand?: Rand;
  /** Set timers for the clocks (the default); off, `tick()` (and each table's) is called by hand (tests). */
  timers?: boolean;
}

/** Someone at a PC, at a table: which, who they are (their chips id) and the floor their PC is on. */
interface Sitting {
  table: number;
  key: string;
  floor: string;
}

/** A place kept for someone who stepped away from their PC: at which table, which seat (and its id there), and until when. */
interface Kept {
  table: number;
  seat: number;
  id: string;
  name: string;
  until: number;
}

/**
 * Online blackjack at the office PCs: the casino's tables (see server/blackjack.ts), as many as it
 * takes, for everyone sitting at a PC on any floor. Someone who sits down to play is put at the first
 * table with room (a new one once they're all full), and a table nobody's at any more goes.
 *
 * A seat is kept by who someone is (`key`, their chips id): stepping away from the PC, a reload or a
 * dropped connection only makes them away. The table keeps them while they're in a round (the others
 * can skip their hand); after that their place waits ONLINE_KEEP for them, and nobody else is put in
 * it. Coming back to a PC (on any floor) puts them back in it. Leave gives it up at once.
 */
export class OnlineBlackjack {
  private readonly tables = new Map<number, BlackjackTable>();
  private ids = 0;
  private readonly sitting = new Map<string, Sitting>();
  private readonly kept = new Map<string, Kept>();
  private readonly emoted = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly bank: BlackjackBank,
    private readonly opts: OnlineBlackjackOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Every table as its pages see it, with the floor each player's PC is on and the places kept. */
  state(): OnlineBlackjackState {
    const now = this.now();
    const tables: OnlineTable[] = [];
    for (const [id, table] of this.tables) {
      const s = table.state();
      const floors: Record<string, string> = {};
      for (const seat of s.seats) {
        const at = seat.peer ? this.sitting.get(seat.peer) : undefined;
        if (at) floors[seat.id] = at.floor;
      }
      const kept = this.keptAt(id).map((k) => ({ seat: k.seat, name: k.name, left: Math.max(0, k.until - now) }));
      tables.push({ ...s, id, floors, kept });
    }
    return { tables };
  }

  /** The table `id`, for tests. */
  table(id: number): BlackjackTable | undefined {
    return this.tables.get(id);
  }

  /** Stops every clock: the office is closing. */
  dispose() {
    for (const t of this.tables.values()) t.dispose();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * `peer` (`key`: who they are) sits down to play at their PC on `floor`: back in their own seat if one's
   * kept for them (or this is their seat from another page), otherwise in the first free place at the
   * first table with room. Not if they're at a table already. Says whether anything changed.
   */
  join(peer: string, name: string, key: string, floor: string): boolean {
    if (this.sitting.has(peer)) return false;
    this.prune();
    // Theirs from another page of theirs (the same account or browser): this one has it now.
    for (const [other, s] of this.sitting) {
      if (s.key !== key) continue;
      if (!this.tables.get(s.table)?.join(peer, name, key)) return false;
      this.sitting.delete(other);
      this.sitting.set(peer, { ...s, floor });
      return true;
    }
    const k = this.kept.get(key);
    if (k) {
      this.kept.delete(key);
      const table = this.tables.get(k.table);
      if (table?.join(peer, name, key, k.seat)) {
        this.sitting.set(peer, { table: k.table, key, floor });
        return true;
      }
    }
    for (const [id, table] of this.tables) {
      const spot = this.freeSeat(id);
      if (spot !== undefined && table.join(peer, name, key, spot)) {
        this.sitting.set(peer, { table: id, key, floor });
        return true;
      }
    }
    const id = ++this.ids;
    const table = new BlackjackTable(this.bank, {
      label: 'onlineblackjack',
      now: this.opts.now,
      rand: this.opts.rand,
      timers: this.opts.timers,
      changed: () => {
        this.tidy();
        this.opts.changed?.();
      },
    });
    this.tables.set(id, table);
    table.join(peer, name, key, 0);
    this.sitting.set(peer, { table: id, key, floor });
    return true;
  }

  /** `peer` stepped away from their PC (got up, left the floor, lost the connection): their place is kept for them, away. */
  away(peer: string): boolean {
    const s = this.sitting.get(peer);
    if (!s) return false;
    this.sitting.delete(peer);
    this.emoted.delete(peer);
    const table = this.tables.get(s.table);
    const seat = table?.state().seats.find((x) => x.peer === peer);
    if (table && seat) {
      table.away(peer);
      this.kept.set(s.key, { table: s.table, seat: seat.seat, id: seat.id, name: seat.name, until: this.now() + ONLINE_KEEP });
    }
    this.tidy();
    this.arm();
    return true;
  }

  /** `peer` gets up from their table for good: their bet back, their hands in a round stand (and are still paid). */
  left(peer: string): boolean {
    const s = this.sitting.get(peer);
    if (!s) return false;
    this.sitting.delete(peer);
    this.emoted.delete(peer);
    this.kept.delete(s.key);
    this.tables.get(s.table)?.left(peer);
    this.tidy();
    return true;
  }

  bet(peer: string, amount: unknown): boolean {
    return !!this.tableOf(peer)?.bet(peer, amount);
  }

  deal(peer: string): boolean {
    return !!this.tableOf(peer)?.deal(peer);
  }

  act(peer: string, action: unknown): boolean {
    return !!this.tableOf(peer)?.act(peer, action);
  }

  insure(peer: string, take: unknown): boolean {
    return !!this.tableOf(peer)?.insure(peer, take);
  }

  skip(peer: string): boolean {
    return !!this.tableOf(peer)?.skip(peer);
  }

  /** `peer` pulls a face at their table: who's to see it (the table, and the seat), or nothing (not one of ONLINE_EMOTES, not at a table, too soon). */
  emote(peer: string, emote: unknown): { table: number; seat: number; emote: OnlineEmote } | undefined {
    const s = this.sitting.get(peer);
    if (!s || !isOnlineEmote(emote)) return undefined;
    const now = this.now();
    if (now - (this.emoted.get(peer) ?? -Infinity) < EMOTE_EVERY) return undefined;
    const seat = this.tables.get(s.table)?.state().seats.find((x) => x.peer === peer);
    if (!seat) return undefined;
    this.emoted.set(peer, now);
    return { table: s.table, seat: seat.seat, emote };
  }

  /** Lets go of the places kept too long: called by its own timer (or by hand). Says whether anything changed. */
  tick(): boolean {
    const changed = this.prune();
    if (changed) this.tidy();
    this.arm();
    return changed;
  }

  private tableOf(peer: string): BlackjackTable | undefined {
    const s = this.sitting.get(peer);
    return s && this.tables.get(s.table);
  }

  /** The places kept at table `id` that the table itself doesn't hold any more (they're in no round). */
  private keptAt(id: number): Kept[] {
    const table = this.tables.get(id);
    const held = new Set(table?.state().seats.map((s) => s.id) ?? []);
    return [...this.kept.values()].filter((k) => k.table === id && !held.has(k.id));
  }

  /** The first place at table `id` that nobody has, is away from, or has kept: none if it's full. */
  private freeSeat(id: number): number | undefined {
    const table = this.tables.get(id);
    if (!table) return undefined;
    const used = new Set([...table.state().seats.map((s) => s.seat), ...[...this.kept.values()].filter((k) => k.table === id).map((k) => k.seat)]);
    for (let i = 0; i < MAX_SEATS; i++) if (!used.has(i)) return i;
    return undefined;
  }

  /** Lets go of kept places whose time is up, unless the table still holds them in a round. Says whether any went. */
  private prune(): boolean {
    const now = this.now();
    let any = false;
    for (const [key, k] of this.kept) {
      if (k.until > now) continue;
      const held = this.tables.get(k.table)?.state().seats.some((s) => s.id === k.id);
      if (held) continue;
      this.kept.delete(key);
      any = true;
    }
    return any;
  }

  /** A table with nobody at it, away in a round or kept for, goes. */
  private tidy() {
    for (const [id, table] of this.tables) {
      if (table.state().seats.length || [...this.kept.values()].some((k) => k.table === id)) continue;
      table.dispose();
      this.tables.delete(id);
    }
  }

  /** Wakes up when the next kept place's time is up. */
  private arm() {
    if (this.opts.timers === false) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.kept.size) return;
    const next = Math.min(...[...this.kept.values()].map((k) => k.until));
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (this.tick()) this.opts.changed?.();
      },
      // A place still held in a round is looked at again later.
      Math.max(1_000, next - this.now() + 5),
    );
    this.timer.unref?.();
  }
}
