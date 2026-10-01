import { MAX_PLAYERS, TEAM_SIZE, newGame, placeCue, removePlayer, shotOk, takeShot, teamsOk, type PoolGame, type PoolPlayback, type PoolSeat, type PoolState, type PoolTeam } from '../shared/pool.js';

/** How long after a shot's balls stop before the next one, at least (ms): time to see where they went. */
const SETTLE = 300;

/**
 * A floor's pool table: who's at it, on which side, and the game. The office rolls and scores every
 * shot itself (see shared/pool.ts) from which way and how hard the page says the cue ball was struck,
 * so a page can't make up where the balls went, and only whoever's shot it is gets to take it, once
 * the last one's balls have stopped.
 */
export class Pool {
  private lobby: PoolSeat[] = [];
  private game: PoolGame | null = null;
  /** The side that breaks the next game: it alternates. */
  private breaker: PoolTeam = 0;
  /** Until when the last shot's balls are still rolling, on the pages (ms). */
  private busyUntil = 0;

  constructor(private now = () => Date.now()) {}

  /** The table as it is now, for the floor's pages. */
  state(): PoolState {
    return structuredClone({ lobby: this.lobby, game: this.game });
  }

  /**
   * `id` steps up to the table, on the side with fewer players (side 0 if they're even): not if
   * they're there already, or it's full. Says whether they did.
   */
  join(id: string, name: string): boolean {
    if (this.seated(id) || this.lobby.length >= MAX_PLAYERS) return false;
    const a = this.lobby.filter((s) => s.team === 0).length;
    this.lobby.push({ id, name: name.slice(0, 24), team: a <= this.lobby.length - a ? 0 : 1 });
    return true;
  }

  /**
   * `id` steps away from the table, or left the floor (or the office): out of the game too, which goes
   * on without them (see removePlayer). Says whether anything changed.
   */
  left(id: string): boolean {
    if (!this.seated(id)) return false;
    this.lobby = this.lobby.filter((s) => s.id !== id);
    if (this.game) removePlayer(this.game, id);
    // Nobody left to look at the table, or to clear it.
    if (this.lobby.length === 0) this.game = null;
    return true;
  }

  /** Someone at the table moves to side `team` for the next game: not while one's on, or if that side's full. */
  setTeam(id: string, team: unknown): boolean {
    const seat = this.lobby.find((s) => s.id === id);
    if (!seat || this.running() || (team !== 0 && team !== 1) || seat.team === team) return false;
    if (this.lobby.filter((s) => s.team === team).length >= TEAM_SIZE) return false;
    seat.team = team;
    // Moved to the back of the line on their new side, so the side's order is the order they arrived in it.
    this.lobby = [...this.lobby.filter((s) => s !== seat), seat];
    return true;
  }

  /** Someone at the table starts a game for everyone at it, one or two a side (or a rematch, once one's over); the break alternates. */
  start(id: string): boolean {
    if (!this.seated(id) || this.running() || !teamsOk(this.lobby)) return false;
    this.game = newGame(this.lobby, this.breaker);
    this.breaker = (1 - this.breaker) as PoolTeam;
    this.busyUntil = 0;
    return true;
  }

  /**
   * `id` takes a shot: only on their turn, once the last shot's balls have stopped. Returns the shot to
   * play back on every page, or null if it didn't count.
   */
  shoot(id: string, shot: { angle?: unknown; power?: unknown; top?: unknown; side?: unknown }): PoolPlayback | null {
    const g = this.game;
    if (!g || !this.myShot(id) || !shotOk(shot)) return null;
    const played = takeShot(g, { angle: shot.angle, power: shot.power, top: shot.top ?? 0, side: shot.side ?? 0 });
    if (!played) return null;
    const at = this.now();
    this.busyUntil = at + played.duration + SETTLE;
    return { ...played, at };
  }

  /** With ball in hand on their shot, `id` puts the cue ball at table-local (x, y). Says whether they could. */
  place(id: string, p: { x?: unknown; y?: unknown }): boolean {
    if (!this.game || !this.myShot(id) || typeof p.x !== 'number' || typeof p.y !== 'number') return false;
    return placeCue(this.game, p.x, p.y);
  }

  /**
   * Back to just the people at the table, for a new game: anyone there can clear a game that's over,
   * but only its players can call off one that's still on.
   */
  reset(id: string): boolean {
    if (!this.seated(id) || !this.game) return false;
    if (!this.game.over && !this.game.players.some((p) => p.id === id)) return false;
    this.game = null;
    this.busyUntil = 0;
    return true;
  }

  private myShot(id: string): boolean {
    const g = this.game;
    return !!g && !g.over && g.players[g.up]?.id === id && this.now() >= this.busyUntil;
  }

  private seated(id: string): boolean {
    return this.lobby.some((s) => s.id === id);
  }

  private running(): boolean {
    return !!this.game && !this.game.over;
  }
}
