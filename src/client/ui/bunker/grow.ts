// The panel at the grow area (E at its spot in the bunker): a card for each of your pots, showing the
// plant, its stage, its water, how long it has to go and how good it'll be, with what you can do to
// it: fill it with soil, plant a seed, water, spray, hang a lamp, harvest, clear a dead one; and
// setting up another pot. Between the office's updates the timers count down by the same model the
// office grows the plants by (shared/bunker/grow.ts).
import type { BunkerPerson } from '../../../shared/bunker/index';
import { countItem } from '../../../shared/bunker/index';
import { MAX_POTS, THIRSTY, growItems, growStep, harvestOf, secondsLeft, stageOf, type Plant, type Pot } from '../../../shared/bunker/grow';
import { bunkerItem, productKind } from '../../../shared/bunker/items';
import { lang, t, type Key } from '../../i18n';
import { store } from '../../state';
import { h } from '../dom';
import { bunkerStyle, stationWindow, type BunkerHooks, type StationWindow } from './panel';

/** When the office last sent your bunker (performance.now()): the plants have grown on since. */
let got = typeof performance === 'undefined' ? 0 : performance.now();
store.on('bunker', () => (got = performance.now()));

/** The pot as it is by now: the office's, grown on by `secs` since it said (no pests guessed). */
export function potNow(pot: Pot, secs: number): Pot {
  if (!pot.plant) return pot;
  const now: Pot = { ...pot, plant: { ...pot.plant } };
  growStep(now, secs);
  return now;
}

