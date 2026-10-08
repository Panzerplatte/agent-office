// The bunker's PC (E at its desk): an old green-on-black desktop of apps, one open at a time. The
// supplier's shop, the stash and the stats are the PC's own apps (here); the customers' and the
// cartel's are theirs (customers.ts, cartel.ts), handed in by the foundation (ui/bunker/index.ts).
import type { BunkerPerson } from '../../../shared/bunker/index';
import { countItem } from '../../../shared/bunker/index';
import { bunkerItem, productKind } from '../../../shared/bunker/items';
import { PC_MAX_BUY, PC_UPGRADES, SHOP_SECTIONS, buyPrice, initialPc, pcStats, stashRoom, suppliesHeld, upgradeLevel, upgradePrice } from '../../../shared/bunker/pc';
import { chips } from '../../chips';
import { lang, locale, t, type Key } from '../../i18n';
import { store } from '../../state';
import { h } from '../dom';
import { bunkerStyle, stationWindow, type BunkerHooks, type PcApp, type StationWindow } from './panel';
import { stashRows } from './stash';

const n = (v: number) => v.toLocaleString(locale());

// ---- What the apps show (plain data, so it can be tested without a page) ------------------------------

/** The shop's sections and rows for `mine` with `balance` chips: each item's price, how many you have, and the upgrades with their next level. */
export function shopSections(mine: BunkerPerson | null, balance: number) {
  const inv = mine?.inventory ?? {};
  const me = { pc: mine?.pc ?? initialPc() };
  const items = SHOP_SECTIONS.map((s) => ({
    id: s.id,
    title: t(`bunker.pc.section.${s.id}` as Key),
    rows: s.items.map((item) => ({
      kind: 'item' as const,
      id: item.id,
      icon: item.icon,
      name: item.name[lang()],
      price: item.price,
      have: countItem(inv, item.id),
      affordable: item.price <= balance,
    })),
  }));
  const upgrades = {
    id: 'upgrades' as const,
    title: t('bunker.pc.section.upgrades'),
    rows: PC_UPGRADES.map((up) => {
      const level = upgradeLevel(me, up.id);
      const price = upgradePrice(up, level);
      return { kind: 'upgrade' as const, id: up.id, icon: up.icon, name: up.name[lang()], level, of: up.prices.length, price, affordable: price !== null && price <= balance };
    }),
  };
  return { balance, used: suppliesHeld(inv), room: stashRoom(me), sections: [...items, upgrades] };
}

