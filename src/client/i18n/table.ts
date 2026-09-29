import type { Vars } from './index';

/** One text: plain with `{name}` placeholders, or a function of its vars where the wording changes (plurals). */
export type Text = string | ((vars: Vars) => string);
export type Table = Record<string, Text>;

/**
 * A table of texts: the English, and the German with exactly the same keys. Keys say what the text
 * is for, not what it says, so rewording the English doesn't rename them, e.g.
 *
 *   strings(
 *     { settings: '⚙️ Settings', workersHere: (v) => (v.n === 1 ? '1 worker here' : `${v.n} workers here`) },
 *     { settings: '⚙️ Einstellungen', workersHere: (v) => (v.n === 1 ? '1 Worker hier' : `${v.n} Worker hier`) },
 *   );
 */
export function strings<const E extends Table>(en: E, de: { [K in keyof E]: Text }): { en: E; de: Table } {
  return { en, de };
}
