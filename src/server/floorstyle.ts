import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FLOOR_STYLE_DEFAULT, isFloorStyle, type FloorStyle } from '../shared/floorstyle.js';

interface Saved {
  style: FloorStyle;
  by?: string;
  at?: number;
}

/**
 * One floor's look (the office, or the bunker), switched from the floor menu or ⚙️ Settings by
 * anyone on it and kept in .agent-office/floorstyle.json. Everyone on the floor sees the same one.
 */
export class FloorStyles {
  private s: Saved = { style: FLOOR_STYLE_DEFAULT };
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'floorstyle.json');
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      if (isFloorStyle(s.style)) this.s = { style: s.style, ...(typeof s.by === 'string' ? { by: s.by } : {}), ...(typeof s.at === 'number' ? { at: s.at } : {}) };
    } catch {
      // never switched: the office
    }
  }

  get style(): FloorStyle {
    return this.s.style;
  }

  /** Says whether it changed. */
  set(style: FloorStyle, by: string): boolean {
    if (style === this.s.style) return false;
    this.s = { style, by, at: Date.now() };
    try {
      writeFileSync(this.file, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
    return true;
  }
}
