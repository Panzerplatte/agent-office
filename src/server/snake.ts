import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SNAKE_SCORES_KEPT, START_LENGTH, checkScore, tickMs, type SnakeFrame, type SnakeResult, type SnakeScore } from '../shared/snake.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Best first; of two the same, the one that got there first. */
const byScore = (a: SnakeScore, b: SnakeScore) => b.score - a.score || a.at - b.at;

/**
 * The Snake machine's high-score table: one for the whole building, on every floor's machine, saved
 * in the office's .agent-office/snake.json so it's still there after a restart.
 */
export class SnakeScores {
  private list: SnakeScore[] = [];
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'snake.json');
    this.load();
  }

  top(): SnakeScore[] {
    return this.list;
  }

  /** A finished game's score: on the table if it's good enough (and that game isn't on it yet). Says whether the table changed, and whether it took first place. */
  record(s: Omit<SnakeScore, 'at'>): { changed: boolean; first: boolean } {
    if (s.score <= 0 || this.list.some((e) => e.game === s.game)) return { changed: false, first: false };
    const next = [...this.list, { ...s, at: Date.now() }].sort(byScore).slice(0, SNAKE_SCORES_KEPT);
    if (!next.some((e) => e.game === s.game)) return { changed: false, first: false };
    this.list = next;
    this.save();
    return { changed: true, first: next[0].game === s.game };
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(saved)) return;
      for (const e of saved as Partial<SnakeScore>[]) {
        const s = e && typeof e === 'object' ? checkScore(e) : null;
        if (!s || typeof e.name !== 'string' || !e.name || typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
        this.list.push({ ...s, name: e.name.slice(0, 24), color: typeof e.color === 'string' && COLOR_RE.test(e.color) ? e.color : '#4f86f7', at: e.at });
      }
      this.list = this.list.sort(byScore).slice(0, SNAKE_SCORES_KEPT);
    } catch {
      // a broken file just means a fresh table
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

/** A game has to have taken at least this share of the time its steps take at the quickest (for clocks and timers that run a little fast)… */
export const PACE_SLACK = 0.8;
/** …give or take this long (ms), for frames that arrive bunched up. */
export const PACE_GRACE = 2000;
/** A score at least this good pays chips (EARN.snakeScore, with its cooldown and daily cap). */
export const GOOD_RUN = 150;
/** Games followed at once, at most: past that the ones started longest ago are dropped. */
const GAMES_KEPT = 100;

/**
 * The least time (ms) `ticks` steps can take with `eaten` pieces eaten along the way: as if each
 * piece were eaten a step after the one before (each step as quick as the snake's length then
 * lets it be) and every other step taken at the length it ended at, the quickest.
 */
export function leastTime(ticks: number, eaten: number): number {
  let ms = 0;
  for (let i = 0; i < eaten; i++) ms += tickMs(START_LENGTH + i);
  return ms + Math.max(0, ticks - eaten) * tickMs(START_LENGTH + eaten);
}

/** Whose game it is (an account, or a name on the shared password) and how it shows on the table. */
export interface SnakePlayer {
  owner: string;
  name: string;
  color: string;
}

interface Game extends SnakePlayer {
  id: string;
  startedAt: number;
  /** From its last frame that added up. */
  last: SnakeResult;
}

/** What the office made of a frame or a result: it added up, it didn't (and its game is gone for good), or there's no game of theirs to follow. */
export type SnakeVerdict = 'ok' | 'void' | 'none';

/**
 * The office's side of the Snake machine. It names every game as it starts and follows it frame by
 * frame; the game's result, when its player's browser sends it at the end, goes on the high-score
 * table only if it adds up: its score is what its pieces make (see checkResult), nothing went down
 * since the frames before it, and the game has gone on at least as long as its steps take (see
 * leastTime, PACE_SLACK and PACE_GRACE). A frame or result that doesn't add up ends its game, with
 * no score. So does stepping away from the machine: a browser that wants its score kept sends the
 * result first.
 */
export class SnakeArcade {
  private readonly games = new Map<string, Game>();

  constructor(
    private readonly table: SnakeScores,
    private readonly now: () => number = Date.now,
  ) {}

  /** `player` starts a new game (any other game of theirs is over, with no score). Says its id. */
  start(player: SnakePlayer): string {
    for (const g of this.games.values()) if (g.owner === player.owner) this.games.delete(g.id);
    for (const g of this.games.values()) if (this.games.size >= GAMES_KEPT) this.games.delete(g.id);
    const id = randomBytes(8).toString('hex');
    this.games.set(id, { ...player, id, startedAt: this.now(), last: { score: 0, eaten: 0, golds: 0, ticks: 0 } });
    return id;
  }

  /** A frame from the player of game `id`. */
  frame(id: string | undefined, f: SnakeFrame): SnakeVerdict {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g) return 'none';
    if (!this.follows(g, f)) {
      this.games.delete(g.id);
      return 'void';
    }
    g.last = { score: f.score, eaten: f.eaten, golds: f.golds, ticks: f.ticks };
    return 'ok';
  }

  /**
   * Game `id` is over, at `result` (checked with checkResult): if it adds up, on the table it goes,
   * under `name` if the player typed one in (checked with cleanName). Says what the office made of it and, when it added up, what went on the table.
   */
  over(id: string | undefined, result: SnakeResult, name?: string | null): { verdict: SnakeVerdict; score?: Omit<SnakeScore, 'at'>; changed?: boolean; first?: boolean } {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g) return { verdict: 'none' };
    this.games.delete(g.id);
    if (!this.follows(g, result)) return { verdict: 'void' };
    const score = { game: g.id, name: name || g.name, color: g.color, score: result.score, length: START_LENGTH + result.eaten };
    return { verdict: 'ok', score, ...this.table.record(score) };
  }

  /** The player of game `id` stepped away from it: it's over, with no score. */
  leave(id: string | undefined) {
    if (id !== undefined) this.games.delete(id);
  }

  /** Whether `r` can come after the game's last frame, this long after it started. */
  private follows(g: Game, r: SnakeResult): boolean {
    const was = g.last;
    if (r.ticks < was.ticks || r.eaten < was.eaten || r.golds < was.golds || r.score < was.score) return false;
    return this.now() - g.startedAt >= leastTime(r.ticks, r.eaten) * PACE_SLACK - PACE_GRACE;
  }
}
