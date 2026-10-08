// The bunker's grow feature on the server (see shared/bunker/grow.ts): filling pots with soil,
// planting, watering, spraying, hanging lamps, harvesting into the stash, and the plants growing on
// the bunker's clock whether anyone's down there or not. Only while the office runs: time it was
// off doesn't count, so nothing dies over a weekend with the office shut down.
import { addItem, addUnit, countItem, takeItem } from '../../shared/bunker/index.js';
import { LIGHTS, MAX_POTS, SOILS, growStep, harvestOf, initialGrow, loadGrow, strainOf, type GrowNews, type GrowState, type Pot } from '../../shared/bunker/grow.js';
import type { BunkerCtx, BunkerFeatureHandler } from './feature.js';

/** A gap longer than this since the plants were last brought up to date (ms) is the office having been off: it doesn't count. */
const GAP = 30_000;
/** How often the plants are sent and saved while they grow, even with nothing to tell (ms): so a restart loses little and the pages stay in step. */
const SYNC_EVERY = 60_000;

/** Which toasts a step's news make (a plant getting thirsty only shows on its pot). */
const TOASTS: Partial<Record<GrowNews, { key: string; level: 'info' | 'warn' }>> = {
  ready: { key: 'grow.ready', level: 'info' },
  dry: { key: 'grow.dry', level: 'warn' },
  pests: { key: 'grow.pests', level: 'warn' },
  died: { key: 'grow.died', level: 'warn' },
};

/** Brings `state`'s plants up to `ctx.now`. Whether anything about them changed worth telling their page (and the toasts sent). */
function catchUp(ctx: BunkerCtx, state: GrowState, roll?: () => number): boolean {
  const gap = ctx.now - state.at;
  const secs = state.at > 0 && gap > 0 && gap <= GAP ? gap / 1000 : 0;
  const before = state.at;
  state.at = ctx.now;
  let changed = false;
  state.pots.forEach((pot, i) => {
    if (!pot.plant || pot.plant.dead || pot.plant.growth >= 3) return;
    const stage = Math.floor(pot.plant.growth);
    const news = growStep(pot, secs, roll);
    if (news.length || Math.floor(pot.plant.growth) !== stage) changed = true;
    for (const n of news) {
      const toast = TOASTS[n];
      if (toast) ctx.event(toast.key, { pot: i + 1 }, toast.level);
    }
    if (Math.floor(before / SYNC_EVERY) !== Math.floor(ctx.now / SYNC_EVERY)) changed = true;
  });
  return changed;
}

/** The pot `args.pot` (0-based) names, if there's one. */
function potOf(state: GrowState, args: unknown): Pot | undefined {
  const i = args && typeof args === 'object' ? (args as { pot?: unknown }).pot : undefined;
  return typeof i === 'number' && Number.isSafeInteger(i) && i >= 0 && i < state.pots.length ? state.pots[i] : undefined;
}

/** The item `args.item` names, as a string (whether it's one is up to the action). */
function itemOf(args: unknown): string | undefined {
  const item = args && typeof args === 'object' ? (args as { item?: unknown }).item : undefined;
  return typeof item === 'string' ? item : undefined;
}

/** Does `action` to `state` (already brought up to date). Whether it did anything. */
function act(ctx: BunkerCtx, state: GrowState, action: string, args: unknown): boolean {
  const inv = ctx.me.inventory;
  if (action === 'addPot') {
    if (state.pots.length >= MAX_POTS || !takeItem(inv, 'pot', 1)) return false;
    state.pots.push({});
    return true;
  }
  const pot = potOf(state, args);
  if (!pot) return false;
  const plant = pot.plant;
  const item = itemOf(args);
  switch (action) {
    case 'soil':
      if (pot.soil || !item || !Object.hasOwn(SOILS, item) || !takeItem(inv, item, 1)) return false;
      pot.soil = item;
      return true;
    case 'plant':
      if (!pot.soil || plant || !strainOf(item) || !takeItem(inv, item!, 1)) return false;
      pot.plant = { seed: item!, growth: 0, water: 0.5, care: SOILS[pot.soil], dry: 0 };
      return true;
    case 'water':
      if (!plant || plant.dead || plant.growth >= 3 || plant.water >= 0.95) return false;
      plant.water = 1;
      plant.dry = 0;
      return true;
    case 'spray':
      if (!plant?.pests) return false;
      delete plant.pests;
      return true;
    case 'lamp': {
      if (!item || item === 'none' || !Object.hasOwn(LIGHTS, item) || pot.lamp === item || countItem(inv, item) < 1) return false;
      if (pot.lamp && !addItem(inv, pot.lamp, 1)) return false;
      takeItem(inv, item, 1);
      pot.lamp = item;
      return true;
    }
    case 'unlamp':
      if (!pot.lamp || !addItem(inv, pot.lamp, 1)) return false;
      delete pot.lamp;
      return true;
    case 'harvest': {
      const crop = harvestOf(pot);
      if (!crop) return false;
      if (!addUnit(ctx.me, crop)) {
        ctx.event('grow.stashFull', undefined, 'warn');
        return false;
      }
      // The soil's spent; the lamp stays.
      delete pot.plant;
      delete pot.soil;
      ctx.event('grow.harvested', { grams: crop.grams, quality: Math.round(crop.quality * 100) });
      return true;
    }
    case 'clear':
      if (!plant?.dead) return false;
      delete pot.plant;
      delete pot.soil;
      return true;
  }
  return false;
}

export const grow: BunkerFeatureHandler<GrowState> = {
  initial: initialGrow,
  load: loadGrow,
  act(ctx, state, action, args) {
    const grew = catchUp(ctx, state);
    return act(ctx, state, action, args) || grew;
  },
  tick: (ctx, state) => catchUp(ctx, state, Math.random),
};
