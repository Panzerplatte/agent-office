// The Snake machine in the lounge, next to the BLOCKFALL cabinet: the game itself (a pure,
// deterministic step function the player's browser runs), what its screen shows while someone plays
// (the frames the office passes on to everyone else on the floor) and its high-score table, which is
// the whole building's (see server/snake.ts).
//
// The rules: a 20×20 grid with WALLS round it (running into one ends the game, there's no wrapping
// round to the other side), a snake that starts START_LENGTH long in the middle heading right, one
// piece of food at a time (placed by a seeded RNG, never on the snake), each piece eaten growing it
// by one and scoring FOOD_POINTS. Every GOLDEN_EVERY-th piece also puts golden food on the grid for
// GOLDEN_TICKS steps, worth GOLDEN_POINTS (and growing it by one too). The snake steps faster the
// longer it gets (see tickMs), and runs into itself or a wall to end the game. Key presses are
// buffered (up to QUEUE_MAX) so quick turns all count, one per step, and a turn straight back the way
// it's heading is ignored.

/** The game on the machine (see client/ui/snake.ts). */
export const SNAKE_GAME = 'SNAKE';
/** The grid: 20 × 20 cells, a cell numbered y * SNAKE_COLS + x from the top left. */
export const SNAKE_COLS = 20;
export const SNAKE_ROWS = 20;
const CELLS = SNAKE_COLS * SNAKE_ROWS;
/** How long the snake starts. */
export const START_LENGTH = 3;
/** Points for a piece of food, and for a piece of golden food. */
export const FOOD_POINTS = 10;
export const GOLDEN_POINTS = 50;
/** Golden food comes out with every GOLDEN_EVERY-th piece of plain food eaten, and stays GOLDEN_TICKS steps. */
export const GOLDEN_EVERY = 5;
export const GOLDEN_TICKS = 40;
/** Turns waiting to be made, at most: more key presses than that before the snake moves are dropped. */
export const QUEUE_MAX = 3;
/** How long a step takes (ms) at the start, the least it ever takes, and how much quicker each piece eaten makes it. */
export const TICK_START = 150;
export const TICK_MIN = 60;
export const TICK_FASTER = 3;
/** How many games the high-score table keeps. */
export const SNAKE_SCORES_KEPT = 10;
const SCORE_MAX = 99_999_999;
const TICKS_MAX = 99_999_999;

export type Dir = 'u' | 'd' | 'l' | 'r';
export type SnakePlayState = 'play' | 'paused' | 'over';

const STEP: Record<Dir, [number, number]> = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
const OPPOSITE: Record<Dir, Dir> = { u: 'd', d: 'u', l: 'r', r: 'l' };

/** A game of Snake as it stands. Never changed in place: step, turn and the rest give a new one. */
export interface SnakeGame {
  /** The snake's cells, head first. */
  snake: number[];
  /** Where it's heading, and the turns waiting to be made (one a step). */
  dir: Dir;
  queue: Dir[];
  /** The food's cell (-1 once the snake fills the grid), and golden food with the steps it has left. */
  food: number;
  golden: { cell: number; left: number } | null;
  score: number;
  /** Pieces eaten, golden ones among them. */
  eaten: number;
  golds: number;
  /** Steps taken. */
  ticks: number;
  state: SnakePlayState;
  /** The food RNG's state (see rand). */
  seed: number;
}

