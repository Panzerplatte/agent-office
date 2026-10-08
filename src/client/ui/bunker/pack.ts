// The panel at the packing table (E at its spot in the bunker): pick a loose unit of product and a
// packaging (and, with the packing machine, how many), then scoop onto the scale and seal. The scale
// is the office's (see server/bunker/pack.ts): every scoop is a `bunker.act`, and what the scale shows
// comes back with your bunker. Below it, what you've packed, stacked.
import type { BunkerPerson } from '../../../shared/bunker/index';
import { countItem } from '../../../shared/bunker/index';
import { bunkerItem, productKind } from '../../../shared/bunker/items';
import { MAX_FILL, PACKS, SCOOP_IDS, SPOT_ON, benchTarget, looseUnits, maxBatch, packHolds, packItem, packedStacks, reading, type PackId, type PackState } from '../../../shared/bunker/pack';
import { lang, locale, t, type Key } from '../../i18n';
import { h } from '../dom';
import { bunkerStyle, stationWindow, type BunkerHooks, type StationWindow } from './panel';

const n = (v: number, digits = 2) => v.toLocaleString(locale(), { maximumFractionDigits: digits });

const CSS = `
.bunker-panel[data-station="pack"] .pk-packs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.bunker-panel[data-station="pack"] .pk-pack { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; }
.bunker-panel[data-station="pack"] .pk-pack.on { background: #fff1de; border-color: var(--accent); }
.bunker-panel[data-station="pack"] .pk-pack b { font-size: 20px; line-height: 1; }
.bunker-panel[data-station="pack"] .pk-pack small { font-size: 11px; font-weight: 700; color: var(--muted); }
.bunker-panel[data-station="pack"] .pk-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.bunker-panel[data-station="pack"] .grow { flex: 1; }
.bunker-panel[data-station="pack"] .pk-count { min-width: 2.5ch; text-align: center; font-weight: 900; font-size: 16px; font-variant-numeric: tabular-nums; }
.bunker-panel[data-station="pack"] .pk-what { display: flex; align-items: center; gap: 10px; font-weight: 800; }
.bunker-panel[data-station="pack"] .pk-scale { margin-top: 10px; padding: 14px 16px 12px; border: 3px solid var(--ink); border-radius: 14px; background: #262a26; color: #b8f5b0; box-shadow: 0 3px 0 var(--ink); }
.bunker-panel[data-station="pack"] .pk-lcd { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
.bunker-panel[data-station="pack"] .pk-grams { font-size: 38px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 1px; text-shadow: 0 0 8px rgba(140, 255, 130, 0.45); }
.bunker-panel[data-station="pack"] .pk-target { font-size: 13px; opacity: 0.8; }
.bunker-panel[data-station="pack"] .pk-read { font-family: var(--font); font-weight: 900; font-size: 13px; padding: 2px 8px; border-radius: 8px; background: #3a403a; }
.bunker-panel[data-station="pack"] .pk-read.on { background: var(--good); color: #0b2a20; }
.bunker-panel[data-station="pack"] .pk-read.over { background: var(--bad); color: #fff; }
.bunker-panel[data-station="pack"] .pk-read.under { background: var(--warn); color: #3a2a00; }
.bunker-panel[data-station="pack"] .pk-bar { position: relative; height: 12px; margin-top: 10px; border-radius: 6px; background: #3a403a; overflow: hidden; }
.bunker-panel[data-station="pack"] .pk-fill { position: absolute; inset: 0 auto 0 0; background: #8fe388; transition: width 0.25s ease-out; }
.bunker-panel[data-station="pack"] .pk-fill.over { background: var(--bad); }
.bunker-panel[data-station="pack"] .pk-band { position: absolute; top: 0; bottom: 0; background: rgba(255, 255, 255, 0.28); border-left: 2px solid #fff; }
@media (prefers-reduced-motion: reduce) { .bunker-panel[data-station="pack"] .pk-fill { transition: none; } }
`;

/** What you've picked at the table, before it goes on the scale (kept while the panel's open). */
interface Pick {
  from: string | null;
  pack: PackId;
  count: number;
}

export function openPack(hooks: BunkerHooks): StationWindow {
  bunkerStyle('pack', CSS);
  const pick: Pick = { from: null, pack: 'bag', count: 1 };
  const act = (action: string, args?: unknown) => hooks.act('pack', action, args);
  const paint = (body: HTMLElement, mine: BunkerPerson | null) => {
    if (!mine) return body.replaceChildren();
    const state = mine.pack as PackState | undefined;
    const main = state?.bench ? benchView(mine, state.bench, act) : pickView(mine, pick, () => paint(body, mine), act);
    body.replaceChildren(...main, ...packedView(mine));
  };
  return stationWindow({ station: 'pack', title: t('bunker.pack.title'), paint });
}

function unitLabel(product: string): { icon: string; name: string } {
  const kind = productKind(product);
  return { icon: kind?.icon ?? '📦', name: kind?.name[lang()] ?? product };
}

