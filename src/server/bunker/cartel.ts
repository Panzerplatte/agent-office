// The bunker's cartel feature on the server (see shared/bunker/cartel.ts): the phone ringing with offers,
// taking one (one at a time), handing over product toward it, being paid in chips when it's all there,
// and the reputation that goes up for that and down for a missed deadline.
//
// Actions: `answer` (picking up for the offer: the phone stops ringing), `accept` and `decline` (the
// offer), `haggle` (args: 'price' or 'time', once a contract, the offer's or your contract's),
// `deliver` (what you have that counts, toward your contract), `abandon` (walking away from it).
import { bunkerSaleReason, takeUnit } from '../../shared/bunker/index.js';
import {
  HAGGLE_PRICE,
  HAGGLE_TIME,
  OFFER_GAP,
  REP_DONE,
  REP_FAILED,
  REP_HAGGLE_FAILED,
  START_REP,
  clampRep,
  cartelTier,
  gramsLeft,
  haggleChance,
  makeOffer,
  unitsToDeliver,
  type CartelContract,
  type CartelState,
} from '../../shared/bunker/cartel.js';
import { PRODUCT_BY_ID } from '../../shared/bunker/items.js';
import type { BunkerCtx, BunkerFeatureHandler } from './feature.js';

/** The reason in the chips ledger for the cartel's pay: "bunker:sale:cartel". */
export const CARTEL_SALE = bunkerSaleReason('cartel');

const num = (v: unknown, ok: (n: number) => boolean = Number.isFinite): v is number => typeof v === 'number' && Number.isFinite(v) && ok(v);
const count = (v: unknown) => (num(v, (n) => Number.isSafeInteger(n) && n >= 0) ? v : 0);

function loadContract(raw: unknown, taken: boolean): CartelContract | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^k\d+$/.test(r.id) || typeof r.product !== 'string' || !PRODUCT_BY_ID.has(r.product)) return null;
  if (!num(r.grams, (n) => n > 0 && n <= 1e6) || !num(r.minQuality) || !num(r.pay, (n) => Number.isSafeInteger(n) && n > 0) || !num(r.time, (n) => n > 0) || !num(r.expiresAt)) return null;
  if (taken && !num(r.dueAt)) return null;
  const c: CartelContract = {
    id: r.id,
    product: r.product,
    grams: r.grams,
    minQuality: Math.min(1, Math.max(0, r.minQuality)),
    pay: r.pay,
    time: r.time,
    tier: Math.min(4, Math.max(0, Math.floor(num(r.tier) ? r.tier : 0))),
    expiresAt: r.expiresAt,
    delivered: num(r.delivered, (n) => n >= 0) ? Math.min(r.delivered, r.grams) : 0,
    haggled: r.haggled === true,
  };
  if (taken) c.dueAt = r.dueAt as number;
  return c;
}

/** Contract `c` didn't happen: the reputation it costs, a word from them, and the next call a while off. */
function failed(ctx: BunkerCtx, state: CartelState, key: 'missed' | 'abandoned') {
  const c = state.contract!;
  state.contract = null;
  state.failed++;
  state.rep = clampRep(state.rep + REP_FAILED);
  state.nextOfferAt = ctx.now + OFFER_GAP;
  ctx.event(`cartel.${key}`, { grams: c.grams }, 'warn');
}

