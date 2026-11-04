import { t } from '../i18n';
import { h } from './dom';

// The lobby's button in the elevator's panel (ui/elevator.ts): between floor 1 and the casino, the
// way the building stands. In the lobby it's where you are; anywhere else it rides you down there.

export interface LobbyStop {
  /** You're in the lobby now. */
  here: boolean;
  /** How many people are down there. */
  people: number;
  /** Ride down to it. */
  go(): void;
}

export function lobbyButton(stop: LobbyStop): HTMLElement {
  const { here, people } = stop;
  const btn = h(
    'button.floor-btn',
    { type: 'button', class: here ? 'here' : '', disabled: here, title: here ? t('lobby.here') : t('lobby.ride') },
    h('span.floor-no', { style: 'background:#e9b949;color:#2b2d42' }, 'L'),
    h('span.floor-text', {}, h('span.floor-name', {}, t('lobby.name'), here ? h('span.here-tag', {}, t('windows.elevator.youAreHere')) : null), h('span.floor-sub', {}, t('lobby.sub'))),
    h('span.floor-stats', {}, people ? h('span', { title: t('lobby.people') }, `🧑 ${people}`) : ''),
  );
  btn.addEventListener('click', () => {
    if (!here) stop.go();
  });
  return btn;
}
