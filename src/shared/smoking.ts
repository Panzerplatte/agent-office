// Where you can smoke: out on an office floor's balcony, by its ashtray (ASHTRAY), and in the casino's
// lounge, by the ashtray down there (CASINO_ASHTRAY). Nowhere else, and not up on the roof. Shared by
// the client (which puts your cigarette out when you walk off) and the server (which only lets you
// light up on a floor that has an ashtray).
import { CASINO, CASINO_ASHTRAY, CASINO_LOUNGE } from './casino.js';
import { BALCONY } from './layout.js';
import { ROOF } from './rooftop.js';

/** Whether the floor you're on has an ashtray: every office floor (its balcony) and the casino, but not the roof. */
export function hasAshtray(floor: string | null | undefined): boolean {
  return floor !== ROOF;
}

/** Out on the balcony, with a little slack at the door. */
export function onBalcony(p: { x: number; y: number; z: number }): boolean {
  return p.y > -0.5 && p.y < 2 && p.x > BALCONY.minX - 0.5 && p.x < BALCONY.maxX + 0.5 && p.z > BALCONY.minZ - 0.8 && p.z < BALCONY.maxZ + 0.5;
}

/** In the casino's lounge: round its low table and sofas, or by its ashtray. */
export function inCasinoLounge(p: { x: number; y: number; z: number }): boolean {
  if (p.y < -0.5 || p.y > 2) return false;
  const A = CASINO_ASHTRAY;
  return Math.hypot(p.x - CASINO_LOUNGE.x, p.z - CASINO_LOUNGE.z) < A.area || Math.hypot(p.x - A.x, p.z - A.z) < A.reach;
}

/** Whether you can smoke standing at `p` on `floor`: the casino's lounge down there, the balcony on an office floor. */
export function canSmokeAt(floor: string | null | undefined, p: { x: number; y: number; z: number }): boolean {
  if (!hasAshtray(floor)) return false;
  return floor === CASINO ? inCasinoLounge(p) : onBalcony(p);
}
