import { strings } from '../table';

/**
 * The bunker's pack feature (ui/bunker/pack.ts, world/drugbunker/pack.ts), keyed `pack.<what>` (so
 * `t('bunker.pack.title')`). Its server's toasts (bunker.event) are keys here too, and a
 * `pack.help` (if there is one) goes in the bunker's help. Filled in by #121.
 */
export default strings(
  {
    'pack.title': '📦 Packing table',
    'pack.mark': 'PACKING',
  },
  {
    'pack.title': '📦 Packtisch',
    'pack.mark': 'PACKEN',
  },
);
