import { strings } from '../table';

/** ui/search.ts */
export default strings(
  {
    'search.title': 'Search',
    'search.heading': '🔎 Search',
    'search.placeholder': 'Search the chat and every terminal…',
    'search.label': 'Search the chat and every terminal',
    'search.searching': 'Searching…',
    'search.failed': "Couldn't search: {error}",
    'search.intro': "Finds words in the office chat and in every worker's terminal, including what they showed before the office restarted.",
    'search.nothing': 'Nothing in the chat or any terminal matches “{q}”.',
    'search.found': (v) =>
      `${v.n === 1 ? '1 line' : `${v.n} lines`}, newest first${v.more ? ' (only the newest are shown; add words to narrow it down)' : ''}.`,
    'search.chat': '💬 Chat',
    'search.openAtLine': 'Open the terminal at this line',
  },
  {
    'search.title': 'Suche',
    'search.heading': '🔎 Suche',
    'search.placeholder': 'Chat und alle Terminals durchsuchen…',
    'search.label': 'Chat und alle Terminals durchsuchen',
    'search.searching': 'Suche…',
    'search.failed': 'Suche fehlgeschlagen: {error}',
    'search.intro': 'Findet Wörter im Büro-Chat und in den Terminals aller Worker, auch was sie vor dem letzten Neustart des Büros gezeigt haben.',
    'search.nothing': 'Nichts im Chat oder in einem Terminal passt zu „{q}“.',
    'search.found': (v) =>
      `${v.n === 1 ? '1 Zeile' : `${v.n} Zeilen`}, neueste zuerst${v.more ? ' (nur die neuesten werden gezeigt; mit mehr Wörtern grenzt du es ein)' : ''}.`,
    'search.chat': '💬 Chat',
    'search.openAtLine': 'Terminal an dieser Zeile öffnen',
  },
);
