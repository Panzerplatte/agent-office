// The panel at the grow area (E at its spot in the bunker). A stub from the bunker's foundation (#118),
// filled in by #119: for now just its window.
import { t } from '../../i18n';
import { stationWindow, type BunkerHooks, type StationWindow } from './panel';

export function openGrow(_hooks: BunkerHooks): StationWindow {
  return stationWindow({ station: 'grow', title: t('bunker.grow.title') });
}