/** "3:07", or "1:02:45". */
export function clock(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** What a plant looks like, in a word of emoji. */
export function plantIcon(plant: Plant | undefined, soil: boolean): string {
  if (!plant) return soil ? '🟫' : '🪴';
  if (plant.dead) return '🥀';
  return { seedling: '🌱', vegetative: '🌿', flowering: '🌸', ready: '🥦' }[stageOf(plant)];
}

/** What's said about a pot under its picture: its stage (or what it needs), and how long it has to go. */
export function potStatus(pot: Pot): { stage: string; timer: string } {
  const p = pot.plant;
  if (!p) return { stage: t(pot.soil ? 'bunker.grow.noPlant' : 'bunker.grow.noSoil'), timer: '' };
  if (p.dead) return { stage: t('bunker.grow.dead'), timer: '' };
  const stage = t(`bunker.grow.stage.${stageOf(p)}` as Key);
  if (p.growth >= 3) return { stage, timer: '' };
  const left = secondsLeft(pot);
  return { stage, timer: Number.isFinite(left) ? t('bunker.grow.readyIn', { time: clock(left) }) : t('bunker.grow.stopped') };
}

const name = (id: string) => bunkerItem(id)?.name[lang()] ?? id;
const icon = (id: string) => bunkerItem(id)?.icon ?? '📦';

function bar(kind: string, label: string): { el: HTMLElement; set(v: number, warn?: boolean): void } {
  const fill = h('span.grow-fill');
  const el = h('div.grow-bar', { 'data-kind': kind, role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
  return {
    el,
    set(v, warn = false) {
      const pct = Math.round(Math.min(1, Math.max(0, v)) * 100);
      fill.style.width = `${pct}%`;
      el.setAttribute('aria-valuenow', String(pct));
      el.classList.toggle('warn', warn);
    },
  };
}

/** A button doing `action` to pot `i`, off (with why) when `ok` is false. */
function button(label: string, onClick: () => void, opts: { ok?: boolean; why?: string; cls?: string } = {}): HTMLButtonElement {
  const b = h('button.btn.small', { class: opts.cls, title: opts.ok === false ? opts.why : undefined }, label);
  b.disabled = opts.ok === false;
  b.addEventListener('click', onClick);
  return b;
}

/** One pot's card. What it gives back is called every second, to count down. */
function potCard(hooks: BunkerHooks, mine: BunkerPerson, i: number): { el: HTMLElement; tick(secs: number): void } {
  const pot = mine.grow.pots[i];
  const act = (action: string, item?: string) => hooks.act('grow', action, item ? { pot: i, item } : { pot: i });
  const inv = mine.inventory;
  const items = growItems();
  const pic = h('div.grow-pic');
  const stage = h('div.grow-stage');
  const strain = h('div.grow-strain');
  const timer = h('div.grow-timer');
  const water = bar('water', t('bunker.grow.water'));
  const growth = bar('growth', t('bunker.grow.growth'));
  const flags = h('div.grow-flags');
  const actions = h('div.grow-actions');
  const lamp = h('div.grow-lamp');
  const buyAtPc = t('bunker.grow.buyAtPc');
  const p = pot.plant;
  // What can be done to it: depends on what's in it.
  if (!pot.soil) for (const s of items.soils) actions.append(button(`${s.icon} ${s.name[lang()]} ×${countItem(inv, s.id)}`, () => act('soil', s.id), { ok: countItem(inv, s.id) > 0, why: buyAtPc }));
  else if (!p) for (const s of items.seeds) actions.append(button(`${s.icon} ${s.name[lang()]} ×${countItem(inv, s.id)}`, () => act('plant', s.id), { ok: countItem(inv, s.id) > 0, why: buyAtPc }));
  else if (p.dead) actions.append(button(t('bunker.grow.doClear'), () => act('clear')));
  // The lamp over it: which one, and swapping it for another of yours.
  lamp.append(h('span.grow-lamp-name', {}, pot.lamp ? `${icon(pot.lamp)} ${name(pot.lamp)}` : t('bunker.grow.noLamp')));
  for (const l of items.lamps) if (l.id !== pot.lamp && countItem(inv, l.id) > 0) lamp.append(button(`${l.icon} ${l.name[lang()]}`, () => act('lamp', l.id)));
  if (pot.lamp) {
    const off = button('✕', () => act('unlamp'), { cls: 'grow-unlamp' });
    off.title = t('bunker.grow.doUnlamp');
    off.setAttribute('aria-label', t('bunker.grow.doUnlamp'));
    lamp.append(off);
  }
  // The buttons that come and go as it grows, made once.
  const doWater = button(t('bunker.grow.doWater'), () => act('water'), { cls: 'grow-water' });
  const doSpray = button(t('bunker.grow.doSpray'), () => act('spray'));
  const doHarvest = button(t('bunker.grow.doHarvest'), () => act('harvest'), { cls: 'primary' });
  if (p && !p.dead) actions.append(doWater, doSpray, doHarvest);
  const el = h(
    'div.grow-pot',
    { 'data-pot': i },
    h('div.grow-head', {}, h('span.grow-name', {}, t('bunker.grow.pot', { n: i + 1 })), strain),
    h('div.grow-main', {}, pic, h('div.grow-info', {}, stage, timer)),
    p && !p.dead ? h('div.grow-bars', {}, h('span.grow-label', {}, '💧'), water.el, h('span.grow-label', {}, '🌿'), growth.el) : null,
    flags,
    actions,
    lamp,
  );
  if (p) strain.textContent = productKind(bunkerItem(p.seed)?.grows)?.name[lang()] ?? '';
  const tick = (secs: number) => {
    const now = potNow(pot, secs);
    const q = now.plant;
    pic.textContent = plantIcon(q, !!now.soil);
    const s = potStatus(now);
    stage.textContent = s.stage;
    timer.textContent = s.timer;
    el.dataset.stage = q ? (q.dead ? 'dead' : stageOf(q)) : 'empty';
    if (!q || q.dead) return;
    water.set(q.water, q.water < THIRSTY);
    growth.set(q.growth / 3);
    const crop = harvestOf(now);
    const badges = [h('span.grow-flag', {}, t('bunker.grow.quality', { quality: Math.round((crop?.quality ?? q.care) * 100) }))];
    if (q.dry > 0) badges.push(h('span.grow-flag.bad', {}, t('bunker.grow.wilting')));
    else if (q.water < THIRSTY && q.growth < 3) badges.push(h('span.grow-flag.warn', {}, t('bunker.grow.thirsty')));
    if (q.pests) badges.push(h('span.grow-flag.bad', {}, `🐛 ${t('bunker.grow.hasPests')}`));
    flags.replaceChildren(...badges);
    doWater.hidden = q.growth >= 3;
    doWater.disabled = q.water >= 0.95;
    doSpray.hidden = !q.pests;
    doHarvest.hidden = q.growth < 3;
  };
  tick(0);
  return { el, tick };
}

const CSS = `
.bunker-panel[data-station="grow"] { width: min(680px, 100%); }
.bunker-panel[data-station="grow"] .grow-pots { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.bunker-panel[data-station="grow"] .grow-pot { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: #fff; border: 3px solid var(--ink); border-radius: 12px; }
.bunker-panel[data-station="grow"] .grow-pot[data-stage="ready"] { background: #eefbe3; }
.bunker-panel[data-station="grow"] .grow-pot[data-stage="dead"] { background: #f3ebe4; }
.bunker-panel[data-station="grow"] .grow-head { display: flex; justify-content: space-between; gap: 6px; font-size: 13px; font-weight: 900; }
.bunker-panel[data-station="grow"] .grow-strain { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bunker-panel[data-station="grow"] .grow-main { display: flex; align-items: center; gap: 10px; }
.bunker-panel[data-station="grow"] .grow-pic { flex: none; width: 46px; height: 46px; display: grid; place-items: center; font-size: 30px; background: var(--paper-2); border-radius: 10px; }
.bunker-panel[data-station="grow"] .grow-stage { font-weight: 900; font-size: 14px; }
.bunker-panel[data-station="grow"] .grow-timer { font-size: 12px; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
.bunker-panel[data-station="grow"] .grow-bars { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px 6px; font-size: 12px; }
.bunker-panel[data-station="grow"] .grow-bar { height: 10px; border: 2px solid var(--ink); border-radius: 6px; background: var(--paper); overflow: hidden; }
.bunker-panel[data-station="grow"] .grow-fill { display: block; height: 100%; background: var(--good); transition: width .4s; }
.bunker-panel[data-station="grow"] .grow-bar[data-kind="water"] .grow-fill { background: var(--info); }
.bunker-panel[data-station="grow"] .grow-bar.warn .grow-fill { background: var(--bad); }
.bunker-panel[data-station="grow"] .grow-flags { display: flex; flex-wrap: wrap; gap: 4px; }
.bunker-panel[data-station="grow"] .grow-flags:empty { display: none; }
.bunker-panel[data-station="grow"] .grow-flag { padding: 1px 7px; font-size: 11px; font-weight: 800; border: 2px solid var(--ink); border-radius: 999px; background: var(--paper); }
.bunker-panel[data-station="grow"] .grow-flag.warn { background: var(--warn); }
.bunker-panel[data-station="grow"] .grow-flag.bad { background: var(--bad); color: #fff; }
.bunker-panel[data-station="grow"] .grow-actions, .bunker-panel[data-station="grow"] .grow-lamp { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.bunker-panel[data-station="grow"] .grow-actions:empty { display: none; }
.bunker-panel[data-station="grow"] .grow-lamp { margin-top: auto; padding-top: 6px; border-top: 2px dashed #d6d0c6; font-size: 12px; }
.bunker-panel[data-station="grow"] .grow-lamp-name { flex: 1 1 auto; font-weight: 800; color: var(--muted); }
.bunker-panel[data-station="grow"] .btn.small { padding: 3px 8px; font-size: 12px; border-width: 2px; border-radius: 9px; box-shadow: 0 2px 0 var(--ink); white-space: normal; text-align: left; }
.bunker-panel[data-station="grow"] .btn[hidden] { display: none; }
.bunker-panel[data-station="grow"] .grow-add { margin-top: 10px; }
`;

export function openGrow(hooks: BunkerHooks): StationWindow {
  bunkerStyle('grow', CSS);
  let ticks: ((secs: number) => void)[] = [];
  const every = setInterval(() => {
    const secs = (performance.now() - got) / 1000;
    for (const tick of ticks) tick(secs);
  }, 1000);
  return stationWindow({
    station: 'grow',
    title: t('bunker.grow.title'),
    onClose: () => clearInterval(every),
    paint(body, mine) {
      ticks = [];
      if (!mine) return body.replaceChildren();
      const secs = (performance.now() - got) / 1000;
      const cards = mine.grow.pots.map((_, i) => potCard(hooks, mine, i));
      for (const c of cards) c.tick(secs);
      ticks = cards.map((c) => c.tick);
      const grid = h('div.grow-pots', {}, ...cards.map((c) => c.el));
      const spare = countItem(mine.inventory, 'pot');
      const add = mine.grow.pots.length < MAX_POTS ? button(t('bunker.grow.addPot', { n: spare }), () => hooks.act('grow', 'addPot'), { ok: spare > 0, why: t('bunker.grow.buyAtPc'), cls: 'grow-add' }) : null;
      body.replaceChildren(grid, ...(add ? [add] : []));
    },
  });
}
