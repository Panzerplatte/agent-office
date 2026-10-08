// The bunker's panels (see shared/bunker/index.ts): which one E at each station opens, what the hint
// calls it, the PC's apps, and the bunker's part of the help. Each feature's panel is its own file
// next to this one; this only hands them what they need.
import { BUNKER_FEATURES, type BunkerStationId } from '../../../shared/bunker/index';
import { t, type Key } from '../../i18n';
import { cartelApp, openCartel } from './cartel';
import { customersApp, openCustomers } from './customers';
import { openGrow } from './grow';
import { openLab } from './lab';
import { openPack } from './pack';
import { openPc, shopApp } from './pc';
import type { BunkerHooks, PcApp, StationWindow } from './panel';
import { openStash } from './stash';

export type { BunkerHooks, PcApp } from './panel';

/** The PC's apps, in the order its screen lists them: the supplier's shop, the customers, the cartel. */
export const PC_APPS: readonly PcApp[] = [shopApp, customersApp, cartelApp];

/** Opens the panel at `station`. */
export function openStation(station: BunkerStationId, hooks: BunkerHooks): StationWindow {
  switch (station) {
    case 'grow':
      return openGrow(hooks);
    case 'lab':
      return openLab(hooks);
    case 'pack':
      return openPack(hooks);
    case 'pc':
      return openPc(hooks, PC_APPS);
    case 'customers':
      return openCustomers(hooks);
    case 'cartel':
      return openCartel(hooks);
    case 'stash':
      return openStash();
  }
}

/** What a station's called (its window's title, and the hint's). */
export function stationTitle(station: BunkerStationId): string {
  return t(station === 'stash' ? 'bunker.common.stash.title' : (`bunker.${station}.title` as Key));
}

/** What's stenciled on the floor at a station's spot. */
export function stationMark(station: BunkerStationId): string {
  return t(station === 'stash' ? 'bunker.common.stash.mark' : (`bunker.${station}.mark` as Key));
}

/** The bunker's part of the help: what it is, then whatever each feature adds (its `<feature>.help`, if it has one). */
export function bunkerHelp(): string {
  const parts = [t('bunker.common.help')];
  for (const f of BUNKER_FEATURES) {
    const key = `bunker.${f}.help` as Key;
    const text = t(key);
    if (text !== key) parts.push(text);
  }
  return parts.join(' ');
}
