import { t } from '../i18n';
import type { Dart, DartsOptions, DartsState } from '../../shared/darts';
import type { ShownTurn } from '../world/dartboard';
import { SWEET } from '../world/darts';
import { $, h } from './dom';

/** How wide the meter's sweet spot is drawn (a fraction of the meter): let go in it and the dart goes about where you aimed. */
const SWEET_BAND = 0.08;

export interface DartsPanelHooks {
  /** 301 or 501, double-out or not, for the next game. */
  options(o: Partial<DartsOptions>): void;
  start(): void;
  /** Clears a game that's over, for a new one. */
  reset(): void;
  /** Skips the turn of the player who's up, who's away. */
  skip(): void;
  /** Leaves the board, and the game. */
  leave(): void;
}

/** How the scoreboard writes a dart: "T20", "D16", "5", "BULL", or a miss in your language. */
export const dartLabel = (d: Dart) => (d.label === 'MISS' ? t('menus.dartsMiss') : d.label);

/**
 * The panel at the top while you're at the dartboard. Before a game it's the lobby: who's at the
 * board in their colours, 301 or 501, double-out, and Start. During one it's the scoreboard: each
 * player's score, whose turn it is and the darts of it ("T20 · 5 · D16"), BUST, and the winner,
 * with New game once it's over. Anyone who's stepped away mid-game is greyed out, and when it's their
 * turn the others can Skip it. Leave, at the bottom, takes you out of the game. On your turn the power
 * meter shows under it.
 */
export class DartsPanel {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly players: HTMLElement;
  private readonly turn: HTMLElement;
  private readonly status: HTMLElement;
  private readonly lobby: HTMLElement;
  private readonly modes: HTMLButtonElement[];
  private readonly doubleOut: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly newGame: HTMLButtonElement;
  private readonly skip: HTMLButtonElement;
  private readonly leave: HTMLButtonElement;
  private readonly meterEl: HTMLElement;
  private readonly rest: HTMLElement;
  private readonly mark: HTMLElement;
  private shown = '';
  private state: DartsState | null = null;

