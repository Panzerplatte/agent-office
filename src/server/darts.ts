import { DART_COLORS, DEFAULT_OPTIONS, MAX_PLAYERS, dartOk, newGame, removePlayer, skipTurn, throwDart, type DartsGame, type DartsMode, type DartsOptions, type DartsSeat, type DartsState } from '../shared/darts.js';

/** How often one person can throw a dart, at most (ms). */
const EVERY = 250;

/** A place at the board, and who it's kept for: `key` says it's the same person back (their account, or their browser). */
interface Seat extends DartsSeat {
  key: string;
}

/**
 * A floor's dartboard: who's at it, the options for the next game, and the game. The office scores
 * every dart itself (see shared/darts.ts) from where the page says it landed, so a page can't make
 * up its score, and only whoever's turn it is gets to throw.
 *
 * Everyone's place is kept by who they are (`key`), not by their connection (`peer`): someone who
 * walks off, reloads or drops out mid-game is only away, and stepping up again puts them straight
 * back in their place, colour and score. Only leaving (Leave, or Esc) takes them out of the game;
 * while they're away, the others can skip their turn.
 */
export class Darts {
  private lobby: Seat[] = [];
  private options: DartsOptions = { ...DEFAULT_OPTIONS };
  private game: DartsGame | null = null;
  private last = new Map<string, number>();
  private seats = 0;

  constructor(private now = () => Date.now()) {}

  /** The board as it is now, for the floor's pages: without anyone's key, and each player with who's at their place now. */
  state(): DartsState {
    const lobby = this.lobby.map(({ key: _, ...s }) => s);
    const game = this.game && { ...this.game, players: this.game.players.map(({ peer: _, ...p }) => ({ ...p, ...this.peerOf(p.id) })) };
    return structuredClone({ lobby, ...this.options, game });
  }

  /**
   * `peer` steps up to the board. If `key` (who they are) has a place there already, they're back in
   * it; otherwise a new one, with the first colour nobody has: not if they're at it already, or it's
   * full. Says whether they did.
   */
  join(peer: string, name: string, key: string): boolean {
    if (this.at(peer)) return false;
    const mine = this.lobby.find((s) => s.key === key);
    if (mine) {
      mine.peer = peer;
      mine.name = name.slice(0, 24);
      return true;
    }
    if (this.lobby.length >= MAX_PLAYERS) return false;
    const color = DART_COLORS.find((c) => !this.lobby.some((s) => s.color === c))!;
    this.lobby.push({ id: `s${++this.seats}`, name: name.slice(0, 24), color, peer, key });
    return true;
  }

  /**
   * `peer` stepped away from the board (walked off, or left the floor or the office): a player in the
   * running game keeps their place in it, away; anyone else is just gone from the board. Says whether
   * anything changed.
   */
  away(peer: string): boolean {
    this.last.delete(peer);
    const s = this.at(peer);
    if (!s) return false;
    if (this.running() && this.game!.players.some((p) => p.id === s.id)) delete s.peer;
    else this.lobby = this.lobby.filter((o) => o !== s);
    this.tidy();
    return true;
  }

  /** `peer` leaves the board on purpose: out of the game too, which goes on without them (see removePlayer). Says whether they were at it. */
  left(peer: string): boolean {
    this.last.delete(peer);
    const s = this.at(peer);
    if (!s) return false;
    this.lobby = this.lobby.filter((o) => o !== s);
    if (this.game) removePlayer(this.game, s.id);
    this.tidy();
    return true;
  }

  /** Someone at the board picks 301 or 501, and double-out or not, for the next game: not while one's on. */
  setOptions(peer: string, o: { mode?: unknown; doubleOut?: unknown }): boolean {
    if (!this.at(peer) || this.running()) return false;
    const mode: DartsMode = o.mode === 301 || o.mode === 501 ? o.mode : this.options.mode;
    const doubleOut = typeof o.doubleOut === 'boolean' ? o.doubleOut : this.options.doubleOut;
    if (mode === this.options.mode && doubleOut === this.options.doubleOut) return false;
    this.options = { mode, doubleOut };
    return true;
  }

  /** Someone at the board starts a game for everyone there (just them, to practise alone), in the order they stepped up (or a rematch, once one's over). */
  start(peer: string): boolean {
    if (!this.at(peer) || this.running()) return false;
    this.game = newGame(this.options, this.lobby);
    return true;
  }

  /** `peer` throws a dart that lands at board-local (x, y) meters: only on their turn. Says whether it counted. */
  throw(peer: string, d: { x: unknown; y: unknown }): boolean {
    const g = this.game;
    const s = this.at(peer);
    if (!s || !g || g.over || g.players[g.up]?.id !== s.id || !dartOk(d) || this.tooSoon(peer)) return false;
    const ok = !!throwDart(g, d.x, d.y);
    this.tidy();
    return ok;
  }

  /** Someone at the board skips the turn of the player who's up, who's away. Says whether it was skipped. */
  skip(peer: string): boolean {
    const g = this.game;
    if (!this.at(peer) || !g || g.over) return false;
    const up = g.players[g.up];
    if (!up || this.peerOf(up.id).peer) return false;
    return skipTurn(g);
  }

  /**
   * Back to just the people at the board, for a new game: anyone there can clear a game that's over,
   * but only its players can call off one that's still on (or anyone, once all of them are away).
   */
  reset(peer: string): boolean {
    const s = this.at(peer);
    const g = this.game;
    if (!s || !g) return false;
    if (!g.over && !g.players.some((p) => p.id === s.id) && g.players.some((p) => this.peerOf(p.id).peer)) return false;
    this.game = null;
    this.tidy();
    return true;
  }

  /** The place `peer` is at, if they're at the board. */
  private at(peer: string): Seat | undefined {
    return this.lobby.find((s) => s.peer === peer);
  }

  /** Who's at place `id` now: `{ peer }`, or nothing while they're away (or gone). */
  private peerOf(id: string): { peer?: string } {
    const peer = this.lobby.find((s) => s.id === id)?.peer;
    return peer ? { peer } : {};
  }

  private running(): boolean {
    return !!this.game && !this.game.over;
  }

  /** Places are only kept for a running game: without one, whoever's away is gone. Nobody left to read the scoreboard, or to clear it: it's cleared. */
  private tidy() {
    if (!this.running()) this.lobby = this.lobby.filter((s) => s.peer);
    if (this.lobby.length === 0) this.game = null;
  }

  private tooSoon(peer: string): boolean {
    const now = this.now();
    if (now - (this.last.get(peer) ?? -Infinity) < EVERY) return true;
    this.last.set(peer, now);
    return false;
  }
}
