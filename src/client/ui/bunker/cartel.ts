// The cartel: the panel at its phone on the bunker's east wall (E there), and its app on the PC (see
// pc.ts). Both show the same: your reputation with them, and the offer on the table or the contract
// you've taken, with what you can do about it (see shared/bunker/cartel.ts for the rules). Opening it
// while the phone rings picks up.
import type { BunkerPerson } from '../../../shared/bunker/index';
import { cartelTier, fittingGrams, gramsLeft, nextTierRep, ringing, type CartelContract, type CartelState } from '../../../shared/bunker/cartel';
import { productKind } from '../../../shared/bunker/items';
import { store } from '../../state';
import { lang, locale, t, type Key } from '../../i18n';
import { h } from '../dom';
import { bunkerStyle, stationWindow, type BunkerHooks, type PcApp, type StationWindow } from './panel';

const CSS = `
.cartel-view { display: grid; gap: 12px; }
.cartel-rep { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; }
.cartel-rank { font-weight: 900; font-size: 15px; }
.cartel-rank small { margin-left: 6px; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
.cartel-next { font-size: 12px; font-weight: 800; color: var(--muted); text-align: right; }
.cartel-meter { grid-column: 1 / -1; position: relative; height: 10px; border-radius: 999px; background: rgba(0,0,0,.1); overflow: hidden; }
.cartel-meter .fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: linear-gradient(90deg, #8a6a3f, #c8a24a); transition: width .4s ease-out; }
.cartel-meter .tick { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,.7); }
.cartel-record { grid-column: 1 / -1; font-size: 12px; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
.cartel-card { display: grid; gap: 10px; padding: 12px 14px; border-radius: 12px; background: #23262a; color: #e9ecef; }
.cartel-card h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 900; }
.cartel-card h3 .when { margin-left: auto; font-size: 13px; font-weight: 800; color: #c8a24a; font-variant-numeric: tabular-nums; }
.cartel-card h3 .when.late { color: #ff8a7a; }
.cartel-want { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 900; }
.cartel-want .icon { font-size: 28px; }
.cartel-terms { display: flex; flex-wrap: wrap; gap: 6px; }
.cartel-term { padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 800; background: rgba(255,255,255,.1); font-variant-numeric: tabular-nums; }
.cartel-term.pay { background: #c8a24a; color: #1d1d1b; }
.cartel-bar { position: relative; height: 12px; border-radius: 999px; background: rgba(255,255,255,.12); overflow: hidden; }
.cartel-bar .fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: linear-gradient(90deg, #6fbf73, #2e7d32); transition: width .4s ease-out; }
.cartel-note { font-size: 13px; font-weight: 700; color: #b9c0c7; font-variant-numeric: tabular-nums; }
.cartel-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cartel-actions .btn { color: var(--ink); }
.cartel-actions .btn.primary, .cartel-actions .btn.danger { color: #fff; }
.cartel-quiet { display: grid; gap: 4px; padding: 14px; border-radius: 12px; background: rgba(0,0,0,.05); font-weight: 800; }
.cartel-quiet small { color: var(--muted); font-weight: 700; }
@media (prefers-reduced-motion: reduce) { .cartel-meter .fill, .cartel-bar .fill { transition: none; } }
`;

const tk = (k: string) => `bunker.cartel.${k}` as Key;
const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString(locale());
const pad = (v: number) => String(v).padStart(2, '0');

