import type { UpgradeState, VersionInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { isAsleep } from '../../shared/status';
import { store } from '../state';
import { closeAllModals, h, openModal, timeAgo, type Modal } from './dom';
import { t } from '../i18n';

const version = (v: VersionInfo) => h('span.version', {}, h('code', {}, v.sha), ' ', v.subject, h('small', {}, ` · ${timeAgo(v.date)}`));

/** The ⬆️ panel: what's running, what's new upstream, and the button to upgrade. */
export function openUpgrade(net: Net) {
  const body = h('div.body.upgrade');
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const recheck = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'upgrade.check' }) }, t('windows.upgrade.checkAgain'));
  const go = h('button.btn.primary', { type: 'button', onclick: () => net.send({ t: 'upgrade.start' }) }, t('windows.upgrade.upgradeNow'));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('windows.upgrade.dialog'), style: 'width:min(620px,100%)' },
    h('header', {}, h('h2', {}, t('windows.upgrade.title')), close),
    body,
    h('footer', {}, h('span.grow', {}), recheck, go),
  );

  const render = () => {
    const u = store.upgrade;
    body.replaceChildren();
    if (u.current) body.append(h('label', {}, t('windows.upgrade.runningNow')), version(u.current));
    const busy = u.phase === 'building' || u.phase === 'restarting';
    recheck.disabled = !!u.checking || busy;
    go.disabled = !u.latest || !!u.checking || busy;

    if (u.phase === 'building') {
      body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), t('windows.upgrade.building', { version: u.latest?.sha ?? t('windows.upgrade.theNewVersion'), by: u.by ? t('windows.upgrade.startedBy', { by: u.by }) : '' })));
    } else if (u.phase === 'failed' && u.error) {
      body.append(h('pre.upgrade-error', {}, u.error));
    }
    if (u.checking) body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), t('windows.upgrade.checking')));
    else if (u.error && u.phase !== 'failed') body.append(h('p.upgrade-status.error', {}, u.error));
    else if (!u.latest && u.checkedAt) body.append(h('p.upgrade-status.ok', {}, t('windows.upgrade.upToDate', { when: timeAgo(u.checkedAt) })));

    if (u.latest) {
      const n = u.behind ?? u.changes?.length ?? 0;
      const shown = u.changes?.length ?? 0;
      body.append(
        h('label', { style: 'margin-top:14px' }, t('windows.upgrade.newChanges', { n })),
        h('ul.changes', {}, ...(u.changes ?? []).map((c) => h('li', {}, h('code', {}, c.sha), ' ', c.subject))),
      );
      if (n > shown) body.append(h('p.note', {}, n >= 50 ? t('windows.upgrade.andMore') : t('windows.upgrade.andNMore', { n: n - shown })));
      if (!busy) {
        const awake = [...store.workers.values()].some((w) => !isAsleep(w.status));
        body.append(
          h(
            'p.note',
            {},
            t('windows.upgrade.howItWorks'),
            awake ? ` ${t('windows.upgrade.workersCarryOn')}` : '',
          ),
        );
      }
    }
  };

  const unsub = store.on('upgrade', render);
  const unsubWorkers = store.on('workers', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      unsubWorkers();
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'upgrade.check' });
}

// --- Restart: a modal nobody can dismiss, then a reload onto the new version ---------------------

let restartModal: Modal | null = null;

export const restarting = () => restartModal !== null;
let restartBody: HTMLElement | null = null;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

function restartDialog(title: string, ...content: (Node | string)[]) {
  if (!restartModal) {
    closeAllModals();
    restartBody = h('div.body');
    const el = h('div.modal.restart', { role: 'alertdialog', 'aria-label': t('windows.upgrade.restartDialog') }, h('header', {}, h('h2', {})), restartBody);
    restartModal = openModal(el, { escCloses: false, backdropCloses: false });
  }
  restartModal.el.querySelector('h2')!.textContent = title;
  restartBody!.replaceChildren(...content);
}

/** The server said it's about to restart into a new version. */
export function showRestarting(u: UpgradeState, net: Net) {
  net.expectRestart();
  restartDialog(
    t('windows.upgrade.restartTitle'),
    h('div.restart-art', {}, '🏗️'),
    h(
      'p',
      {},
      u.latest
        ? t(u.by ? 'windows.upgrade.byTo' : 'windows.upgrade.to', { by: u.by ?? '', sha: u.latest.sha, subject: u.latest.subject })
        : u.by
          ? t('windows.upgrade.by', { by: u.by })
          : t('windows.upgrade.plain'),
    ),
    h('p.upgrade-status.busy', {}, h('span.spinner'), t('windows.upgrade.restarting')),
  );
  clearTimeout(slowTimer);
  slowTimer = setTimeout(
    () =>
      restartBody?.append(
        h('p.note', {}, `${t('windows.upgrade.slow')} `, h('button.btn', { type: 'button', onclick: () => location.reload() }, t('windows.upgrade.tryReload'))),
      ),
    3 * 60_000,
  );
}

/** `text` with its `{sha}` shown as code. */
function withSha(text: string, sha: string): (Node | string)[] {
  const [before, after = ''] = text.split('{sha}');
  return [before, h('code', {}, sha), after];
}

/** Reconnected to a different version than this page was loaded from: load the new client. */
export function showUpgraded(u: UpgradeState) {
  clearTimeout(slowTimer);
  const v = u.current;
  restartDialog(
    t('windows.upgrade.upgradedTitle'),
    h('div.restart-art', {}, '🎉'),
    v ? h('p', {}, ...withSha(t('windows.upgrade.nowRunning', { subject: v.subject }), v.sha)) : h('p', {}, t('windows.upgrade.newVersionRunning')),
    h('p.upgrade-status.ok', {}, h('span.spinner'), t('windows.upgrade.loading')),
  );
  setTimeout(() => location.reload(), 2500);
}
