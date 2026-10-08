// The panel at the lab bench (E at its spot in the bunker): the recipes and what each needs, the batch on
// the bench, and its mini-game (see shared/bunker/lab.ts for the rules and the scores). It's all a game:
// made-up products, made-up steps.
//
//   heat   (Glimmer)   hold the flame so the burner's needle stays in the green band; boiling over ruins it
//   press  (Fizz tabs) mix the powder to the shade on the card, then press tablets as the marker crosses the zone
//   drops  (Nebula)    watch the drops go in, then put them in in the same order, three rounds
import type { BunkerPerson } from '../../../shared/bunker/index';
import { countItem } from '../../../shared/bunker/index';
import { bunkerItem, productKind } from '../../../shared/bunker/items';
import { DROPS, HEAT, PRESS, RECIPES, dropSequence, dropsQuality, heatQuality, heatStep, missingFor, mixScore, playing, pressHit, pressMarker, pressQuality, recipe, type LabBatch, type Recipe } from '../../../shared/bunker/lab';
import { lang, t, type Key } from '../../i18n';
import { h } from '../dom';
import { bunkerStyle, stationWindow, type BunkerHooks, type StationWindow } from './panel';

const S = '.bunker-panel[data-station="lab"]';
const CSS = `
${S} .lab-recipes { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
${S} .lab-recipe { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 12px; align-items: center; padding: 10px 12px; border-radius: 12px; background: rgba(0,0,0,.05); }
${S} .lab-icon { grid-row: span 2; font-size: 28px; }
${S} .lab-name { font-weight: 900; }
${S} .lab-name small { margin-left: 6px; font-weight: 700; color: var(--muted); }
${S} .lab-needs { display: flex; flex-wrap: wrap; gap: 4px; grid-column: 2; }
${S} .lab-need { padding: 1px 7px; border-radius: 999px; font-size: 12px; font-weight: 800; background: rgba(46,125,50,.14); color: #2e6b31; font-variant-numeric: tabular-nums; }
${S} .lab-need.short { background: rgba(198,40,40,.12); color: #b23a3a; }
${S} .lab-recipe .btn { grid-row: 1 / span 2; grid-column: 3; }
${S} .lab-bench { display: grid; gap: 12px; }
${S} .lab-head { display: flex; align-items: center; gap: 10px; font-weight: 900; font-size: 16px; }
${S} .lab-head .lab-icon { font-size: 26px; }
${S} .lab-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
${S} .lab-meter { position: relative; height: 26px; border-radius: 8px; background: linear-gradient(90deg, #6aa0d8, #d9dcd6 40%, #f0b35a 75%, #d9452f); overflow: hidden; }
${S} .lab-meter .band { position: absolute; top: 0; bottom: 0; background: rgba(60,180,75,.55); border-left: 2px solid #2e7d32; border-right: 2px solid #2e7d32; }
${S} .lab-meter .over { position: absolute; top: 0; bottom: 0; right: 0; background: repeating-linear-gradient(45deg, rgba(120,0,0,.35) 0 6px, transparent 6px 12px); }
${S} .lab-meter .needle { position: absolute; top: -2px; bottom: -2px; width: 4px; margin-left: -2px; border-radius: 2px; background: #1d1d1b; box-shadow: 0 0 0 2px #fff; }
${S} .lab-meter .zone { position: absolute; top: 0; bottom: 0; background: rgba(255,255,255,.55); border-left: 2px solid #fff; border-right: 2px solid #fff; }
${S} .lab-meter.press { background: linear-gradient(90deg, #9aa3ab, #c9ced3); }
${S} .lab-meter.rest { background: #d9dcd6; }
${S} .lab-meter.rest .fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #7cc4e8, #3b8fd0); transition: width .4s linear; }
${S} .lab-meter.rest.ready .fill { background: linear-gradient(90deg, #8fd694, #2e7d32); }
${S} .lab-status { font-weight: 800; font-variant-numeric: tabular-nums; color: var(--muted); }
${S} .lab-swatches { display: flex; gap: 14px; align-items: center; }
${S} .lab-swatch { width: 64px; height: 44px; border-radius: 10px; border: 2px solid rgba(0,0,0,.2); }
${S} .lab-swatch-label { font-size: 12px; font-weight: 800; color: var(--muted); }
${S} .lab-slider { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; font-size: 13px; font-weight: 800; }
${S} .lab-slider input { width: 100%; }
${S} .lab-tablets { display: flex; gap: 6px; }
${S} .lab-tablet { width: 22px; height: 22px; border-radius: 50%; border: 2px dashed rgba(0,0,0,.25); }
${S} .lab-tablet.done { border-style: solid; }
${S} .lab-bottles { display: flex; gap: 10px; }
${S} .lab-bottle { flex: 1; min-height: 64px; font-size: 26px; display: grid; place-items: center; gap: 2px; padding: 6px; transition: transform .1s, box-shadow .1s; }
${S} .lab-bottle small { font-size: 11px; font-weight: 800; }
${S} .lab-bottle.lit { transform: translateY(-4px) scale(1.06); box-shadow: 0 0 0 3px var(--accent); }
${S} .lab-puff { position: relative; height: 0; }
${S} .lab-puff::after { content: ''; position: absolute; left: 50%; top: -30px; width: 60px; height: 60px; margin-left: -30px; border-radius: 50%; background: radial-gradient(circle, rgba(90,90,90,.75), rgba(90,90,90,0) 70%); animation: lab-puff 1.2s ease-out forwards; }
@keyframes lab-puff { from { transform: scale(.3); opacity: 1; } to { transform: translateY(-40px) scale(2.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { ${S} .lab-puff::after { animation-duration: .01s; } ${S} .lab-bottle { transition: none; } }
`;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const itemName = (id: string) => bunkerItem(id)?.name[lang()] ?? id;
const itemIcon = (id: string) => bunkerItem(id)?.icon ?? '📦';
const productName = (r: Recipe) => productKind(r.product)?.name[lang()] ?? r.product;
const productIcon = (r: Recipe) => productKind(r.product)?.icon ?? '🧪';
const tk = (k: string) => `bunker.lab.${k}` as Key;

