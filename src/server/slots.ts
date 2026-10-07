import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HouseTally } from './housebank.js';
import { JACKPOT_SEED, JACKPOT_SHARE, REELS, SPIN_MS, emptySlots, evaluate, isBet, jackpotWin, type JackpotHit, type SlotSpin, type SlotsState } from '../shared/slots.js';

/** A machine kept for someone who walked off (or reloaded, or dropped out) stays theirs this long (ms). */
export const KEEP_MS = 5 * 60_000;
/** How long after a change the jackpot is written to disk (ms). */
const SAVE_AFTER = 2000;

/** What the slots need from the bank (see server/chips.ts): a bet on the way in, a payout on the way out. */
export interface SlotsBank {
  bet(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
  award(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
}

export interface SlotsOptions {
  /** Where the jackpot is kept between restarts (slots.json); none in the tests. */
  dataDir?: string;
  now?: () => number;
  /** Where each reel stops, 0 to its length - 1: crypto random unless a test says otherwise. */
  random?: (n: number) => number;
  /** A spin's winnings are paid once its reels have stopped: then, or at once in the tests. */
  later?: (fn: () => void, ms: number) => void;
  /** The reels have stopped and it's paid: the casino hears about it again (the jackpot's back to its seed, say). */
  onPaid?: (spin: SlotSpin, machine: number) => void;
  /** The house bank (server/housebank.ts): told what each settled bet lost. */
  house?: HouseTally;
}

/** Someone's machine, and who it's kept for: `key` is who they are at the bank (their chips id), the same after a reload. */
interface Seat {
  name: string;
  key: string;
  peer?: string;
  /** When they walked off (with no `peer`): the machine's theirs until KEEP_MS after it. */
  awayAt?: number;
}

interface Machine {
  seat: Seat | null;
  spin: SlotSpin | null;
  /** When its reels were last pulled: no new spin until they've stopped. */
  spunAt: number;
}

/** A payout waiting for the reels to stop. */
interface Pending {
  key: string;
  win: number;
  spin: SlotSpin;
  machine: number;
  paid: boolean;
}

/**
 * The casino's slot machines: who's at which (one person each), every spin and the jackpot they share.
 * The office spins the reels itself (crypto random), takes the bet from the bank first and pays what
 * it won once the reels have stopped, so the balance doesn't give the result away before the screen.
 *
 * A machine belongs to whoever sits down at it and says so (`join`) until they leave it (Leave, or
 * Esc). Walking off, reloading or dropping out only leaves them away: it's kept for them for KEEP_MS,
 * and sitting down at it again (as the same person to the bank) carries on where they were.
 */
export class Slots {
  private machines: Machine[];
  private jackpot = JACKPOT_SEED;
  private last: JackpotHit | null = null;
  private pending: Pending[] = [];
  private readonly file: string | null;
  private readonly now: () => number;
  private readonly random: (n: number) => number;
  private readonly later: (fn: () => void, ms: number) => void;
  private readonly onPaid: SlotsOptions['onPaid'];
  private readonly house: SlotsOptions['house'];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private n = 0;

  constructor(
    count: number,
    private readonly bank: SlotsBank,
    opts: SlotsOptions = {},
  ) {
    this.machines = Array.from({ length: count }, () => ({ seat: null, spin: null, spunAt: -Infinity }));
    this.file = opts.dataDir ? path.join(opts.dataDir, 'slots.json') : null;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? ((n) => randomInt(n));
    this.later = opts.later ?? ((fn, ms) => setTimeout(fn, ms).unref());
    this.onPaid = opts.onPaid;
    this.house = opts.house;
    this.load();
  }

  /** Every machine as the casino sees it (without anyone's key), and the jackpot in whole chips. */
  state(): SlotsState {
    this.expire();
    const s = emptySlots(0);
    s.machines = this.machines.map((m) => ({ seat: m.seat && { name: m.seat.name, ...(m.seat.peer ? { peer: m.seat.peer } : {}) }, spin: m.spin && structuredClone(m.spin) }));
    s.jackpot = Math.floor(this.jackpot);
    s.last = this.last && { ...this.last };
    return s;
  }

  /**
   * `peer` (`key` at the bank) sits down at `machine`: theirs, unless someone else has it (or has it
   * kept for them while they're away). Back at one kept for them, they've got it again. Anywhere else
   * they were sitting is let go. Says whether they've got it.
   */
  join(peer: string, machine: unknown, name: string, key: string): boolean {
    this.expire();
    const m = this.machine(machine);
    if (!m || !key) return false;
    if (m.seat && m.seat.key !== key) return false;
    for (const o of this.machines) if (o !== m && (o.seat?.peer === peer || o.seat?.key === key)) o.seat = null;
    m.seat = { name: name.slice(0, 24), key, peer };
    return true;
  }

  /** Which machine `peer` is at (-1 for none). */
  machineOf(peer: string): number {
    return this.machines.findIndex((m) => m.seat?.peer === peer);
  }

  /** `peer` walked off (or reloaded, or dropped out): their machine's kept for them a while. Says whether they had one. */
  away(peer: string): boolean {
    const m = this.at(peer);
    if (!m?.seat) return false;
    delete m.seat.peer;
    m.seat.awayAt = this.now();
    return true;
  }

  /** `peer` leaves their machine on purpose: it's free for anyone. Says whether they had one. */
  left(peer: string): boolean {
    const m = this.at(peer);
    if (!m) return false;
    m.seat = null;
    return true;
  }

  /**
   * `peer` pulls the lever on their machine for `bet` chips. Not before the last spin's reels have
   * stopped, not with a bet that isn't on the machine or that they haven't got. The bet comes off,
   * some of it into the jackpot, the reels stop where the office says, and what it won is paid once
   * they have. Says whether it spun.
   */
  spin(peer: string, bet: unknown): boolean {
    const m = this.at(peer);
    if (!m?.seat || !isBet(bet)) return false;
    const now = this.now();
    if (now - m.spunAt < SPIN_MS) return false;
    const key = m.seat.key;
    if (!this.bank.bet(key, bet, 'slots.bet', { quiet: true })) return false;
    m.spunAt = now;
    this.jackpot += bet * JACKPOT_SHARE;
    const stops = REELS.map((r) => this.random(r.length));
    const result = evaluate(stops, bet);
    let jackpot = 0;
    if (result.jackpot) {
      jackpot = jackpotWin(this.jackpot, bet);
      this.jackpot = Math.max(JACKPOT_SEED, this.jackpot - jackpot);
    }
    const machine = this.machines.indexOf(m);
    const spin: SlotSpin = { n: ++this.n, stops, bet, win: result.win + jackpot, lines: result.lines, jackpot, name: m.seat.name };
    m.spin = spin;
    if (jackpot) this.last = { name: m.seat.name, amount: jackpot, machine, at: now };
    this.saveSoon();
    // The spin's settled now (the reels only show it): what it didn't pay back goes to the house bank.
    if (spin.win < bet) this.house?.lost('slots', bet - spin.win);
    if (spin.win > 0) {
      const p: Pending = { key, win: spin.win, spin, machine, paid: false };
      this.pending.push(p);
      this.later(() => this.pay(p), SPIN_MS);
    }
    return true;
  }

  /** Pays every spin still waiting on its reels, and writes the jackpot down: the office is stopping. */
  flush() {
    for (const p of [...this.pending]) this.pay(p);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }

  private pay(p: Pending) {
    if (p.paid) return;
    p.paid = true;
    this.pending = this.pending.filter((o) => o !== p);
    this.bank.award(p.key, p.win, p.spin.jackpot ? 'slots.jackpot' : 'slots.win', { quiet: true });
    this.onPaid?.(p.spin, p.machine);
  }

  private machine(i: unknown): Machine | undefined {
    return typeof i === 'number' && Number.isInteger(i) ? this.machines[i] : undefined;
  }

  private at(peer: string): Machine | undefined {
    return this.machines.find((m) => m.seat?.peer === peer);
  }

  /** Machines kept for someone who hasn't come back in KEEP_MS are free again. */
  private expire() {
    const now = this.now();
    for (const m of this.machines) if (m.seat && !m.seat.peer && now - (m.seat.awayAt ?? now) >= KEEP_MS) m.seat = null;
  }

  private load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { jackpot?: unknown; last?: JackpotHit | null };
      if (typeof saved.jackpot === 'number' && Number.isFinite(saved.jackpot) && saved.jackpot >= JACKPOT_SEED) this.jackpot = saved.jackpot;
      const l = saved.last;
      if (l && typeof l.name === 'string' && Number.isSafeInteger(l.amount) && Number.isInteger(l.machine) && typeof l.at === 'number') this.last = { name: l.name, amount: l.amount, machine: l.machine, at: l.at };
    } catch (err) {
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message}`);
    }
  }

  private saveSoon() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, SAVE_AFTER);
    this.timer.unref();
  }

  private save() {
    if (!this.file) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ jackpot: this.jackpot, last: this.last }));
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}
