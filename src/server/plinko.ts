import { randomBytes } from 'node:crypto';
import { DROP_GAP, MAX_BALLS, MAX_YOURS, RECENT, dropOk, fallMs, multipliers, payout, slotOf, type PlinkoBall, type PlinkoLanding, type PlinkoPath, type PlinkoState } from '../shared/plinko.js';

/** What the game needs of the chips bank (server/chips.ts): taking a stake, and paying out. */
export interface PlinkoBank {
  bet(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
  award(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
}

export interface PlinkoOptions {
  now?: () => number;
  /** A ball's bounces, one per row: from cryptographically random bytes unless a test says otherwise. */
  path?: (rows: number) => PlinkoPath;
}

/** A ball while it falls: whose wallet the bet came out of (and the winnings go back into), and when it lands. */
interface Falling extends Omit<PlinkoBall, 'age'> {
  wallet: string;
  at: number;
  lands: number;
}

/** A fair left or right for each of `rows` rows: the low bit of a cryptographically random byte. */
function randomPath(rows: number): PlinkoPath {
  return [...randomBytes(rows)].map((b) => (b & 1) as 0 | 1);
}

/**
 * The casino's Plinko machine, one for the whole building. A drop takes the bet there and then
 * (through the chips bank, which won't take more than you have), picks the ball's path there and
 * then, and the ball's paid bet × its slot's multiplier when it lands, fallMs later on the office's
 * clock, when everyone's page shows it landing. Pages only say "drop one"; they never pick a path.
 */
export class Plinko {
  private balls: Falling[] = [];
  private recent: PlinkoLanding[] = [];
  private ids = 0;
  /** When each wallet last dropped one, to keep auto-clickers to DROP_GAP. */
  private last = new Map<string, number>();
  private now: () => number;
  private pick: (rows: number) => PlinkoPath;

  constructor(
    private readonly bank: PlinkoBank,
    opts: PlinkoOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.pick = opts.path ?? randomPath;
  }

  /** The machine as it is now, for a page coming down: nobody's wallet. */
  state(): PlinkoState {
    const now = this.now();
    return structuredClone({ balls: this.balls.map((b) => this.view(b, now)), recent: this.recent });
  }

  /**
   * `wallet` (on page `peer`, called `name`) drops a ball: `d` must be a bet within the limits on a
   * board there is, they can't have MAX_YOURS falling already or have dropped one in the last
   * DROP_GAP ms, and the bank must take the bet (no more than they have). Says the ball (to show
   * everyone), or null if it didn't go.
   */
  drop(peer: string, wallet: string, name: string, d: unknown, color?: string): PlinkoBall | null {
    if (!dropOk(d)) return null;
    const now = this.now();
    if (now - (this.last.get(wallet) ?? -Infinity) < DROP_GAP) return null;
    if (this.balls.length >= MAX_BALLS || this.balls.filter((b) => b.wallet === wallet).length >= MAX_YOURS) return null;
    const path = this.pick(d.rows).slice(0, d.rows);
    if (path.length !== d.rows) return null;
    if (!this.bank.bet(wallet, d.bet, 'plinko.bet', { quiet: true })) return null;
    this.last.set(wallet, now);
    const slot = slotOf(path);
    const m = multipliers(d.rows, d.risk)[slot];
    const ball: Falling = {
      id: ++this.ids,
      peer,
      name: name.slice(0, 24),
      ...(color ? { color } : {}),
      bet: d.bet,
      rows: d.rows,
      risk: d.risk,
      path,
      slot,
      m,
      won: payout(d.bet, m),
      wallet,
      at: now,
      lands: now + fallMs(d.rows),
    };
    this.balls.push(ball);
    return this.view(ball, now);
  }

  /** When the next ball lands (ms, on the office's clock), or Infinity with none falling: the office sleeps till then. */
  nextAt(): number {
    return this.balls.reduce((t, b) => Math.min(t, b.lands), Infinity);
  }

  /** Pays every ball that's landed by now. Says the ones that did (oldest first), for the machine's strip. */
  tick(): PlinkoLanding[] {
    const now = this.now();
    const landed = this.balls.filter((b) => b.lands <= now).sort((a, b) => a.lands - b.lands);
    if (!landed.length) return [];
    this.balls = this.balls.filter((b) => b.lands > now);
    return landed.map((b) => this.settle(b));
  }

  /** The office is stopping: every ball still falling lands now (its slot was picked on the drop), and is paid. */
  close() {
    const falling = this.balls;
    this.balls = [];
    for (const b of falling) this.settle(b);
  }

  private settle(b: Falling): PlinkoLanding {
    if (b.won > 0) this.bank.award(b.wallet, b.won, 'plinko.win', { quiet: true });
    const landing: PlinkoLanding = { name: b.name, ...(b.color ? { color: b.color } : {}), bet: b.bet, rows: b.rows, risk: b.risk, m: b.m, won: b.won };
    this.recent = [landing, ...this.recent].slice(0, RECENT);
    // Nobody's drop gap needs remembering once they've nothing falling.
    if (!this.balls.some((o) => o.wallet === b.wallet)) this.last.delete(b.wallet);
    return landing;
  }

  private view({ wallet: _w, at, lands: _l, ...b }: Falling, now: number): PlinkoBall {
    return { ...b, path: [...b.path], age: Math.max(0, now - at) };
  }
}
