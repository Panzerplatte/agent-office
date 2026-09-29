import type { AccountInvite, AccountRole, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';
import { t } from '../i18n';

export const inviteLink = (v: AccountInvite) => `${location.origin}/join#${v.token}`;

function expiresIn(at: number): string {
  const d = Math.round((at - Date.now()) / 86_400_000);
  return d >= 1 ? t('windows.accounts.expiresIn', { n: d }) : t('windows.accounts.expiresToday');
}

/** A role as it reads in your language; the role itself stays 'admin' or 'member' for the server and the CSS. */
const roleName = (role: AccountRole) => (role === 'admin' ? t('windows.accounts.tagAdmin') : t('windows.accounts.tagMember'));

let onInvited: ((msg: Extract<ServerMsg, { t: 'accounts.invited' }>) => void) | null = null;

export function routeAccountsMessage(msg: ServerMsg) {
  if (msg.t === 'accounts.invited') onInvited?.(msg);
}

/** 🔑 Accounts, for admins: invite people by link, list them, change their role or revoke them. */
export function openAccounts(net: Net) {
  let status: HTMLElement | null = null;
  /** The invite just made, shown big until the next one. */
  let fresh: AccountInvite | null = null;
  const body = h('div.body.team.accounts');
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const signedInAs = h('span.grow');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('windows.accounts.title'), style: 'width:min(680px,100%)' },
    h('header', {}, h('h2', {}, t('windows.accounts.heading')), close),
    body,
    h('footer', {}, signedInAs),
  );

  const nameInput = h('input', { type: 'text', maxlength: 24, placeholder: t('windows.accounts.namePlaceholder'), 'aria-label': t('windows.accounts.nameAria'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const roleSelect = h(
    'select',
    { 'aria-label': t('windows.accounts.roleAria') },
    h('option', { value: 'member' }, t('windows.accounts.optionMember')),
    h('option', { value: 'admin' }, t('windows.accounts.optionAdmin')),
  ) as HTMLSelectElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, t('windows.accounts.makeInvite'));
  const form = h('form.invite-row', {}, nameInput, roleSelect, inviteBtn) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    inviteBtn.disabled = true;
    net.send({ t: 'accounts.invite', name: nameInput.value.trim() || undefined, role: roleSelect.value as AccountRole });
  });

  const render = () => {
    const s = store.accounts;
    const me = store.me;
    signedInAs.textContent = me.account
      ? t('windows.accounts.signedInAs', { name: me.account.name, role: roleName(me.account.role) })
      : t('windows.accounts.signedInShared');
    const typing = document.activeElement === nameInput;
    body.replaceChildren();
    if (!s) return body.append(h('p.empty', {}, t('windows.accounts.loading')));

    body.append(
      h('label', {}, t('windows.accounts.inviteSomeone')),
      form,
      h('p.note', {}, t('windows.accounts.inviteNote')),
    );
    if (status) body.append(status);
    if (fresh) {
      const v = fresh;
      body.append(h('div.cmd', {}, h('pre', {}, inviteLink(v)), copyButton(t('windows.accounts.copy'), () => inviteLink(v))));
    }
    if (store.invites) body.append(h('p.note', {}, t('windows.accounts.needKeys')));

    const list = h('ul.team-list');
    for (const a of s.accounts) {
      const you = me.account?.name === a.name;
      const seen = a.online ? t('windows.accounts.inOffice') : a.lastSeenAt ? t('windows.accounts.seen', { when: timeAgo(a.lastSeenAt) }) : t('windows.accounts.neverCame');
      const role = h(
        'button.btn',
        { type: 'button', title: a.role === 'admin' ? t('windows.accounts.takeAdmin') : t('windows.accounts.letManage') },
        a.role === 'admin' ? t('windows.accounts.makeMember') : t('windows.accounts.makeAdmin'),
      );
      role.addEventListener('click', () => net.send({ t: 'accounts.role', accountId: a.id, role: a.role === 'admin' ? 'member' : 'admin' }));
      const revoke = h('button.btn.danger', { type: 'button', title: t('windows.accounts.revokeTitle', { name: a.name }) }, t('windows.accounts.revoke'));
      revoke.addEventListener('click', () =>
        confirmDialog(
          t('windows.accounts.revokeConfirm', { name: a.name }),
          t('windows.accounts.revokeBody') + (s.sharedPassword ? t('windows.accounts.revokeShared', { name: a.name }) : ''),
          t('windows.accounts.revoke'),
          () => net.send({ t: 'accounts.revoke', accountId: a.id }),
        ),
      );
      list.append(
        h(
          'li',
          {},
          h('span.dot', { class: a.online ? 'on' : '', title: seen }),
          h('span.name', {}, a.name, you ? h('span.you', {}, t('windows.accounts.you')) : null),
          h('span.role', { class: a.role }, roleName(a.role)),
          h('span.keys', { title: t('windows.accounts.invitedBy', { name: a.createdBy }) }, seen),
          you ? null : role,
          you ? null : revoke,
        ),
      );
    }
    if (!s.accounts.length) list.append(h('li.empty', {}, t('windows.accounts.nobody')));
    body.append(h('h4', {}, t('windows.accounts.people'), h('span.count', {}, String(s.accounts.length))), list);

    if (s.invites.length) {
      const invites = h('ul.team-list');
      for (const v of s.invites) {
        const cancel = h('button.btn', { type: 'button', title: t('windows.accounts.cancelTitle') }, t('windows.accounts.cancel'));
        cancel.addEventListener('click', () => {
          if (fresh?.id === v.id) fresh = null;
          net.send({ t: 'accounts.cancel', inviteId: v.id });
        });
        invites.append(
          h(
            'li',
            {},
            h('span.name', {}, v.name ?? h('i', {}, t('windows.accounts.theyPick'))),
            h('span.role', { class: v.role }, roleName(v.role)),
            h('span.keys', { title: t('windows.accounts.madeBy', { name: v.createdBy, when: timeAgo(v.createdAt) }) }, expiresIn(v.expiresAt)),
            copyButton(t('windows.accounts.copyLink'), () => inviteLink(v)),
            cancel,
          ),
        );
      }
      body.append(h('h4', {}, t('windows.accounts.openInvites'), h('span.count', {}, String(s.invites.length))), invites);
    }

    // The shared password: the old way in, kept as a fallback until everyone has an account.
    const toggle = h('button.btn', { type: 'button', class: s.sharedPassword ? 'danger' : '' }, s.sharedPassword ? t('windows.accounts.switchOff') : t('windows.accounts.switchOn'));
    const canSwitchOff = me.account?.role === 'admin';
    if (s.sharedPassword && !canSwitchOff) toggle.setAttribute('disabled', '');
    toggle.addEventListener('click', () => {
      if (!s.sharedPassword) return net.send({ t: 'accounts.shared', on: true });
      confirmDialog(
        t('windows.accounts.switchOffConfirm'),
        t('windows.accounts.switchOffBody'),
        t('windows.accounts.switchOff'),
        () => net.send({ t: 'accounts.shared', on: false }),
      );
    });
    body.append(
      h('div.team-head', {}, h('h4', {}, t('windows.accounts.shared')), toggle),
      h(
        'p.note',
        {},
        s.sharedPassword
          ? t('windows.accounts.sharedOn')
          : t('windows.accounts.sharedOff'),
        s.sharedPassword && !canSwitchOff ? h('b', {}, t('windows.accounts.adminFirst')) : null,
      ),
    );
    if (typing) nameInput.focus();
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error || !msg.invite) {
      status = h('p.team-status.error', {}, msg.error ?? t('windows.accounts.inviteFailed'));
      return render();
    }
    fresh = msg.invite;
    nameInput.value = '';
    status = h('p.team-status.ok', {}, t('windows.accounts.sendLink', { name: msg.invite.name ?? t('windows.accounts.them') }));

    render();
  };
  // No longer an admin (someone changed your role): the list isn't yours to see any more.
  const unsubs = [store.on('accounts', render), store.on('me', () => (store.me.admin ? render() : modal.close()))];
  const modal = openModal(el, {
    onClose: () => {
      unsubs.forEach((u) => u());
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => nameInput.focus(), 30);
  net.send({ t: 'accounts.get' });
}
