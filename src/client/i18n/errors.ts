import pages from './pages';
import { t, type Key } from './index';

/** The server's sign-in errors as patterns: its English word for word, with `{name}` matching whatever it said there. */
const ERRORS = Object.entries(pages.en)
  .filter(([key]) => key.startsWith('err'))
  .map(([key, en]) => {
    const names: string[] = [];
    const parts = (en as string).split(/\{(\w+)\}/).map((part, i) => (i % 2 ? (names.push(part), '(.+)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return { key: `pages.${key}` as Key, re: new RegExp(`^${parts.join('')}$`), names };
  });

/** What the server said went wrong, in your language when it's one the pages know, else just as it came; `fallback` when it said nothing. */
export function serverError(text: unknown, fallback: Key): string {
  if (typeof text !== 'string' || !text) return t(fallback);
  for (const { key, re, names } of ERRORS) {
    const m = re.exec(text);
    if (m) return t(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return text;
}
