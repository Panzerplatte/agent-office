// The customers: the panel at the slot in the bunker's metal door (E there), and their app on the PC
// (see pc.ts). A stub from the bunker's foundation (#118), filled in by #123: for now just its window
// and an empty app.
import { t } from '../../i18n';
import { h } from '../dom';
import { stationWindow, type BunkerHooks, type PcApp, type StationWindow } from './panel';

export function openCustomers(_hooks: BunkerHooks): StationWindow {
  return stationWindow({ station: 'customers', title: t('bunker.customers.title') });
}

/** The customers' app on the PC. */
export const customersApp: PcApp = {
  id: 'customers',
  icon: '👥',
  title: () => t('bunker.customers.app'),
  mount(host) {
    host.replaceChildren(h('h3.bunker-app-title', {}, `👥 ${t('bunker.customers.app')}`));
  },
};
