// The stash shelf on the bunker's south wall (E at it): everything you have down here, the supplies
// (seeds, soil, kit, packaging) and the product, by kind. The foundation's own: every feature puts
// what it makes and buys here (see BunkerPerson's inventory and products).
import type { BunkerPerson } from '../../../shared/bunker/index';
import { bunkerItem, productKind } from '../../../shared/bunker/items';
import { lang, locale, t } from '../../i18n';
import { h } from '../dom';
import { stationWindow, type StationWindow } from './panel';

const n = (v: number) => v.toLocaleString(locale());

/** What's on the shelf, as rows (an icon, a name, how much): supplies first, then each unit of product. */
export function stashRows(mine: BunkerPerson | null): { section: 'items' | 'products'; icon: string; name: string; amount: string }[] {
  if (!mine) return [];
  const items = Object.entries(mine.inventory)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => {
      const item = bunkerItem(id);
      return { section: 'items' as const, icon: item?.icon ?? '📦', name: item?.name[lang()] ?? id, amount: `×${n(count)}` };
    });
  const products = mine.products.map((u) => {
    const kind = productKind(u.product);
    const pack = bunkerItem(u.pack);
    return {
      section: 'products' as const,
      icon: pack?.icon ?? kind?.icon ?? '📦',
      name: kind?.name[lang()] ?? u.product,
      amount: t('bunker.common.stash.unit', { grams: n(Math.round(u.grams * 10) / 10), quality: Math.round(u.quality * 100) }),
    };
  });
  return [...items, ...products];
}

export function openStash(): StationWindow {
  return stationWindow({
    station: 'stash',
    title: t('bunker.common.stash.title'),
    paint(body, mine) {
      const rows = stashRows(mine);
      if (!rows.length) return body.replaceChildren(h('p.bunker-empty', {}, t('bunker.common.stash.empty')));
      const list = (section: 'items' | 'products') => {
        const these = rows.filter((r) => r.section === section);
        if (!these.length) return [];
        return [
          h('h3.bunker-section', {}, t(section === 'items' ? 'bunker.common.stash.items' : 'bunker.common.stash.products')),
          h('ul.svc-list.bunker-stash', {}, ...these.map((r) => h('li', {}, h('span.jb-icon', {}, r.icon), h('div.svc-main', {}, h('div.svc-title', {}, r.name)), h('span.bunker-amount', {}, r.amount)))),
        ];
      };
      body.replaceChildren(...list('items'), ...list('products'));
    },
  });
}
