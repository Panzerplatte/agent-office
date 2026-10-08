// The customers: the panel at the slot in the bunker's metal door (E there), and their app on the PC
// (see pc.ts), the same in both: the list of your customers (how hooked they are, what they think of
// you, what they last bought, their open order), and each one's texts, where you answer their order
// (accept, decline, a counter-offer), deliver from your packed stash, or give a free sample.
import type { BunkerPerson } from '../../../shared/bunker/index';
import { addictionNow, customerCap, inTrouble, unitNominal, unitShort, unitsFor, type ChatLine, type Customer } from '../../../shared/bunker/customers';
import { productKind } from '../../../shared/bunker/items';
import { lang, locale, t, type Key } from '../../i18n';
import { h } from '../dom';
import { store } from '../../state';
import { bunkerStyle, stationWindow, type BunkerHooks, type PcApp, type StationWindow } from './panel';

const n = (v: number) => v.toLocaleString(locale());
const grams = (g: number) => n(Math.round(g * 10) / 10);
const productName = (id: string) => productKind(id)?.name[lang()] ?? id;

/** A line of a customer's chat in your language, its product by name. */
export function chatText(line: Pick<ChatLine, 'key' | 'params'>): string {
  const params = { ...line.params };
  if (typeof params.product === 'string') params.product = productName(params.product);
  if (typeof params.grams === 'number') params.grams = grams(params.grams);
  return t(`bunker.customers.say.${line.key}` as Key, params);
}

/** What the list says about a customer at `now`. */
export function customerRow(c: Customer, now: number): { addiction: number; opinion: number; last: string; order: string; minutes?: number } {
  const last = !c.last
    ? t('bunker.customers.never')
    : c.last.price
      ? t('bunker.customers.last', { grams: grams(c.last.grams), product: productName(c.last.product) })
      : t('bunker.customers.lastSample', { product: productName(c.last.product) });
  const o = c.order;
  const order = inTrouble(c, now)
    ? t('bunker.customers.trouble')
    : o
      ? t('bunker.customers.wants', { grams: grams(o.grams), product: productName(o.product), price: n(o.price) })
      : t('bunker.customers.noOrder');
  return { addiction: Math.round(addictionNow(c, now)), opinion: Math.round(c.opinion), last, order, ...(o && !inTrouble(c, now) ? { minutes: minutesLeft(o.due, now) } : {}) };
}

const minutesLeft = (due: number, now: number) => Math.max(0, Math.ceil((due - now) / 60_000));

const meter = (label: string, value: number, kind: string) =>
  h(
    'div.cu-meter',
    { class: kind, title: `${label} ${value} %` },
    h('span.cu-meter-label', {}, label),
    h('span.cu-meter-bar', {}, h('span', { style: `width:${value}%` })),
    h('span.cu-meter-value', {}, `${value}`),
  );

/**
 * The customers in `host`, kept up to date with your bunker. What it returns stops that. You
 * pick a customer to see their texts and answer them; ← goes back to the list.
 */
