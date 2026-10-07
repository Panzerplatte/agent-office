import { CREDIT_AMOUNTS, CREDIT_MERGED, CREDIT_PAYOFF, CREDIT_PER_MINUTE, creditWork, workTime } from '../../shared/chips';
import { chips } from '../chips';
import { locale, t } from '../i18n';
import { h, openModal } from './dom';

const n = (v: number) => v.toLocaleString(locale());

/**
 * The bank at the cashier's window: chip credit (see shared/chips.ts). With nothing owed, pick an
 * amount and it goes on your balance; while you owe, it shows what's still owed, how far it's paid
 * back, and about how much work pays off the rest. The office checks it all again; this only asks.
 */
export function openCredit(take: (amount: number) => void) {
  const close = h('button.btn.close', { 'aria-label': t('menus.close') }, '✕');
  const body = h('div.body');
  const el = h(
    'div.modal.jukebox.credit',
    { role: 'dialog', 'aria-label': t('menus.credit') },
    h('header', {}, h('h2', {}, t('menus.creditTitle')), close),
    body,
    h('footer', {}, h('span.grow', {}, t('menus.creditFoot', { per: n(CREDIT_PER_MINUTE * 60), full: workTime(CREDIT_PAYOFF), merged: workTime(CREDIT_MERGED) }))),
  );
  let painted = '';
  const paint = () => {
    const c = chips.state.credit;
    // Only when the credit changes: a list you're picking from isn't redrawn under you.
    const key = JSON.stringify([c, chips.balance]);
    if (key === painted) return;
    const was = painted;
    painted = key;
    const balance = h('p.setting-note', { style: 'margin:0 0 12px' }, t('menus.creditBalance', { n: n(chips.balance) }));
    if (c) {
      const paid = Math.max(0, Math.min(1, 1 - c.owed / c.amount));
      body.replaceChildren(
        balance,
        h('p.credit-owed', { style: 'margin:0 0 8px;font-weight:800' }, t('menus.creditOwed', { owed: n(c.owed), amount: n(c.amount) })),
        h(
          'div.credit-bar',
          { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(paid * 100)), style: 'height:10px;border-radius:5px;background:rgba(127,127,127,.25);overflow:hidden;margin:0 0 8px' },
          h('div', { style: `height:100%;width:${(paid * 100).toFixed(1)}%;background:#16a34a` }),
        ),
        h('p.setting-note', { style: 'margin:0' }, t('menus.creditWork', { wait: workTime(creditWork(c.owed)) })),
      );
      return;
    }
    const list = h(
      'ul.svc-list',
      {},
      ...CREDIT_AMOUNTS.map((amount) => {
        const li = h(
          'li',
          { tabindex: 0, role: 'button', title: t('menus.creditTake', { n: n(amount) }) },
          h('span.jb-icon', { style: 'font-size:26px' }, '🪙'),
          h('div.svc-main', {}, h('div.svc-title', {}, t('menus.creditAmount', { n: n(amount) }))),
        );
        const pick = () => {
          modal.close();
          take(amount);
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
    body.replaceChildren(balance, h('p.setting-note', { style: 'margin:0 0 12px' }, t('menus.creditNote')), list);
    if (!was) setTimeout(() => (list.querySelector('li') as HTMLElement | null)?.focus(), 30);
  };
  // What's owed goes down as you work and play: kept up to date while it's open.
  const off = chips.onChange(() => paint());
  const modal = openModal(el, { onClose: () => void off() });
  close.addEventListener('click', () => modal.close());
  paint();
}
