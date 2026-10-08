// The bunker's customers feature on the server (see shared/bunker/customers.ts). A stub from the foundation (#118),
// filled in by #123: it does nothing yet.
import type { CustomersState } from '../../shared/bunker/customers.js';
import type { BunkerFeatureHandler } from './feature.js';

export const customers: BunkerFeatureHandler<CustomersState> = {
  initial: () => ({}),
  load: () => ({}),
  act: () => false,
  tick: () => false,
};
