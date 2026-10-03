/**
 * Online blackjack at the office PCs (the boss's monitor on each floor): the casino's game (see
 * shared/blackjack.ts) at virtual tables for everyone sitting at a PC, on any floor. What the server
 * (server/onlineblackjack.ts) and the pages (client/ui/onlineblackjack.ts) both need to know.
 */
import { MAX_BET, MAX_SEATS, allowed, type BjAction, type BjPlayer, type BlackjackSeat, type BlackjackState } from './blackjack.js';

/** How long a seat waits for someone who stepped away from their PC (ms), once they're in no round. */
export const ONLINE_KEEP = 3 * 60_000;

/** What you can pull a face with at the table, in place of a chat. */
export const ONLINE_EMOTES = ['👍', '😂', '😱', '🎉'] as const;
export type OnlineEmote = (typeof ONLINE_EMOTES)[number];

/** How long an emote stays up over a seat on the pages (ms), and how often someone can send one, at most. */
export const EMOTE_SHOWN = 3_000;
export const EMOTE_EVERY = 1_000;

export function isOnlineEmote(e: unknown): e is OnlineEmote {
  return typeof e === 'string' && (ONLINE_EMOTES as readonly string[]).includes(e);
}

/**
 * A seat kept for someone who stepped away from their PC while they were in no round (the table itself
 * keeps those who are): which place, whose, and for how much longer (ms).
 */
export interface OnlineKept {
  seat: number;
  name: string;
  left: number;
}

/**
 * One online table: the table as the casino's (seats, stage, clock, round), its number, the floor each
 * player there now is on (by seat id, so a floor's monitor shows the table of whoever's at its PC), and
 * the places kept for people who stepped away.
 */
export interface OnlineTable extends BlackjackState {
  id: number;
  floors: Record<string, string>;
  kept: OnlineKept[];
}

export interface OnlineBlackjackState {
  tables: OnlineTable[];
}

export function emptyOnlineBlackjack(): OnlineBlackjackState {
  return { tables: [] };
}

/** Everyone a table has places for: those sitting there or away in a round, and those kept for. */
export function taken(t: OnlineTable): number {
  return t.seats.length + t.kept.length;
}

export function isFull(t: OnlineTable): boolean {
  return taken(t) >= MAX_SEATS;
}

/** The table and seat `peer` is sitting at, if they are. */
export function seatOf(s: OnlineBlackjackState, peer: string): { table: OnlineTable; seat: BlackjackSeat } | undefined {
  for (const table of s.tables) {
    const seat = table.seats.find((x) => x.peer === peer);
    if (seat) return { table, seat };
  }
  return undefined;
}

/** Whoever's playing online at the PC on `floor` (there's one per floor), and at which table. */
export function atFloor(s: OnlineBlackjackState, floor: string): { table: OnlineTable; seat: BlackjackSeat } | undefined {
  for (const table of s.tables) {
    const seat = table.seats.find((x) => x.peer && table.floors[x.id] === floor);
    if (seat) return { table, seat };
  }
  return undefined;
}

// ---- What the pages make of a table ----------------------------------------------------------------

/** What you can do at the table now, which decides the buttons under the screen. */
export type OnlineControls =
  | { kind: 'join' }
  | { kind: 'bet'; cap: number; again: number }
  | { kind: 'down'; bet: number; deal: boolean }
  | { kind: 'insure'; cost: number }
  | { kind: 'moves'; moves: BjAction[]; stake: number }
  | { kind: 'wait' };

/**
 * What you can do at `table` (undefined: you're at none), as `you`, with `balance` chips: sit down
 * again, bet (up to `cap`; `again` your last bet, if you can bet it again), take your bet back or deal,
 * say about insurance, make a move, or wait for the others.
 */
export function controlsFor(table: OnlineTable | undefined, you: string, balance: number): OnlineControls {
  const me = table?.seats.find((s) => s.peer === you);
  if (!table || !me) return { kind: 'join' };
  const r = table.round;
  if (table.stage === 'idle' || table.stage === 'betting') {
    if (me.bet) return { kind: 'down', bet: me.bet, deal: table.stage === 'betting' };
    const cap = Math.min(MAX_BET, balance);
    return { kind: 'bet', cap, again: me.last && me.last <= cap ? me.last : 0 };
  }
  const mine = r?.players.find((p) => p.id === me.id);
  if (table.stage === 'insurance' && mine && mine.insurance === null) return { kind: 'insure', cost: Math.floor(mine.hands[0].bet / 2) };
  const moves = r ? allowed(r, me.id) : [];
  if (moves.length && r?.turn) return { kind: 'moves', moves, stake: mine!.hands[r.turn.hand].bet };
  return { kind: 'wait' };
}

/** Whether someone at `table` can skip the hand that's up now: its player's away, and you're sitting there. */
export function canSkip(table: OnlineTable | undefined, you: string): boolean {
  const r = table?.round;
  if (!table || !r?.turn || table.stage !== 'playing' || !table.seats.some((s) => s.peer === you)) return false;
  const up = r.players[r.turn.player];
  return !!up && !table.seats.find((s) => s.id === up.id)?.peer;
}

/** How a round came out for player `p`, all told: what it paid back over what they put on it. */
export function netOf(p: BjPlayer): number {
  return (p.paid ?? 0) - p.hands.reduce((a, hd) => a + hd.bet, 0) - (p.insurance ?? 0);
}

/** "2:31": how long a kept seat still waits (ms). */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
