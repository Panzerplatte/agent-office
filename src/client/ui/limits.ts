import type { PlanWindow } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { panelHide } from './menu';
import { locale, t } from '../i18n';

/** Numbers older than this say when they were read. */
const STALE_MS = 10 * 60_000;

/** "in 12m", "in 2h 5m", or "Tue 5:00 AM" once it is more than a day out. */
export function fmtReset(at: number, now = Date.now()): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 0) return t('windows.limits.resetNow');
  if (mins < 60) return t('windows.limits.resetMins', { m: mins });
  if (mins < 24 * 60) return t('windows.limits.resetHours', { h: Math.floor(mins / 60), m: mins % 60 });
  return new Date(at).toLocaleString(locale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** The server names the windows in English ("5h session", "Week"); the ones we know read in your language. */
function labelOf(label: string): string {
  return label === 'Week' ? t('windows.limits.week') : label === '5h session' ? t('windows.limits.session') : label;
}

const level = (pct: number) => (pct >= 90 ? 'over' : pct >= 75 ? 'near' : '');

function windowRow(w: PlanWindow, now: number): HTMLElement[] {
  const pct = Math.round(w.pct);
  const when = w.resetsAt ? new Date(w.resetsAt).toLocaleString(locale(), { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
  const scope = w.label === 'Week' ? t('windows.limits.allModels') : '';
  const label = labelOf(w.label);
  const title = t('windows.limits.used', { label, scope, pct }) + (when ? `\n${t('windows.limits.startsOver', { when })}` : '');
  return [
    h(
      'div.row',
      { title },
      h('span.what', {}, label),
      h('b', { class: level(w.pct) }, `${pct}%`),
      w.resetsAt ? h('span.reset', {}, t('windows.limits.resets', { when: fmtReset(w.resetsAt, now) })) : null,
    ),
    h('div.meter', { class: level(w.pct), title, role: 'progressbar', 'aria-label': label, 'aria-valuenow': pct }, h('div.fill', { style: `width:${w.pct}%` })),
  ];
}

/** The Claude plan's 5-hour session and weekly limits, under the workers. Click to read them again. */
export function renderLimits() {
  const s = store.limits;
  const el = $('limits');
  el.classList.toggle('hidden', !s.windows.length);
  if (!s.windows.length) return;
  const now = Date.now();
  const plan = s.plan ? s.plan.charAt(0).toUpperCase() + s.plan.slice(1) : '';
  el.replaceChildren(h('h3', {}, t('windows.limits.heading'), plan ? h('span.plan', {}, plan) : null, panelHide('limits')), ...s.windows.flatMap((w) => windowRow(w, now)));
  if (now - s.at > STALE_MS) el.append(h('div.row.muted', {}, t('windows.limits.asOf', { time: new Date(s.at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) })));
}