/** A time left, to the second: "12:34", or "1:02:03" from an hour up. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return hours ? `${hours}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** A while, in whole minutes ("30 min", at least 1). */
export function minutes(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60_000))} min`;
}

/** What a contract wants, in words: "400 g Neon Haze" and its terms (packed, the quality, the time, the pay). */
export function contractTerms(c: CartelContract): { want: string; icon: string; terms: string[]; pay: string; perGram: string } {
  const kind = productKind(c.product);
  return {
    want: t(tk('want'), { grams: n(c.grams), product: kind?.name[lang()] ?? c.product }),
    icon: kind?.icon ?? '📦',
    terms: [t(tk('packed')), t(tk('quality'), { quality: Math.round(c.minQuality * 100) }), t(tk('within'), { time: minutes(c.time) })],
    pay: t(tk('pay'), { pay: c.pay.toLocaleString(locale()) }),
    perGram: t(tk('perGram'), { price: n(c.pay / c.grams) }),
  };
}

/** Your standing with them: the rank, the reputation, what the next rank takes (or that it's the top), and your record. */
export function standing(s: CartelState): { rank: string; rep: number; next: string; record: string } {
  const next = nextTierRep(s.rep);
  return {
    rank: t(tk(`rank.${cartelTier(s.rep)}`)),
    rep: s.rep,
    next: next === null ? t(tk('top')) : t(tk('next'), { rep: next, rank: t(tk(`rank.${cartelTier(next)}`)) }),
    record: t(tk('record'), { done: s.done, failed: s.failed, earned: s.earned.toLocaleString(locale()) }),
  };
}

function repBlock(s: CartelState): HTMLElement {
  const st = standing(s);
  const meter = h(
    'div.cartel-meter',
    { role: 'meter', 'aria-label': t(tk('rep')), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(s.rep) },
    h('div.fill', { style: `width:${s.rep}%` }),
  );
  for (const at of [20, 40, 60, 80]) meter.append(h('div.tick', { style: `left:${at}%` }));
  return h('div.cartel-rep', {}, h('div.cartel-rank', {}, st.rank, h('small', {}, `${t(tk('rep'))} ${st.rep}`)), h('div.cartel-next', {}, st.next), meter, h('div.cartel-record', {}, st.record));
}

function button(label: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = h(`button.btn${cls}` as 'button', { type: 'button', disabled }, label);
  b.addEventListener('click', onClick);
  return b;
}

function haggleButtons(c: CartelContract, act: (action: string, args?: unknown) => void): HTMLElement[] {
  if (c.haggled) return [button(t(tk('haggled')), '', () => {}, true)];
  return [button(t(tk('hagglePrice')), '', () => act('haggle', 'price')), button(t(tk('haggleTime')), '', () => act('haggle', 'time'))];
}

/** A clock's words at `now`: how long till `until`, as `kind` says it. */
function clockText(kind: string, until: number, now: number): string {
  const left = until - now;
  if (kind === 'due') return left > 0 ? t(tk('due'), { time: clock(left) }) : t(tk('overdue'));
  if (kind === 'expires') return t(tk('expires'), { time: clock(left) });
  return t(tk('nextCall'), { time: minutes(left) });
}

/** A clock that `tickClocks` keeps going. */
function clockEl(tag: 'span.when' | 'small', kind: string, until: number, now: number): HTMLElement {
  return h(tag, { 'data-kind': kind, 'data-until': until }, clockText(kind, until, now));
}

/** Moves the clocks in `host` on to `now`, touching nothing else (so the buttons keep focus). */
export function tickClocks(host: HTMLElement, now: number) {
  for (const el of host.querySelectorAll<HTMLElement>('[data-until]')) {
    const until = Number(el.dataset.until);
    el.textContent = clockText(el.dataset.kind ?? '', until, now);
    if (el.dataset.kind === 'due') el.classList.toggle('late', until - now <= 5 * 60_000);
  }
}

function card(c: CartelContract, head: string, when: HTMLElement, ...rest: (HTMLElement | null)[]): HTMLElement {
  const terms = contractTerms(c);
  return h(
    'div.cartel-card',
    { 'data-contract': c.id },
    h('h3', {}, head, when),
    h('div.cartel-want', {}, h('span.icon', {}, terms.icon), terms.want),
    h('div.cartel-terms', {}, ...terms.terms.map((x) => h('span.cartel-term', {}, x)), h('span.cartel-term.pay', {}, terms.pay), h('span.cartel-term', {}, terms.perGram)),
    ...rest,
  );
}

/** Paints the cartel into `host` for `mine` at `now`. */
export function paintCartel(host: HTMLElement, mine: BunkerPerson | null, now: number, act: (action: string, args?: unknown) => void) {
  const s = mine?.cartel;
  if (!s) return host.replaceChildren(h('p.bunker-empty', {}, t(tk('quiet'))));
  const parts: HTMLElement[] = [repBlock(s)];
  const c = s.contract;
  if (c) {
    const have = Math.min(fittingGrams(c, mine.products), gramsLeft(c));
    parts.push(
      card(
        c,
        t(tk('contract')),
        clockEl('span.when', 'due', c.dueAt ?? now, now),
        h(
          'div.cartel-bar',
          { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(c.grams), 'aria-valuenow': String(c.delivered) },
          h('div.fill', { style: `width:${Math.min(100, (c.delivered / c.grams) * 100)}%` }),
        ),
        h(
          'div.cartel-note',
          {},
          t(tk('progress'), { delivered: n(c.delivered), grams: n(c.grams) }),
          ' · ',
          have > 0 ? t(tk('have'), { grams: n(have) }) : t(tk('haveNone'), { quality: Math.round(c.minQuality * 100) }),
        ),
        h(
          'div.cartel-actions',
          {},
          button(t(tk('deliver')), '.primary', () => act('deliver'), have <= 0),
          ...haggleButtons(c, act),
          button(t(tk('abandon')), '.danger', () => act('abandon')),
        ),
      ),
    );
  } else if (s.offer) {
    const o = s.offer;
    parts.push(
      card(
        o,
        t(tk('offer')),
        clockEl('span.when', 'expires', o.expiresAt, now),
        h(
          'div.cartel-actions',
          {},
          button(t(tk('accept')), '.primary', () => act('accept')),
          ...haggleButtons(o, act),
          button(t(tk('decline')), '', () => act('decline')),
        ),
      ),
    );
  } else if (!s.known) {
    parts.push(h('div.cartel-quiet', {}, t(tk('quiet')), h('small', {}, t(tk('unknown')))));
  } else {
    parts.push(h('div.cartel-quiet', {}, t(tk('quiet')), clockEl('small', 'nextCall', s.nextOfferAt, now)));
  }
  host.replaceChildren(h('div.cartel-view', {}, ...parts));
  tickClocks(host, now);
}

/**
 * Keeps `host` showing the cartel while it's open: again whenever your bunker changes, and every second
 * for the clocks. Picks up the phone for an offer that's ringing. What it returns stops it.
 */
function mountCartel(host: HTMLElement, hooks: BunkerHooks): () => void {
  bunkerStyle('cartel', CSS);
  const act = (action: string, args?: unknown) => hooks.act('cartel', action, args);
  let picked: string | null = null;
  const paint = () => {
    const mine = store.bunker;
    if (ringing(mine?.cartel) && picked !== mine!.cartel.offer!.id) {
      picked = mine!.cartel.offer!.id;
      act('answer');
    }
    paintCartel(host, mine, Date.now(), act);
  };
  const off = store.on('bunker', paint);
  const timer = setInterval(() => tickClocks(host, Date.now()), 1000);
  paint();
  return () => {
    off();
    clearInterval(timer);
  };
}

export function openCartel(hooks: BunkerHooks): StationWindow {
  let stop = () => {};
  const win = stationWindow({ station: 'cartel', title: t('bunker.cartel.title'), onClose: () => stop() });
  stop = mountCartel(win.body, hooks);
  return win;
}

/** The cartel's app on the PC. */
export const cartelApp: PcApp = {
  id: 'cartel',
  icon: '🤝',
  title: () => t('bunker.cartel.app'),
  mount(host, hooks) {
    const title = h('h3.bunker-app-title', {}, `🤝 ${t('bunker.cartel.app')}`);
    const view = h('div');
    host.replaceChildren(title, view);
    return mountCartel(view, hooks);
  },
};
