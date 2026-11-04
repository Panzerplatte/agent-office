import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BOARD_SIZE, CHECKPOINTS, LONGEST_MS, QUICKEST_MS, atFlag, checkpointPiece, type JumpRunScore } from '../shared/jumprun.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** How far off the last place the office heard you were (m) still counts: moves come a few times a second. */
const SLACK = 2.5;

/** Quickest first; of two the same, the one that got there first. */
const byTime = (a: JumpRunScore, b: JumpRunScore) => a.ms - b.ms || a.at - b.at;

interface Entry extends JumpRunScore {
  /** Whose time it is (an account, or a name on the shared password): one time each, their best. */
  owner: string;
}

/**
 * The jump & run's board: everyone's best time, for the whole building, saved in the office's
 * .agent-office/jumprun.json so it's still there after a restart.
 */
export class JumpRunTimes {
  private list: Entry[] = [];
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'jumprun.json');
    this.load();
  }

  /** The board as it's shown: the best BOARD_SIZE. */
  top(): JumpRunScore[] {
    return this.list.slice(0, BOARD_SIZE).map(({ name, color, ms, at }) => ({ name, color, ms, at }));
  }

  /**
   * A finished run of `owner`'s: on the board if it beats their best. Says their place on the board
   * (from 1, or null if it isn't on it), whether it's their best yet, and whether it took first place.
   */
  record(owner: string, name: string, color: string, ms: number, at: number): { rank: number | null; best: boolean; first: boolean } {
    const was = this.list.find((e) => e.owner === owner);
    const best = !was || ms < was.ms;
    if (best) {
      this.list = [...this.list.filter((e) => e.owner !== owner), { owner, name, color, ms, at }].sort(byTime);
      this.save();
    }
    const i = this.list.findIndex((e) => e.owner === owner);
    const rank = i >= 0 && i < BOARD_SIZE ? i + 1 : null;
    return { rank, best, first: best && i === 0 };
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(saved)) return;
      for (const e of saved as Partial<Entry>[]) {
        if (!e || typeof e !== 'object' || typeof e.owner !== 'string' || typeof e.name !== 'string' || !e.name) continue;
        if (typeof e.ms !== 'number' || !Number.isFinite(e.ms) || e.ms < QUICKEST_MS || typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
        if (this.list.some((o) => o.owner === e.owner)) continue;
        this.list.push({ owner: e.owner, name: e.name.slice(0, 24), color: typeof e.color === 'string' && COLOR_RE.test(e.color) ? e.color : '#4f86f7', ms: Math.round(e.ms), at: e.at });
      }
      this.list.sort(byTime);
    } catch {
      // a broken file just means a fresh board
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.list, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

/** Who's running, as the office knows them: who they are, how they show on the board, and where it last heard they were. */
export interface Runner {
  /** Their connection. */
  id: string;
  owner: string;
  name: string;
  color: string;
  x: number;
  z: number;
}

interface Run {
  startedAt: number;
  /** The checkpoints reached so far. */
  reached: number;
}

/** What the office made of a finish: the time, and how it went on the board; or it didn't count. */
export type Finish = { ok: true; ms: number; rank: number | null; best: boolean; first: boolean } | { ok: false };

/**
 * The jump & run's clock. Crossing the start line starts it (by the office's clock, not the
 * browser's), checkpoints come in order and only where they are, and the flag stops it: a run that
 * reaches the flag with every checkpoint behind it, there, and no quicker than anyone can run it
 * (QUICKEST_MS) goes on the board.
 */
export class JumpRun {
  private readonly runs = new Map<string, Run>();

  constructor(
    readonly times: JumpRunTimes,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether `id` has a run on. */
  running(id: string): boolean {
    const r = this.runs.get(id);
    if (r && this.now() - r.startedAt > LONGEST_MS) this.runs.delete(id);
    return this.runs.has(id);
  }

  start(id: string) {
    this.runs.set(id, { startedAt: this.now(), reached: 0 });
  }

  /** `who` landed on checkpoint `n`: it counts if it's the next one and they're on it. */
  checkpoint(who: Runner, n: number): boolean {
    const run = this.running(who.id) ? this.runs.get(who.id)! : undefined;
    const p = checkpointPiece(n);
    if (!run || !p || n !== run.reached + 1) return false;
    if (Math.abs(who.x - p.x) > p.w / 2 + SLACK || Math.abs(who.z - p.z) > p.d / 2 + SLACK) return false;
    run.reached = n;
    return true;
  }

  /** `who` reached the flag. */
  finish(who: Runner): Finish {
    const run = this.running(who.id) ? this.runs.get(who.id)! : undefined;
    this.runs.delete(who.id);
    if (!run || run.reached !== CHECKPOINTS || !atFlag(who.x, who.z, SLACK)) return { ok: false };
    const at = this.now();
    const ms = at - run.startedAt;
    if (ms < QUICKEST_MS) return { ok: false };
    return { ok: true, ms, ...this.times.record(who.owner, who.name, who.color, ms, at) };
  }

  /** `id` gave up, or went away. */
  quit(id: string) {
    this.runs.delete(id);
  }
}
