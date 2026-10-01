import { DART_COLORS, DEFAULT_OPTIONS, MAX_PLAYERS, dartOk, newGame, removePlayer, throwDart, type DartsGame, type DartsMode, type DartsOptions, type DartsSeat, type DartsState } from '../shared/darts.js';

/** How often one person can throw a dart, at most (ms). */
const EVERY = 250;

/**
 * A floor's dartboard: who's at it, the options for the next game, and the game. The office scores
 * every dart itself (see shared/darts.ts) from where the page says it landed, so a page can't make
 * up its score, and only whoever's turn it is gets to throw.
 */
export class Darts {
  private lobby: DartsSeat[] = [];
  private options: DartsOptions = { ...DEFAULT_OPTIONS };
  private game: DartsGame | null = null;
  private last = new Map<string, number>();

  constructor(private now = () => Date.now()) {}

  /** The board as it is now, for the floor's pages. */
  state(): DartsState {
    return structuredClone({ lobby: this.lobby, ...this.options, game: this.game });
  }

  /** `id` steps up to the board, with the first colour nobody has: not if they're there already, or it's full. Says whether they did. */
  join(id: string, name: string): boolean {
    if (this.seated(id) || this.lobby.length >= MAX_PLAYERS) return false;
    const color = DART_COLORS.find((c) => !this.lobby.some((s) => s.color === c))!;
    this.lobby.push({ id, name: name.slice(0, 24), color });
    return true;
  }

  /**
   * `id` steps away from the board, or left the floor (or the office): out of the game too, which goes
   * on without them (see removePlayer). Says whether anything changed.
   */
  left(id: string): boolean {
    this.last.delete(id);
    if (!this.seated(id)) return false;
    this.lobby = this.lobby.filter((s) => s.id !== id);
    if (this.game) removePlayer(this.game, id);
    // Nobody left to read the scoreboard, or to clear it.
    if (this.lobby.length === 0) this.game = null;
    return true;
  }

  /** Someone at the board picks 301 or 501, and double-out or not, for the next game: not while one's on. */
  setOptions(id: string, o: { mode?: unknown; doubleOut?: unknown }): boolean {
    if (!this.seated(id) || this.running()) return false;
    const mode: DartsMode = o.mode === 301 || o.mode === 501 ? o.mode : this.options.mode;
    const doubleOut = typeof o.doubleOut === 'boolean' ? o.doubleOut : this.options.doubleOut;
    if (mode === this.options.mode && doubleOut === this.options.doubleOut) return false;
    this.options = { mode, doubleOut };
    return true;
  }

  /** Someone at the board starts a game for everyone there, in the order they stepped up (or a rematch, once one's over). */
  start(id: string): boolean {
    if (!this.seated(id) || this.running()) return false;
    this.game = newGame(this.options, this.lobby);
    return true;
  }

  /** `id` throws a dart that lands at board-local (x, y) meters: only on their turn. Says whether it counted. */
  throw(id: string, d: { x: unknown; y: unknown }): boolean {
    const g = this.game;
    if (!g || g.over || g.players[g.up]?.id !== id || !dartOk(d) || this.tooSoon(id)) return false;
    return !!throwDart(g, d.x, d.y);
  }

  /**
   * Back to just the people at the board, for a new game: anyone there can clear a game that's over,
   * but only its players can call off one that's still on.
   */
  reset(id: string): boolean {
    if (!this.seated(id) || !this.game) return false;
    if (!this.game.over && !this.game.players.some((p) => p.id === id)) return false;
    this.game = null;
    return true;
  }

  private seated(id: string): boolean {
    return this.lobby.some((s) => s.id === id);
  }

  private running(): boolean {
    return !!this.game && !this.game.over;
  }

  private tooSoon(id: string): boolean {
    const now = this.now();
    if (now - (this.last.get(id) ?? -Infinity) < EVERY) return true;
    this.last.set(id, now);
    return false;
  }
}
