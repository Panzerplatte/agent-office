import { DRINKS, type Drink } from '../../shared/rooftop';
import { h, openModal } from './dom';
import { t } from '../i18n';
import { drinkBlurb, drinkName } from '../i18n/labels';

export interface BarOptions {
  /** Had enough: nothing stronger than water or a mocktail. */
  cutOff: boolean;
  /** At the casino's bar, which pours its own few as well (the roof's pours only the usual). */
  casino?: boolean;
  order(d: Drink): void;
}

/** How hard a drink hits, for the menu. */
function kick(d: Drink): string {
  if (d.strength < 0) return t('menus.barSobers');
  if (d.strength === 0) return t('menus.barNone');
  return t(d.strength >= 0.55 ? 'menus.barStrong' : d.strength >= 0.4 ? 'menus.barMedium' : 'menus.barLight');
}

/** The rooftop bar's menu (or the casino's): pick a drink and the bartender pours it. */
export function openBar(opts: BarOptions) {
  const close = h('button.btn.close', { 'aria-label': t('menus.close') }, '✕');
  const list = h(
    'ul.svc-list',
    {},
    ...DRINKS.filter((d) => opts.casino || !d.casino).map((d) => {
      const refused = opts.cutOff && d.strength > 0;
      const li = h(
        'li',
        {
          tabindex: refused ? -1 : 0,
          role: 'button',
          'aria-disabled': String(refused),
          title: refused ? t('menus.barRefused') : t('menus.barOrder', { drink: drinkName(d) }),
          style: refused ? 'opacity:.45;cursor:not-allowed' : '',
        },
        h('span.jb-icon', { style: 'font-size:26px' }, d.emoji),
        h('div.svc-main', {}, h('div.svc-title', {}, drinkName(d)), h('div.svc-meta', {}, `${drinkBlurb(d)} · ${kick(d)}`)),
      );
      const pick = () => {
        if (refused) return;
        modal.close();
        opts.order(d);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      return li;
    }),
  );
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': t('menus.bar') },
    h('header', {}, h('h2', {}, t(opts.casino ? 'menus.casinoBarTitle' : 'menus.barTitle')), close),
    h(
      'div.body',
      {},
      opts.cutOff ? h('p.setting-note', { style: 'margin:0 0 12px;font-weight:800' }, t('menus.barCutOff')) : null,
      list,
    ),
    h('footer', {}, h('span.grow', {}, t('menus.barFoot'))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  setTimeout(() => (list.querySelector('li[tabindex="0"]') as HTMLElement | null)?.focus(), 30);
}