  constructor(hooks: DartsPanelHooks) {
    this.title = h('div.darts-title');
    this.players = h('ul.darts-players');
    this.turn = h('div.darts-turn');
    this.status = h('div.darts-status');
    this.modes = ([301, 501] as const).map((mode) => {
      const b = h('button.btn', { type: 'button' }, String(mode));
      b.addEventListener('click', () => hooks.options({ mode }));
      return b;
    });
    this.doubleOut = h('button.btn', { type: 'button' });
    this.doubleOut.addEventListener('click', () => this.state && hooks.options({ doubleOut: !this.state.doubleOut }));
    this.startBtn = h('button.btn.primary', { type: 'button' }, t('menus.dartsStart'));
    this.startBtn.addEventListener('click', () => hooks.start());
    this.lobby = h('div.darts-lobby', {}, h('div.darts-modes', {}, ...this.modes), this.doubleOut, this.startBtn);
    this.newGame = h('button.btn.primary.hidden', { type: 'button' }, t('menus.dartsNewGame'));
    this.newGame.addEventListener('click', () => hooks.reset());
    this.skip = h('button.btn.hidden', { type: 'button' }, t('menus.dartsSkip'));
    this.skip.addEventListener('click', () => hooks.skip());
    this.leave = h('button.btn.darts-leave', { type: 'button', title: t('menus.dartsLeaveNote') }, t('menus.dartsLeave'));
    this.leave.addEventListener('click', () => hooks.leave());
    this.rest = h('span.golf-rest');
    this.mark = h('span.golf-last');
    const band = h('span.darts-sweet', { style: `left:${(SWEET - SWEET_BAND / 2) * 100}%;width:${SWEET_BAND * 100}%` });
    this.meterEl = h('div.golf-meter.darts-meter.hidden', {}, this.rest, band, this.mark);
    this.el = h('div.darts.panel.hidden', { id: 'darts', 'aria-label': t('menus.darts') }, this.title, this.players, this.turn, this.status, this.lobby, this.newGame, this.skip, this.meterEl, this.leave);
    // A click on a button mustn't leave it focused, or Space (which throws) would press it again.
    this.el.addEventListener('pointerdown', (e) => e.preventDefault());
    $('hud').append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) this.shown = '';
  }

  /** The board as it is: `turn` the darts in it (they stay up a moment after a turn's over), `you` your id. */
  render(d: DartsState, you: string, turn: ShownTurn | null) {
    const k = JSON.stringify([d, you, turn]);
    if (k === this.shown) return;
    this.shown = k;
    this.state = d;
    const g = d.game;
    const mode = g?.mode ?? d.mode;
    const doubleOut = g?.doubleOut ?? d.doubleOut;
    this.title.textContent = `🎯 ${mode}${doubleOut ? ` · ${t('menus.dartsDoubleOut')}` : ''}`;

    // The winner once the winning dart is in the board, not while it's still in the air.
    const winner = g?.winner && (!turn || turn.done) ? g.players.find((p) => p.id === g.winner) : undefined;
    const rows = g ? g.players : d.lobby;
    const upId = g && !g.over ? g.players[g.up]?.id : undefined;
    this.players.replaceChildren(
      ...rows.map((p) => {
        const score = 'score' in p ? h('span.darts-score', {}, String(p.score)) : '';
        // Stepped away from a running game: their place is kept, greyed out.
        const away = !!g && !g.over && !p.peer;
        const name = `${p.name}${p.peer === you ? ` ${t('menus.dartsYou')}` : ''}${away ? ` ${t('menus.dartsAway')}` : ''}`;
        const crown = winner?.id === p.id ? '🏆 ' : '';
        const cls = [p.id === upId && 'up', away && 'away'].filter(Boolean).join(' ') || undefined;
        return h('li', { class: cls }, h('span.darts-swatch', { style: `background:${p.color}` }), h('span.darts-name', { style: `color:${p.color}` }, crown + name), score);
      }),
    );

    // The darts of the turn that's in the board, or of the one just starting.
    const who = g?.players.find((p) => p.id === (turn?.player ?? upId));
    const darts = turn?.darts ?? [];
    this.turn.classList.toggle('hidden', !g || !who);
    if (g && who) {
      const slots = [...darts.map(dartLabel), ...Array(Math.max(0, 3 - darts.length)).fill('–')];
      this.turn.replaceChildren(h('span.darts-who', { style: `color:${who.color}` }, who.name), h('span', {}, slots.join(' · ')));
    }

    // Whose turn it is, while they're away: the others can skip it. With every player away, nobody's
    // playing it any more: anyone at the board can clear it for a new one.
    const abandoned = !!g && !g.over && g.players.every((p) => !p.peer);
    const upAway = g && !g.over && !abandoned ? g.players.find((p) => p.id === upId && !p.peer) : undefined;
    let status = '';
    let cls = '';
    if (turn?.bust) {
      status = t('menus.dartsBust');
      cls = 'bust';
    } else if (winner) {
      status = t('menus.dartsWinner', { name: winner.name });
      cls = 'won';
    } else if (g?.over && !g.winner) status = t('menus.dartsOver');
    else if (upAway) status = t('menus.dartsUpAway', { name: upAway.name });
    else if (abandoned) status = t('menus.dartsAllAway');
    else if (!g) status = d.lobby.length > 1 ? t('menus.dartsLobby', { n: d.lobby.length }) : t('menus.dartsSolo');
    this.status.textContent = status;
    this.status.className = `darts-status ${cls}`;
    this.status.classList.toggle('hidden', !status);

    this.lobby.classList.toggle('hidden', !!g);
    for (const b of this.modes) b.classList.toggle('on', b.textContent === String(d.mode));
    this.doubleOut.textContent = d.doubleOut ? t('menus.dartsDoubleOutOn') : t('menus.dartsDoubleOutOff');
    this.doubleOut.classList.toggle('on', d.doubleOut);
    this.newGame.classList.toggle('hidden', !abandoned && (!g?.over || (!!g.winner && !winner)));
    this.skip.classList.toggle('hidden', !upAway);
  }

  /** The power meter, on your turn (`power` how far up it is, null to hide it; `last` the throw before, or -1). */
  meter(power: number | null, last: number) {
    this.meterEl.classList.toggle('hidden', power === null);
    if (power === null) return;
    this.rest.style.width = `${(1 - power) * 100}%`;
    this.mark.style.left = `${last * 100}%`;
    this.mark.classList.toggle('hidden', last < 0);
  }
}
