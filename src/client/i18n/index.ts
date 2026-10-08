import core from './core';
import menus from './menus';
import windows from './windows';
import boards from './boards';
import notices from './notices';
import main from './main';
import data from './data';
import world from './world';
import pages from './pages';
import bunker from './bunker';
import type { Table } from './table';

/**
 * The office's interface in your language. Every text you see comes from `t('<table>.<key>')`,
 * and each table (core, menus, windows, boards, notices, main, data, world, pages, bunker) keeps its English and German side by
 * side, so a German one missing a key doesn't typecheck. Your pick is yours alone, kept in this
 * browser, and the page reloads to switch, since windows and panels are built with their text.
 */
const TABLES = { core, menus, windows, boards, notices, main, data, world, pages, bunker };

export type Lang = 'en' | 'de';

/** The languages there are, each named in itself for the picker. */
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
];

type Tables = typeof TABLES;
/** Every text there is, as `<table>.<key>`. */
export type Key = { [T in keyof Tables]: `${T & string}.${keyof Tables[T]['en'] & string}` }[keyof Tables];
/** What fills a text's `{name}` placeholders, or what a text that's a function (for plurals) is given. */
export type Vars = Record<string, string | number>;

const LANG_KEY = 'agent-office.lang';

/** The language you picked, or else the first of the browser's languages there is (`de-AT` counts as `de`), or else English. */
export function pickLang(saved: string | null, asked: readonly string[]): Lang {
  const known = (id: string | undefined) => LANGS.find((l) => l.id === id)?.id;
  return known(saved ?? undefined) ?? asked.map((tag) => known(tag.toLowerCase().split('-')[0])).find(Boolean) ?? 'en';
}

function startLang(): Lang {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LANG_KEY);
  } catch {
    // storage blocked
  }
  return pickLang(saved, typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]));
}

let current: Lang = startLang();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function lang(): Lang {
  return current;
}

/** The locale for dates and numbers in the current language (Intl, toLocaleString). */
export function locale(): string {
  return current === 'de' ? 'de-DE' : 'en-US';
}

/** Picks a language and remembers it in this browser. What's already on screen keeps its text until the page reloads. */
export function setLang(l: Lang) {
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    // storage blocked
  }
}

/** `text` with each `{name}` in it replaced by `vars.name`. A placeholder with nothing to fill it stays as it is. */
export function format(text: string, vars: Vars = {}): string {
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all));
}

/** The text for `key` in the current language, filled in with `vars`. */
export function t(key: Key, vars: Vars = {}): string {
  const dot = key.indexOf('.');
  const table = TABLES[key.slice(0, dot) as keyof Tables] as { en: Table; de: Table } | undefined;
  const name = key.slice(dot + 1);
  const text = table?.[current][name] ?? table?.en[name];
  if (text === undefined) return key;
  return typeof text === 'function' ? text(vars) : format(text, vars);
}

/** A toast the server sent, in your language: by its key when this page knows it, else the English it came with. */
export function noticeText(n: { text: string; key?: string; params?: Vars }): string {
  return n.key && Object.hasOwn(TABLES.notices.en, n.key) ? t(`notices.${n.key}` as Key, n.params) : n.text;
}

/** Every table, for the tests that check each language has every text. */
export const tables: Record<string, { en: Table; de: Table }> = TABLES;
