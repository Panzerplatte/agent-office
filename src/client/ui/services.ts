import type { ServiceInfo, ServicesState } from '../../shared/protocol';
import { t } from '../i18n';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { copy, copyButton, guessOs, openCommand, OS_LABEL, type Os } from './team';

function serviceUrl(port: number): string {
  // The tunnel lands on the office's own port, so it speaks whatever the office speaks.
  return `${location.protocol}//localhost:${port}`;
}

/**
 * One command that tunnels localhost:<port> to the office, which relays it to the worker's
 * server, and opens it once the tunnel is up. It uses the same SSH access as the office itself.
 */
export function serviceTunnel(s: ServicesState, port: number, os: Os): string {
  const open = openCommand(serviceUrl(port), os);
  return `ssh -N -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="${open}" -L ${port}:localhost:${s.port} ${s.ssh ?? 'you@your-server'}`;
}

function describe(svc: ServiceInfo): { who: string; color: string; branch?: string } {
  const w = store.workers.get(svc.workerId);
  return { who: w?.name ?? t('windows.services.aWorker'), color: w?.color ?? '#8d99ae', branch: w?.worktree?.branch };
}

export function openServices() {
  let os = guessOs();
  let picked: number | null = null;
  let copied: number | null = null;
  const body = h('div.body.team.services');
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const tabs = h('div.os-tabs');
  const footer = h('footer', {}, h('span.grow', {}, t('windows.services.footer')));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('windows.services.title'), style: 'width:min(760px,100%)' },
    h('header', {}, h('h2', {}, t('windows.services.heading')), tabs, close),
    body,
    footer,
  );

  const pick = async (svc: ServiceInfo) => {
    picked = svc.port;
    copied = (await copy(serviceTunnel(store.services, svc.port, os))) ? svc.port : null;
    render();
  };

  const render = () => {
    const s = store.services;
    tabs.replaceChildren(
      ...(Object.keys(OS_LABEL) as Os[]).map((o) => h('button.btn', { type: 'button', class: o === os ? 'on' : '', onclick: () => ((os = o), (copied = null), render()) }, OS_LABEL[o])),
    );
    body.replaceChildren(
      h('p.note', { style: 'margin:0 0 12px' }, t('windows.services.intro')),
    );
    if (!s.items.length) {
      body.append(
        h(
          'div.svc-empty',
          {},
          h('p', {}, t('windows.services.empty')),
          h('p.note', {}, t('windows.services.emptyHint1'), h('code', {}, 'npm run dev'), t('windows.services.emptyHint2'), h('code', {}, 'python -m http.server'), t('windows.services.emptyHint3')),
        ),
      );
      return;
    }
    const list = h('ul.svc-list');
    for (const svc of s.items) {
      const { who, color, branch } = describe(svc);
      const on = picked === svc.port;
      const open = h('a.btn', { href: serviceUrl(svc.port), target: '_blank', rel: 'noopener', title: t('windows.services.openTitle', { url: serviceUrl(svc.port) }) }, t('windows.services.open'));
      open.addEventListener('click', (e) => e.stopPropagation());
      const li = h(
        'li',
        { class: on ? 'on' : '', tabindex: 0, role: 'button', title: t('windows.services.copyTitle') },
        h('span.dot', { style: `background:${color}` }),
        h(
          'div.svc-main',
          {},
          h('div.svc-title', {}, svc.title || svc.command),
          h('div.svc-meta', {}, [who, branch ? `🌿 ${branch}` : '', svc.title ? svc.command : '', t('windows.services.started', { ago: timeAgo(svc.since) })].filter(Boolean).join(' · ')),
        ),
        h('span.svc-port', {}, `:${svc.port}`),
        open,
      );
      li.addEventListener('click', () => void pick(svc));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void pick(svc);
        }
      });
      list.append(li);
    }
    body.append(list);

    const svc = s.items.find((i) => i.port === picked);
    if (svc) {
      const cmd = serviceTunnel(s, svc.port, os);
      body.append(
        copied === svc.port
          ? h('p.team-status.ok', {}, t('windows.services.copied', { url: serviceUrl(svc.port) }))
          : h('p.team-status', {}, t('windows.services.command', { port: svc.port, url: serviceUrl(svc.port) })),
        h('div.cmd', {}, h('pre', {}, cmd), copyButton(t('windows.services.copy'), () => cmd)),
      );
    } else if (picked !== null) {
      body.append(h('p.team-status.error', {}, t('windows.services.stopped', { port: picked })));
    }
    body.append(
      s.ssh
        ? h('p.note', {}, t('windows.services.sshNote1'), h('code', {}, 'deploy/aws.sh service <port>'), t('windows.services.sshNote2'))
        : h('p.note', {}, t('windows.services.noSsh1'), h('code', {}, 'you@your-server'), t('windows.services.noSsh2')),
    );
  };

  const unsubs = [store.on('services', render), store.on('workers', render)];
  // Keeps "up 5m" fresh.
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: '🌐 at the services board',
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
