// What every bunker feature's handler (server/bunker/<feature>.ts) is to the bunker (server/bunker/index.ts).
import type { BunkerPerson } from '../../shared/bunker/index.js';

/** One person's bunker while a feature acts on it: who, when, all of their state, and what the feature may do with chips and toasts. */
export interface BunkerCtx {
  /** Who (their chips id: see server/chips.ts's chipsId). */
  id: string;
  /** The office's clock (ms). */
  now: number;
  /** Everything of theirs down here: the feature changes its own section, and the inventory and products. */
  me: BunkerPerson;
  /** Their chips. */
  balance(): number;
  /** Pays them `amount` chips through the chips ledger (a sale: see bunkerSaleReason). Says false, changing nothing, unless it's a positive whole number. */
  pay(amount: number, reason: string): boolean;
  /** Takes `amount` chips off them (a purchase: see bunkerBuyReason). Says false, changing nothing, unless they have it. */
  spend(amount: number, reason: string): boolean;
  /** Tells them something (a toast): `key` is one of the bunker's texts, without the "bunker." ("grow.harvested"). */
  event(key: string, params?: Record<string, string | number>, level?: 'info' | 'warn'): void;
}

/** A bunker feature on the server. Its section `S` is its own; nothing else changes it. */
export interface BunkerFeatureHandler<S> {
  /** Its section for someone new. */
  initial(): S;
  /** Its section as saved (anything at all: an old version, a hand-edited file), made safe; `initial()` for what isn't. */
  load(raw: unknown): S;
  /** They did `action` with `args` (from the page: check everything). Whether anything of theirs changed (their page is then sent it). */
  act(ctx: BunkerCtx, state: S, action: string, args: unknown): boolean;
  /** Every BUNKER_TICK ms, for everyone the office keeps a bunker for, here or not: time passing (plants grow, deadlines run out). Whether anything changed. */
  tick(ctx: BunkerCtx, state: S): boolean;
}
