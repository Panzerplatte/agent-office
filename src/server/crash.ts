import { randomBytes } from 'node:crypto';
import type { HouseTally } from './housebank.js';
import { BET_TIME, CRASHED_TIME, CYCLE, HISTORY, MAX_BET, MAX_PLAYERS, autoBetOk, autoStop, betOk, crashPoint, crashedBy, drawSeries, multiplierAt, nextAutoBet, payout, targetOk, timeFor, type CrashAutoState, type CrashAutoStop, type CrashOdds, type CrashPhase, type CrashPlayer, type CrashState } from '../shared/crash.js';

/** What the game needs of the chips bank (server/chips.ts): taking a stake, and paying out. */
export interface CrashBank {
  bet(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
  award(id: string, amount: number, reason: string, opts?: { quiet?: boolean }): boolean;
}

export interface CrashOptions {
  now?: () => number;
  /** Where the next round crashes, at the series' odds: from a cryptographically random number unless a test says otherwise. */
  point?: (odds: CrashOdds) => number;
  /** A new series' odds: drawn from cryptographically random numbers unless a test says otherwise. */
  series?: () => CrashOdds;
  /** Who's bet what and won what, all-time, for the scoreboard (server/crashstats.ts): told when a bet goes down, goes back, and settles. */
  stats?: CrashTally;
  /** The house bank (server/housebank.ts): told what each settled bet lost. */
  house?: HouseTally;
  /** Someone's auto-bet changed (it bet, a round settled, it stopped): told whose, and how it is now. */
  onAuto?: (wallet: string, auto: CrashAutoState) => void;
}

/** What the game tells the scoreboard's totals (see server/crashstats.ts). */
export interface CrashTally {
  bet(id: string, amount: number, name: string, color?: string): void;
  refund(id: string, amount: number): void;
  settle(id: string, bet: number, won: number, m: number): void;
}

/** In someone's round: whose wallet the bet came out of (and the winnings go back into). */
interface Player extends CrashPlayer {
  wallet: string;
  /** Put down by their auto-bet (so how it settles counts towards it). */
  byAuto?: boolean;
}

/** Someone's auto-bet: its settings, how far it's got, the next bet, and who to bet as. */
interface AutoRun extends CrashAutoState {
  peer: string;
  name: string;
  color?: string;
}

/** A uniform random number in [0, 1), from 52 cryptographically random bits. */
function random(): number {
  const b = randomBytes(7);
  // 52 bits: six whole bytes and the top half of the seventh.
  return (b.readUIntBE(0, 6) * 16 + (b[6] >> 4)) / 2 ** 52;
}

/**
 * The casino's Crash game, one for the whole building. The office runs every round, nonstop: it
 * opens bets for BET_TIME after every crash (bets or not), takes each bet (through the chips bank,
 * which won't take more than you have), picks where the round crashes when it starts, at the series'
 * odds (and keeps it to itself), and pays every cash-out there and then at the multiplier the
 * office's own clock says. Every CYCLE rounds a new series starts: round 1 again, the history wiped,
 * and new odds drawn (see drawSeries). Pages only say "bet this" and "cash
 * me out"; when they arrive is what counts, so a cash-out that gets here after the crash gets nothing.
 *
 * Bets are someone's (`wallet`), not their page's: a reload or walking off doesn't lose a bet, and
 * any page of theirs in the casino can cash it out.
 */
export class Crash {
  private phase: CrashPhase = 'betting';
  /** When the betting clock (or the crash on the screen) runs out, and when the multiplier started climbing (ms). */
  private endsAt = 0;
  private startedAt = 0;
  private round = 1;
  /** Which series this is, which round of it (1 to CYCLE), and its odds. */
  private series = 1;
  private of = 1;
  private odds: CrashOdds;
  /** Where this round crashes: picked as it starts, only told once it has. */
  private point = 1;
  private players: Player[] = [];
  private history: number[] = [];
  private ids = 0;
  private now: () => number;
  private pick: (odds: CrashOdds) => number;
  private draw: () => CrashOdds;
  private stats: CrashTally | undefined;
  private house: HouseTally | undefined;
  private onAuto: ((wallet: string, auto: CrashAutoState) => void) | undefined;
  /** Everyone's auto-bet, running or the last one stopped (so their pages can say why), by wallet. */
  private autos = new Map<string, AutoRun>();

