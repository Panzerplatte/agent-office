import type { ServerMsg, TeamState } from '../../shared/protocol';
import { t as tr } from '../i18n';
import type { Net } from '../net';
import { store } from '../state';
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

function inviteMessage(t: TeamState, os: Os): string {
  return [
    tr('windows.team.inviteHead', { project: store.project?.name ?? '', os: OS_LABEL[os] }),
    '',
    tunnelCommand(t, os),
    '',
    tr('windows.team.inviteOpens', { url: `http://localhost:${t.port}` }),
    t.fingerprint ? tr('windows.team.inviteFingerprint', { fingerprint: t.fingerprint }) : '',
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
    btn.textContent = (await copy(text())) ? tr('windows.team.copied') : tr('windows.team.copyFailed');
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
  const close = h('button.btn.close', { 'aria-label': tr('windows.common.close') }, '✕');
  const copyMsg = copyButton(tr('windows.team.copyInvite'), () => (store.team ? inviteMessage(store.team, os) : ''), 'primary');
  const footer = h('footer', {}, h('span.grow', {}, tr('windows.team.footer')), copyMsg);
  const el = h('div.modal', { role: 'dialog', 'aria-label': tr('windows.team.title'), style: 'width:min(680px,100%)' }, h('header', {}, h('h2', {}, tr('windows.team.heading')), close), body, footer);

  const input = h('input', { type: 'text', maxlength: 40, placeholder: tr('windows.team.github'), 'aria-label': tr('windows.team.github'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, tr('windows.team.invite'));
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
    setStatus(tr('windows.team.fetching', { github }), 'busy');
    net.send({ t: 'team.invite', github });
  });

  let focused = false;
  const render = () => {
    const t = store.team;
    const typing = document.activeElement === input;
    body.replaceChildren();
    if (!t) return body.append(h('p.empty', {}, tr('windows.team.loading')));
    footer.classList.toggle('hidden', !!t.unavailable);
    if (t.unavailable) return body.append(h('p', { style: 'margin:0;font-weight:700' }, t.unavailable));

    body.append(
      h('label', {}, tr('windows.team.inviteLabel')),
      form,
      h('p.note', {}, tr('windows.team.keysNote')),
    );
    if (status) body.append(status);
    if (t.error) body.append(h('p.team-status.error', {}, t.error));

    const tabs = h(
      'div.os-tabs',
      {},
      ...(Object.keys(OS_LABEL) as Os[]).map((o) =>
        h('button.btn', { type: 'button', class: o === os ? 'on' : '', onclick: () => ((os = o), render()) }, OS_LABEL[o]),
      ),
    );
    body.append(
      h('div.team-head', {}, h('h4', {}, tr('windows.team.sendThis')), tabs),
      h('div.cmd', {}, h('pre', {}, tunnelCommand(t, os)), copyButton(tr('windows.team.copy'), () => tunnelCommand(t, os))),
      h(
        'p.note',
        {},
        tr('windows.team.opensNote', { url: `http://localhost:${t.port}` }),
        t.fingerprint ? h('span', {}, tr('windows.team.fingerprint1'), h('code', {}, t.fingerprint), tr('windows.team.fingerprint2')) : null,
      ),
      h('p.note', {}, tr('windows.team.allow1'), h('code', {}, 'deploy/aws.sh allow <their-ip>'), tr('windows.team.allow2'), h('code', {}, 'allow anywhere'), tr('windows.team.allow3')),
    );

    const list = h('ul.team-list');
    for (const m of t.members) {
      const remove = h('button.btn', { type: 'button', title: tr('windows.team.removeTitle', { name: m.name }) }, tr('windows.team.remove'));
      remove.addEventListener('click', () =>
        confirmDialog(
          tr('windows.team.removeQ', { name: m.name }),
          tr('windows.team.removeBody', { name: m.name }),
          tr('windows.team.remove'),
          () => net.send({ t: 'team.remove', name: m.name }),
        ),
      );
      list.append(h('li', {}, h('span.name', {}, m.name), h('span.keys', {}, tr('windows.team.keys', { n: m.keys })), remove));
    }
    if (!t.members.length) list.append(h('li.empty', {}, tr('windows.team.nobody')));
    body.append(h('h4', {}, tr('windows.team.invited'), h('span.count', {}, String(t.members.length))), list);
    if (typing || !focused) setTimeout(() => input.focus(), 30);
    focused = true;
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error) return setStatus(msg.error, 'error');
    input.value = '';
    setStatus(tr('windows.team.invitedOk', { name: msg.name ?? '', n: msg.keys ?? 0 }), 'ok');
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
