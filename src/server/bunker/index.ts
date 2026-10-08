// The bunker on the server (see shared/bunker/index.ts): everyone's bunker, kept in
// .agent-office/bunker.json, each feature's actions handed to its own handler, and the features'
// clocks ticked. Buying and selling down here goes through the casino's chips ledger (server/chips.ts),
// so it's the same balance as the casino's.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BUNKER_FEATURES, MAX_STACK, MAX_UNITS, isBunkerFeature, type BunkerEvent, type BunkerFeature, type BunkerPerson, type BunkerSections, type Inventory, type ProductUnit } from '../../shared/bunker/index.js';
import type { ServerMsg } from '../../shared/protocol.js';
import type { BunkerCtx, BunkerFeatureHandler } from './feature.js';
import { cartel } from './cartel.js';
import { customers } from './customers.js';
import { grow } from './grow.js';
import { lab } from './lab.js';
import { pack } from './pack.js';
import { pc } from './pc.js';

/** Every feature's handler, by its name. */
export const BUNKER_HANDLERS: { [F in BunkerFeature]: BunkerFeatureHandler<BunkerSections[F]> } = { grow, lab, pack, pc, customers, cartel };

/** How often the features' clocks tick (ms). */
export const BUNKER_TICK = 5000;
/** How long after a change the file is written, gathering a burst of changes into one write (ms). */
const SAVE_AFTER = 1000;
/** An action's name: short, plain. */
const ACTION_RE = /^[a-zA-Z][\w.-]{0,39}$/;

/** What the bunker needs of the chips (server/chips.ts's Chips). */
export interface BunkerChips {
  balance(id: string): number;
  award(id: string, amount: number, reason: string): boolean;
  bet(id: string, amount: number, reason: string): boolean;
}

export interface BunkerOptions {
  chips: BunkerChips;
  now?: () => number;
  /** To every page of person `id` (their chips id). */
  send?: (id: string, msg: ServerMsg) => void;
  /** How long after a change it's written (ms); tests pass 0 and call flush. */
  saveAfter?: number;
  /** The handlers (tests swap in their own). */
  handlers?: Partial<typeof BUNKER_HANDLERS>;
}

interface Saved {
  people: Record<string, unknown>;
}

/**
 * Everyone's bunker. A person (`id`) is who they are to the chips (an account, a browser's key, or
 * `conn:` for a page that couldn't keep one, which is never saved). Someone new has nothing until
 * they do something down here.
 */
export class Bunker {
  private people = new Map<string, BunkerPerson>();
  private file: string;
  private chips: BunkerChips;
  private now: () => number;
  private send: BunkerOptions['send'];
  private saveAfter: number;
  private handlers: typeof BUNKER_HANDLERS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  /** The file is there but couldn't be read: never write over it, or everyone's bunker is gone. */
  private unreadable = false;

  constructor(dataDir: string, opts: BunkerOptions) {
    this.file = path.join(dataDir, 'bunker.json');
    this.chips = opts.chips;
    this.now = opts.now ?? Date.now;
    this.send = opts.send;
    this.saveAfter = opts.saveAfter ?? SAVE_AFTER;
    this.handlers = { ...BUNKER_HANDLERS, ...opts.handlers };
    this.load();
  }

  /** `id`'s bunker, for their page (a fresh one for someone new, not kept until they do something). */
  state(id: string): BunkerPerson {
    return structuredClone(this.people.get(id) ?? this.fresh());
  }

  /** Whether the office keeps a bunker for `id`. */
  has(id: string): boolean {
    return this.people.has(id);
  }

  /**
   * `id` did something at a feature (a `bunker.act` from their page, already checked to be in the
   * bunker): handed to that feature. Whether anything changed (their pages are then sent it).
   */
  act(id: string, msg: { feature?: unknown; action?: unknown; args?: unknown }): boolean {
    if (!isBunkerFeature(msg.feature) || typeof msg.action !== 'string' || !ACTION_RE.test(msg.action)) return false;
    const feature = msg.feature;
    const me = this.person(id);
    const handler = this.handlers[feature] as BunkerFeatureHandler<unknown>;
    let changed = false;
    try {
      changed = handler.act(this.ctx(id, me), me[feature], msg.action, msg.args);
    } catch (err) {
      console.error(`agent-office: bunker ${feature}.${msg.action} failed: ${(err as Error).message}`);
    }
    if (changed) this.changed(id);
    return changed;
  }

  /** Time passes for everyone's features. */
  tick() {
    for (const [id, me] of this.people) {
      let changed = false;
      const ctx = this.ctx(id, me);
      for (const f of BUNKER_FEATURES) {
        try {
          if ((this.handlers[f] as BunkerFeatureHandler<unknown>).tick(ctx, me[f])) changed = true;
        } catch (err) {
          console.error(`agent-office: bunker ${f} tick failed: ${(err as Error).message}`);
        }
      }
      if (changed) this.changed(id);
    }
  }

