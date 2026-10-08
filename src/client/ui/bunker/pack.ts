// The panel at the packing table (E at its spot in the bunker). A stub from the bunker's foundation (#118),
// filled in by #121: for now just its window.
import { t } from '../../i18n';
import { stationWindow, type BunkerHooks, type StationWindow } from './panel';

export function openPack(_hooks: BunkerHooks): StationWindow {
  return stationWindow({ station: 'pack', title: t('bunker.pack.title') });
}
