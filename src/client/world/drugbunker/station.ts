// What a station's builder (world/drugbunker/<feature>.ts) gives the bunker's room (world/drugbunker/index.ts).
import type * as THREE from 'three';
import type { BunkerPerson, StationSpot } from '../../../shared/bunker/index';
import type { Collider } from '../office';

/**
 * A station's model in the bunker. Its group is already at its spot, turned its way: build in its own
 * frame (x along its front, +z out of its front toward where you stand, the floor at y 0) and inside
 * its spot (w × d). The room has marked the spot on the floor and does the E (see ui/bunker/).
 */
export interface StationView {
  group: THREE.Group;
  /** What of it you can't walk through, in the room's coordinates (stationBox gives the whole spot). */
  colliders?: Collider[];
  /** Every frame while you're down there: `t` seconds on the clock, `dt` since the last frame, your bunker as the office last said (null: not yet). */
  update?(t: number, dt: number, mine: BunkerPerson | null): void;
}

export type StationBuilder = (spot: StationSpot) => StationView;