  constructor(
    private readonly bank: CrashBank,
    opts: CrashOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.pick = opts.point ?? ((odds) => crashPoint(random(), odds));
    this.stats = opts.stats;
    this.house = opts.house;
    this.onAuto = opts.onAuto;
    this.draw = opts.series ?? (() => drawSeries(random(), random()));
    // The first series, and bets open for its first round straight away.
    this.odds = this.draw();
    this.endsAt = this.now() + BET_TIME;
  }

  /** The round as it is now, for every page in the casino: nobody's wallet, and never the crash point before the crash. */
  state(): CrashState {
    const now = this.now();
    return structuredClone({
      phase: this.phase,
      left: this.phase === 'betting' || this.phase === 'crashed' ? Math.max(0, this.endsAt - now) : 0,
      elapsed: this.phase === 'running' ? Math.max(0, now - this.startedAt) : 0,
      round: this.round,
      series: this.series,
      of: this.of,
      odds: this.odds,
      crash: this.phase === 'crashed' ? this.point : null,
      players: this.players.map(({ wallet: _, byAuto: __, ...p }) => p),
      history: this.history,
    });
  }

  /** The multiplier right now, on the office's clock (1 unless it's climbing). */
  multiplier(): number {
    return this.phase === 'running' ? multiplierAt(this.now() - this.startedAt) : 1;
  }

  /**
   * `wallet` (on page `peer`, called `name`) bets `amount` on the next round: only while bets are
   * taken (no round climbing or just crashed), once a round, a whole number within the limits (up to
   * MAX_BET), and only chips they have: the bank takes them there and then. With `target` (see
   * targetOk) the office cashes it out by itself at exactly that, if the round gets there. Says whether it went down.
   */
  bet(peer: string, wallet: string, name: string, amount: unknown, color?: string, target?: unknown): boolean {
    return this.place(peer, wallet, name, amount, color, target) === null;
  }

  /** Puts a bet down (see bet), or says why it couldn't. */
  private place(peer: string, wallet: string, name: string, amount: unknown, color: string | undefined, target: unknown, byAuto = false): CrashAutoStop | 'closed' | 'bad' | null {
    if (!betOk(amount)) return typeof amount === 'number' && amount > MAX_BET ? 'limit' : 'bad';
    if (target !== undefined && target !== null && !targetOk(target)) return 'bad';
    if (this.phase !== 'betting' || this.now() >= this.endsAt) return 'closed';
    if (this.players.some((p) => p.wallet === wallet)) return 'closed';
    if (this.players.length >= MAX_PLAYERS) return 'full';
    if (!this.bank.bet(wallet, amount, 'crash.bet', { quiet: true })) return 'balance';
    const auto = typeof target === 'number' ? { auto: target } : {};
    this.players.push({ id: `c${++this.ids}`, name: name.slice(0, 24), ...(color ? { color } : {}), peer, bet: amount, ...auto, wallet, ...(byAuto ? { byAuto } : {}) });
    this.stats?.bet(wallet, amount, name, color);
    return null;
  }

  // ---- Auto-bet ---------------------------------------------------------------------------------------

  /**
   * `wallet` (on page `peer`) starts an auto-bet with `settings` (see CrashAutoBet; checked here):
   * it bets straight away if bets are open and they're not in yet, else from the next betting window.
   * Any auto-bet they had is replaced. Says whether it started.
   */
  startAuto(peer: string, wallet: string, name: string, settings: unknown, color?: string): boolean {
    const s = autoBetOk(settings);
    if (!s) return false;
    const run: AutoRun = { on: true, settings: s, rounds: 0, profit: 0, next: s.base, peer, name, ...(color ? { color } : {}) };
    this.autos.set(wallet, run);
    if (this.phase === 'betting' && this.now() < this.endsAt && !this.players.some((p) => p.wallet === wallet)) this.autoBet(wallet, run);
    else this.told(wallet, run);
    return true;
  }