export function mountCustomers(host: HTMLElement, hooks: BunkerHooks): () => void {
  bunkerStyle('customers', CSS);
  const root = h('div.cu-view');
  host.append(root);
  let open: string | null = null;
  const picked = new Set<string>();
  let counterDraft = '';
  let painted = '';
  const act = (action: string, args: Record<string, unknown>) => hooks.act('customers', action, args);

  const paint = (force = false) => {
    const mine = store.bunker;
    const state = mine?.customers;
    // Only when what's shown changed, so a tick elsewhere doesn't wipe what you're typing.
    const sig = JSON.stringify([open, state, open ? mine?.products : null, lang()]);
    if (!force && sig === painted) return;
    painted = sig;
    const now = Date.now();
    const c = open ? state?.list.find((x) => x.id === open) : undefined;
    if (open && !c) open = null;
    root.replaceChildren(...(c && mine ? detail(c, mine, now) : list(mine, now)));
  };

  const list = (mine: BunkerPerson | null, now: number): Node[] => {
    const state = mine?.customers;
    if (!state?.list.length) return [h('p.bunker-empty', {}, t('bunker.customers.empty'))];
    const ul = h('ul.svc-list.cu-list');
    for (const c of state.list) {
      const row = customerRow(c, now);
      const li = h(
        'li',
        { tabindex: '0', 'data-customer': c.id, class: c.order && !inTrouble(c, now) ? 'cu-wants' : '' },
        h('span.cu-face', {}, c.face),
        h(
          'div.svc-main.cu-main',
          {},
          h('div.svc-title', {}, c.name, c.referredBy ? h('span.cu-by', {}, ` · ${t('bunker.customers.referredBy', { by: c.referredBy })}`) : null),
          h('div.cu-meters', {}, meter(t('bunker.customers.addiction'), row.addiction, 'hooked'), meter(t('bunker.customers.opinion'), row.opinion, 'likes')),
          h('div.cu-line', {}, row.last),
          h(
            'div.cu-line.cu-order',
            {},
            row.order,
            row.minutes !== undefined ? h('span.cu-due', { 'data-due': c.order!.due }, ` · ${t('bunker.customers.due', { minutes: row.minutes })}`) : null,
            c.order?.agreed ? h('span.cu-agreed', {}, ` · ${t('bunker.customers.agreed')}`) : null,
          ),
        ),
      );
      const go = () => {
        open = c.id;
        picked.clear();
        counterDraft = '';
        paint(true);
      };
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
      ul.append(li);
    }
    return [h('div.cu-count', {}, t('bunker.customers.count', { n: state.list.length, cap: customerCap(state.reputation), rep: Math.round(state.reputation) })), ul];
  };

  const unitRow = (u: BunkerPerson['products'][number], input: HTMLInputElement) =>
    h(
      'label.cu-unit',
      {},
      input,
      h('span', {}, productName(u.product)),
      h(
        'span.bunker-amount',
        {},
        t('bunker.customers.unit', { grams: grams(u.grams), quality: Math.round(u.quality * 100) }),
        unitShort(u) ? h('span.cu-short', {}, ` · ${t('bunker.customers.short')}`) : null,
      ),
    );

  const detail = (c: Customer, mine: BunkerPerson, now: number): Node[] => {
    const back = h('button.btn.bunker-back', {}, t('bunker.customers.back'));
    back.addEventListener('click', () => {
      open = null;
      paint(true);
    });
    const row = customerRow(c, now);
    const head = h(
      'div.cu-head',
      {},
      h('span.cu-face.big', {}, c.face),
      h(
        'div.cu-main',
        {},
        h('div.svc-title', {}, c.name),
        h('div.cu-meters', {}, meter(t('bunker.customers.addiction'), row.addiction, 'hooked'), meter(t('bunker.customers.opinion'), row.opinion, 'likes')),
      ),
    );
    const chat = h('div.cu-chat', { 'aria-live': 'polite' }, ...c.chat.map((l) => h('div.cu-msg', { class: l.from }, chatText(l))));
    const out: Node[] = [back, head, chat];
    const o = c.order;
    if (o && !inTrouble(c, now)) {
      out.push(
        h(
          'div.cu-line.cu-order',
          {},
          row.order,
          h('span.cu-due', { 'data-due': o.due }, ` · ${t('bunker.customers.due', { minutes: row.minutes ?? 0 })}`),
          o.agreed ? h('span.cu-agreed', {}, ` · ${t('bunker.customers.agreed')}`) : null,
        ),
      );
      const buttons = h('div.cu-actions');
      if (!o.agreed) {
        const accept = h('button.btn.primary', {}, t('bunker.customers.accept'));
        accept.addEventListener('click', () => act('accept', { customer: c.id }));
        const price = h('input', {
          type: 'number',
          min: 1,
          step: 1,
          inputmode: 'numeric',
          'aria-label': t('bunker.customers.counterPrice'),
          placeholder: t('bunker.customers.counterPrice'),
          value: counterDraft || String(o.price),
        });
        price.addEventListener('input', () => (counterDraft = price.value));
        const counter = h('button.btn', {}, t('bunker.customers.counter'));
        const send = () => {
          const v = Math.round(Number(price.value));
          if (v > 0) act('counter', { customer: c.id, price: v });
          counterDraft = '';
        };
        counter.addEventListener('click', send);
        price.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') send();
        });
        buttons.append(accept, h('span.cu-counter', {}, price, counter));
      }
      const decline = h('button.btn', {}, t('bunker.customers.decline'));
      decline.addEventListener('click', () => act('decline', { customer: c.id }));
      buttons.append(decline);
      out.push(buttons);
      // Delivering: tick the packed units of what they want.
      const units = unitsFor(mine, o);
      for (const id of [...picked]) if (!units.some((u) => u.id === id)) picked.delete(id);
      if (!units.length) out.push(h('p.bunker-empty', {}, t('bunker.customers.noUnits', { product: productName(o.product) })));
      else {
        const sum = h('span.cu-picked');
        const deliver = h('button.btn.primary', {}, t('bunker.customers.deliver'));
        const update = () => {
          const g = units.filter((u) => picked.has(u.id)).reduce((s, u) => s + unitNominal(u), 0);
          sum.textContent = t('bunker.customers.picked', { grams: grams(g), want: grams(o.grams) });
          deliver.disabled = g < o.grams;
        };
        const rows = units.map((u) => {
          const box = h('input', { type: 'checkbox', checked: picked.has(u.id) });
          box.addEventListener('change', () => {
            if (box.checked) picked.add(u.id);
            else picked.delete(u.id);
            update();
          });
          return unitRow(u, box);
        });
        deliver.addEventListener('click', () => {
          act('deliver', { customer: c.id, units: units.filter((u) => picked.has(u.id)).map((u) => u.id) });
          picked.clear();
        });
        update();
        out.push(h('h3.bunker-section', {}, t('bunker.customers.deliverWhat', { product: productName(o.product) })), h('div.cu-units', {}, ...rows), h('div.cu-actions', {}, sum, deliver));
      }
    }
    // A free sample, now and then.
    const samples = mine.products.filter((u) => u.pack && u.grams <= 10);
    if (!inTrouble(c, now)) {
      out.push(h('h3.bunker-section', {}, t('bunker.customers.sample')));
      if (!samples.length) out.push(h('p.bunker-empty', {}, t('bunker.customers.noSample')));
      else {
        const pick = h(
          'select',
          { 'aria-label': t('bunker.customers.sampleWhat') },
          ...samples.map((u) => h('option', { value: u.id }, `${productName(u.product)} · ${t('bunker.customers.unit', { grams: grams(u.grams), quality: Math.round(u.quality * 100) })}`)),
        );
        const give = h('button.btn', {}, t('bunker.customers.sample'));
        give.addEventListener('click', () => act('sample', { customer: c.id, unit: pick.value }));
        out.push(h('div.cu-actions', {}, pick, give));
      }
    }
    queueMicrotask(() => (chat.scrollTop = chat.scrollHeight));
    return out;
  };

  const off = store.on('bunker', () => paint());
  // The minutes left tick down by themselves; an order coming or going repaints anyway.
  const clock = setInterval(() => {
    const now = Date.now();
    for (const el of root.querySelectorAll<HTMLElement>('[data-due]')) el.textContent = ` · ${t('bunker.customers.due', { minutes: minutesLeft(Number(el.dataset.due), now) })}`;
  }, 10_000);
  paint(true);
  // Someone new gets their first few customers the first time they look.
  if (!store.bunker?.customers?.list.length) act('open', {});
  return () => {
    off();
    clearInterval(clock);
    root.remove();
  };
}

