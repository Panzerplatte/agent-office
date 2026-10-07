import { CREDIT_AMOUNTS, CREDIT_MERGED, CREDIT_PAYOFF, CREDIT_PER_MINUTE, creditWork, workTime } from '../../shared/chips';
import { chips } from '../chips';
import { locale, t } from '../i18n';
import { HOUSE_GAMES, formatChips, type HouseBankState } from '../../shared/housebank';
import { h, openModal, timeAgo } from './dom';

const n = (v: number) => v.toLocaleString(locale());

/**
 * The house bank (see shared/housebank.ts), at the top of the cashier's window: its total for
 * everyone; for its owner, taking chips out (an amount, or all of it) and the log of what each game
 * put in and what was taken out. The office checks it's the owner again; this only asks.
 */
function houseBankSection(withdraw: (amount: number | 'all') => void): { el: HTMLElement; paint: (bank: HouseBankState) => void } {
  const el = h('div.house-bank', { style: 'margin:0 0 14px;padding:0 0 12px;border-bottom:1px solid rgba(127,127,127,.25)' });
  const amount = h('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', placeholder: t('menus.houseBankAmount'), 'aria-label': t('menus.houseBankAmount'), style: 'flex:1;min-width:0' }) as HTMLInputElement;
  const take = h('button.btn.primary', { type: 'submit', title: t('menus.houseBankWithdrawTip') }, t('menus.houseBankWithdraw'));
  const all = h('button.btn', { type: 'button', title: t('menus.houseBankAllTip') }, t('menus.houseBankAll'));
  const form = h('form', { style: 'display:flex;gap:8px;margin:8px 0 0' }, amount, take, all) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = Number(amount.value);
    if (!Number.isSafeInteger(n) || n <= 0) return amount.focus();
    withdraw(n);
    amount.value = '';
  });
  all.addEventListener('click', () => withdraw('all'));
  let painted = '';
  const paint = (bank: HouseBankState) => {
    const key = JSON.stringify(bank);
    if (key === painted) return;
    painted = key;
    const head = h('p', { style: 'margin:0;font-weight:800;display:flex;justify-content:space-between;gap:8px' }, h('span', {}, t('menus.houseBank')), h('span', {}, t('menus.houseBankTotal', { n: formatChips(bank.total, locale()) })));
    if (!bank.owner) return void el.replaceChildren(head);
    const small = 'margin:10px 0 4px;font-size:13px;opacity:.75;font-weight:800';
    const row = 'display:flex;justify-content:space-between;gap:8px;font-size:14px';
    const games = HOUSE_GAMES.filter((g) => bank.games?.[g]).map((g) => h('div', { style: row }, h('span', {}, t(`menus.houseGame_${g}`)), h('span', {}, formatChips(bank.games![g]!, locale()))));
    const out = (bank.withdrawals ?? []).map((w) => h('div', { style: row }, h('span', {}, t('menus.houseBankWithdrawal', { amount: formatChips(w.amount, locale()), by: w.by, when: timeAgo(w.at) }))));
    el.replaceChildren(
      head,
      form,
      h('p', { style: small }, t('menus.houseBankFrom')),
      ...(games.length ? games : [h('div', { style: row }, '–')]),
      h('p', { style: small }, t('menus.houseBankOut')),
      ...(out.length ? out : [h('div', { style: row }, t('menus.houseBankNoneOut'))]),
    );
  };
  return { el, paint };
}

/**
 * The bank at the cashier's window: chip credit (see shared/chips.ts). With nothing owed, pick an
 * amount and it goes on your balance; while you owe, it shows what's still owed, how far it's paid
 * back, and about how much work pays off the rest. The office checks it all again; this only asks.
 */
export function openCredit(take: (amount: number) => void, withdraw: (amount: number | 'all') => void) {
  const close = h('button.btn.close', { 'aria-label': t('menus.close') }, '✕');
  const house = houseBankSection(withdraw);
  const body = h('div');
  const el = h(
    'div.modal.jukebox.credit',
    { role: 'dialog', 'aria-label': t('menus.credit') },
    h('header', {}, h('h2', {}, t('menus.creditTitle')), close),
    h('div.body', {}, house.el, body),
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
  const offBank = chips.onBank((bank) => house.paint(bank));
  house.paint(chips.bank);
  const modal = openModal(el, {
    onClose: () => {
      off();
      offBank();
    },
  });
  close.addEventListener('click', () => modal.close());
  paint();
}
