import { t } from '../i18n';
import { ballColor, groupFor, groupOf, isSolo, team, teamsOk, type PoolFoul, type PoolGame, type PoolSeat, type PoolState, type PoolTeam } from '../../shared/pool';
import { seatColor } from '../world/pool';
import { $, h } from './dom';

export interface PoolPanelHooks {
  /** Move to the other side for the next game. */
  team(team: PoolTeam): void;
  start(): void;
  /** Clears a game that's over (or calls one off), for a new one. */
  reset(): void;
  /** Leave the table and its game for good. */
  leave(): void;
  /** Skip the shot of whoever's up while they're away. */
  skip(): void;
  /** Where on the cue ball you'll strike it: side (-1 left … 1 right) and top (-1 draw … 1 follow). */
  spin(side: number, top: number): void;
}

/** How a side is called: its players' names ("Ada", or "Ada & Bo"). */
export function sideName(players: readonly PoolSeat[], side: PoolTeam): string {
  return players
    .filter((p) => p.team === side)
    .map((p) => p.name)
    .join(' & ');
}

const FOULS: Record<PoolFoul, string> = {
  scratch: 'menus.poolFoulScratch',
  noHit: 'menus.poolFoulNoHit',
  wrongBall: 'menus.poolFoulWrongBall',
  noRail: 'menus.poolFoulNoRail',
};

/** What the last shot did, in a line (or two): a foul, the groups decided, what went in, the 8, the winner. */
export function shotNews(g: PoolGame): { text: string; cls: string }[] {
  const out: { text: string; cls: string }[] = [];
  const last = g.last;
  const name = (side: PoolTeam) => sideName(g.players, side);
  if (g.over) {
    if (isSolo(g)) {
      if (g.winner !== null) out.push({ text: t('menus.poolSoloWon'), cls: 'won' });
      else if (last?.outcome === 'lost') out.push({ text: t('menus.poolSoloLost'), cls: 'foul' });
      else out.push({ text: t('menus.poolOver'), cls: '' });
      return out;
    }
    if (g.winner !== null) {
      if (last?.outcome === 'lost') out.push({ text: t('menus.poolLost8', { name: g.players.find((p) => p.id === last.player)?.name ?? name(last.team) }), cls: 'foul' });
      out.push({ text: t('menus.poolWinner', { name: name(g.winner) }), cls: 'won' });
    } else out.push({ text: t('menus.poolOver'), cls: '' });
    return out;
  }
  if (!last) return out;
  const shooter = g.players.find((p) => p.id === last.player)?.name ?? name(last.team);
  // The cue ball going down is always said, even when the office calls the foul something else first (it touched nothing on the way).
  const scratched = last.pocketed.includes(0);
  if (scratched) out.push({ text: t('menus.poolFoulScratch'), cls: 'foul' });
  if (last.foul && !(scratched && last.foul === 'scratch')) out.push({ text: t(FOULS[last.foul] as 'menus.poolFoulScratch'), cls: 'foul' });
  const objects = last.pocketed.filter((n) => n !== 0);
  if (objects.length) out.push({ text: t('menus.poolPotted', { name: shooter, balls: objects.join(', ') }), cls: '' });
  if (last.spotted8) out.push({ text: t('menus.poolSpotted8'), cls: '' });
  if (last.assigned && g.solids !== null) out.push({ text: t('menus.poolGroups', { name: name(g.solids), group: t('menus.poolSolids') }), cls: '' });
  return out;
}

/** The balls side `s` still has to pot: its group's left on the table (on your own, every ball), then the 8 once they're gone. */
export function ballsLeft(g: PoolGame, s: PoolTeam): number[] {
  const solo = isSolo(g);
  if (solo && !g.players.some((p) => p.team === s)) return [];
  const group = groupFor(g, s);
  if (!group && !solo) return [];
  const mine = g.balls.filter((b) => (solo ? groupOf(b.n) : groupOf(b.n) === group)).map((b) => b.n);
  return mine.length ? mine.sort((a, b) => a - b) : g.balls.some((b) => b.n === 8) ? [8] : [];
}

/** A little ball for the scoreboard: solid, or white with a band, and its number. */
function chip(n: number): HTMLElement {
  const c = ballColor(n);
  const bg = n > 8 ? `linear-gradient(#f8f4e8 0 28%, ${c} 28% 72%, #f8f4e8 72%)` : c;
  return h('span.pool-ball', { style: `background:${bg}` }, h('span', {}, String(n)));
}