/** The next number in [0, 1) from a seeded RNG (mulberry32), and its next state. */
export function rand(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** A free cell picked by the RNG (none free: -1), and the RNG's next state. */
function freeCell(taken: ReadonlySet<number>, seed: number): [number, number] {
  const free = CELLS - taken.size;
  if (free <= 0) return [-1, seed];
  const [r, next] = rand(seed);
  let n = Math.floor(r * free);
  for (let cell = 0; cell < CELLS; cell++) if (!taken.has(cell) && n-- === 0) return [cell, next];
  return [-1, next];
}

/** A new game, its food placed by `seed`. */
export function newGame(seed: number): SnakeGame {
  const y = Math.floor(SNAKE_ROWS / 2);
  const x = Math.floor(SNAKE_COLS / 2);
  const snake = Array.from({ length: START_LENGTH }, (_, i) => y * SNAKE_COLS + x - i);
  const [food, next] = freeCell(new Set(snake), seed | 0);
  return { snake, dir: 'r', queue: [], food, golden: null, score: 0, eaten: 0, golds: 0, ticks: 0, state: 'play', seed: next };
}

/** How long a step takes (ms) for a snake this long: quicker as it grows, down to TICK_MIN. */
export function tickMs(length: number): number {
  return Math.max(TICK_MIN, TICK_START - Math.max(0, length - START_LENGTH) * TICK_FASTER);
}

/** The score `eaten` pieces make, `golds` of them golden. */
export function scoreFor(eaten: number, golds: number): number {
  return (eaten - golds) * FOOD_POINTS + golds * GOLDEN_POINTS;
}

/** The most golden pieces `eaten` pieces can have among them: one for each GOLDEN_EVERY plain ones. */
export function maxGolds(eaten: number): number {
  return Math.floor(eaten / (GOLDEN_EVERY + 1));
}

/** A key press: `dir` goes on the queue, unless it's where the snake will already be heading or straight back the way it came. */
export function turn(g: SnakeGame, dir: Dir): SnakeGame {
  if (g.state !== 'play' || g.queue.length >= QUEUE_MAX) return g;
  const last = g.queue.at(-1) ?? g.dir;
  if (dir === last || dir === OPPOSITE[last]) return g;
  return { ...g, queue: [...g.queue, dir] };
}

export function pause(g: SnakeGame): SnakeGame {
  return g.state === 'play' ? { ...g, state: 'paused' } : g;
}

export function resume(g: SnakeGame): SnakeGame {
  return g.state === 'paused' ? { ...g, state: 'play' } : g;
}

/** The cell one step from `cell` towards `dir`, or -1 past a wall. */
export function neighbor(cell: number, dir: Dir): number {
  const x = (cell % SNAKE_COLS) + STEP[dir][0];
  const y = Math.floor(cell / SNAKE_COLS) + STEP[dir][1];
  return x < 0 || y < 0 || x >= SNAKE_COLS || y >= SNAKE_ROWS ? -1 : y * SNAKE_COLS + x;
}

/**
 * One step of the game: the next turn waiting is made, and the snake moves a cell. Into a wall or
 * itself (its tail moving out of the way counts as out of the way) the game's over, the snake left
 * where it was. Onto food it grows, scores and new food comes out.
 */
export function step(g: SnakeGame): SnakeGame {
  if (g.state !== 'play') return g;
  const [dir = g.dir, ...queue] = g.queue;
  const head = neighbor(g.snake[0], dir);
  const gold = g.golden && head === g.golden.cell ? g.golden : null;
  const grows = head !== -1 && (head === g.food || !!gold);
  const body = grows ? g.snake : g.snake.slice(0, -1);
  if (head === -1 || body.includes(head)) return { ...g, dir, queue: [], ticks: g.ticks + 1, state: 'over' };
  const snake = [head, ...body];
  let { food, golden, seed, score, eaten, golds } = g;
  golden = golden && !gold && golden.left > 1 ? { ...golden, left: golden.left - 1 } : null;
  if (grows) {
    eaten++;
    if (gold) golds++;
    score = scoreFor(eaten, golds);
    const taken = new Set(snake);
    if (golden) taken.add(golden.cell);
    if (!gold) {
      [food, seed] = freeCell(taken, seed);
      if (food !== -1) taken.add(food);
      if ((eaten - golds) % GOLDEN_EVERY === 0) {
        const [cell, next] = freeCell(taken, seed);
        seed = next;
        golden = cell === -1 ? null : { cell, left: GOLDEN_TICKS };
      }
    }
  }
  const full = food === -1 && !golden;
  return { snake, dir, queue, food, golden, score, eaten, golds, ticks: g.ticks + 1, state: full ? 'over' : 'play', seed };
}

/** One picture of the machine's screen while someone plays. */
export interface SnakeFrame {
  /** The head's cell, and the way from each cell of the snake to the next one back, to the tail ('u', 'd', 'l', 'r'). */
  head: number;
  body: string;
  /** The food's cell, and golden food's (-1 for none). */
  food: number;
  golden: number;
  score: number;
  eaten: number;
  golds: number;
  ticks: number;
  state: SnakePlayState;
}

/** The game's frame, for the office to pass on. */
export function frameOf(g: SnakeGame): SnakeFrame {
  let body = '';
  for (let i = 1; i < g.snake.length; i++) {
    const was = g.snake[i - 1];
    body += (['u', 'd', 'l', 'r'] as Dir[]).find((d) => neighbor(was, d) === g.snake[i]) ?? 'r';
  }
  return { head: g.snake[0], body, food: g.food, golden: g.golden?.cell ?? -1, score: g.score, eaten: g.eaten, golds: g.golds, ticks: g.ticks, state: g.state };
}

/** A frame's snake, head first; null if it leaves the grid or crosses itself. */
export function snakeCells(head: number, body: string): number[] | null {
  const cells = [head];
  const seen = new Set(cells);
  for (const d of body) {
    const cell = neighbor(cells.at(-1)!, d as Dir);
    if (cell === -1 || seen.has(cell)) return null;
    cells.push(cell);
    seen.add(cell);
  }
  return cells;
}

/** A game on the high-score table. */
export interface SnakeScore {
  /** Which game: the office names each one as it starts (see SnakeArcade in server/snake.ts). */
  game: string;
  name: string;
  color: string;
  score: number;
  /** How long the snake got. */
  length: number;
  at: number;
}

/** Who's at the Snake machine on your floor (and which game they're on), and the building's high scores. */
export interface SnakeState {
  player: { id: string; name: string; game: string } | null;
  scores: SnakeScore[];
}

/** The machine for someone walking onto the floor: its screen too, when a game's on. */
export interface SnakeView extends SnakeState {
  frame: SnakeFrame | null;
}

/** What a game came to, as its player's browser sends it at the end (see 'snake.over'). */
export interface SnakeResult {
  score: number;
  eaten: number;
  golds: number;
  ticks: number;
}

const BODY_RE = new RegExp(`^[udlr]{${START_LENGTH - 1},${CELLS - 1}}$`);
const GAME_RE = /^[a-z0-9]{8,32}$/;

const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** A result a browser sent, if it adds up on its own: its score is what its pieces make, and there are no more golden ones than can come out. */
export function checkResult(raw: unknown): SnakeResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const eaten = int(r.eaten, 0, CELLS - START_LENGTH);
  const golds = int(r.golds, 0, CELLS);
  const score = int(r.score, 0, SCORE_MAX);
  const ticks = int(r.ticks, 0, TICKS_MAX);
  if (eaten === null || golds === null || score === null || ticks === null) return null;
  if (golds > maxGolds(eaten) || score !== scoreFor(eaten, golds) || ticks < eaten) return null;
  return { score, eaten, golds, ticks };
}

