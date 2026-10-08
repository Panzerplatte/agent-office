// The bunker's cartel feature on the server (see shared/bunker/cartel.ts). A stub from the foundation (#118),
// filled in by #124: it does nothing yet.
import type { CartelState } from '../../shared/bunker/cartel.js';
import type { BunkerFeatureHandler } from './feature.js';

export const cartel: BunkerFeatureHandler<CartelState> = {
  initial: () => ({}),
  load: () => ({}),
  act: () => false,
  tick: () => false,
};
