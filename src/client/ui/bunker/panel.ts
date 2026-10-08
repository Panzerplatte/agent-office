// What every bunker panel (ui/bunker/<feature>.ts) is built with: the hooks to the office, the PC's
// apps, the window a station opens, and its styles. What they share is in ui/bunker/bunker.css.
import type { BunkerFeature, BunkerPerson } from '../../../shared/bunker/index';
import { store } from '../../state';
import { t } from '../../i18n';
import { h, openModal, type Modal } from '../dom';

/** What a panel can ask of the office. */
export interface BunkerHooks {
  /** Does `action` at `feature` (a `bunker.act`): the office answers with your bunker as it is then, or a toast. */
  act(feature: BunkerFeature, action: string, args?: unknown): void;
}

/**
 * An app on the bunker's PC (see ui/bunker/pc.ts, which lists them): the supplier's shop (pc.ts's
 * own), the customers (customers.ts) and the cartel (cartel.ts).
 */
export interface PcApp {
  id: string;
  icon: string;
  title(): string;
  /** Fills `host` (the PC's screen) with the app. What it returns is called when the app's closed (another app, or the PC's window). */
  mount(host: HTMLElement, hooks: BunkerHooks): (() => void) | void;
}

export interface StationWindow {
  modal: Modal;
  el: HTMLElement;
  body: HTMLElement;
}

/**
 * A station's window: its title and ✕ on top, and a body that `paint` fills with your bunker as it
 * is, again whenever it changes (null: the office hasn't sent it yet). No info text under it (#92):
 * what it all means goes in the bunker's help.
 */
export function stationWindow(opts: { station: string; title: string; paint?: (body: HTMLElement, mine: BunkerPerson | null) => void; onClose?: () => void }): StationWindow {
  const close = h('button.btn.close', { 'aria-label': t('menus.close') }, '✕');
  const body = h('div.body.bunker-body');
  const el = h('div.modal.bunker-panel', { role: 'dialog', 'aria-label': opts.title, 'data-station': opts.station }, h('header', {}, h('h2', {}, opts.title), close), body);
  const paint = () => opts.paint?.(body, store.bunker);
  const off = opts.paint ? store.on('bunker', paint) : () => {};
  const modal = openModal(el, {
    onClose: () => {
      off();
      opts.onClose?.();
    },
  });
  close.addEventListener('click', () => modal.close());
  paint();
  return { modal, el, body };
}

/**
 * A feature's own styles (scope them by `.bunker-panel[data-station="<id>"]`), put on the page once:
 * kept in the feature's own file, so no two features edit the same stylesheet.
 */
export function bunkerStyle(id: string, css: string) {
  if (typeof document === 'undefined' || document.getElementById(`bunker-style-${id}`)) return;
  const el = document.createElement('style');
  el.id = `bunker-style-${id}`;
  el.textContent = css;
  document.head.append(el);
}
