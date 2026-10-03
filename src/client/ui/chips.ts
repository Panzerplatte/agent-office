import type { ChipsEntry, ChipsReason } from '../../shared/chips';
import { chips } from '../chips';
import { locale, t, type Key } from '../i18n';
import { $, h, openModal, timeAgo, toast } from './dom';

/** A casino chip, drawn: a coloured disc with notches round its edge and a ring inside. */
function chipIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'chip-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<circle cx="12" cy="12" r="10.5" fill="#e63946" stroke="#2b2d42" stroke-width="2"/>' +
    '<circle cx="12" cy="12" r="10.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-dasharray="3.3 4.95" transform="rotate(-8 12 12)"/>' +
    '<circle cx="12" cy="12" r="6" fill="#fff" stroke="#2b2d42" stroke-width="1.5"/>' +
    '<circle cx="12" cy="12" r="3.6" fill="none" stroke="#e63946" stroke-width="1.4"/>';
  return svg;
}

/** Why a balance changed, in your language when the page knows the reason, else as the office said it. */
export function chipsWhy(reason: ChipsReason): string {
  const key = `main.chipsWhy_${reason.replace(/\W/g, '_')}` as Key;
  const text = t(key);
  return text === key ? reason : text;
}

/** Why a change came, with a basket's streak: "3er-Streak 🔥" (a three-pointer says so first). */
function entryWhy(e: ChipsEntry): string {
  if (!e.streak || e.streak < 2) return chipsWhy(e.reason);
  const streak = t('main.chipsStreak', { n: e.streak });
  return e.reason === 'three' ? `${chipsWhy(e.reason)}, ${streak}` : streak;
}

/** An amount with its sign, in your language's digits: "+50", "−200". */
export function signedChips(n: number): string {
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString(locale())}`;
}

/**
 * Your chips in the top bar, next to the floor's name: a chip and your balance, which counts up (or
 * down) to the new one when it changes, with the change floating off it. Clicking it shows your
 * latest changes. A change the office didn't mark quiet also comes up as a toast.
 */
export function mountChips() {
  const n = h('span.n', {}, '0');
  const el = h('button.panel.chips-hud.hidden', { type: 'button', title: t('main.chipsTitle'), 'aria-label': t('main.chipsLedger') }, chipIcon(), n);
  $('project').after(el);
  el.addEventListener('click', () => openLedger());

  let shown = 0;
  let anim = 0;
  const show = (v: number) => {
    shown = v;
    n.textContent = Math.round(v).toLocaleString(locale());
  };
  /** Counts from what's showing to `to` over a moment. */
  const countTo = (to: number) => {
    cancelAnimationFrame(anim);
    const from = shown;
    const t0 = performance.now();
    const ms = Math.min(1200, 300 + Math.abs(to - from) * 4);
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      show(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1) anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  };

  chips.onChange((state, change) => {
    el.classList.remove('hidden');
    if (!change) {
      cancelAnimationFrame(anim);
      show(state.balance);
      return;
    }
    countTo(state.balance);
    el.classList.remove('up', 'down');
    void el.offsetWidth; // so the bump plays again for a second change straight after
    el.classList.add(change.amount > 0 ? 'up' : 'down');
    const fly = h('span.chips-fly', { class: change.amount > 0 ? 'up' : 'down' }, signedChips(change.amount));
    el.append(fly);
    setTimeout(() => fly.remove(), 1400);
    if (ledgerList) ledgerList.replaceChildren(...ledgerRows());
  });
  chips.onTop(() => topList?.replaceChildren(...topRows()));
}

/** Called with each change, when it isn't quiet: "+50 Chips: Won at darts", "+15 Chips: 3er-Streak 🔥". */
export function chipsToast(change: ChipsEntry) {
  toast(t('main.chipsToast', { amount: signedChips(change.amount), why: entryWhy(change) }));
}

/** The ledger window's list, while it's open. */
let ledgerList: HTMLElement | null = null;
/** Its leaderboard, likewise. */
let topList: HTMLElement | null = null;

/** The building's biggest balances, as on the casino's board: medals for the first three, your own row marked. */
function topRows(): HTMLElement[] {
  if (!chips.top.length) return [h('li.empty', {}, t('main.chipsLedgerEmpty'))];
  return chips.top.map((r, i) =>
    h(
      'li',
      { class: r.you ? 'you' : '' },
      h('span.rank', {}, ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`),
      h('span.dot', { style: `background: ${r.color ?? '#adb5bd'}` }),
      h('span.why', {}, r.name),
      h('b.amount', {}, r.chips.toLocaleString(locale())),
    ),
  );
}

function ledgerRows(): HTMLElement[] {
  const { ledger } = chips.state;
  if (!ledger.length) return [h('li.empty', {}, t('main.chipsLedgerEmpty'))];
  return ledger.map((e) =>
    h(
      'li',
      { title: new Date(e.at).toLocaleString(locale()) },
      h('span.why', {}, entryWhy(e), h('span.when', {}, timeAgo(e.at))),
      h('b.amount', { class: e.amount > 0 ? 'up' : 'down' }, signedChips(e.amount)),
      h('span.after', {}, e.balance.toLocaleString(locale())),
    ),
  );
}

function openLedger() {
  const close = h('button.btn.close', { 'aria-label': t('menus.close') }, '✕');
  ledgerList = h('ul.chips-ledger', {}, ...ledgerRows());
  topList = h('ol.chips-ledger.chips-top', {}, ...topRows());
  const el = h(
    'div.modal.chips-window',
    { role: 'dialog', 'aria-label': t('main.chipsLedger') },
    h('header', {}, h('h2', {}, chipIcon(), ' ', t('main.chipsLedger'), ' ', h('span.chips-total', {}, chips.balance.toLocaleString(locale()))), close),
    h('div.body', {}, ledgerList, h('h3', {}, t('main.chipsTop')), topList, h('p.chips-note', {}, t('main.chipsEarnNote')), h('p.chips-note', {}, t('main.chipsNote'))),
  );
  const modal = openModal(el, { onClose: () => (ledgerList = topList = null) });
  close.addEventListener('click', () => modal.close());
}
