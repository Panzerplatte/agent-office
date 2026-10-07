import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { addWager, crashRanking, emptyTotals, settle, takeWager, type CrashBoardRow, type CrashTotals } from '../shared/crash.js';

/** How long after a change the file is written, gathering a round's bets and cash-outs into one write (ms). */
const SAVE_AFTER = 1000;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Someone's place on the scoreboard, with whose it is (`id`, their chips id, which stays on the server). */
export interface CrashBoardEntry extends CrashBoardRow {
  id: string;
}

export interface CrashStatsOptions {
  /** How long after a change it's written to disk (ms); tests pass 0 and call flush. */
  saveAfter?: number;
  /** Somebody's totals changed (a bet went down, was taken back, or settled). */
  onChange?: () => void;
}

/**
 * Everyone's Crash totals, all-time, in .agent-office/crash-stats.json: what each person (by chips id,
 * see server/chips.ts) has bet on Crash, what it's come to, and their biggest win, for the scoreboard
 * by the Crash screen. The game (server/crash.ts) tells it when a bet goes down, is taken back, and
 * settles; nothing here ever resets with the rounds. A `conn:` id, which only lasts while the office
 * runs, is counted but never saved.
 */
export class CrashStats {
  private totals = new Map<string, CrashTotals & { name: string; color?: string }>();
  private file: string;
  private saveAfter: number;
  private onChange: CrashStatsOptions['onChange'];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The file is there but couldn't be read: never write over it. */
  private unreadable = false;

  constructor(dataDir: string, opts: CrashStatsOptions = {}) {
    this.file = path.join(dataDir, 'crash-stats.json');
    this.saveAfter = opts.saveAfter ?? SAVE_AFTER;
    this.onChange = opts.onChange;
    this.load();
  }

  /** `id` (called `name`) bet `amount` on a round. */
  bet(id: string, amount: number, name: string, color?: string) {
    const t = this.totals.get(id);
    const c = color ?? t?.color;
    this.totals.set(id, { ...addWager(t ?? emptyTotals(), amount), name: name.slice(0, 24) || t?.name || '?', ...(c ? { color: c } : {}) });
    this.changed();
  }

  /** `id`'s bet of `amount` went back to them (taken back while the clock counted down, or the office stopped). */
  refund(id: string, amount: number) {
    const t = this.totals.get(id);
    if (!t) return;
    this.totals.set(id, { ...t, ...takeWager(t, amount) });
    this.changed();
  }

  /** `id`'s bet of `bet` settled: cashed out at `m` for `won`, or lost in the crash at `m` (`won` 0). */
  settle(id: string, bet: number, won: number, m: number) {
    const t = this.totals.get(id);
    if (!t) return;
    this.totals.set(id, { ...t, ...settle(t, bet, won, m) });
    this.changed();
  }

  /** `id`'s totals so far (none if they've never played). */
  of(id: string): CrashTotals | undefined {
    const t = this.totals.get(id);
    return t && { wagered: t.wagered, net: t.net, rounds: t.rounds, ...(t.best ? { best: { ...t.best } } : {}) };
  }

  /** Everyone's all-time result on Crash (won less wagered): for the house bank's backfill (server/housebank.ts). */
  nets(): number[] {
    return [...this.totals.values()].map((t) => t.net);
  }

  /** The scoreboard: the most wagered and the most won, each with whose place it is. */
  board(): { wagered: CrashBoardEntry[]; won: CrashBoardEntry[] } {
    return crashRanking([...this.totals].map(([id, t]) => ({ id, ...structuredClone(t) })));
  }

  /** Writes any change not on disk yet, now (the office is stopping). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }

  private changed() {
    this.onChange?.();
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
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Partial<CrashTotals & { name: string; color: string }>>;
      for (const [id, t] of Object.entries(saved ?? {})) {
        if (!t || !Number.isSafeInteger(t.wagered) || !Number.isSafeInteger(t.net) || typeof t.name !== 'string') continue;
        const best = t.best && Number.isSafeInteger(t.best.won) && Number.isFinite(t.best.m) ? { won: t.best.won, m: t.best.m } : undefined;
        this.totals.set(id, {
          wagered: Math.max(0, t.wagered!),
          net: t.net!,
          rounds: Number.isSafeInteger(t.rounds) ? t.rounds! : 0,
          ...(best ? { best } : {}),
          name: t.name.slice(0, 24),
          ...(typeof t.color === 'string' && COLOR_RE.test(t.color) ? { color: t.color } : {}),
        });
      }
    } catch (err) {
      this.unreadable = true;
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message} — Crash totals won't be saved until it's fixed or moved`);
    }
  }

  private save() {
    if (this.unreadable) return;
    const saved = Object.fromEntries([...this.totals].filter(([id]) => !id.startsWith('conn:')));
    // Written whole and renamed into place, so a crash mid-write never leaves half a file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}
