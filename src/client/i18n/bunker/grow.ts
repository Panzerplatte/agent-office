import { strings } from '../table';

/**
 * The bunker's grow feature (ui/bunker/grow.ts, world/drugbunker/grow.ts), keyed `grow.<what>` (so
 * `t('bunker.grow.title')`). Its server's toasts (bunker.event) are keys here too, and a
 * `grow.help` (if there is one) goes in the bunker's help. Filled in by #119.
 */
export default strings(
  {
    'grow.title': '🌿 Grow area',
    'grow.mark': 'GROW',
  },
  {
    'grow.title': '🌿 Anbaufläche',
    'grow.mark': 'ANBAU',
  },
);
