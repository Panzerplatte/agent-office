import { CASINO, onChipPlatform } from '../shared/casino.js';
import { PLATFORM_PAY } from '../shared/chips.js';

/** How often the office looks at who's on the chip platform (ms): a payout is at most this late. */
export const PLATFORM_TICK = 250;

/** One page in the office, as the platform sees it: whose chips, where they are, and when they last did something. */
export interface PlatformPerson {
  /** Their chips id (see server/chips.ts): several pages of one person are paid once. */
  chips: string;
  floor?: string;
  x: number;
  z: number;
  /** Sitting somewhere (nobody sits on the platform). */
  seat?: string;
  /** When they last did something (see activeMsg). */
  activeAt: number;
}

/**
 * The casino's chip platform (see CHIP_PLATFORM, PLATFORM_PAY): everyone standing on it gets
 * PLATFORM_PAY.chips every PLATFORM_PAY.every ms, the first a whole `every` after stepping on. The
 * office calls `tick` on one timer with everyone where it last heard they are; whoever isn't on it
 * then (stepped off, rode the elevator, sat down, went quiet for PLATFORM_PAY.idle, or dropped out
 * and isn't in the list any more) starts again from nothing next time they step on.
 */
export class ChipPlatform {
  /** Who's on it (chips ids), and when each is paid next. */
  private due = new Map<string, number>();

  /** How many people are on it and being paid (for the glow). */
  get count(): number {
    return this.due.size;
  }

  /** Whether `p` counts as standing on the platform now. */
  static on(p: PlatformPerson, now: number): boolean {
    return p.floor === CASINO && !p.seat && onChipPlatform(p.x, p.z) && now - p.activeAt < PLATFORM_PAY.idle;
  }

  /** Who's where now: the chips ids to pay (once each), and whether the number on it changed. */
  tick(now: number, people: Iterable<PlatformPerson>): { paid: string[]; changed: boolean } {
    const before = this.due.size;
    const here = new Set<string>();
    for (const p of people) if (ChipPlatform.on(p, now)) here.add(p.chips);
    for (const id of this.due.keys()) if (!here.has(id)) this.due.delete(id);
    const paid: string[] = [];
    for (const id of here) {
      const at = this.due.get(id);
      if (at === undefined) {
        this.due.set(id, now + PLATFORM_PAY.every);
        continue;
      }
      if (now < at) continue;
      paid.push(id);
      // On the beat, not drifting later by the tick's lateness (but never a burst after a stall).
      const next = at + PLATFORM_PAY.every;
      this.due.set(id, next > now ? next : now + PLATFORM_PAY.every);
    }
    return { paid, changed: this.due.size !== before };
  }
}
