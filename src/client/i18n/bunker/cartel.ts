import { strings } from '../table';

/**
 * The bunker's cartel feature (ui/bunker/cartel.ts, world/drugbunker/cartel.ts), keyed `cartel.<what>` (so
 * `t('bunker.cartel.title')`). Its server's toasts (bunker.event) are keys here too, and a
 * `cartel.help` (if there is one) goes in the bunker's help. Filled in by #124.
 */
export default strings(
  {
    'cartel.title': '☎️ Cartel',
    'cartel.mark': 'CARTEL',
    'cartel.app': '🤝 Cartel',
  },
  {
    'cartel.title': '☎️ Kartell',
    'cartel.mark': 'KARTELL',
    'cartel.app': '🤝 Kartell',
  },
);