  /** `wallet`'s auto-bet stops (a bet it already put down stays in the round). Says whether one was running. */
  stopAuto(wallet: string, why: CrashAutoStop = 'user'): boolean {
    const run = this.autos.get(wallet);
    if (!run?.on) return false;
    run.on = false;
    run.stopped = why;
    this.told(wallet, run);
    return true;
  }

  /** `wallet`'s auto-bet as their pages see it: running, or the last one and why it stopped (null if they never had one). */
  autoState(wallet: string): CrashAutoState | null {
    const run = this.autos.get(wallet);
    return run ? view(run) : null;
  }

  /** The auto-bet puts its next bet down, or stops and says why it couldn't. */
  private autoBet(wallet: string, run: AutoRun) {
    const why = this.place(run.peer, wallet, run.name, run.next, run.color, run.settings.target, true);
    if (why === 'closed') return;
    if (why === null) this.told(wallet, run);
    else this.stopAuto(wallet, why === 'bad' ? 'limit' : why);
  }

  /** A bet settled for `won` (0: lost; any cash-out counts as a win): if their auto-bet put it down, it counts, the next bet's worked out, and it may stop there. */
  private settled(p: Player, won: number) {
    if (won < p.bet) this.house?.lost('crash', p.bet - won);
    const run = this.autos.get(p.wallet);
    if (!p.byAuto || !run?.on) return;
    run.rounds++;
    run.profit += won - p.bet;
    run.next = nextAutoBet(run.settings, p.bet, won > 0);
    const stop = autoStop(run.settings, run.rounds, run.profit);
    if (stop) this.stopAuto(p.wallet, stop);
    else if (run.next > MAX_BET) this.stopAuto(p.wallet, 'limit');
    else this.told(p.wallet, run);
  }

  private told(wallet: string, run: AutoRun) {
    this.onAuto?.(wallet, view(run));
  }

  /** `wallet` takes their bet back while the clock's still counting down. Says whether they had one. */
  cancel(wallet: string): boolean {
    if (this.phase !== 'betting' || this.now() >= this.endsAt) return false;
    const p = this.players.find((o) => o.wallet === wallet);
    if (!p) return false;
    this.players = this.players.filter((o) => o !== p);
    this.bank.award(wallet, p.bet, 'crash.refund', { quiet: true });
    this.stats?.refund(wallet, p.bet);
    // Taking back a bet the auto-bet put down stops it, or it'd only be back next round.
    if (p.byAuto) this.stopAuto(wallet);
    return true;
  }

  /**
   * `wallet` cashes out: only while the multiplier's climbing, before it's gone past the crash point
   * (as of now, by the office's clock), once. Pays bet × the multiplier now (or the bet's auto
   * cash-out, if the multiplier's already past it). Says what it paid, or 0.
   */
  cashOut(wallet: string, peer?: string): number {
    if (this.phase !== 'running') return 0;
    const ms = this.now() - this.startedAt;
    if (crashedBy(this.point, ms)) return 0;
    const p = this.players.find((o) => o.wallet === wallet);
    if (!p || p.out !== undefined) return 0;
    if (peer) p.peer = peer;
    const m = multiplierAt(ms);
    return this.pay(p, p.auto !== undefined && p.auto <= m ? p.auto : m);
  }

  /** `p` is cashed out at `m`: paid bet × m. Says what it paid. */
  private pay(p: Player, m: number): number {
    const won = payout(p.bet, m);
    p.out = m;
    p.won = won;
    this.bank.award(p.wallet, won, 'crash.win', { quiet: true });
    this.stats?.settle(p.wallet, p.bet, won, m);
    this.settled(p, won);
    return won;
  }

