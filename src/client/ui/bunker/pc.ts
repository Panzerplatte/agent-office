// The bunker's PC (E at its desk): a screen of apps, one open at a time. The supplier's shop is the
// PC's own app (here); the customers' and the cartel's are theirs (customers.ts, cartel.ts), handed in
// by the foundation (ui/bunker/index.ts). A stub from the foundation (#118), filled in by #122: for
// now the list of apps, each opening to its title.
import { t } from '../../i18n';
import { h } from '../dom';
import { stationWindow, type BunkerHooks, type PcApp, type StationWindow } from './panel';

/** The supplier's shop: seeds, soil, lamps, the lab's ingredients and kit, packaging, for chips. */
export const shopApp: PcApp = {
  id: 'shop',
  icon: '🛒',
  title: () => t('bunker.pc.shop'),
  mount(host) {
    host.replaceChildren(h('h3.bunker-app-title', {}, `🛒 ${t('bunker.pc.shop')}`));
  },
};

/** Opens the PC with `apps` on its screen (the shop first, then the others'). */
export function openPc(hooks: BunkerHooks, apps: readonly PcApp[]): StationWindow {
  const win = stationWindow({ station: 'pc', title: t('bunker.pc.title'), onClose: () => unmount() });
  let unmount = () => {};
  const home = () => {
    unmount();
    unmount = () => {};
    const list = h('ul.svc-list.bunker-apps', { 'aria-label': t('bunker.pc.apps') });
    for (const app of apps) {
      const li = h('li', { tabindex: '0', 'data-app': app.id }, h('span.jb-icon', {}, app.icon), h('div.svc-main', {}, h('div.svc-title', {}, app.title())));
      const open = () => {
        const back = h('button.btn.bunker-back', {}, t('bunker.pc.back'));
        const screen = h('div.bunker-app');
        win.body.replaceChildren(back, screen);
        back.addEventListener('click', home);
        unmount = app.mount(screen, hooks) ?? (() => {});
      };
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open();
      });
      list.append(li);
    }
    win.body.replaceChildren(list);
  };
  home();
  return win;
}
