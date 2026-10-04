import { floorPalette } from '../../shared/floors';
import { ROOF } from '../../shared/rooftop';
import { CASINO } from '../../shared/casino';
import type { FloorInfo } from '../../shared/protocol';
import { FLOOR_STYLES, type FloorStyle } from '../../shared/floorstyle';
import { store } from '../state';
import { h } from './dom';
import { t } from '../i18n';

// The floor list that drops down from the project in the corner: every floor of the building, top
// floor first. Picking one takes you straight there, to the same spot in the office you're standing
// in now. Adding a project is still the elevator's job.

export interface FloorMenuOptions {
  /** Go to that floor, staying where you are in the office. */
  go(floorId: string): void;
  /** Open the elevator's panel, to add a project. */
  elevator(): void;
  /** Up to the rooftop bar, by elevator. */
  roof(): void;
  /** Down to the casino, by elevator. */
  casino(): void;
  /** Switch the floor you're on to the office look or the bunker look, for everyone on it. */
  style(style: FloorStyle): void;
}

let current: { el: HTMLElement; close(): void } | null = null;

export function floorMenuOpen(): boolean {
  return !!current;
}

export function closeFloorMenu() {
  current?.close();
}

/** Opens the floor list under `anchor`, or closes it if it's open. */
export function toggleFloorMenu(anchor: HTMLElement, opts: FloorMenuOptions): void {
  if (current) return current.close();
  const el = h('div.floor-menu.panel', { role: 'menu', 'aria-label': t('menus.floors') });

  const item = (f: FloorInfo, i: number, here: number) => {
    const isHere = f.id === store.floor;
    const p = floorPalette(f.palette);
    const n = Math.abs(i - here);
    const where = isHere ? t('menus.youAreHere') : here < 0 ? '' : t(i > here ? 'menus.floorsUp' : 'menus.floorsDown', { n });
    const stats: HTMLElement[] = [];
    if (f.cloning) stats.push(h('span', {}, t('menus.cloning')));
    else {
      if (f.waiting) stats.push(h('span.waiting', { title: t('menus.statWaiting') }, `🙋 ${f.waiting}`));
      if (f.busy) stats.push(h('span', { title: t('menus.statWorking') }, `👷 ${f.busy}`));
      stats.push(h('span', { title: t('menus.statDesks') }, `💻 ${f.workers}`));
      if (f.people) stats.push(h('span', { title: t('menus.statPeople') }, `🧑 ${f.people}`));
    }
    const btn = h(
      'button.floor-item',
      { type: 'button', role: 'menuitem', class: isHere ? 'here' : '', disabled: isHere || f.cloning, title: isHere ? t('menus.onThisFloor') : f.cloning ? t('menus.stillCloning') : t('menus.goToFloor', { name: f.name }) },
      h('span.floor-no', { style: `background:${p.trim}` }, String(i + 1)),
      h('span.floor-text', {}, h('span.floor-name', {}, f.name), h('span.floor-sub', {}, where || (f.repo ?? f.dir))),
      h('span.floor-stats', {}, ...stats),
    );
    btn.addEventListener('click', () => {
      if (isHere || f.cloning) return;
      close();
      opts.go(f.id);
    });
    return btn;
  };

  const render = () => {
    const floors = store.floors;
    const here = floors.findIndex((f) => f.id === store.floor);
    const add = h('button.floor-item.add', { type: 'button', role: 'menuitem', title: t('menus.addTitle') }, h('span.floor-no', {}, '🛗'), h('span.floor-text', {}, h('span.floor-name', {}, t('menus.elevator')), h('span.floor-sub', {}, t('menus.addProject'))));
    add.addEventListener('click', () => {
      close();
      opts.elevator();
    });
    // Top floor first, the way a building's directory reads, and the roof over them.
    const items = floors.map((f, i) => item(f, i, here)).reverse();
    const onRoof = store.floor === ROOF;
    const people = [...store.peers.values()].filter((p) => p.floor === ROOF).length;
    const roof = h(
      'button.floor-item',
      { type: 'button', role: 'menuitem', class: onRoof ? 'here' : '', disabled: onRoof, title: onRoof ? t('menus.onRoof') : t('menus.rideUp') },
      h('span.floor-no', { style: 'background:#2b2d42' }, '🍸'),
      h('span.floor-text', {}, h('span.floor-name', {}, t('menus.roofName')), h('span.floor-sub', {}, onRoof ? t('menus.youAreHere') : t('menus.roofSub'))),
      h('span.floor-stats', {}, people ? h('span', { title: t('menus.peopleUpThere') }, `🧑 ${people}`) : ''),
    );
    roof.addEventListener('click', () => {
      if (onRoof) return;
      close();
      opts.roof();
    });
    // And the casino in the basement, under them all.
    const inCasino = store.floor === CASINO;
    const gamblers = [...store.peers.values()].filter((p) => p.floor === CASINO).length;
    const casino = h(
      'button.floor-item',
      { type: 'button', role: 'menuitem', class: inCasino ? 'here' : '', disabled: inCasino, title: inCasino ? t('menus.inCasino') : t('menus.rideDown') },
      h('span.floor-no', { style: 'background:#5b1530' }, '🎰'),
      h('span.floor-text', {}, h('span.floor-name', {}, t('menus.casinoName')), h('span.floor-sub', {}, inCasino ? t('menus.youAreHere') : t('menus.casinoSub'))),
      h('span.floor-stats', {}, gamblers ? h('span', { title: t('menus.peopleDownThere') }, `🧑 ${gamblers}`) : ''),
    );
    casino.addEventListener('click', () => {
      if (inCasino) return;
      close();
      opts.casino();
    });
    // The look of the floor you're on (not the roof's or the casino's): 🏢 office or 🛢️ bunker.
    const styles = here < 0 ? [] : [
      h(
        'div.seg.floor-style',
        { role: 'radiogroup', 'aria-label': t('menus.styleTitle'), title: t('menus.styleTitle') },
        ...FLOOR_STYLES.map((st) =>
          h(
            'button.btn',
            { type: 'button', role: 'radio', 'aria-checked': String(store.style === st), class: store.style === st ? 'on' : '', onclick: () => store.style !== st && opts.style(st) },
            t(st === 'bunker' ? 'menus.styleBunker' : 'menus.styleOffice'),
          ),
        ),
      ),
    ];
    el.replaceChildren(h('div.floor-menu-head', {}, `🏢 ${t('menus.floorCount', { n: floors.length })}`), ...styles, ...(floors.length ? [roof] : []), ...items, ...(floors.length ? [casino] : []), add);
  };

  const place = () => {
    const r = anchor.getBoundingClientRect();
    el.style.left = `${r.left}px`;
    el.style.top = `${r.bottom + 8}px`;
  };

  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!el.contains(t) && !anchor.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const offs = [store.on('floors', render), store.on('floor', render), store.on('style', render)];
  const close = () => {
    if (current?.el !== el) return;
    current = null;
    el.remove();
    anchor.classList.remove('open');
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    for (const off of offs) off();
  };
  render();
  document.body.append(el);
  place();
  anchor.classList.add('open');
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  current = { el, close };
}
