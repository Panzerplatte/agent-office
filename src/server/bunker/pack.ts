// The bunker's packing table on the server (see shared/bunker/pack.ts): the scale is the office's, so
// how much a scoop puts on it is rolled here, and only what the scale shows gets sealed.
//
// Actions: `start` {from, pack, count?} puts a loose unit and a packaging on the table, `add` (a
// ScoopId) scoops product onto the scale, `empty` tips it back, `seal` packs what's on it, and
// `stop` clears the table. The product on the scale stays its loose unit's until it's sealed.
import { MAX_UNITS, addUnit, takeItem, type BunkerPerson } from '../../shared/bunker/index.js';
import { MACHINE_BATCH, MAX_FILL, MIN_FILL, SCOOPS, benchTarget, isPackId, isScoop, looseUnits, reading, roundGrams, startProblem, type PackBench, type PackState } from '../../shared/bunker/pack.js';
import type { BunkerCtx, BunkerFeatureHandler } from './feature.js';

/** The loose unit the bench is packing from, if it's still there and still loose. */
function source(me: BunkerPerson, bench: PackBench) {
  return looseUnits(me).find((u) => u.id === bench.from);
}

/** The packing table, rolling its scoops with `rng` (tests pass their own). */
export function makePack(rng: () => number = Math.random): BunkerFeatureHandler<PackState> {
  return {
    initial: () => ({ bench: null }),

    load(raw) {
      const b = (raw as { bench?: unknown } | null)?.bench as Record<string, unknown> | null | undefined;
      if (!b || typeof b !== 'object') return { bench: null };
      const { from, pack, count, grams } = b;
      if (typeof from !== 'string' || !isPackId(pack) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > MACHINE_BATCH) return { bench: null };
      const g = typeof grams === 'number' && Number.isFinite(grams) && grams > 0 ? grams : 0;
      return { bench: { from, pack, count, grams: roundGrams(Math.min(g, benchTarget({ pack, count }) * MAX_FILL)) } };
    },

    act(ctx: BunkerCtx, state, action, args) {
      const me = ctx.me;
      switch (action) {
        case 'start': {
          const a = (args && typeof args === 'object' ? args : {}) as { from?: unknown; pack?: unknown; count?: unknown };
          const count = a.count ?? 1;
          const problem = startProblem(me, a.from, a.pack, count);
          if (problem) {
            ctx.event(`pack.${problem}`, undefined, 'warn');
            return false;
          }
          state.bench = { from: a.from as string, pack: a.pack as PackBench['pack'], count: count as number, grams: 0 };
          return true;
        }
        case 'add': {
          const bench = state.bench;
          if (!bench || !isScoop(args)) return false;
          const from = source(me, bench);
          if (!from) {
            state.bench = null;
            ctx.event('pack.gone', undefined, 'warn');
            return true;
          }
          const target = benchTarget(bench);
          const room = Math.min(target * MAX_FILL, from.grams) - bench.grams;
          if (room <= 0.005) {
            ctx.event(from.grams <= bench.grams + 0.005 ? 'pack.noMore' : 'pack.full', undefined, 'warn');
            return false;
          }
          const { min, max } = SCOOPS[args];
          const scoop = Math.max(0.01, target * (min + (max - min) * rng()));
          bench.grams = roundGrams(bench.grams + Math.min(scoop, room));
          return true;
        }
        case 'empty': {
          if (!state.bench || state.bench.grams === 0) return false;
          state.bench.grams = 0;
          return true;
        }
        case 'stop': {
          if (!state.bench) return false;
          state.bench = null;
          return true;
        }
        case 'seal':
          return seal(ctx, state);
        default:
          return false;
      }
    },

    tick: () => false,
  };
}

/** Packs what's on the scale: `count` units of the bench's packaging, the grams shared out between them, off the loose unit. */
function seal(ctx: BunkerCtx, state: PackState): boolean {
  const me = ctx.me;
  const bench = state.bench;
  if (!bench) return false;
  const from = source(me, bench);
  if (!from) {
    state.bench = null;
    ctx.event('pack.gone', undefined, 'warn');
    return true;
  }
  const target = benchTarget(bench);
  const grams = Math.min(bench.grams, from.grams);
  const read = reading(grams, target);
  if (read === 'low') {
    ctx.event('pack.tooLight', { min: roundGrams(target * MIN_FILL) }, 'warn');
    return false;
  }
  if (me.products.length - (grams >= from.grams - 0.005 ? 1 : 0) + bench.count > MAX_UNITS) {
    ctx.event('pack.shelfFull', undefined, 'warn');
    return false;
  }
  if (!takeItem(me.inventory, bench.pack, bench.count)) {
    ctx.event('pack.noBags', undefined, 'warn');
    return false;
  }
  // Off the loose unit (gone, if that was all of it).
  from.grams = roundGrams(from.grams - grams);
  if (from.grams <= 0.005) me.products.splice(me.products.indexOf(from), 1);
  const each = roundGrams(grams / bench.count);
  for (let i = 0; i < bench.count; i++) addUnit(me, { product: from.product, quality: from.quality, grams: each, pack: bench.pack });
  const params = { count: bench.count, grams: each, target: roundGrams(target / bench.count) };
  if (read === 'on') ctx.event('pack.sealed', params);
  else if (read === 'over') ctx.event('pack.sealedOver', { ...params, over: roundGrams(grams - target) });
  else ctx.event('pack.sealedUnder', { ...params, under: roundGrams(target - grams) }, 'warn');
  // Same again, if there's product and packaging left for it; else the table's clear.
  const left = source(me, bench);
  state.bench = left && startProblem(me, left.id, bench.pack, bench.count) === null ? { ...bench, grams: 0 } : null;
  return true;
}

export const pack: BunkerFeatureHandler<PackState> = makePack();