/** A frame a browser sent, if it is one: on the grid, a snake as long as what it ate, food never on it. */
export function checkFrame(raw: unknown): SnakeFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const result = checkResult(f);
  const head = int(f.head, 0, CELLS - 1);
  const body = typeof f.body === 'string' && BODY_RE.test(f.body) ? f.body : null;
  const food = int(f.food, -1, CELLS - 1);
  const golden = int(f.golden, -1, CELLS - 1);
  const state = f.state === 'play' || f.state === 'paused' || f.state === 'over' ? f.state : null;
  if (!result || head === null || body === null || food === null || golden === null || !state) return null;
  if (body.length + 1 !== START_LENGTH + result.eaten) return null;
  const cells = snakeCells(head, body);
  if (!cells || cells.includes(food) || cells.includes(golden) || (golden !== -1 && golden === food)) return null;
  return { head, body, food, golden, ...result, state };
}

/** A score read back from disk, if it is one. */
export function checkScore(raw: { game?: unknown; score?: unknown; length?: unknown }): Pick<SnakeScore, 'game' | 'score' | 'length'> | null {
  const game = typeof raw.game === 'string' && GAME_RE.test(raw.game) ? raw.game : null;
  const score = int(raw.score, 0, SCORE_MAX);
  const length = int(raw.length, START_LENGTH, CELLS);
  if (game === null || score === null || length === null) return null;
  return { game, score, length };
}
