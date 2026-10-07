import { chips } from '../chips';
import { locale, t } from '../i18n';
import { HOUSE_GAMES, formatChips, type HouseBankState } from '../../shared/housebank';
import { h, openModal, timeAgo } from './dom';

/**
 * The house bank's window, at its machine in the casino (see shared/housebank.ts): its total, taking
 * chips out (an amount, or all of it) onto your own balance (anyone can), what each game put in and
 * the log of withdrawals, which everyone sees. The office checks every withdrawal again; this only asks.
 */
export function openHouseBank(withdraw: (amount: number | 'all') => void) {
  const close = h('button.btn.close', { 'aria-label': t('menus.close') }, '✕');
  const body = h('div.body.house-bank');
  const el = h('div.modal.jukebox.house-bank-panel', { role: 'dialog', 'aria-label': t('menus.houseBank') }, h('header', {}, h('h2', {}, t('menus.houseBank')), close), body);
  const amount = h('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', placeholder: t('menus.houseBankAmount'), 'aria-label': t('menus.houseBankAmount'), style: 'flex:1;min-width:0' }) as HTMLInputElement;
  const take = h('button.btn.primary', { type: 'submit', title: t('menus.houseBankWithdrawTip') }, t('menus.houseBankWithdraw'));
  const all = h('button.btn', { type: 'button', title: t('menus.houseBankAllTip') }, t('menus.houseBankAll'));
  const form = h('form', { style: 'display:flex;gap:8px;margin:12px 0 0' }, amount, take, all) as HTMLFormElement;
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
    const small = 'margin:14px 0 4px;font-size:13px;opacity:.75;font-weight:800';
    const row = 'display:flex;justify-content:space-between;gap:8px;font-size:14px';
    const total = h('p.house-bank-total', { style: 'margin:0;font-size:28px;font-weight:900;text-align:center' }, t('menus.houseBankTotal', { n: formatChips(bank.total, locale()) }));
    const games = HOUSE_GAMES.filter((g) => bank.games?.[g]).map((g) => h('div', { style: row }, h('span', {}, t(`menus.houseGame_${g}`)), h('span', {}, formatChips(bank.games![g]!, locale()))));
    const out = (bank.withdrawals ?? []).map((w) => h('div', { style: row }, h('span', {}, t('menus.houseBankWithdrawal', { amount: formatChips(w.amount, locale()), by: w.by, when: timeAgo(w.at) }))));
    body.replaceChildren(
      total,
      form,
      h('p', { style: small }, t('menus.houseBankFrom')),
      ...(games.length ? games : [h('div', { style: row }, '–')]),
      h('p', { style: small }, t('menus.houseBankOut')),
      ...(out.length ? out : [h('div', { style: row }, t('menus.houseBankNoneOut'))]),
    );
  };
  const off = chips.onBank(paint);
  paint(chips.bank);
  const modal = openModal(el, { onClose: () => void off() });
  close.addEventListener('click', () => modal.close());
  setTimeout(() => amount.focus(), 30);
}
