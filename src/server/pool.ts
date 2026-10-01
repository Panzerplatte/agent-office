import { MAX_PLAYERS, TEAM_SIZE, isSolo, newGame, placeCue, removePlayer, shotOk, skipTurn, takeShot, teamsOk, type PoolGame, type PoolPlayback, type PoolSeat, type PoolState, type PoolTeam } from '../shared/pool.js';

/** How long after a shot's balls stop before the next one, at least (ms): time to see where they went. */
const SETTLE = 300;

/**
 * A floor's pool table: who's at it, on which side, and the game. The office rolls and scores every
 * shot itself (see shared/pool.ts) from which way and how hard the page says the cue ball was struck,
 * so a page can't make up where the balls went, and only whoever's shot it is gets to take it, once
 * the last one's balls have stopped.
 *
 * A seat in a game that's running belongs to the person, not their connection: each seat has a `key`
 * (their account, or their browser's own key, see server.ts), and stepping up again with it (after
 * walking off, a reload, or a dropped connection) puts them straight back in it under their new
 * connection id. While they're gone they're `away`, and anyone at the table can skip their shot.
 * Only leaving (Leave in the panel), or the game being over or reset, gives a seat up.
 */
export class Pool {
  private lobby: PoolSeat[] = [];
  /** Whose each seat is, by its id now: the key they stepped up with. */
  private keys = new Map<string, string>();
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
   * `id` steps up to the table (`key`: who they are, whatever their connection): back in their seat
   * if they have one, under `id` now; otherwise on the side with fewer players (side 0 if they're
   * even), unless it's full. Says whether anything changed.
   */
  join(id: string, name: string, key = id): boolean {
    const mine = this.lobby.find((s) => this.keys.get(s.id) === key);
    if (mine) {
      if (mine.id === id && !mine.away) return false;
      this.rebind(mine.id, id);
      return true;
    }
    if (this.seated(id) || this.lobby.length >= MAX_PLAYERS) return false;
    const a = this.lobby.filter((s) => s.team === 0).length;
    this.lobby.push({ id, name: name.slice(0, 24), team: a <= this.lobby.length - a ? 0 : 1 });
    this.keys.set(id, key);
    return true;
  }

  /**
   * `id` leaves the table for good (Leave): out of the game too, which goes on without them (see
   * removePlayer). Says whether anything changed.
   */
  left(id: string): boolean {
    if (!this.seated(id)) return false;
    this.lobby = this.lobby.filter((s) => s.id !== id);
    this.keys.delete(id);
    if (this.game) removePlayer(this.game, id);
    this.tidy();
    return true;
  }

  /**
   * `id` stepped away from the table without leaving it: walked off, left the floor, reloaded or lost
   * their connection. In a game that's running they keep their seat, shown as away, until they step
   * up again; otherwise there's nothing to keep, and they're off the table. Says whether anything changed.
   */
  away(id: string): boolean {
    const seat = this.lobby.find((s) => s.id === id);
    if (!seat) return false;
    if (!this.playing(id)) return this.left(id);
    if (seat.away) return false;
    this.mark(id, true);
    return true;
  }

  /**
   * Someone at the table (and there) skips the shot of whoever's up, who's away, so the game doesn't
   * wait for them (see skipTurn). Says whether it did.
   */
  skip(id: string): boolean {
    const g = this.game;
    const me = this.lobby.find((s) => s.id === id);
    const up = g && !g.over ? g.players[g.up] : undefined;
    if (!g || !me || me.away || !up?.away || this.now() < this.busyUntil) return false;
    return skipTurn(g);
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
    // On your own you always break; the alternation is for the games against someone.
    if (!isSolo(this.game)) this.breaker = (1 - this.breaker) as PoolTeam;
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
    // Over: the seats of anyone away from it are given up.
    if (g.over) this.tidy();
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
   * but only its players can call off one that's still on (or anyone, if they're all away).
   */
  reset(id: string): boolean {
    const g = this.game;
    if (!this.seated(id) || !g) return false;
    if (!g.over && !g.players.some((p) => p.id === id) && g.players.some((p) => !p.away)) return false;
    this.game = null;
    this.busyUntil = 0;
    this.tidy();
    return true;
  }

  private myShot(id: string): boolean {
    const g = this.game;
    return !!g && !g.over && g.players[g.up]?.id === id && this.now() >= this.busyUntil;
  }

  private seated(id: string): boolean {
    return this.lobby.some((s) => s.id === id);
  }

  /** Whether `id` is in the game that's running. */
  private playing(id: string): boolean {
    return this.running() && this.game!.players.some((p) => p.id === id);
  }

  /** `id`'s seat, at the table and in the game, away (or back). */
  private mark(id: string, away: boolean) {
    for (const s of [...this.lobby, ...(this.game?.players ?? [])]) {
      if (s.id !== id) continue;
      if (away) s.away = true;
      else delete s.away;
    }
  }

  /** The seat `was` is back, under `id`: at the table, in the game and in its last shot. */
  private rebind(was: string, id: string) {
    const key = this.keys.get(was)!;
    // Someone else can't be sitting under the new id, but just in case: theirs goes.
    if (was !== id && this.seated(id)) this.left(id);
    for (const s of [...this.lobby, ...(this.game?.players ?? [])]) if (s.id === was) s.id = id;
    if (this.game?.last?.player === was) this.game.last.player = id;
    this.keys.delete(was);
    this.keys.set(id, key);
    this.mark(id, false);
  }

  /** With no game running, nobody away keeps a seat; and with nobody at the table, the game goes. */
  private tidy() {
    if (!this.running()) {
      for (const s of this.lobby) if (s.away) this.keys.delete(s.id);
      this.lobby = this.lobby.filter((s) => !s.away);
    }
    // Nobody left to look at the table, or to clear it.
    if (this.lobby.length === 0) this.game = null;
  }

  private running(): boolean {
    return !!this.game && !this.game.over;
  }
}