  /**
   * Everyone still in whose auto cash-out the multiplier's got to (`m`), and the round gets to (it's
   * no higher than the crash point), is cashed out at exactly that. Says whether anyone was.
   */
  private autoCash(m: number): boolean {
    let any = false;
    for (const p of this.players) {
      if (p.out !== undefined || p.auto === undefined || p.auto > m || p.auto > this.point) continue;
      this.pay(p, p.auto);
      any = true;
    }
    return any;
  }

  /** `peer` is a page of `wallet`'s (it opened the panel): their entry in the round is marked as theirs. Says whether there was one. */
  look(peer: string, wallet: string): boolean {
    const p = this.players.find((o) => o.wallet === wallet);
    if (!p || p.peer === peer) return false;
    p.peer = peer;
    return true;
  }

  /**
   * When tick() next has something to do (ms, on the office's clock): the betting clock or the crash
   * on the screen running out, or the multiplier going past the crash point. The office sleeps till
   * then: one timer, a few wake-ups a round, whether anyone's in the casino or not.
   */
  nextAt(): number {
    if (this.phase !== 'running') return this.endsAt;
    let at = this.startedAt + Math.ceil(timeFor(this.point + 0.01)) + 1;
    // Or an auto cash-out the round gets to, before that.
    for (const p of this.players) if (p.out === undefined && p.auto !== undefined && p.auto <= this.point) at = Math.min(at, this.startedAt + Math.ceil(timeFor(p.auto)) + 1);
    return at;
  }

  /**
   * The clock: when the betting time's up the round starts (and its crash point's picked), bets or
   * not; while it climbs, bets are cashed out at their auto cash-out as the multiplier gets there;
   * when the multiplier's gone past the crash point the round crashes (whoever's still in loses their bet);
   * and a while after that bets open for the next round, after the series' last round for the first
   * round of a new series, with new odds and a clean history, and every auto-bet that's on puts its
   * next bet down. Says whether anything changed.
   */
  tick(): boolean {
    const now = this.now();
    if (this.phase === 'betting' && now >= this.endsAt) {
      this.phase = 'running';
      this.startedAt = now;
      this.point = this.pick(this.odds);
      // An instant crash happens there and then.
      if (crashedBy(this.point, 0)) this.crashed(now);
      return true;
    }
    if (this.phase === 'running') {
      const ms = now - this.startedAt;
      const paid = this.autoCash(multiplierAt(ms));
      if (!crashedBy(this.point, ms)) return paid;
      this.crashed(now);
      return true;
    }
    if (this.phase === 'crashed' && now >= this.endsAt) {
      this.phase = 'betting';
      this.endsAt = now + BET_TIME;
      this.players = [];
      this.round++;
      if (this.of >= CYCLE) {
        this.series++;
        this.of = 1;
        this.odds = this.draw();
        this.history = [];
      } else this.of++;
      for (const [wallet, run] of this.autos) if (run.on) this.autoBet(wallet, run);
      return true;
    }
    return false;
  }

  /** The office is shutting down: bets of a round that hasn't crashed, and not cashed out, go back to whoever made them. */
  close() {
    if (this.phase === 'betting' || this.phase === 'running') {
      for (const p of this.players) {
        if (p.out !== undefined) continue;
        this.bank.award(p.wallet, p.bet, 'crash.refund', { quiet: true });
        this.stats?.refund(p.wallet, p.bet);
      }
    }
    this.players = [];
    for (const run of this.autos.values()) run.on = false;
  }

  private crashed(now: number) {
    // Auto cash-outs the round got to are paid, however late the clock got here.
    this.autoCash(this.point);
    this.phase = 'crashed';
    this.endsAt = now + CRASHED_TIME;
    this.history = [this.point, ...this.history].slice(0, HISTORY);
    // Whoever's still in lost their bet.
    for (const p of this.players) {
      if (p.out !== undefined) continue;
      this.stats?.settle(p.wallet, p.bet, 0, this.point);
      this.settled(p, 0);
    }
  }
}

/** An auto-bet without who it bets as: what its owner's pages are told. */
function view({ peer: _, name: __, color: ___, ...run }: AutoRun): CrashAutoState {
  return structuredClone(run);
}
