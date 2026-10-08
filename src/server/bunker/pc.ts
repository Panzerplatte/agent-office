// The bunker's pc feature on the server (see shared/bunker/pc.ts). A stub from the foundation (#118),
// filled in by #122: it does nothing yet.
import type { PcState } from '../../shared/bunker/pc.js';
import type { BunkerFeatureHandler } from './feature.js';

export const pc: BunkerFeatureHandler<PcState> = {
  initial: () => ({}),
  load: () => ({}),
  act: () => false,
  tick: () => false,
};
