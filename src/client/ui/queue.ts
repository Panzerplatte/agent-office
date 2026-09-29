import type { AgentProvider, QueueTask, Usage } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, STATUS_LABEL } from './dom';
import { confirmDialog } from './prompt';
import { providerPicker, providerLabel, providerUsageState, resolvedProvider, modelBadge } from './provider';
import { officeFull } from '../world/machine';
import { t } from '../i18n';

export interface QueueActions {
  openTerminal(workerId: string): void;
}

/** The queue task's name, linked to its GitHub issue when it has one. */
function taskTitle(task: QueueTask): HTMLElement {
  if (task.issue === undefined) return h('div.queue-title', { title: task.prompt }, task.title);
  const issue = store.issues.items.find((i) => i.number === task.issue);
  const text = task.title.startsWith(`#${task.issue}`) ? task.title : `#${task.issue} ${task.title}`;
  return h('div.queue-title', { title: task.prompt }, issue ? h('a', { href: issue.url, target: '_blank', rel: 'noopener' }, text) : text);
}

function outcome(task: QueueTask): string {
  switch (task.outcome) {
    case 'done':
      return t(task.pr ? 'boards.finished' : 'boards.finishedNoPr');
    case 'exited':
      return task.error ? t('boards.stoppedWith', { error: task.error }) : t('boards.stoppedEarly');
    case 'killed':
      return t('boards.sentHome');
    case 'failed':
      return t('boards.couldntStart', { error: task.error ?? t('boards.unknownError') });
    default:
      return '';
  }
}

