import { strings } from '../table';

/**
 * The bunker's customers feature (ui/bunker/customers.ts, world/drugbunker/customers.ts), keyed `customers.<what>` (so
 * `t('bunker.customers.title')`). Its server's toasts (bunker.event) are keys here too, and a
 * `customers.help` (if there is one) goes in the bunker's help. Filled in by #123.
 */
export default strings(
  {
    'customers.title': '🚪 Customers',
    'customers.mark': 'CUSTOMERS',
    'customers.app': '👥 Customers',
  },
  {
    'customers.title': '🚪 Kundschaft',
    'customers.mark': 'KUNDEN',
    'customers.app': '👥 Kundschaft',
  },
);
