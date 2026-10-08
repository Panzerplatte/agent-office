// The panel at the lab bench (E at its spot in the bunker). A stub from the bunker's foundation (#118),
// filled in by #120: for now just its window.
import { t } from '../../i18n';
import { stationWindow, type BunkerHooks, type StationWindow } from './panel';

export function openLab(_hooks: BunkerHooks): StationWindow {
  return stationWindow({ station: 'lab', title: t('bunker.lab.title') });
}