export function openCustomers(hooks: BunkerHooks): StationWindow {
  let stop = () => {};
  const win = stationWindow({ station: 'customers', title: t('bunker.customers.title'), onClose: () => stop() });
  stop = mountCustomers(win.body, hooks);
  return win;
}

/** The customers' app on the PC. */
export const customersApp: PcApp = {
  id: 'customers',
  icon: '👥',
  title: () => t('bunker.customers.app'),
  mount(host, hooks) {
    host.replaceChildren(h('h3.bunker-app-title', {}, `👥 ${t('bunker.customers.app')}`));
    return mountCustomers(host, hooks);
  },
};

const CSS = `
.bunker-panel .cu-count { margin: 0 0 8px; font-size: 13px; font-weight: 800; color: var(--muted); }
.bunker-panel .cu-list li { align-items: flex-start; }
.bunker-panel .cu-list li.cu-wants { border-color: var(--accent); }
.bunker-panel .cu-face { flex: none; width: 40px; height: 40px; display: grid; place-items: center; font-size: 26px; border: 3px solid var(--ink); border-radius: 50%; background: var(--paper-2); }
.bunker-panel .cu-face.big { width: 52px; height: 52px; font-size: 34px; }
.bunker-panel .cu-main { min-width: 0; flex: 1; }
.bunker-panel .cu-by { font-size: 12px; font-weight: 700; color: var(--muted); }
.bunker-panel .cu-meters { display: flex; gap: 12px; margin: 4px 0; flex-wrap: wrap; }
.bunker-panel .cu-meter { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; }
.bunker-panel .cu-meter-bar { width: 70px; height: 9px; border: 2px solid var(--ink); border-radius: 999px; background: #fff; overflow: hidden; }
.bunker-panel .cu-meter-bar > span { display: block; height: 100%; }
.bunker-panel .cu-meter.hooked .cu-meter-bar > span { background: var(--bad); }
.bunker-panel .cu-meter.likes .cu-meter-bar > span { background: var(--good); }
.bunker-panel .cu-meter-value { min-width: 2ch; font-variant-numeric: tabular-nums; }
.bunker-panel .cu-line { font-size: 13px; font-weight: 600; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.bunker-panel .cu-order { color: var(--ink); font-weight: 800; }
.bunker-panel .cu-agreed { color: #0a8f6b; }
.bunker-panel .cu-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.bunker-panel .cu-chat { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; padding: 10px; margin-bottom: 10px; border: 3px solid var(--ink); border-radius: 14px; background: #eef1ec; }
.bunker-panel .cu-msg { max-width: 80%; padding: 6px 10px; border-radius: 14px; font-size: 14px; font-weight: 700; line-height: 1.3; }
.bunker-panel .cu-msg.them { align-self: flex-start; background: #fff; border: 2px solid var(--ink); border-bottom-left-radius: 4px; }
.bunker-panel .cu-msg.me { align-self: flex-end; background: var(--info); color: #082a3a; border: 2px solid var(--ink); border-bottom-right-radius: 4px; }
.bunker-panel .cu-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; }
.bunker-panel .cu-actions .btn { padding: 5px 12px; font-size: 14px; }
.bunker-panel .cu-counter { display: inline-flex; gap: 6px; }
.bunker-panel .cu-counter input, .bunker-panel .cu-actions select { width: 110px; min-width: 0; font: inherit; font-weight: 700; border: 2px solid var(--ink); border-radius: 8px; padding: 4px 6px; background: #fff; }
.bunker-panel .cu-actions select { width: auto; max-width: 100%; font-size: 14px; }
.bunker-panel .cu-units { display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto; }
.bunker-panel .cu-unit { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; cursor: pointer; }
.bunker-panel .cu-unit .bunker-amount { margin-left: auto; }
.bunker-panel .cu-short { color: var(--bad); }
.bunker-panel .cu-picked { font-size: 13px; font-weight: 800; color: var(--muted); }
`;
