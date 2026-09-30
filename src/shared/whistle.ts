// The referee's whistle (Trillerpfeife): L blows it anywhere, and everyone on your floor hears it.
// Hold L for one long trill, tap it for a short tweet. Shared by the server (who may blow it now,
// and who hears it) and the page (which keeps the same limit, so a whistle you hear yourself blow
// is one everyone else hears too).

/** How long between two whistles, per person, on the page (ms). */
export const WHISTLE_EVERY = 1200;
/** The server's limit: a bit more lenient, so two whistles bunched up on the way still both get through. */
export const WHISTLE_SERVER_EVERY = 1000;
/** The longest a held whistle trills (s), in case the key never comes up. */
export const WHISTLE_MAX_SECS = 3;

/** At most one whistle every `every` ms. */
export class WhistleGate {
  private at = -Infinity;

  constructor(private every = WHISTLE_EVERY) {}

  /** True, and it counts, if it's been long enough since the last one at `now` (ms). */
  take(now: number): boolean {
    if (now - this.at < this.every) return false;
    this.at = now;
    return true;
  }
}

/** Who hears `by` blow the whistle: everyone else on their floor (the roof counts), not them (they already did). */
export function whistleHearers<T extends { id: string }>(people: Iterable<T>, by: T, floorOf: (p: T) => string | undefined): T[] {
  const floor = floorOf(by);
  if (!floor) return [];
  return [...people].filter((p) => p.id !== by.id && floorOf(p) === floor);
}
