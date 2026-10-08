import { strings } from '../table';

/**
 * The bunker's pc feature (ui/bunker/pc.ts, world/drugbunker/pc.ts), keyed `pc.<what>` (so
 * `t('bunker.pc.title')`). Its server's toasts (bunker.event) are keys here too, and a
 * `pc.help` (if there is one) goes in the bunker's help. Filled in by #122.
 */
export default strings(
  {
    'pc.title': '🖥️ PC',
    'pc.mark': 'PC',
    'pc.apps': 'Apps',
    'pc.shop': 'Supplier',
    'pc.back': '← Apps',
  },
  {
    'pc.title': '🖥️ PC',
    'pc.mark': 'PC',
    'pc.apps': 'Apps',
    'pc.shop': 'Lieferant',
    'pc.back': '← Apps',
  },
);
