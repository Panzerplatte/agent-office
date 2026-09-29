import { h, openModal } from './dom';
import { t } from '../i18n';

/** What you can roll at the ashtray: how hard it hits decides how far the view goes (see world/drunk.ts). */
export interface Strain {
  id: 'mild' | 'house' | 'strong';
  emoji: string;
  /** How high it gets you, 0–1. */
  strength: number;
}

export const STRAINS: readonly Strain[] = [
  { id: 'mild', emoji: '🌱', strength: 0.45 },
  { id: 'house', emoji: '🌿', strength: 0.75 },
  { id: 'strong', emoji: '🍁', strength: 1 },
];

const NAME = { mild: 'menus.strainMild', house: 'menus.strainHouse', strong: 'menus.strainStrong' } as const;
const BLURB = { mild: 'menus.strainMildBlurb', house: 'menus.strainHouseBlurb', strong: 'menus.strainStrongBlurb' } as const;

export const strainName = (s: Strain) => t(NAME[s.id]);

/** How hard a strain hits, for the list. */
function kick(s: Strain): string {
  return t(s.strength >= 0.9 ? 'menus.strainKickStrong' : s.strength >= 0.6 ? 'menus.strainKickMedium' : 'menus.strainKickLight');
}

/** F at the ashtray: pick what to roll, and `light` sparks it up. */
export function openAshtray(light: (s: Strain) => void) {
  const close = h('button.btn.close', { 'aria-label': t('menus.close') }, '✕');
  const list = h(
    'ul.svc-list',
    {},
    ...STRAINS.map((s) => {
      const li = h(
        'li',
        { tabindex: 0, role: 'button', title: t('menus.strainLight', { strain: strainName(s) }) },
        h('span.jb-icon', { style: 'font-size:26px' }, s.emoji),
        h('div.svc-main', {}, h('div.svc-title', {}, strainName(s)), h('div.svc-meta', {}, `${t(BLURB[s.id])} · ${kick(s)}`)),
      );
      const pick = () => {
        modal.close();
        light(s);
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
    { role: 'dialog', 'aria-label': t('menus.ashtray') },
    h('header', {}, h('h2', {}, t('menus.ashtrayTitle')), close),
    h('div.body', {}, list),
    h('footer', {}, h('span.grow', {}, t('menus.ashtrayFoot'))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  setTimeout(() => (list.querySelector('li') as HTMLElement | null)?.focus(), 30);
}
