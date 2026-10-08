// The bunker's grow feature on the server (see shared/bunker/grow.ts). A stub from the foundation (#118),
// filled in by #119: it does nothing yet.
import type { GrowState } from '../../shared/bunker/grow.js';
import type { BunkerFeatureHandler } from './feature.js';

export const grow: BunkerFeatureHandler<GrowState> = {
  initial: () => ({}),
  load: () => ({}),
  act: () => false,
  tick: () => false,
};
