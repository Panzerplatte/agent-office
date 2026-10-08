// The bunker's pack feature on the server (see shared/bunker/pack.ts). A stub from the foundation (#118),
// filled in by #121: it does nothing yet.
import type { PackState } from '../../shared/bunker/pack.js';
import type { BunkerFeatureHandler } from './feature.js';

export const pack: BunkerFeatureHandler<PackState> = {
  initial: () => ({}),
  load: () => ({}),
  act: () => false,
  tick: () => false,
};
