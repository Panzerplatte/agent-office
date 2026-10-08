// The bunker's lab feature on the server (see shared/bunker/lab.ts): starting a batch (its kit there,
// its ingredients used up), believing the page's score for its mini-game only as soon as it could have
// been played, letting it rest, and putting it in the stash as a unit of product.
//
// Actions: `start` (args: a recipe's id), `finish` (args: { quality } 0–1, or { ruined: true }),
// `abandon` (the batch being played is thrown out), `collect` (a rested batch into the stash).
import { addUnit, takeItem } from '../../shared/bunker/index.js';
import { LAB_ABANDON, RECIPES, missingFor, playing, recipe, type LabBatch, type LabState, type RecipeId } from '../../shared/bunker/lab.js';
import type { BunkerFeatureHandler } from './feature.js';

const RECIPE_IDS = new Set<string>(RECIPES.map((r) => r.id));

function loadBatch(raw: unknown): LabBatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const { recipe: id, startedAt, quality, readyAt } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !RECIPE_IDS.has(id) || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  const batch: LabBatch = { recipe: id as RecipeId, startedAt };
  if (typeof quality === 'number' && Number.isFinite(quality)) {
    batch.quality = Math.min(1, Math.max(0, quality));
    batch.readyAt = typeof readyAt === 'number' && Number.isFinite(readyAt) ? readyAt : startedAt;
  }
  return batch;
}

export const lab: BunkerFeatureHandler<LabState> = {
  initial: () => ({ batch: null, made: 0 }),

  load(raw) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const made = typeof r.made === 'number' && Number.isSafeInteger(r.made) && r.made > 0 ? r.made : 0;
    return { batch: loadBatch(r.batch), made };
  },

  act(ctx, state, action, args) {
    switch (action) {
      case 'start': {
        const r = recipe(args);
        if (!r) return false;
        if (state.batch) {
          ctx.event('lab.busy', undefined, 'warn');
          return false;
        }
        if (Object.keys(missingFor(r, ctx.me.inventory)).length) {
          ctx.event('lab.missing', undefined, 'warn');
          return false;
        }
        for (const [item, n] of Object.entries(r.ingredients)) takeItem(ctx.me.inventory, item, n);
        state.batch = { recipe: r.id, startedAt: ctx.now };
        return true;
      }
      case 'finish': {
        const b = state.batch;
        if (!playing(b) || !args || typeof args !== 'object') return false;
        const r = recipe(b.recipe)!;
        const { quality, ruined } = args as Record<string, unknown>;
        // Only the burner's batch can boil over.
        if (ruined === true && r.game === 'heat') {
          state.batch = null;
          ctx.event('lab.ruined', undefined, 'warn');
          return true;
        }
        if (typeof quality !== 'number' || !Number.isFinite(quality)) return false;
        // Too quick to have played it: not believed (the batch stays, to be played).
        if (ctx.now - b.startedAt < r.minPlay) return false;
        const q = Math.min(1, Math.max(0, quality));
        state.batch = { ...b, quality: q, readyAt: ctx.now + r.rest };
        ctx.event(`lab.resting.${r.id}`, { quality: Math.round(q * 100) });
        return true;
      }
      case 'abandon': {
        if (!playing(state.batch)) return false;
        state.batch = null;
        ctx.event('lab.abandoned', undefined, 'warn');
        return true;
      }
      case 'collect': {
        const b = state.batch;
        if (!b || playing(b)) return false;
        if (ctx.now < (b.readyAt ?? 0)) {
          ctx.event('lab.notYet');
          return false;
        }
        const r = recipe(b.recipe)!;
        const unit = addUnit(ctx.me, { product: r.product, quality: b.quality ?? 0, grams: r.grams });
        if (!unit) {
          ctx.event('lab.full', undefined, 'warn');
          return false;
        }
        state.batch = null;
        state.made++;
        ctx.event('lab.collected', { grams: unit.grams, quality: Math.round(unit.quality * 100) });
        return true;
      }
    }
    return false;
  },

  tick(ctx, state) {
    // A batch nobody finished playing (the page went away) spoils.
    if (playing(state.batch) && ctx.now - state.batch.startedAt > LAB_ABANDON) {
      state.batch = null;
      return true;
    }
    return false;
  },
};