  /** Starts the features' clocks. */
  start(every = BUNKER_TICK) {
    if (this.clock) return;
    this.clock = setInterval(() => this.tick(), every);
    this.clock.unref?.();
  }

  stop() {
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
  }

  /** Pays `id` `amount` chips through the ledger (a sale: see bunkerSaleReason). */
  payChips(id: string, amount: number, reason: string): boolean {
    return this.chips.award(id, amount, reason);
  }

  /** Takes `amount` chips off `id` through the ledger (a purchase: see bunkerBuyReason), if they have it. */
  spendChips(id: string, amount: number, reason: string): boolean {
    return this.chips.bet(id, amount, reason);
  }

  /** Writes any change not on disk yet, now (the office is stopping). */
  flush() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }

  // ---- Inside -------------------------------------------------------------------------------------------

  private fresh(): BunkerPerson {
    const sections = Object.fromEntries(BUNKER_FEATURES.map((f) => [f, this.handlers[f].initial()])) as unknown as BunkerSections;
    return { inventory: {}, products: [], nextUnit: 1, ...sections };
  }

  private person(id: string): BunkerPerson {
    let me = this.people.get(id);
    if (!me) this.people.set(id, (me = this.fresh()));
    return me;
  }

  private ctx(id: string, me: BunkerPerson): BunkerCtx {
    return {
      id,
      now: this.now(),
      me,
      balance: () => this.chips.balance(id),
      pay: (amount, reason) => this.payChips(id, amount, reason),
      spend: (amount, reason) => this.spendChips(id, amount, reason),
      event: (key, params, level) => this.send?.(id, { t: 'bunker.event', event: { key, ...(params ? { params } : {}), ...(level ? { level } : {}) } satisfies BunkerEvent }),
    };
  }

  private changed(id: string) {
    this.dirty();
    this.send?.(id, { t: 'bunker.state', state: this.state(id) });
  }

  private dirty() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, this.saveAfter);
    this.timer.unref?.();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      for (const [id, raw] of Object.entries(saved.people ?? {})) {
        if (!id || id.startsWith('conn:') || !raw || typeof raw !== 'object') continue;
        this.people.set(id, this.loadPerson(raw as Record<string, unknown>));
      }
    } catch (err) {
      this.unreadable = true;
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message} — the bunker won't be saved until it's fixed or moved`);
    }
  }

  /** Someone's bunker as saved, made safe: the inventory and products checked, each section by its own feature. */
  private loadPerson(raw: Record<string, unknown>): BunkerPerson {
    const inventory: Inventory = {};
    if (raw.inventory && typeof raw.inventory === 'object') {
      for (const [item, n] of Object.entries(raw.inventory as Record<string, unknown>)) {
        if (typeof n === 'number' && Number.isSafeInteger(n) && n > 0) inventory[item] = Math.min(n, MAX_STACK);
      }
    }
    const products: ProductUnit[] = [];
    const ids = new Set<string>();
    for (const u of Array.isArray(raw.products) ? raw.products : []) {
      if (!u || typeof u !== 'object') continue;
      const { id, product, quality, grams, pack } = u as Record<string, unknown>;
      if (typeof id !== 'string' || ids.has(id) || typeof product !== 'string' || typeof quality !== 'number' || !Number.isFinite(quality) || typeof grams !== 'number' || !(grams > 0) || !Number.isFinite(grams)) continue;
      ids.add(id);
      products.push({ id, product, quality: Math.min(1, Math.max(0, quality)), grams, ...(typeof pack === 'string' ? { pack } : {}) });
      if (products.length >= MAX_UNITS) break;
    }
    const highest = products.reduce((n, u) => Math.max(n, Number(/^u(\d+)$/.exec(u.id)?.[1] ?? 0)), 0);
    const nextUnit = typeof raw.nextUnit === 'number' && Number.isSafeInteger(raw.nextUnit) && raw.nextUnit > highest ? raw.nextUnit : highest + 1;
    const sections = Object.fromEntries(
      BUNKER_FEATURES.map((f) => {
        const handler = this.handlers[f] as BunkerFeatureHandler<unknown>;
        try {
          return [f, raw[f] === undefined ? handler.initial() : handler.load(raw[f])];
        } catch {
          return [f, handler.initial()];
        }
      }),
    ) as unknown as BunkerSections;
    return { inventory, products, nextUnit, ...sections };
  }

  private save() {
    if (this.unreadable) return;
    const people = Object.fromEntries([...this.people].filter(([id]) => !id.startsWith('conn:')));
    // Written whole and renamed into place, so a crash mid-write never leaves half a file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ people } satisfies Saved), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}
