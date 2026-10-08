// The cartel: the panel at its phone on the bunker's east wall (E there), and its app on the PC (see
// pc.ts). A stub from the bunker's foundation (#118), filled in by #124: for now just its window and an
// empty app.
import { t } from '../../i18n';
import { h } from '../dom';
import { stationWindow, type BunkerHooks, type PcApp, type StationWindow } from './panel';

export function openCartel(_hooks: BunkerHooks): StationWindow {
  return stationWindow({ station: 'cartel', title: t('bunker.cartel.title') });
}

/** The cartel's app on the PC. */
export const cartelApp: PcApp = {
  id: 'cartel',
  icon: '🤝',
  title: () => t('bunker.cartel.app'),
  mount(host) {
    host.replaceChildren(h('h3.bunker-app-title', {}, t('bunker.cartel.app')));
  },
};
