// A floor's look: the normal office, or the underground bunker (same layout, same desks and
// games, only the walls, furniture and light change). Per floor, shared by everyone on it; the
// server keeps it in that floor's .agent-office/floorstyle.json (server/floorstyle.ts).

export type FloorStyle = 'office' | 'bunker';

export const FLOOR_STYLES: readonly FloorStyle[] = ['office', 'bunker'];

export const FLOOR_STYLE_DEFAULT: FloorStyle = 'office';

export function isFloorStyle(v: unknown): v is FloorStyle {
  return typeof v === 'string' && (FLOOR_STYLES as readonly string[]).includes(v);
}