/** The stats app's lines: a label and a value (and a line under it). */
export function statsLines(mine: BunkerPerson | null): { label: string; value: string; sub?: string }[] {
  const s = pcStats(mine?.pc ?? initialPc());
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v))}`;
  const none = t('bunker.pc.nothingYet');
  const product = s.bestProduct && productKind(s.bestProduct.id);
  const bought = s.mostBought && (bunkerItem(s.mostBought.id) ?? PC_UPGRADES.find((u) => u.id === s.mostBought!.id));
  return [
    { label: t('bunker.pc.spent'), value: n(s.spent) },
    { label: t('bunker.pc.earned'), value: n(s.earned) },
    { label: t('bunker.pc.net'), value: signed(s.net) },
    s.bestCustomer
      ? { label: t('bunker.pc.bestCustomer'), value: s.bestCustomer.name ?? s.bestCustomer.id, sub: t('bunker.pc.customerLine', { chips: n(s.bestCustomer.chips), n: n(s.bestCustomer.sales) }) }
      : { label: t('bunker.pc.bestCustomer'), value: none },
    s.bestProduct
      ? {
          label: t('bunker.pc.bestProduct'),
          value: `${product?.icon ?? '📦'} ${product?.name[lang()] ?? s.bestProduct.id}`,
          sub: t('bunker.pc.productLine', { chips: n(s.bestProduct.chips), grams: n(Math.round(s.bestProduct.grams * 10) / 10) }),
        }
      : { label: t('bunker.pc.bestProduct'), value: none },
    s.mostBought
      ? { label: t('bunker.pc.mostBought'), value: `${bought?.icon ?? '📦'} ${bought?.name[lang()] ?? s.mostBought.id}`, sub: t('bunker.pc.boughtLine', { n: n(s.mostBought.n) }) }
      : { label: t('bunker.pc.mostBought'), value: none },
  ];
}

// ---- The apps ---------------------------------------------------------------------------------------------

/** Paints `paint` into `host` now and whenever your bunker or your chips change. `stop` stops it; `paint` paints again now. */
function live(host: HTMLElement, paint: (mine: BunkerPerson | null) => void): { stop: () => void; paint: () => void } {
  const again = () => {
    if (host.isConnected) paint(store.bunker);
  };
  paint(store.bunker);
  const offBunker = store.on('bunker', again);
  const offChips = chips.onChange(again);
  return {
    paint: () => paint(store.bunker),
    stop: () => {
      offBunker();
      offChips();
    },
  };
}
/** The supplier's shop: seeds, soil, lamps, the lab's ingredients and kit, packaging and upgrades, for chips. */
export const shopApp: PcApp = {
  id: 'shop',
  icon: '🛒',
  title: () => t('bunker.pc.shop'),
  mount(host, hooks) {
    let tab: string = SHOP_SECTIONS[0].id;
    /** How many of each item you're about to buy (kept while the shop's open). */
    const qty = new Map<string, number>();
    const view = live(host, (mine) => {
      const shop = shopSections(mine, chips.balance);
      const top = h(
        'div.pc-shop-top',
        {},
        h('span.pc-balance', { title: t('bunker.pc.balance') }, `🪙 ${n(shop.balance)}`),
        h('span.pc-room', { class: shop.used >= shop.room ? 'full' : '' }, t('bunker.pc.room', { used: n(shop.used), room: n(shop.room) })),
      );
      const tabs = h('div.pc-tabs', { role: 'tablist' });
      for (const s of shop.sections) {
        const b = h('button.pc-tab', { type: 'button', role: 'tab', 'aria-selected': String(s.id === tab), class: s.id === tab ? 'on' : '' }, s.title);
        b.addEventListener('click', () => {
          tab = s.id;
          view.paint();
        });
        tabs.append(b);
      }
      const section = shop.sections.find((s) => s.id === tab) ?? shop.sections[0];
      const list = h('ul.pc-shop-list');
      for (const row of section.rows) {
        if (row.kind === 'item') {
          const k = qty.get(row.id) ?? 1;
          const input = h('input.pc-qty', { type: 'number', min: '1', max: String(PC_MAX_BUY), value: String(k), 'aria-label': t('bunker.pc.howMany') });
          const total = () => buyPrice(bunkerItem(row.id), qty.get(row.id) ?? 1) ?? 0;
          const buy = h('button.btn.primary.pc-buy', { type: 'button' });
          const sync = () => {
            buy.textContent = t('bunker.pc.buy', { chips: n(total()) });
            buy.disabled = total() > chips.balance || total() <= 0;
          };
          const set = (v: number) => {
            const clamped = Math.min(PC_MAX_BUY, Math.max(1, Math.round(Number.isFinite(v) ? v : 1)));
            qty.set(row.id, clamped);
            input.value = String(clamped);
            sync();
          };
          const less = h('button.btn.pc-step', { type: 'button', 'aria-label': t('bunker.pc.less') }, '−');
          const more = h('button.btn.pc-step', { type: 'button', 'aria-label': t('bunker.pc.more') }, '+');
          less.addEventListener('click', () => set((qty.get(row.id) ?? 1) - 1));
          more.addEventListener('click', () => set((qty.get(row.id) ?? 1) + 1));
          input.addEventListener('change', () => set(Number(input.value)));
          input.addEventListener('input', () => {
            const v = Number(input.value);
            if (Number.isInteger(v) && v >= 1 && v <= PC_MAX_BUY) qty.set(row.id, v);
            sync();
          });
          buy.addEventListener('click', () => hooks.act('pc', 'buy', { item: row.id, n: qty.get(row.id) ?? 1 }));
          sync();
          list.append(
            h(
              'li',
              { 'data-item': row.id },
              h('span.pc-icon', {}, row.icon),
              h('div.pc-main', {}, h('div.pc-name', {}, row.name), h('div.pc-sub', {}, `${t('bunker.pc.each', { chips: n(row.price) })} · ${t('bunker.pc.have', { n: n(row.have) })}`)),
              h('div.pc-picker', {}, less, input, more),
              buy,
            ),
          );
        } else {
          const buy = h('button.btn.primary.pc-buy', { type: 'button', disabled: !row.affordable }, row.price === null ? t('bunker.pc.maxedOut') : t('bunker.pc.upgrade', { chips: n(row.price) }));
          buy.addEventListener('click', () => hooks.act('pc', 'upgrade', { id: row.id }));
          list.append(
            h(
              'li',
              { 'data-item': row.id },
              h('span.pc-icon', {}, row.icon),
              h('div.pc-main', {}, h('div.pc-name', {}, row.name), h('div.pc-sub', {}, t('bunker.pc.level', { level: row.level, of: row.of }))),
              buy,
            ),
          );
        }
      }
      host.replaceChildren(h('h3.bunker-app-title', {}, `🛒 ${t('bunker.pc.shop')}`), top, tabs, list);
    });
    return view.stop;
  },
};

/** The stash at a glance: the supplies, the product (packed or loose, with its quality) and the upgrades. */
export const stashApp: PcApp = {
  id: 'stash',
  icon: '🗄️',
  title: () => t('bunker.pc.stash'),
  mount(host) {
    return live(host, (mine) => {
      const rows = stashRows(mine);
      const me = { pc: mine?.pc ?? initialPc() };
      const ups = PC_UPGRADES.filter((u) => upgradeLevel(me, u.id) > 0);
      const list = (title: string, these: { icon: string; name: string; amount: string }[]) =>
        these.length
          ? [
              h('h3.bunker-section', {}, title),
              h(
                'ul.svc-list.bunker-stash',
                {},
                ...these.map((r) => h('li', {}, h('span.jb-icon', {}, r.icon), h('div.svc-main', {}, h('div.svc-title', {}, r.name)), h('span.bunker-amount', {}, r.amount))),
              ),
            ]
          : [];
      host.replaceChildren(
        h('h3.bunker-app-title', {}, `🗄️ ${t('bunker.pc.stash')}`),
        h('div.pc-shop-top', {}, h('span.pc-room', {}, t('bunker.pc.room', { used: n(suppliesHeld(mine?.inventory ?? {})), room: n(stashRoom(me)) }))),
        ...(rows.length || ups.length ? [] : [h('p.bunker-empty', {}, t('bunker.common.stash.empty'))]),
        ...list(
          t('bunker.common.stash.items'),
          rows.filter((r) => r.section === 'items'),
        ),
        ...list(
          t('bunker.common.stash.products'),
          rows.filter((r) => r.section === 'products'),
        ),
        ...list(
          t('bunker.pc.upgrades'),
          ups.map((u) => ({ icon: u.icon, name: u.name[lang()], amount: t('bunker.pc.level', { level: upgradeLevel(me, u.id), of: u.prices.length }) })),
        ),
      );
    }).stop;
  },
};

/** The bunker's numbers: chips spent and earned down here, the best customer, what sells best. */
export const statsApp: PcApp = {
  id: 'stats',
  icon: '📈',
  title: () => t('bunker.pc.stats'),
  mount(host) {
    return live(host, (mine) => {
      host.replaceChildren(
        h('h3.bunker-app-title', {}, `📈 ${t('bunker.pc.stats')}`),
        h('dl.pc-stats', {}, ...statsLines(mine).map((l) => h('div', {}, h('dt', {}, l.label), h('dd', {}, h('b', {}, l.value), l.sub ? h('small', {}, l.sub) : null)))),
      );
    }).stop;
  },
};

/** The apps on the PC's desktop: the PC's own three, then the others' (the customers', the cartel's) in the order handed in. */
export function desktopApps(apps: readonly PcApp[]): PcApp[] {
  const own = [shopApp, stashApp, statsApp];
  return [...own, ...apps.filter((a) => !own.some((o) => o.id === a.id))];
}

/** Opens the PC with `apps` on its desktop (see desktopApps). */
export function openPc(hooks: BunkerHooks, apps: readonly PcApp[]): StationWindow {
  bunkerStyle('pc', CSS);
  const win = stationWindow({ station: 'pc', title: t('bunker.pc.title'), onClose: () => unmount() });
  const screen = h('div.pc-screen');
  win.body.replaceChildren(screen);
  let unmount = () => {};
  const home = () => {
    unmount();
    unmount = () => {};
    const grid = h('ul.pc-desktop', { 'aria-label': t('bunker.pc.apps') });
    for (const app of desktopApps(apps)) {
      const open = () => {
        const back = h('button.btn.bunker-back', { type: 'button' }, t('bunker.pc.back'));
        const view = h('div.bunker-app');
        screen.replaceChildren(back, view);
        back.addEventListener('click', home);
        unmount = app.mount(view, hooks) ?? (() => {});
      };
      const icon = h('button.pc-app', { type: 'button', 'data-app': app.id }, h('span.pc-app-icon', {}, app.icon), h('span.pc-app-name', {}, app.title()));
      icon.addEventListener('click', open);
      grid.append(h('li', {}, icon));
    }
    screen.replaceChildren(grid);
  };
  home();
  return win;
}

/** The PC's own styles: an old CRT's green glow round the desktop, the shop's rows and pickers. */
const CSS = `
.bunker-panel[data-station="pc"] { width: min(640px, 100%); }
.bunker-panel[data-station="pc"] .pc-screen {
  min-height: 300px; padding: 14px; border-radius: 14px; border: 3px solid var(--ink);
  background: radial-gradient(ellipse at 50% 40%, #183a26 0%, #0c1e14 70%, #07120c 100%);
  color: #b7f5c6; box-shadow: inset 0 0 28px rgba(0, 0, 0, .65), inset 0 0 6px rgba(120, 255, 160, .25);
}
.bunker-panel[data-station="pc"] .pc-screen .bunker-app-title,
.bunker-panel[data-station="pc"] .pc-screen .bunker-section { color: #d9ffe2; text-shadow: 0 0 6px rgba(120, 255, 160, .45); }
.bunker-panel[data-station="pc"] .pc-screen .bunker-empty { color: #8fd3a1; }
.bunker-panel[data-station="pc"] .pc-desktop { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
.bunker-panel[data-station="pc"] .pc-app {
  width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px;
  border: 2px solid transparent; border-radius: 12px; background: transparent; color: inherit; font: inherit; font-weight: 800; cursor: pointer;
}
.bunker-panel[data-station="pc"] .pc-app:hover, .bunker-panel[data-station="pc"] .pc-app:focus-visible { border-color: #7fe29b; background: rgba(127, 226, 155, .12); outline: none; }
.bunker-panel[data-station="pc"] .pc-app-icon { font-size: 34px; line-height: 1; }
.bunker-panel[data-station="pc"] .pc-app-name { font-size: 13px; text-align: center; }
.bunker-panel[data-station="pc"] .pc-shop-top { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-bottom: 10px; font-weight: 800; font-variant-numeric: tabular-nums; }
.bunker-panel[data-station="pc"] .pc-balance { font-size: 18px; color: #fff3b0; }
.bunker-panel[data-station="pc"] .pc-room { font-size: 13px; color: #8fd3a1; }
.bunker-panel[data-station="pc"] .pc-room.full { color: #ff9a9a; }
.bunker-panel[data-station="pc"] .pc-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.bunker-panel[data-station="pc"] .pc-tab { padding: 4px 10px; border: 2px solid #3f7a52; border-radius: 999px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
.bunker-panel[data-station="pc"] .pc-tab.on { background: #7fe29b; border-color: #7fe29b; color: #0c1e14; }
.bunker-panel[data-station="pc"] .pc-shop-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.bunker-panel[data-station="pc"] .pc-shop-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 8px 10px; border-radius: 10px; background: rgba(127, 226, 155, .08); }
.bunker-panel[data-station="pc"] .pc-icon { flex: none; font-size: 22px; width: 28px; text-align: center; }
.bunker-panel[data-station="pc"] .pc-main { flex: 1 1 140px; min-width: 0; }
.bunker-panel[data-station="pc"] .pc-name { font-weight: 800; }
.bunker-panel[data-station="pc"] .pc-sub { font-size: 12px; color: #8fd3a1; font-variant-numeric: tabular-nums; }
.bunker-panel[data-station="pc"] .pc-picker { display: flex; align-items: center; gap: 4px; }
.bunker-panel[data-station="pc"] .pc-step { padding: 2px 9px; font-size: 14px; }
.bunker-panel[data-station="pc"] .pc-qty { width: 58px; padding: 4px 6px; border: 2px solid var(--ink); border-radius: 8px; font: inherit; font-weight: 800; text-align: center; font-variant-numeric: tabular-nums; }
.bunker-panel[data-station="pc"] .pc-buy { padding: 4px 10px; font-size: 13px; white-space: nowrap; }
.bunker-panel[data-station="pc"] .pc-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; margin: 0; }
.bunker-panel[data-station="pc"] .pc-stats > div { padding: 10px 12px; border-radius: 10px; background: rgba(127, 226, 155, .08); }
.bunker-panel[data-station="pc"] .pc-stats dt { font-size: 12px; color: #8fd3a1; font-weight: 800; }
.bunker-panel[data-station="pc"] .pc-stats dd { margin: 2px 0 0; display: grid; }
.bunker-panel[data-station="pc"] .pc-stats b { font-size: 18px; font-variant-numeric: tabular-nums; color: #d9ffe2; }
.bunker-panel[data-station="pc"] .pc-stats small { font-size: 12px; color: #8fd3a1; }
.bunker-panel[data-station="pc"] .pc-screen .svc-list li { background: rgba(127, 226, 155, .08); color: inherit; }
`;
