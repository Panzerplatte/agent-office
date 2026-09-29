import { strings } from '../table';

/** What every window shares: the ✕ and how long ago something was (timeAgo). */
export default strings(
  {
    'common.close': 'Close',
    'common.closeEsc': 'Close (Esc)',
    'common.justNow': 'just now',
    'common.minutesAgo': '{n}m ago',
    'common.hoursAgo': '{n}h ago',
    'common.daysAgo': (v) => `${v.n}d ago`,
  },
  {
    'common.close': 'Schließen',
    'common.closeEsc': 'Schließen (Esc)',
    'common.justNow': 'gerade eben',
    'common.minutesAgo': 'vor {n} Min.',
    'common.hoursAgo': 'vor {n} Std.',
    'common.daysAgo': (v) => (v.n === 1 ? 'vor 1 Tag' : `vor ${v.n} Tagen`),
  },
);