/**
 * The panel at the top while you're at the pool table. Before a game it's the lobby: who's at the
 * table on which side (one or two a side), Switch sides, and Start once it's one against one, two
 * against two, or you on your own (practice). During one it's the scoreboard: each side with its group
 * and the balls it still has to pot, whose shot it is, what the last shot did (fouls, what went in,
 * the 8), ball in hand, and the winner, with New game once it's over. Anyone who's stepped away is
 * greyed out, and when it's their shot the others can Skip it. Leave, always there, gives up your
 * seat. On your shot the power bar and the spin dot show under it.
 */
export class PoolPanel {
  readonly el: HTMLElement;
  private readonly sides: HTMLElement;
  private readonly status: HTMLElement;
  private readonly lobby: HTMLElement;
  private readonly switchBtn: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly newGame: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly shooting: HTMLElement;
  private readonly meterEl: HTMLElement;
  private readonly rest: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly spinBall: HTMLElement;
  private readonly spinDot: HTMLElement;
  private shown = '';
  private side: PoolTeam = 0;
  private spinAt = { side: 0, top: 0 };

  constructor(private readonly hooks: PoolPanelHooks) {
    const title = h('div.darts-title', {}, t('menus.poolTitle'));
    this.sides = h('div.pool-sides');
    this.status = h('div.pool-status');
    this.switchBtn = h('button.btn', { type: 'button' }, t('menus.poolSwitch'));
    this.switchBtn.addEventListener('click', () => hooks.team((1 - this.side) as PoolTeam));
    this.startBtn = h('button.btn.primary', { type: 'button' }, t('menus.poolStart'));
    this.startBtn.addEventListener('click', () => hooks.start());
    this.lobby = h('div.darts-lobby', {}, this.switchBtn, this.startBtn);
    this.newGame = h('button.btn.hidden', { type: 'button' }, t('menus.poolNewGame'));
    this.newGame.addEventListener('click', () => hooks.reset());
    this.skipBtn = h('button.btn.hidden', { type: 'button' }, t('menus.poolSkip'));
    this.skipBtn.addEventListener('click', () => hooks.skip());
    const leaveBtn = h('button.btn.pool-leave', { type: 'button', title: t('menus.poolLeaveNote') }, t('menus.poolLeave'));
    leaveBtn.addEventListener('click', () => hooks.leave());
    const actions = h('div.darts-lobby', {}, this.skipBtn, this.newGame, leaveBtn);

    this.rest = h('span.golf-rest');
    this.mark = h('span.golf-last');
    this.meterEl = h('div.golf-meter.pool-meter', { title: t('menus.poolPower') }, this.rest, this.mark);
    this.spinDot = h('span.pool-spin-dot');
    this.spinBall = h('div.pool-spin', { title: t('menus.poolSpinNote') }, this.spinDot);
    // Click on the cue ball where the tip goes; a double click puts it back in the middle.
    this.spinBall.addEventListener('pointerdown', (e) => {
      const r = this.spinBall.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      const len = Math.hypot(x, y);
      if (len > 0.8) {
        x = (x / len) * 0.8;
        y = (y / len) * 0.8;
      }
      this.setSpin(x / 0.8, y / 0.8);
    });
    this.spinBall.addEventListener('dblclick', () => this.setSpin(0, 0));
    this.shooting = h('div.pool-shooting.hidden', {}, h('span.pool-label', {}, t('menus.poolPower')), this.meterEl, h('span.pool-label', {}, t('menus.poolSpin')), this.spinBall);

    this.el = h('div.darts.pool.panel.hidden', { id: 'pool', 'aria-label': t('menus.poolTitle') }, title, this.sides, this.status, this.lobby, actions, this.shooting);
    // A click on a button mustn't leave it focused, or Space (which shoots) would press it again.
    this.el.addEventListener('pointerdown', (e) => e.preventDefault());
    $('hud').append(this.el);
    this.setSpin(0, 0);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) this.shown = '';
  }

  /** Where the tip goes on the cue ball now (each -1 … 1). */
  get spin() {
    return this.spinAt;
  }

  setSpin(side: number, top: number) {
    this.spinAt = { side, top };
    this.spinDot.style.left = `${50 + side * 40}%`;
    this.spinDot.style.top = `${50 - top * 40}%`;
    this.hooks.spin(side, top);
  }

  /** The table as it's shown (the game before a shot that's still rolling): `you` your id. */
  render(d: PoolState, you: string) {
    const k = JSON.stringify([d, you]);
    if (k === this.shown) return;
    this.shown = k;
    const g = d.game;
    const seats = g ? g.players : d.lobby;
    const upId = g && !g.over ? g.players[g.up]?.id : undefined;
    this.side = d.lobby.find((s) => s.id === you)?.team ?? 0;

    this.sides.replaceChildren(
      ...([0, 1] as const).map((s) => {
        const players = (g ? team(g, s) : d.lobby.filter((p) => p.team === s)).map((p) => {
          const crown = g?.over && g.winner === s ? '🏆 ' : '';
          const name = `${crown}${p.name}${p.id === you ? ` ${t('menus.dartsYou')}` : ''}${p.away ? ` ${t('menus.poolAway')}` : ''}`;
          const cls = [p.id === upId ? 'up' : '', p.away ? 'away' : ''].filter(Boolean).join(' ');
          return h('li', { class: cls || undefined }, h('span.darts-swatch', { style: `background:${seatColor(seats, p.id)}` }), h('span.darts-name', { style: `color:${seatColor(seats, p.id)}` }, name));
        });
        const group = g ? groupFor(g, s) : null;
        const label = group ? t(group === 'solids' ? 'menus.poolSolids' : 'menus.poolStripes') : '';
        const left = g ? ballsLeft(g, s) : [];
        return h(
          'div.pool-side',
          {},
          h('div.pool-side-head', {}, h('span', {}, t(s === 0 ? 'menus.poolSideA' : 'menus.poolSideB')), label ? h('span.pool-group', {}, label) : ''),
          players.length ? h('ul.darts-players', {}, ...players) : h('div.pool-empty', {}, '—'),
          left.length ? h('div.pool-left', {}, ...left.map(chip)) : '',
        );
      }),
    );

    const lines: { text: string; cls: string }[] = [];
    if (g) {
      lines.push(...shotNews(g));
      const solo = isSolo(g);
      if (!g.over && solo) lines.push({ text: t('menus.poolSoloRules'), cls: '' });
      else if (!g.over && g.broken && g.solids === null) lines.push({ text: t('menus.poolOpen'), cls: '' });
      const up = upId ? g.players.find((p) => p.id === upId) : undefined;
      if (up) {
        const who = up.id === you ? t('menus.poolYourShot') : t(g.broken ? 'menus.poolUp' : 'menus.poolToBreak', { name: up.name });
        lines.push({ text: who, cls: 'up' });
        if (up.away) lines.push({ text: t(solo ? 'menus.poolIsAwaySolo' : 'menus.poolIsAway', { name: up.name }), cls: 'foul' });
        if (g.ballInHand === 'table') lines.push({ text: t('menus.poolBallInHand', { name: up.name }), cls: '' });
      }
    } else lines.push({ text: !teamsOk(d.lobby) ? t('menus.poolNeed') : d.lobby.length === 1 ? t('menus.poolReadySolo') : t('menus.poolReady'), cls: '' });
    this.status.replaceChildren(...lines.map((l) => h('div', { class: l.cls || undefined }, l.text)));

    const running = !!g && !g.over;
    const seated = d.lobby.some((s) => s.id === you && !s.away);
    const upSeat = upId ? g!.players.find((p) => p.id === upId) : undefined;
    this.skipBtn.classList.toggle('hidden', !seated || !upSeat?.away || isSolo(g!));
    const otherSide = d.lobby.filter((s) => s.team !== this.side).length;
    this.lobby.classList.toggle('hidden', running || !seated);
    this.switchBtn.classList.toggle('hidden', otherSide >= 2);
    this.startBtn.classList.toggle('hidden', !teamsOk(d.lobby));
    this.startBtn.textContent = g?.over ? t('menus.poolRematch') : t('menus.poolStart');
    // A game everyone's walked away from can be cleared by whoever's at the table, so it doesn't stay there for good.
    const abandoned = running && seated && g!.players.every((p) => p.away);
    this.newGame.classList.toggle('hidden', !g?.over && !abandoned);
  }

  /** The power bar and the spin dot, on your shot (`power` how hard now, null to hide them; `last` the shot before, or -1). */
  meter(power: number | null, last: number) {
    this.shooting.classList.toggle('hidden', power === null);
    if (power === null) return;
    this.rest.style.width = `${(1 - power) * 100}%`;
    this.mark.style.left = `${last * 100}%`;
    this.mark.classList.toggle('hidden', last < 0);
  }
}