export function openQueue(net: Net, actions: QueueActions) {
  const body = h('div.body.queue');
  const close = h('button.btn.close', { 'aria-label': t('boards.close') }, '✕');
  const limitValue = h('b');
  const minus = h('button.btn', { type: 'button', title: t('boards.fewerWorkers'), 'aria-label': t('boards.fewerWorkers') }, '−');
  const plus = h('button.btn', { type: 'button', title: t('boards.moreWorkers'), 'aria-label': t('boards.moreWorkers') }, '+');
  const limit = h('div.queue-limit', { title: t('boards.limitTitle') }, t('boards.limitLabel'), minus, limitValue, plus);
  minus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers - 1 }));
  plus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers + 1 }));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('boards.queueAria'), style: 'width:min(800px,100%)' },
    h('header', {}, h('h2', {}, t('boards.queueHeading')), limit, close),
    body,
    h('footer', {}, h('span.grow', {}, t('boards.queueFoot'))),
  );

  const ta = h('textarea', { rows: 2, placeholder: t('boards.newTaskPlaceholder'), 'aria-label': t('boards.newTask') }) as HTMLTextAreaElement;
  const provider = providerPicker(store.project, 'queue-provider');
  const addBtn = h('button.btn.primary', { type: 'submit' }, t('boards.addToQueue'));
  const form = h('form.queue-add', {}, ta, provider.element, addBtn) as HTMLFormElement;
  form.noValidate = true;
  const submit = () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    if (!provider.valid()) return;
    net.send({ t: 'queue.add', prompt: text, provider: provider.value(), model: provider.model(), effort: provider.effort() });
    ta.value = '';
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  const section = (title: string, tasks: QueueTask[], extra?: HTMLElement) => {
    if (!tasks.length) return null;
    return h('div', {}, h('h4', {}, title, h('span.count', {}, String(tasks.length)), extra ?? null), h('ul.queue-list', {}, ...tasks.map(row)));
  };

  const row = (task: QueueTask): HTMLElement => {
    const w = task.workerId ? store.workers.get(task.workerId) : undefined;
    const meta: string[] = [];
    const buttons: HTMLElement[] = [];
    const badge = modelBadge(task.provider, task.model, task.effort);
    const model = badge ? t('boards.initialModel', { model: badge }) : '';
    const usageSuffix = (provider: AgentProvider | undefined, usage?: Usage) => {
      const state = providerUsageState(provider, store.project, usage);
      return state === 'untracked'
        ? t('boards.usageUntracked')
        : state === 'waiting' && resolvedProvider(provider, store.project) === 'opencode'
          ? t('boards.waitingMetrics')
          : state === 'waiting' && resolvedProvider(provider, store.project) === 'codex'
            ? t('boards.waitingReport')
            : '';
    };
    let pos: string | null = null;
    if (task.status === 'running') {
      const selectedProvider = providerLabel(task.provider ?? w?.provider, store.project);
      meta.push(`⚙️ ${selectedProvider}${model}${usageSuffix(task.provider ?? w?.provider, w?.usage)}`);
      meta.push(`${task.workerName ?? t('boards.aWorker')} · ${w ? STATUS_LABEL[w.status] ?? w.status : t('boards.gone')}`);
      if (task.branch) meta.push(`🌿 ${task.branch}`);
      if (task.startedAt) meta.push(t('boards.startedAgo', { ago: timeAgo(task.startedAt) }));
      meta.push(t('boards.byAuthor', { name: task.addedBy }));
      if (w) {
        buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, t('boards.terminal')));
        buttons.push(
          h('button.btn', {
            type: 'button',
            title: t('boards.stopTitle'),
            onclick: () => confirmDialog(t('boards.stopConfirmTitle', { name: w.name }), t('boards.stopConfirmBody', { name: w.name }), t('boards.stopConfirm'), () => net.send({ t: 'worker.kill', workerId: w.id })),
          }, t('boards.stop')),
        );
      }
    } else if (task.status === 'queued') {
      const queued = store.queue.tasks.filter((x) => x.status === 'queued');
      const i = queued.indexOf(task);
      pos = String(i + 1);
      meta.push(`⚙️ ${providerLabel(task.provider, store.project)}${model}${usageSuffix(task.provider, w?.usage)}`);
      meta.push(t('boards.addedBy', { name: task.addedBy, ago: timeAgo(task.addedAt) }));
      buttons.push(h('button.btn', { type: 'button', title: t('boards.moveUp'), 'aria-label': t('boards.moveUp'), disabled: i === 0, onclick: () => net.send({ t: 'queue.move', taskId: task.id, delta: -1 }) }, '↑'));
      buttons.push(h('button.btn', { type: 'button', title: t('boards.moveDown'), 'aria-label': t('boards.moveDown'), disabled: i === queued.length - 1, onclick: () => net.send({ t: 'queue.move', taskId: task.id, delta: 1 }) }, '↓'));
      buttons.push(h('button.btn', { type: 'button', title: t('boards.removeFromQueue'), 'aria-label': t('boards.remove'), onclick: () => net.send({ t: 'queue.remove', taskId: task.id }) }, '✕'));
    } else {
      meta.push(`⚙️ ${providerLabel(task.provider, store.project)}${model}${usageSuffix(task.provider, w?.usage)}`);
      meta.push(outcome(task));
      if (task.workerName) meta.push(task.workerName);
      if (task.branch) meta.push(`🌿 ${task.branch}`);
      if (task.finishedAt) meta.push(timeAgo(task.finishedAt));
      if (task.pr) buttons.push(h('a.btn', { href: task.pr.url, target: '_blank', rel: 'noopener', title: task.pr.title }, `🔀 PR #${task.pr.number}${task.pr.state === 'MERGED' ? ' ✓' : task.pr.state === 'DRAFT' ? t('boards.draftSuffix') : ''}`));
      if (w) buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, t('boards.terminal')));
      buttons.push(h('button.btn', { type: 'button', title: t('boards.requeueTitle'), onclick: () => net.send({ t: 'queue.retry', taskId: task.id }) }, t('boards.requeue')));
      buttons.push(h('button.btn', { type: 'button', title: t('boards.forget'), 'aria-label': t('boards.remove'), onclick: () => net.send({ t: 'queue.remove', taskId: task.id }) }, '✕'));
    }
    return h(
      'li',
      { class: task.status },
      pos ? h('span.pos', {}, pos) : null,
      h('div.queue-main', {}, taskTitle(task), h('div.queue-meta', {}, meta.join(' · '))),
      h('div.queue-actions', {}, ...buttons),
    );
  };

  // The form stays put and only the list below it re-renders, so worker updates don't pull focus out of the textarea.
  const list = h('div');
  body.append(form, list);

  const render = () => {
    const q = store.queue;
    limitValue.textContent = q.maxWorkers === 0 ? t('boards.paused') : String(q.maxWorkers);
    minus.toggleAttribute('disabled', q.maxWorkers <= 0);
    const running = q.tasks.filter((task) => task.status === 'running');
    const queued = q.tasks.filter((task) => task.status === 'queued');
    const done = q.tasks.filter((task) => task.status === 'done').slice().reverse();
    const m = store.machine;
    const parts: (HTMLElement | null)[] = [
      h('p.note', {}, t('boards.noteOpenBoard'), h('b', {}, t('boards.addToQueue')), t('boards.noteOnIssue'), h('b', {}, q.maxWorkers === 0 ? '0' : String(q.maxWorkers)), t('boards.noteRest')),
      queued.length && officeFull(m) ? h('p.note', {}, t('boards.officeFull', { n: m.limit ?? 0 })) : null,
      section(t('boards.secWorking'), running),
      section(t('boards.secUpNext'), queued),
      section(t('boards.secFinished'), done, h('button.btn', { type: 'button', onclick: () => net.send({ t: 'queue.clear' }) }, t('boards.clearFinished'))),
      running.length + queued.length + done.length ? null : h('div.queue-empty', {}, t('boards.queueEmpty')),
    ];
    list.replaceChildren(...parts.filter((n): n is HTMLElement => n !== null));
  };

  // The machine reports every few seconds; only a change to whether the office is full shows here.
  let full = '';
  const machineChanged = () => {
    const k = `${officeFull(store.machine)}|${store.machine.limit}`;
    if (k === full) return;
    full = k;
    render();
  };
  const unsubs = [store.on('queue', render), store.on('workers', render), store.on('issues', render), store.on('machine', machineChanged)];
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: t('boards.doingQueue'),
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => ta.focus(), 30);
}
