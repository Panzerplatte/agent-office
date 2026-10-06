import type { ClientMsg, ServiceInfo, ServicesState } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { copy, copyButton, guessOs, openCommand, OS_LABEL, type Os } from './team';
import { confirmDialog } from './prompt';
import { t } from '../i18n';

/** A text with `{name}` placeholders filled by elements (code snippets) rather than strings. */
function withNodes(text: string, nodes: Record<string, Node>): (string | Node)[] {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? (nodes[part] ?? `{${part}}`) : part));
}

function serviceUrl(port: number): string {
  // The tunnel lands on the office's own port, so it speaks whatever the office speaks.
  return `${location.protocol}//localhost:${port}`;
}

/** Where the office page itself is: just the bits previewUrl looks at, so tests can pass their own. */
type Here = Pick<Location, 'protocol' | 'hostname' | 'port'>;

/**
 * The page the 🖥 Preview window loads. With the office opened on localhost (on this computer or
 * through its tunnel), `p<port>.localhost:<office port>` reaches the worker's server through that
 * same port, so one tunnel serves every preview. Anywhere else it's the per-port tunnel's address.
 */
export function previewUrl(port: number, here: Here = location): string {
  if (here.hostname === 'localhost') return `${here.protocol}//p${port}.localhost${here.port ? `:${here.port}` : ''}/`;
  return `${here.protocol}//localhost:${port}`;
}

/** One window name for every service: each Preview loads into the same window, so sharing it in a meeting keeps going. */
export const PREVIEW_WINDOW = 'ao-preview';

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
  return { who: w?.name ?? t('windows.services.someWorker'), color: w?.color ?? '#8d99ae', branch: w?.worktree?.branch };
}

/** The 🖥 Preview window only loads on localhost (through the office's own port, see previewUrl): anywhere else the TV shows the site instead. */
export function canPreview(here: Here = location): boolean {
  return here.hostname === 'localhost';
}

/**
 * 🚀 Live gehen, after a yes: the worker whose service it is publishes the website in the floor's
 * Demo-Galerie (the office prompts it, see server/golive.ts). Also on the TV's toolbar.
 */
export function confirmGoLive(send: (msg: ClientMsg) => void, port: number) {
  confirmDialog(t('windows.services.goLive'), t('windows.services.goLiveAsk'), t('windows.services.goLive'), () => send({ t: 'service.golive', port }));
}

export function openServices(send: (msg: ClientMsg) => void) {
  let os = guessOs();
  let picked: number | null = null;
  let copied: number | null = null;
  const body = h('div.body.team.services');
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const tabs = h('div.os-tabs');
  const footer = h('footer', {}, h('span.grow', {}, t('windows.services.footer')));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('windows.services.dialog'), style: 'width:min(760px,100%)' },
    h('header', {}, h('h2', {}, t('windows.services.title')), tabs, close),
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
    // The floor's Demo-Galerie on Render: public, so it opens straight from anywhere.
    const gallery = store.demoGallery;
    if (gallery)
      body.append(
        h('div', { style: 'margin:0 0 12px' }, h('a.btn', { href: gallery, target: '_blank', rel: 'noopener', title: t('windows.services.galleryTitle', { url: gallery }) }, t('windows.services.gallery'))),
      );
    if (!s.items.length) {
      body.append(
        h(
          'div.svc-empty',
          {},
          h('p', {}, t('windows.services.empty')),
          h('p.note', {}, ...withNodes(t('windows.services.emptyNote'), { dev: h('code', {}, 'npm run dev'), http: h('code', {}, 'python -m http.server') })),
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
      // The office's own browser shows it on the floor's TV, for everyone (see src/server/tvbrowser.ts).
      const onTv = store.tvBrowser?.port === svc.port;
      const tv = h(
        'button.btn',
        { type: 'button', class: onTv ? '' : 'primary', title: t(onTv ? 'windows.services.tvOffTitle' : 'windows.services.tvTitle') },
        t(onTv ? 'windows.services.tvOff' : 'windows.services.tv'),
      );
      tv.addEventListener('click', (e) => {
        e.stopPropagation();
        send(onTv ? { t: 'tvbrowser.close' } : { t: 'tvbrowser.open', port: svc.port });
      });
      const live = h('button.btn', { type: 'button', title: t('windows.services.goLiveTitle') }, t('windows.services.goLive'));
      live.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmGoLive(send, svc.port);
      });
      const url = previewUrl(svc.port);
      const preview =
        canPreview() &&
        h('button.btn', { type: 'button', title: t('windows.services.previewTitle', { url }) }, t('windows.services.preview'));
      if (preview)
        preview.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(url, PREVIEW_WINDOW, 'popup,width=1280,height=900');
        });
      const li = h(
        'li',
        { class: on ? 'on' : '', tabindex: 0, role: 'button', title: t('windows.services.rowTitle') },
        h('span.dot', { style: `background:${color}` }),
        h(
          'div.svc-main',
          {},
          h('div.svc-title', {}, svc.title || svc.command),
          h('div.svc-meta', {}, [who, branch ? `🌿 ${branch}` : '', svc.title ? svc.command : '', t('windows.services.started', { ago: timeAgo(svc.since) })].filter(Boolean).join(' · ')),
        ),
        h('span.svc-port', {}, `:${svc.port}`),
        open,
        tv,
        live,
        preview,
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
          : h('p.team-status', {}, t('windows.services.commandFor', { port: svc.port, url: serviceUrl(svc.port) })),
        h('div.cmd', {}, h('pre', {}, cmd), copyButton(t('windows.services.copy'), () => cmd)),
      );
    } else if (picked !== null) {
      body.append(h('p.team-status.error', {}, t('windows.services.stopped', { port: picked })));
    }
    body.append(
      s.ssh
        ? h('p.note', {}, ...withNodes(t('windows.services.sshNote'), { cmd: h('code', {}, 'deploy/aws.sh service <port>') }))
        : h('p.note', {}, ...withNodes(t('windows.services.noSshNote'), { host: h('code', {}, 'you@your-server') })),
    );
  };

  const unsubs = [store.on('services', render), store.on('workers', render), store.on('tvBrowser', render), store.on('demoGallery', render)];
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