/** The fizz powder's shade at a mix (0: all fizzium salt, white; 1: all moon syrup, deep amber). */
export function mixColor(mix: number): string {
  const m = Math.min(1, Math.max(0, mix));
  const a = [246, 244, 236];
  const b = [214, 120, 40];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * m)).join(',')})`;
}

/** A mini-game being played in the panel: `stop` ends it without a word to the office. */
interface Game {
  stop(): void;
}

/** What a game says when it's over: the batch's quality, or that it boiled over. */
type Outcome = { quality: number } | { ruined: true };

/**
 * Keys while a game runs (Space, 1–3), taken before anything else on the page sees them, so they don't
 * also walk or jump you.
 */
function grabKeys(on: (e: KeyboardEvent, down: boolean) => boolean): () => void {
  const down = (e: KeyboardEvent) => {
    if (on(e, true)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const up = (e: KeyboardEvent) => {
    if (on(e, false)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', down, true);
  window.addEventListener('keyup', up, true);
  return () => {
    window.removeEventListener('keydown', down, true);
    window.removeEventListener('keyup', up, true);
  };
}

/** Every frame until stopped: `step(dt)` (seconds), and false from it stops it. */
function frames(step: (dt: number) => boolean | void): () => void {
  let last = performance.now();
  let id = 0;
  let live = true;
  const loop = (now: number) => {
    if (!live) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (step(dt) === false) return;
    id = requestAnimationFrame(loop);
  };
  id = requestAnimationFrame(loop);
  return () => {
    live = false;
    cancelAnimationFrame(id);
  };
}

// ---- The burner (Glimmer) ----------------------------------------------------------------------------------

function heatGame(host: HTMLElement, done: (o: Outcome) => void): Game {
  const band = h('div.band', { style: `left:${HEAT.band[0]}%;width:${HEAT.band[1] - HEAT.band[0]}%` });
  const needle = h('div.needle');
  const meter = h('div.lab-meter', { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100' }, band, h('div.over', { style: `width:${100 - HEAT.over}%` }), needle);
  const status = h('span.lab-status');
  const flameBtn = h('button.btn.primary', { type: 'button' }, t(tk('heat.flame')));
  const puff = h('div.lab-puff', { hidden: true });
  host.replaceChildren(h('div.lab-bench', {}, puff, meter, h('div.lab-row', {}, flameBtn, status)));

  let temp: number = HEAT.start;
  let time = 0;
  let inBand = 0;
  let flame = false;
  let over = false;
  const hold = (v: boolean) => {
    flame = v;
    flameBtn.classList.toggle('on', v);
  };
  flameBtn.addEventListener('pointerdown', (e) => {
    flameBtn.setPointerCapture?.(e.pointerId);
    hold(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) flameBtn.addEventListener(ev, () => hold(false));
  const keys = grabKeys((e, down) => {
    if (e.code !== 'Space') return false;
    hold(down);
    return true;
  });
  const stopFrames = frames((dt) => {
    time += dt;
    temp = heatStep(temp, flame, dt, Math.sin(time * 2.3) * 0.6 + Math.sin(time * 5.1) * 0.4);
    if (temp >= HEAT.band[0] && temp <= HEAT.band[1]) inBand += dt;
    needle.style.left = `${temp}%`;
    meter.setAttribute('aria-valuenow', String(Math.round(temp)));
    status.textContent = t(tk('heat.left'), { s: Math.max(0, Math.ceil(HEAT.seconds - time)) });
    if (temp >= HEAT.over) {
      over = true;
      puff.hidden = false;
      finish();
      return false;
    }
    if (time >= HEAT.seconds) {
      finish();
      return false;
    }
  });
  const stop = () => {
    stopFrames();
    keys();
    hold(false);
  };
  const finish = () => {
    stop();
    flameBtn.disabled = true;
    const q = heatQuality(inBand / HEAT.seconds, over);
    // Let the puff of smoke show before the office answers.
    setTimeout(() => done(q === null ? { ruined: true } : { quality: q }), over ? 900 : 0);
  };
  return { stop };
}

// ---- The tablet press (Fizz tabs) -------------------------------------------------------------------------

function pressGame(host: HTMLElement, done: (o: Outcome) => void): Game {
  const target = 0.25 + Math.random() * 0.5;
  const center = 0.2 + Math.random() * 0.6;
  let mix = 0;
  let stopFrames = () => {};
  let keys = () => {};

  // First the powder: mix it to the card's shade.
  const card = h('div.lab-swatch', { style: `background:${mixColor(target)}` });
  const yours = h('div.lab-swatch', { style: `background:${mixColor(0.5)}` });
  const slider = h('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': t(tk('press.mix')) });
  slider.addEventListener('input', () => {
    yours.style.background = mixColor(Number(slider.value) / 100);
  });
  const mixBtn = h('button.btn.primary', { type: 'button' }, t(tk('press.mixIt')));
  host.replaceChildren(
    h(
      'div.lab-bench',
      {},
      h('div.lab-swatches', {}, h('div', {}, card, h('div.lab-swatch-label', {}, t(tk('press.card')))), h('div', {}, yours, h('div.lab-swatch-label', {}, t(tk('press.mix'))))),
      h('label.lab-slider', {}, h('span', {}, `${itemIcon('fizzium')} ${itemName('fizzium')}`), slider, h('span', {}, `${itemIcon('moon-syrup')} ${itemName('moon-syrup')}`)),
      h('div.lab-row', {}, mixBtn),
    ),
  );
  mixBtn.addEventListener('click', () => {
    mix = mixScore(Number(slider.value) / 100, target);
    pressing();
  });

  // Then the press: a tablet each time, best when the marker's in the zone.
  const pressing = () => {
    const zone = h('div.zone', { style: `left:${(center - PRESS.zone) * 100}%;width:${PRESS.zone * 200}%` });
    const needle = h('div.needle');
    const tablets = Array.from({ length: PRESS.tablets }, () => h('span.lab-tablet'));
    const pressBtn = h('button.btn.primary', { type: 'button' }, t(tk('press.press')));
    host.replaceChildren(h('div.lab-bench', {}, h('div.lab-meter.press', {}, zone, needle), h('div.lab-row', {}, pressBtn, h('div.lab-tablets', {}, ...tablets))));
    const hits: number[] = [];
    let time = 0;
    let marker = 0;
    const press = () => {
      if (hits.length >= PRESS.tablets) return;
      const hit = pressHit(marker, center);
      const el = tablets[hits.length];
      el.classList.add('done');
      el.style.background = hit > 0 ? mixColor(target) : '#9aa3ab';
      el.style.opacity = String(0.35 + hit * 0.65);
      hits.push(hit);
      if (hits.length >= PRESS.tablets) {
        stop();
        pressBtn.disabled = true;
        done({ quality: pressQuality(mix, hits) });
      }
    };
    pressBtn.addEventListener('click', press);
    keys = grabKeys((e, down) => {
      if (e.code !== 'Space') return false;
      if (down && !e.repeat) press();
      return true;
    });
    stopFrames = frames((dt) => {
      time += dt;
      marker = pressMarker(time);
      needle.style.left = pct(marker);
    });
  };

  const stop = () => {
    stopFrames();
    keys();
  };
  return { stop };
}

// ---- The drops (Nebula) -----------------------------------------------------------------------------------

function dropsGame(host: HTMLElement, done: (o: Outcome) => void): Game {
  const bottles = DROPS.bottles.map((id, i) => h('button.btn.lab-bottle', { type: 'button', 'data-bottle': id }, itemIcon(id), h('small', {}, `${i + 1} · ${itemName(id)}`)));
  const status = h('span.lab-status');
  host.replaceChildren(h('div.lab-bench', {}, h('div.lab-bottles', {}, ...bottles), h('div.lab-row', {}, status)));
  const right: number[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let seq: number[] = [];
  let at = 0;
  let turn = false;
  let over = false;
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  const light = (i: number, ms: number) => {
    bottles[i].classList.add('lit');
    later(ms, () => bottles[i].classList.remove('lit'));
  };
  const round = () => {
    const r = right.length;
    if (r >= DROPS.rounds.length) {
      over = true;
      stop();
      done({ quality: dropsQuality(right) });
      return;
    }
    seq = dropSequence(DROPS.rounds[r]);
    at = 0;
    turn = false;
    status.textContent = `${t(tk('drops.round'), { n: r + 1, of: DROPS.rounds.length })} · ${t(tk('drops.watch'))}`;
    seq.forEach((b, i) => later(700 + i * 650, () => light(b, 420)));
    later(700 + seq.length * 650, () => {
      turn = true;
      status.textContent = `${t(tk('drops.round'), { n: r + 1, of: DROPS.rounds.length })} · ${t(tk('drops.yourTurn'))}`;
    });
  };
  const put = (b: number) => {
    if (!turn || over) return;
    light(b, 180);
    if (seq[at] === b) at++;
    else {
      // Wrong drop: the round's over with what was right so far.
      turn = false;
      right.push(at);
      later(500, round);
      return;
    }
    if (at >= seq.length) {
      turn = false;
      right.push(at);
      later(500, round);
    }
  };
  bottles.forEach((el, i) => el.addEventListener('click', () => put(i)));
  const keys = grabKeys((e, down) => {
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (i < 0) return false;
    if (down && !e.repeat) put(i);
    return true;
  });
  const stop = () => {
    keys();
    for (const id of timers) clearTimeout(id);
  };
  round();
  return { stop };
}

const GAMES = { heat: heatGame, press: pressGame, drops: dropsGame } as const;

// ---- The panel --------------------------------------------------------------------------------------------

/** A recipe's card: what it makes, what it needs (and what you're short of), and Start. */
function recipeCard(r: Recipe, mine: BunkerPerson, start: (r: Recipe) => void): HTMLElement {
  const short = missingFor(r, mine.inventory);
  const needs = [
    ...r.kit.map((k) => h('span.lab-need', { class: k in short ? 'short' : undefined, title: itemName(k) }, `${itemIcon(k)} ${itemName(k)}`)),
    ...Object.entries(r.ingredients).map(([id, n]) => h('span.lab-need', { class: id in short ? 'short' : undefined, title: itemName(id) }, `${itemIcon(id)} ${Math.min(countItem(mine.inventory, id), n)}/${n} ${itemName(id)}`)),
  ];
  const btn = h('button.btn.primary', { type: 'button', disabled: Object.keys(short).length > 0 }, t(tk('start')));
  btn.addEventListener('click', () => start(r));
  return h('li.lab-recipe', { 'data-recipe': r.id }, h('span.lab-icon', {}, productIcon(r)), h('div.lab-name', {}, productName(r), h('small', {}, t(tk('yields'), { grams: r.grams }))), h('div.lab-needs', {}, ...needs), btn);
}

export function openLab(hooks: BunkerHooks): StationWindow {
  bunkerStyle('lab', CSS);
  let game: Game | null = null;
  /** The batch the game's for (its startedAt), so a repaint doesn't throw away the game being played. */
  let gameFor = -1;
  /** A recipe just started from here: its game opens as soon as the office says it's on the bench. */
  let starting: string | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let body: HTMLElement;

  const stopGame = () => {
    game?.stop();
    game = null;
    gameFor = -1;
  };
  const stopTick = () => {
    if (tick) clearInterval(tick);
    tick = null;
  };

  const play = (b: LabBatch) => {
    const r = recipe(b.recipe)!;
    stopTick();
    stopGame();
    gameFor = b.startedAt;
    const head = h('div.lab-head', {}, h('span.lab-icon', {}, productIcon(r)), productName(r));
    const host = h('div');
    body.replaceChildren(h('div.lab-bench', {}, head, host));
    const began = Date.now();
    game = GAMES[r.game](host, (o) => {
      game = null;
      // Not before the office would believe it could have been played (its clock started a moment before ours).
      const wait = 'ruined' in o ? 0 : Math.max(0, r.minPlay + 400 - (Date.now() - began));
      const send = () => {
        gameFor = -1;
        hooks.act('lab', 'finish', o);
      };
      if (wait > 0) {
        host.append(h('p.lab-status', {}, t(tk('wait'))));
        setTimeout(send, wait);
      } else send();
    });
  };

  const paint = (b: HTMLElement, mine: BunkerPerson | null) => {
    body = b;
    const batch = mine?.lab?.batch ?? null;
    // A game being played stays as it is while its batch is still on the bench.
    if (gameFor >= 0 && playing(batch) && batch.startedAt === gameFor) return;
    stopGame();
    stopTick();
    if (!mine) return b.replaceChildren(h('p.bunker-empty', {}, t(tk('empty'))));
    if (!batch) {
      b.replaceChildren(
        h(
          'ul.lab-recipes',
          {},
          ...RECIPES.map((r) =>
            recipeCard(r, mine, (r) => {
              starting = r.id;
              hooks.act('lab', 'start', r.id);
            }),
          ),
        ),
      );
      return;
    }
    const r = recipe(batch.recipe)!;
    const head = h('div.lab-head', {}, h('span.lab-icon', {}, productIcon(r)), productName(r));
    if (playing(batch)) {
      if (starting === batch.recipe) {
        starting = null;
        return play(batch);
      }
      const again = h('button.btn.primary', { type: 'button' }, t(tk('play')));
      const out = h('button.btn', { type: 'button' }, t(tk('throwOut')));
      again.addEventListener('click', () => play(batch));
      out.addEventListener('click', () => hooks.act('lab', 'abandon'));
      b.replaceChildren(h('div.lab-bench', {}, head, h('div.lab-row', {}, again, out)));
      return;
    }
    // Resting: how long until it can come off the bench.
    const fill = h('div.fill');
    const meter = h('div.lab-meter.rest', {}, fill);
    const status = h('span.lab-status');
    const take = h('button.btn.primary', { type: 'button' }, t(tk(`take.${r.id}`)));
    take.addEventListener('click', () => hooks.act('lab', 'collect'));
    const quality = h('span.lab-status', {}, t(tk('quality'), { quality: Math.round((batch.quality ?? 0) * 100) }));
    const update = () => {
      const left = Math.max(0, (batch.readyAt ?? 0) - Date.now());
      fill.style.width = pct(1 - Math.min(1, left / r.rest));
      meter.classList.toggle('ready', left <= 0);
      status.textContent = left > 0 ? t(tk(`rest.${r.id}`), { s: Math.ceil(left / 1000) }) : t(tk('ready'));
      take.disabled = left > 0;
      if (left <= 0) stopTick();
    };
    b.replaceChildren(h('div.lab-bench', {}, head, meter, h('div.lab-row', {}, take, status, quality)));
    update();
    if (take.disabled) tick = setInterval(update, 250);
  };

  return stationWindow({
    station: 'lab',
    title: t('bunker.lab.title'),
    paint,
    onClose: () => {
      // Walking off mid-game throws the batch out (the burner can't be left on).
      if (game) {
        stopGame();
        hooks.act('lab', 'abandon');
      }
      stopTick();
    },
  });
}
