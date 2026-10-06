import { SHOP_ITEMS, SHOP_SLOTS, type ShopItem } from '../../shared/shop';
import { chips } from '../chips';
import { lang, locale, t, type Key } from '../i18n';
import { h, openModal } from './dom';

const n = (v: number) => v.toLocaleString(locale());

export interface ShopHooks {
  /** Buy the item with this id (the office checks the price and your balance, and says if it can't). */
  buy(item: string): void;
  /** Put it on, or take it off. */
  wear(item: string, on: boolean): void;
}

/**
 * The casino's shop, at its counter (see shared/shop.ts): every item by slot, with its price in chips,
 * and your balance. What you can afford has a Buy button, what you can't says how many chips short
 * you are, and what you have is yours to put on or take off. The office does the buying; this asks,
 * and redraws when your chips (and what you have) change.
 */
export function openShop(hooks: ShopHooks) {
  const close = h('button.btn.close', { 'aria-label': t('menus.close') }, '✕');
  const body = h('div.body');
  const el = h(
    'div.modal.jukebox.shop',
    { role: 'dialog', 'aria-label': t('menus.shop') },
    h('header', {}, h('h2', {}, t('menus.shopTitle')), close),
    body,
  );
  let painted = '';
  const paint = () => {
    const s = chips.state;
    const key = JSON.stringify([s.balance, s.items, s.worn]);
    if (key === painted) return;
    painted = key;
    const owned = new Set(s.items ?? []);
    const worn = new Set(s.worn ?? []);
    const row = (item: ShopItem) => {
      const have = owned.has(item.id);
      const on = worn.has(item.id);
      const short = item.price - s.balance;
      const desk = item.slot === 'desk';
      let action: HTMLElement;
      if (have) {
        action = h('button.btn', { class: on ? 'on' : '', 'aria-pressed': String(on) }, t((on ? (desk ? 'menus.shopHide' : 'menus.shopTakeOff') : desk ? 'menus.shopShow' : 'menus.shopWear') as Key));
        action.addEventListener('click', () => hooks.wear(item.id, !on));
      } else if (short > 0) {
        action = h('span.shop-short', {}, t('menus.shopShort', { missing: n(short) }));
      } else {
        action = h('button.btn.primary', {}, t('menus.shopBuy', { price: n(item.price) }));
        action.addEventListener('click', () => hooks.buy(item.id));
      }
      const icon =
        item.slot === 'name'
          ? h('span.shop-swatch', { style: `color: ${item.color}; text-shadow: 0 0 6px ${item.color}` }, 'Aa')
          : h('span.jb-icon', { style: 'font-size:26px' }, item.icon);
      return h(
        'li',
        { class: on ? 'on' : '' },
        icon,
        h(
          'div.svc-main',
          {},
          h('div.svc-title', {}, item.name[lang()], on ? h('span.shop-badge', {}, t('menus.shopWearing')) : null),
          h('div.svc-meta.shop-about', {}, `${item.about[lang()]}${have ? '' : ` · ${n(item.price)} 🪙`}`),
        ),
        action,
      );
    };
    body.replaceChildren(
      h('p.setting-note', { style: 'margin:0 0 4px;font-weight:800' }, t('menus.shopBalance', { n: n(s.balance) })),
      ...SHOP_SLOTS.flatMap((slot) => {
        const items = SHOP_ITEMS.filter((i) => i.slot === slot);
        if (!items.length) return [];
        return [h('h3.shop-slot', {}, t(`menus.shopSlot_${slot}` as Key)), h('ul.svc-list.shop-list', {}, ...items.map(row))];
      }),
    );
  };
  // Buying changes your chips and what you have: kept up to date while it's open.
  const off = chips.onChange(() => paint());
  const modal = openModal(el, { onClose: () => void off(), doing: t('world.doingShop') });
  close.addEventListener('click', () => modal.close());
  paint();
}
