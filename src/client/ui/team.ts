import type { ServerMsg, TeamState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { t, type Key } from '../i18n';
import { h, openModal } from './dom';
import { confirmDialog } from './prompt';

export type Os = 'mac' | 'linux' | 'windows';
export const OS_LABEL: Record<Os, string> = { mac: 'macOS', linux: 'Linux', windows: 'Windows' };

export function guessOs(): Os {
  const p = navigator.userAgent;
  return /Windows/i.test(p) ? 'windows' : /Mac/i.test(p) ? 'mac' : 'linux';
}

/** Opens a URL in the browser, for ssh's LocalCommand. */
export function openCommand(url: string, os: Os): string {
  return os === 'mac' ? `open ${url}` : os === 'windows' ? `start ${url}` : `xdg-open ${url} >/dev/null 2>&1 &`;
}

/** One command that opens the tunnel and, once it's up, the office in their browser. */
export function tunnelCommand(t: TeamState, os: Os): string {
  // LocalCommand runs after the forward is listening, so the page loads on the first try.
  const open = openCommand(`http://localhost:${t.port}`, os);
  return `ssh -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="${open}" -L ${t.port}:localhost:${t.port} ${t.ssh}`;
}

/** A text with elements in it: each `{name}` in `key`'s text becomes `parts.name`. */
function withParts(key: Key, parts: Record<string, Node>): (string | Node)[] {
  return t(key)
    .split(/\{(\w+)\}/)
    .map((bit, i) => (i % 2 ? (parts[bit] ?? `{${bit}}`) : bit))
    .filter((bit) => bit !== '');
}

function inviteMessage(team: TeamState, os: Os): string {
  return [
    t('windows.team.messageIntro', { project: store.project?.name ?? '', os: OS_LABEL[os] }),
    '',
    tunnelCommand(team, os),
    '',
    t('windows.team.messageOpens', { port: team.port }),
    team.fingerprint ? t('windows.team.messageFingerprint', { fingerprint: team.fingerprint }) : '',
  ]
    .filter((l, i, all) => l || all[i - 1])
    .join('\n')
    .trim();
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not a secure context: fall back to a hidden textarea.
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function copyButton(label: string, text: () => string, cls = '') {
  const btn = h('button.btn', { type: 'button', class: cls }, label);
  btn.addEventListener('click', async () => {
    btn.textContent = (await copy(text())) ? t('windows.team.copied') : t('windows.team.copyFailed');
    setTimeout(() => (btn.textContent = label), 1600);
  });
  return btn;
}

let onInvited: ((msg: Extract<ServerMsg, { t: 'team.invited' }>) => void) | null = null;

export function routeTeamMessage(msg: ServerMsg) {
  if (msg.t === 'team.invited') onInvited?.(msg);
}

export function openTeam(net: Net) {
  let os = guessOs();
  let status: HTMLElement | null = null;
  const body = h('div.body.team');
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const copyMsg = copyButton(t('windows.team.copyMessage'), () => (store.team ? inviteMessage(store.team, os) : ''), 'primary');
  const footer = h('footer', {}, h('span.grow', {}, t('windows.team.footer')), copyMsg);
  const el = h('div.modal', { role: 'dialog', 'aria-label': t('windows.team.dialog'), style: 'width:min(680px,100%)' }, h('header', {}, h('h2', {}, t('windows.team.title')), close), body, footer);

  const input = h('input', { type: 'text', maxlength: 40, placeholder: t('windows.team.username'), 'aria-label': t('windows.team.username'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, t('windows.team.invite'));
  const form = h('form.invite-row', {}, input, inviteBtn) as HTMLFormElement;
  const setStatus = (text: string, kind: 'busy' | 'ok' | 'error') => {
    status = h('p.team-status', { class: kind }, text);
    render();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const github = input.value.trim();
    if (!github) return input.focus();
    inviteBtn.disabled = true;
    setStatus(t('windows.team.fetching', { name: github }), 'busy');
    net.send({ t: 'team.invite', github });
  });

  let focused = false;
  const render = () => {
    const team = store.team;
    const typing = document.activeElement === input;
    body.replaceChildren();
    if (!team) return body.append(h('p.empty', {}, t('windows.team.loading')));
    footer.classList.toggle('hidden', !!team.unavailable);
    if (team.unavailable) return body.append(h('p', { style: 'margin:0;font-weight:700' }, team.unavailable));

    body.append(
      h('label', {}, t('windows.team.inviteLabel')),
      form,
      h('p.note', {}, t('windows.team.keysNote')),
    );
    if (status) body.append(status);
    if (team.error) body.append(h('p.team-status.error', {}, team.error));

    const tabs = h(
      'div.os-tabs',
      {},
      ...(Object.keys(OS_LABEL) as Os[]).map((o) =>
        h('button.btn', { type: 'button', class: o === os ? 'on' : '', onclick: () => ((os = o), render()) }, OS_LABEL[o]),
      ),
    );
    body.append(
      h('div.team-head', {}, h('h4', {}, t('windows.team.sendThis')), tabs),
      h('div.cmd', {}, h('pre', {}, tunnelCommand(team, os)), copyButton(t('windows.team.copy'), () => tunnelCommand(team, os))),
      h(
        'p.note',
        {},
        `${t('windows.team.tunnelNote', { port: team.port })} `,
        team.fingerprint ? h('span', {}, ...withParts('windows.team.fingerprint', { fingerprint: h('code', {}, team.fingerprint) })) : null,
      ),
      h('p.note', {}, ...withParts('windows.team.allowNote', { allow: h('code', {}, 'deploy/aws.sh allow <their-ip>'), anywhere: h('code', {}, 'allow anywhere') })),
    );

    const list = h('ul.team-list');
    for (const m of team.members) {
      const remove = h('button.btn', { type: 'button', title: t('windows.team.removeTip', { name: m.name }) }, t('windows.team.remove'));
      remove.addEventListener('click', () =>
        confirmDialog(
          t('windows.team.removeTitle', { name: m.name }),
          t('windows.team.removeText', { name: m.name }),
          t('windows.team.remove'),
          () => net.send({ t: 'team.remove', name: m.name }),
        ),
      );
      list.append(h('li', {}, h('span.name', {}, m.name), h('span.keys', {}, t('windows.team.keys', { n: m.keys })), remove));
    }
    if (!team.members.length) list.append(h('li.empty', {}, t('windows.team.nobody')));
    body.append(h('h4', {}, t('windows.team.invited'), ' ', h('span.count', {}, String(team.members.length))), list);
    if (typing || !focused) setTimeout(() => input.focus(), 30);
    focused = true;
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error) return setStatus(msg.error, 'error');
    input.value = '';
    setStatus(t('windows.team.invitedOk', { name: msg.name ?? '', n: msg.keys ?? 0 }), 'ok');
  };
  const unsub = store.on('team', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'team.get' });
}
