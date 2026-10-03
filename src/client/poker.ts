import { POKER_TABLE } from '../shared/casino';
import type { PokerAction, PokerState } from '../shared/poker';
import { isTyping, type PlayerController } from './player';
import { modalOpen } from './ui/dom';
import { PokerPanel } from './ui/poker';

// Poker at the casino's table (see shared/poker.ts, server/poker.ts). Sit down in one of its chairs
// (E, like any chair) and the panel comes up: buy in with some of your chips and you're dealt in from
// the next hand, against whoever else sits down and the Dealer-Bots you add. The mouse is free for
// the panel while you sit there. Standing up (walking off) keeps your seat, and you sit out until
// you're back; sitting down at the table again, after a reload too, puts you straight back in it.
// Only Leave on the panel, or Esc, gives the seat up and puts what's in front of you back on your
// balance. E doesn't: you're sitting at the table, not using it.

export interface PokerHooks {
  /** Sit down at seat `seat` with `buyIn` chips, or back into the seat kept for you (no buy-in). */
  sit(seat: number, buyIn?: number): void;
  away(): void;
  leave(): void;
  act(a: PokerAction): void;
  topUp(amount: number): void;
  bot(add: boolean): void;
  /** Moves you into the chair at seat `seat` (yours, kept for you, when you sat down in another one). */
  sitIn(seat: number): void;
  /** Gets you up out of the chair. */
  standUp(): void;
}

export class PokerPlayer {
  /** The chair you're in at the table (its seat), or -1. */
  private chair = -1;
  /** Asked the office for your kept seat back since sitting down. */
  private rejoined = false;
  /** Left on purpose: getting up after that isn't stepping away. */
  private leaving = false;
  private readonly panel: PokerPanel;
  private state: PokerState | null = null;

  constructor(
    private readonly player: PlayerController,
    private readonly hooks: PokerHooks,
    /** Your chips, to buy in with. */
    private readonly balance: () => number,
  ) {
    this.panel = new PokerPanel({
      sit: (buyIn) => this.chair >= 0 && hooks.sit(this.chair, buyIn),
      act: (a) => hooks.act(a),
      topUp: (n) => hooks.topUp(n),
      bot: (add) => hooks.bot(add),
      leave: () => this.leave(),
    });
    window.addEventListener('keydown', (e) => {
      if (this.chair < 0 || e.code !== 'Escape' || e.repeat || isTyping(e) || modalOpen()) return;
      e.preventDefault();
      this.leave();
    });
  }

  /** At the table: sitting in one of its chairs. */
  get active(): boolean {
    return this.chair >= 0;
  }

  /** Sitting in the poker table's chair `chair` now (-1: not), every frame: the panel comes and goes with it. */
  update(chair: number) {
    if (chair === this.chair) {
      if (chair >= 0) this.panel.tick();
      return;
    }
    const was = this.chair;
    this.chair = chair;
    if (chair >= 0 && was < 0) this.sat();
    else if (chair < 0) this.gotUp();
    else {
      // Moved over into your own seat.
      this.look();
      this.sync(this.state);
    }
  }

  /** Looking down at the felt, the middle of the table straight ahead. */
  private look() {
    const p = this.player;
    p.camYaw = Math.atan2(POKER_TABLE.x - p.pos.x, POKER_TABLE.z - p.pos.z) - Math.PI;
    p.lookPitch = -0.5;
  }

  /** The office's latest on the table. */
  sync(s: PokerState | null) {
    this.state = s;
    if (!s || this.chair < 0) return;
    // A seat's kept for you (you stood up, or reloaded): back in it, in its own chair.
    if (s.you < 0 && s.kept >= 0 && !this.rejoined) {
      this.rejoined = true;
      if (s.kept !== this.chair) this.hooks.sitIn(s.kept);
      this.hooks.sit(s.kept);
    }
    // Your seat's another chair (a Dealer-Bot had this one, so the office gave you the next free one): over you go.
    else if (s.you >= 0 && s.you !== this.chair) this.hooks.sitIn(s.you);
    this.panel.render(s, this.chair, this.balance());
  }

  /** After a reconnect, which left your seat away: ask for it again. */
  rejoin() {
    this.rejoined = false;
    this.sync(this.state);
  }

  private sat() {
    this.leaving = false;
    this.rejoined = false;
    const p = this.player;
    this.look();
    // The mouse is for the panel now.
    p.freeMouse = true;
    p.unlock();
    this.panel.show(true);
    this.sync(this.state);
  }

  private gotUp() {
    const p = this.player;
    p.freeMouse = false;
    if (p.canLock && p.enabled) p.lock();
    this.panel.show(false);
    // Stepped away: your seat waits for you (unless you'd just left it).
    if (!this.leaving && this.state && this.state.you >= 0) this.hooks.away();
    this.leaving = false;
  }

  private leave() {
    this.leaving = true;
    this.hooks.leave();
    this.hooks.standUp();
  }
}
