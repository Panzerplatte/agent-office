import { strings } from '../table';

/**
 * The bunker's lab feature (ui/bunker/lab.ts, world/drugbunker/lab.ts), keyed `lab.<what>` (so
 * `t('bunker.lab.title')`). Its server's toasts (bunker.event) are keys here too, and a
 * `lab.help` (if there is one) goes in the bunker's help. Filled in by #120.
 */
export default strings(
  {
    'lab.title': '⚗️ Lab bench',
    'lab.mark': 'LAB',
  },
  {
    'lab.title': '⚗️ Labortisch',
    'lab.mark': 'LABOR',
  },
);