/** The cartel's handler, rolling its dice with `rand` (tests pass their own). */
export function makeCartel(rand: () => number = Math.random): BunkerFeatureHandler<CartelState> {
  return {
    initial: () => ({ known: false, rep: START_REP, offer: null, contract: null, answered: null, nextOfferAt: 0, nextId: 1, done: 0, failed: 0, earned: 0 }),

    load(raw) {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const offer = loadContract(r.offer, false);
      const contract = loadContract(r.contract, true);
      const highest = [offer, contract].reduce((n, c) => Math.max(n, Number(c?.id.slice(1) ?? 0)), 0);
      return {
        known: r.known === true || !!offer || !!contract,
        rep: num(r.rep) ? clampRep(r.rep) : START_REP,
        offer,
        contract,
        answered: typeof r.answered === 'string' ? r.answered : null,
        nextOfferAt: num(r.nextOfferAt) ? r.nextOfferAt : 0,
        nextId: num(r.nextId, (n) => Number.isSafeInteger(n) && n > highest) ? r.nextId : highest + 1,
        done: count(r.done),
        failed: count(r.failed),
        earned: count(r.earned),
      };
    },

    act(ctx, state, action, args) {
      switch (action) {
        case 'answer': {
          if (!state.offer || state.answered === state.offer.id) return false;
          state.answered = state.offer.id;
          return true;
        }
        case 'accept': {
          const o = state.offer;
          if (!o) return false;
          if (state.contract) {
            ctx.event('cartel.busy', undefined, 'warn');
            return false;
          }
          state.offer = null;
          state.answered = null;
          state.contract = { ...o, dueAt: ctx.now + o.time, delivered: 0 };
          ctx.event('cartel.accepted', { minutes: Math.round(o.time / 60_000) });
          return true;
        }
        case 'decline': {
          if (!state.offer) return false;
          state.offer = null;
          state.answered = null;
          state.nextOfferAt = ctx.now + OFFER_GAP;
          ctx.event('cartel.declined');
          return true;
        }
        case 'haggle': {
          if (args !== 'price' && args !== 'time') return false;
          const c = state.contract ?? state.offer;
          if (!c) return false;
          if (c.haggled) {
            ctx.event('cartel.haggledAlready', undefined, 'warn');
            return false;
          }
          c.haggled = true;
          if (state.offer === c) state.answered = c.id;
          if (rand() >= haggleChance(state.rep)) {
            state.rep = clampRep(state.rep + REP_HAGGLE_FAILED);
            ctx.event(`cartel.haggleNo.${args}`, undefined, 'warn');
            return true;
          }
          if (args === 'price') {
            c.pay = Math.round(c.pay * (1 + HAGGLE_PRICE));
            ctx.event('cartel.haggleYes.price', { pay: c.pay });
          } else {
            const more = Math.round(c.time * HAGGLE_TIME);
            c.time += more;
            if (c.dueAt !== undefined) c.dueAt += more;
            ctx.event('cartel.haggleYes.time', { minutes: Math.round(more / 60_000) });
          }
          return true;
        }
        case 'deliver': {
          const c = state.contract;
          if (!c) return false;
          const units = unitsToDeliver(c, ctx.me.products);
          if (!units.length) {
            ctx.event('cartel.nothingFits', { quality: Math.round(c.minQuality * 100) }, 'warn');
            return false;
          }
          let grams = 0;
          for (const u of units) if (takeUnit(ctx.me, u.id)) grams += u.grams;
          c.delivered = Math.min(c.grams, Math.round((c.delivered + grams) * 10) / 10);
          if (gramsLeft(c) > 1e-9) {
            ctx.event('cartel.delivered', { grams: Math.round(grams * 10) / 10, left: Math.round(gramsLeft(c) * 10) / 10 });
            return true;
          }
          state.contract = null;
          state.done++;
          state.rep = clampRep(state.rep + REP_DONE);
          state.nextOfferAt = ctx.now + OFFER_GAP;
          const before = cartelTier(state.rep - REP_DONE);
          if (ctx.pay(c.pay, CARTEL_SALE)) state.earned += c.pay;
          ctx.event('cartel.paid', { pay: c.pay, grams: c.grams });
          if (cartelTier(state.rep) > before) ctx.event(`cartel.promoted.${cartelTier(state.rep)}`);
          return true;
        }
        case 'abandon': {
          if (!state.contract) return false;
          failed(ctx, state, 'abandoned');
          return true;
        }
      }
      return false;
    },

    tick(ctx, state) {
      let changed = false;
      if (state.contract && ctx.now >= (state.contract.dueAt ?? 0)) {
        failed(ctx, state, 'missed');
        changed = true;
      }
      if (state.offer && ctx.now >= state.offer.expiresAt) {
        state.offer = null;
        state.answered = null;
        state.nextOfferAt = ctx.now + OFFER_GAP;
        changed = true;
      }
      // They hear of you once you've something in the stash to sell (nothing changes for anyone else).
      if (!state.known) {
        if (!ctx.me.products.length) return changed;
        state.known = true;
        changed = true;
      }
      // The phone rings with the next offer: never while you've a contract, or one's on the table.
      if (!state.offer && !state.contract && ctx.now >= state.nextOfferAt) {
        state.offer = makeOffer(state.rep, ctx.now, `k${state.nextId++}`, rand);
        state.answered = null;
        changed = true;
      }
      return changed;
    },
  };
}

export const cartel: BunkerFeatureHandler<CartelState> = makeCartel();
