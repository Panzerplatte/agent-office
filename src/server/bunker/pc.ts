// The bunker's pc feature on the server (see shared/bunker/pc.ts): the supplier's shop. Buying takes
// the chips through the ledger ("bunker:buy:<id>") and delivers straight into the inventory, or (an
// upgrade) the PC's own section; the PC also keeps the numbers its stats app shows.
import { addItem, bunkerBuyReason, countItem, MAX_STACK } from '../../shared/bunker/index.js';
import { bunkerItem } from '../../shared/bunker/items.js';
import { buyPrice, initialPc, loadPc, pcUpgrade, stashRoom, suppliesHeld, upgradeLevel, upgradePrice, type PcState } from '../../shared/bunker/pc.js';
import type { BunkerCtx, BunkerFeatureHandler } from './feature.js';

/** Notes a purchase in the PC's stats. */
function noteBuy(state: PcState, id: string, n: number, chips: number) {
  state.spent += chips;
  state.bought[id] = (Object.hasOwn(state.bought, id) ? state.bought[id] : 0) + n;
}

/** Buys `n` of the item `args.item` (args: { item, n }). */
function buy(ctx: BunkerCtx, state: PcState, args: unknown): boolean {
  const { item: id, n } = (args && typeof args === 'object' ? args : {}) as { item?: unknown; n?: unknown };
  const item = bunkerItem(id);
  const count = typeof n === 'number' ? n : NaN;
  const price = buyPrice(item, count);
  if (!item || price === null) return false;
  const inv = ctx.me.inventory;
  if (suppliesHeld(inv) + count > stashRoom(ctx.me) || countItem(inv, item.id) + count > MAX_STACK) {
    ctx.event('pc.full', { room: stashRoom(ctx.me) }, 'warn');
    return false;
  }
  if (!ctx.spend(price, bunkerBuyReason(item.id))) {
    ctx.event('pc.broke', { chips: price }, 'warn');
    return false;
  }
  addItem(inv, item.id, count);
  noteBuy(state, item.id, count, price);
  ctx.event('pc.delivered', { icon: item.icon, n: count });
  return true;
}

/** Buys the next level of the upgrade `args.id` (args: { id }). */
function upgrade(ctx: BunkerCtx, state: PcState, args: unknown): boolean {
  const up = pcUpgrade(((args && typeof args === 'object' ? args : {}) as { id?: unknown }).id);
  if (!up) return false;
  const level = upgradeLevel(ctx.me, up.id);
  const price = upgradePrice(up, level);
  if (price === null) {
    ctx.event('pc.maxed', { icon: up.icon }, 'warn');
    return false;
  }
  if (!ctx.spend(price, bunkerBuyReason(up.id))) {
    ctx.event('pc.broke', { chips: price }, 'warn');
    return false;
  }
  state.upgrades[up.id] = level + 1;
  noteBuy(state, up.id, 1, price);
  ctx.event('pc.upgraded', { icon: up.icon, level: level + 1 });
  return true;
}

export const pc: BunkerFeatureHandler<PcState> = {
  initial: initialPc,
  load: loadPc,
  act(ctx, state, action, args) {
    if (action === 'buy') return buy(ctx, state, args);
    if (action === 'upgrade') return upgrade(ctx, state, args);
    return false;
  },
  tick: () => false,
};