/** Choosing what to pack: a loose unit, a packaging, how many. */
function pickView(mine: BunkerPerson, pick: Pick, repaint: () => void, act: (action: string, args?: unknown) => void): HTMLElement[] {
  const loose = looseUnits(mine);
  if (!loose.some((u) => u.id === pick.from)) pick.from = loose[0]?.id ?? null;
  const batch = maxBatch(mine);
  pick.count = Math.max(1, Math.min(pick.count, batch));
  if (!loose.length) return [h('p.bunker-empty', {}, t('bunker.pack.noLoose'))];

  const units = h(
    'ul.svc-list',
    { 'aria-label': t('bunker.pack.product') },
    ...loose.map((u) => {
      const { icon, name } = unitLabel(u.product);
      const choose = () => {
        pick.from = u.id;
        repaint();
      };
      return h(
        `li${u.id === pick.from ? '.on' : ''}`,
        { tabindex: '0', 'aria-selected': u.id === pick.from ? 'true' : 'false', onclick: choose, onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && choose() },
        h('span.jb-icon', {}, icon),
        h('div.svc-main', {}, h('div.svc-title', {}, name)),
        h('span.bunker-amount', {}, t('bunker.pack.loose', { grams: n(u.grams), quality: Math.round(u.quality * 100) })),
      );
    }),
  );
  const packs = h(
    'div.pk-packs',
    { role: 'group', 'aria-label': t('bunker.pack.packaging') },
    ...PACKS.map((id) => {
      const item = packItem(id);
      const have = countItem(mine.inventory, id);
      return h(
        `button.btn.pk-pack${id === pick.pack ? '.on' : ''}`,
        {
          'aria-pressed': id === pick.pack ? 'true' : 'false',
          title: item.name[lang()],
          onclick: () => {
            pick.pack = id;
            repaint();
          },
        },
        h('b', {}, item.icon),
        h('span', {}, `${n(packHolds(id))} g`),
        h('small', {}, t('bunker.pack.have', { n: have })),
      );
    }),
  );
  const row = h('div.pk-row');
  if (batch > 1) {
    const step = (d: number) => () => {
      pick.count = Math.max(1, Math.min(batch, pick.count + d));
      repaint();
    };
    row.append(
      h('span', {}, t('bunker.pack.count')),
      h('button.btn', { 'aria-label': '−', disabled: pick.count <= 1, onclick: step(-1) }, '−'),
      h('span.pk-count', { 'aria-live': 'polite' }, String(pick.count)),
      h('button.btn', { 'aria-label': '+', disabled: pick.count >= batch, onclick: step(1) }, '+'),
    );
  }
  row.append(
    h('span.grow'),
    h(
      'button.btn.primary',
      { disabled: !pick.from || countItem(mine.inventory, pick.pack) < pick.count, onclick: () => act('start', { from: pick.from, pack: pick.pack, count: pick.count }) },
      t('bunker.pack.start'),
    ),
  );
  return [h('h3.bunker-section', {}, t('bunker.pack.product')), units, h('h3.bunker-section', {}, t('bunker.pack.packaging')), packs, row];
}

/** The scale, with what's on it, and the scoops. */
function benchView(mine: BunkerPerson, bench: NonNullable<PackState['bench']>, act: (action: string, args?: unknown) => void): HTMLElement[] {
  const from = mine.products.find((u) => u.id === bench.from);
  const { icon, name } = unitLabel(from?.product ?? '');
  const target = benchTarget(bench);
  const read = reading(bench.grams, target);
  const pack = bunkerItem(bench.pack);
  const fill = h(`div.pk-fill${read === 'over' ? '.over' : ''}`);
  fill.style.width = `${Math.min(100, (bench.grams / (target * MAX_FILL)) * 100)}%`;
  const band = h('div.pk-band');
  band.style.left = `${((1 - SPOT_ON) / MAX_FILL) * 100}%`;
  band.style.width = `${((2 * SPOT_ON) / MAX_FILL) * 100}%`;
  const scale = h(
    'div.pk-scale',
    {},
    h('div.pk-lcd', {}, h('span.pk-grams', { 'aria-live': 'polite' }, `${n(bench.grams)} g`), h(`span.pk-read.${read}`, {}, t(`bunker.pack.read.${read}` as Key))),
    h('div.pk-target', {}, t('bunker.pack.target', { target: n(target) })),
    h('div.pk-bar', { 'aria-hidden': 'true' }, fill, band),
  );
  const what = h('div.pk-what', {}, h('span.jb-icon', {}, icon), h('span.grow', {}, name), h('span.bunker-amount', {}, `${pack?.icon ?? ''} ${bench.count} × ${n(packHolds(bench.pack))} g`));
  const scoops = h('div.pk-row', {}, ...SCOOP_IDS.map((s) => h('button.btn', { onclick: () => act('add', s) }, t(`bunker.pack.scoop.${s}` as Key))));
  const end = h(
    'div.pk-row',
    {},
    h('button.btn', { disabled: bench.grams === 0, onclick: () => act('empty') }, t('bunker.pack.empty')),
    h('button.btn', { onclick: () => act('stop') }, t('bunker.pack.stop')),
    h('span.grow'),
    h('button.btn.primary', { disabled: read === 'low', onclick: () => act('seal') }, t('bunker.pack.seal')),
  );
  return [what, scale, scoops, end];
}

/** What you've packed, stacked. */
function packedView(mine: BunkerPerson): HTMLElement[] {
  const stacks = packedStacks(mine.products);
  if (!stacks.length) return [];
  return [
    h('h3.bunker-section', {}, t('bunker.pack.packed')),
    h(
      'ul.svc-list.bunker-stash',
      {},
      ...stacks.map((s) => {
        const { name } = unitLabel(s.product);
        const pack = bunkerItem(s.pack);
        return h(
          'li',
          {},
          h('span.jb-icon', {}, pack?.icon ?? '📦'),
          h('div.svc-main', {}, h('div.svc-title', {}, `${name} · ${pack?.name[lang()] ?? s.pack}`)),
          h('span.bunker-amount', {}, t('bunker.pack.stack', { n: s.ids.length, grams: n(s.grams), quality: Math.round(s.quality * 100) })),
        );
      }),
    ),
  ];
}
