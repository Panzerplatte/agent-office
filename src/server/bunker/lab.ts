// The bunker's lab feature on the server (see shared/bunker/lab.ts). A stub from the foundation (#118),
// filled in by #120: it does nothing yet.
import type { LabState } from '../../shared/bunker/lab.js';
import type { BunkerFeatureHandler } from './feature.js';

export const lab: BunkerFeatureHandler<LabState> = {
  initial: () => ({}),
  load: () => ({}),
  act: () => false,
  tick: () => false,
};
