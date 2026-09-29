import type { GhCheck, GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhMergeMethod, GhPull, GhPullDetail, GhReviewComment, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { AVATAR_COLORS, store, workerForPull } from '../state';
import { issuePrompt, issueVars, type BoardActions } from './boards';
import { issueMeeting } from './meeting';
import { officePrompt } from './prompts';
import { h, openModal, timeAgo, type Modal } from './dom';
import { markdown, repoUrlOf } from './markdown';
import { buildTree, looksGenerated, parseDiff, renderFileDiff, renderThread, repliesOf, Reviewed, statusWord, treeOrder, type DiffFile, type TreeDir } from './pulldiff';
import { providerPicker } from './provider';
import { locale, t, type Key } from '../i18n';

// The windows behind the board cards. A PR opens on its conversation (description, comments,
// reviews, line comments, checks) with a Files tab for the diff, where you tick files off as
// reviewed; from here you comment, label, merge or close it, or hand it to a worker to review, fix up and merge.

/** The board windows ask about the floor you're on. */
function onFloor(url: string): string {
  return store.floor ? `${url}${url.includes('?') ? '&' : '?'}floor=${encodeURIComponent(store.floor)}` : url;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(onFloor(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function getText(url: string): Promise<string> {
  const r = await fetch(onFloor(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.text();
}

const mergeWaiters = new Map<number, (msg: Extract<ServerMsg, { t: 'gh.merged' }>) => void>();
const commentWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.commented' }>) => void>();
/** Open close dialogs, by "issue:N" or "pull:N". */
const closeWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.closed' }>) => void>();
/** Open label pickers, by "issue:N" or "pull:N". */
const labelWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.labeled' }>) => void>();

/** Main feeds server messages through here so an open merge, close or label dialog or comment box hears back. */
export function routePullMessage(msg: ServerMsg) {
  if (msg.t === 'gh.merged') mergeWaiters.get(msg.number)?.(msg);
  if (msg.t === 'gh.commented') commentWaiters.get(`${msg.kind}#${msg.number}`)?.(msg);
  if (msg.t === 'gh.closed') closeWaiters.get(`${msg.kind}:${msg.number}`)?.(msg);
  if (msg.t === 'gh.labeled') labelWaiters.get(`${msg.kind}:${msg.number}`)?.(msg);
}

function pref<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage blocked
  }
}

const MERGE_KEY = 'agent-office.merge';
const FILES_KEY = 'agent-office.pr-files';
const TAB_KEY = 'agent-office.pr-tab';
/** Followed by the issue or PR's URL: the comment you were writing there. */
const DRAFT_KEY = 'agent-office.comment:';

interface MergePref {
  method?: GhMergeMethod;
  deleteBranch?: boolean;
}

const METHOD_LABEL: Record<GhMergeMethod, Key> = { squash: 'boards.methodSquash', merge: 'boards.methodMerge', rebase: 'boards.methodRebase' };

function mergePref(methods: GhMergeMethod[]): { method: GhMergeMethod; deleteBranch: boolean } {
  const p = pref<MergePref>(MERGE_KEY, {});
  return { method: p.method && methods.includes(p.method) ? p.method : methods[0], deleteBranch: p.deleteBranch ?? true };
}

/** owner/repo from a PR or issue URL. */
function nameWithOwner(url: string): string {
  return repoUrlOf(url).replace(/^https?:\/\/[^/]+\//, '');
}

// ---- Small pieces ---------------------------------------------------------------------------------

/** A GitHub label in its own color, with text that stays readable on dark ones. */
export function labelChip(l: GhLabel) {
  const n = parseInt(l.color.slice(1), 16);
  const lum = Number.isNaN(n) ? 1 : (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return h('span.label', { style: `background:${l.color};color:${lum < 0.55 ? '#fff' : 'var(--ink)'}` }, l.name);
}

function avatar(name: string) {
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return h('span.gh-avatar', { style: `background:${AVATAR_COLORS[Math.abs(x) % AVATAR_COLORS.length]}`, 'aria-hidden': 'true' }, (name[0] ?? '?').toUpperCase());
}

function when(iso: string, url?: string) {
  const title = iso ? new Date(iso).toLocaleString(locale()) : '';
  return url ? h('a.when', { href: url, target: '_blank', rel: 'noopener noreferrer', title }, timeAgo(iso)) : h('span.when', { title }, timeAgo(iso));
}

const REVIEW_BADGE: Record<string, [Key, string]> = {
  APPROVED: ['boards.reviewApproved', 'ok'],
  CHANGES_REQUESTED: ['boards.reviewChanges', 'bad'],
  COMMENTED: ['boards.reviewCommented', ''],
  DISMISSED: ['boards.reviewDismissed', 'muted'],
};

/** A review's badge: its words and its look. */
function reviewBadge(state: string | undefined): [string, string] | undefined {
  const b = REVIEW_BADGE[state ?? ''];
  return b && [t(b[0]), b[1]];
}

function commentCard(c: GhComment, itemUrl: string, verb: string, badge?: [string, string]) {
  return h(
    'article.gh-card',
    { class: badge?.[1] ? `is-${badge[1]}` : '' },
    h('header', {}, avatar(c.author), h('b', {}, c.author), h('span', {}, verb), when(c.createdAt, c.url), badge ? h('span.gh-badge', { class: badge[1] }, badge[0]) : null),
    c.body.trim() || !badge ? markdown(c.body, itemUrl) : null,
  );
}

/** Drops the nulls of optional pieces, for replaceChildren. */
function nodes(...xs: (Node | string | null | undefined)[]): (Node | string)[] {
  return xs.filter((x): x is Node | string => x != null);
}

function spinnerRow(text: string) {
  return h('div.gh-loading', {}, h('span.spinner'), text);
}

function errorBox(text: string, retry?: () => void) {
  return h('div.gh-error', {}, t('boards.loadError', { error: text }), retry ? h('button.btn', { type: 'button', onclick: retry }, t('boards.tryAgain')) : null);
}

const CHECK_ICON: Record<GhCheck['state'], string> = { pass: '✅', fail: '❌', pending: '🟡', skip: '⚪' };

function stateOf(it: { state: string; isDraft?: boolean }): [string, string] {
  if (it.state === 'MERGED') return [t('boards.pillMerged'), 'merged'];
  if (it.state === 'CLOSED') return [t('boards.pillClosed'), 'offline'];
  return it.isDraft ? [t('boards.pillDraft'), 'idle'] : [t('boards.pillOpen'), 'working'];
}

// ---- Whether a PR can merge ---------------------------------------------------------------------

interface MergeStatus {
  icon: string;
  text: string;
  cls: 'ok' | 'warn' | 'bad' | 'muted';
  /** False when merging can't work at all (draft, conflicts, already merged). */
  can: boolean;
  /** GitHub could merge it on its own once the requirements pass. */
  auto: boolean;
}

/** An open PR whose branch can't merge until someone resolves conflicts with the base. */
function conflicted(d: GhPullDetail) {
  return d.state === 'OPEN' && !d.isDraft && (d.mergeable === 'CONFLICTING' || d.mergeStateStatus === 'DIRTY');
}

function mergeStatus(d: GhPullDetail): MergeStatus {
  const failing = d.checks.filter((c) => c.state === 'fail').length;
  const pending = d.checks.filter((c) => c.state === 'pending').length;
  if (d.state === 'MERGED') return { icon: '🎉', text: t('boards.msMerged'), cls: 'ok', can: false, auto: false };
  if (d.state === 'CLOSED') return { icon: '🗑️', text: t('boards.msClosed'), cls: 'muted', can: false, auto: false };
  if (d.isDraft) return { icon: '📝', text: t('boards.msDraft'), cls: 'muted', can: false, auto: false };
  if (conflicted(d))
    return { icon: '⚠️', text: t('boards.msConflicts', { base: d.baseRefName }), cls: 'bad', can: false, auto: false };
  if (d.mergeStateStatus === 'BEHIND') return { icon: '⤵️', text: t('boards.msBehind', { base: d.baseRefName }), cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'BLOCKED') {
    const why =
      d.reviewDecision === 'CHANGES_REQUESTED'
        ? t('boards.whyChanges')
        : d.reviewDecision === 'REVIEW_REQUIRED'
          ? t('boards.whyReview')
          : failing
            ? t('boards.whyFailing', { n: failing })
            : pending
              ? t('boards.whyPending')
              : t('boards.whyRule');
    return { icon: '🚫', text: t('boards.msBlocked', { why }), cls: 'bad', can: true, auto: true };
  }
  if (failing) return { icon: '❌', text: t('boards.msFailing', { n: failing }), cls: 'warn', can: true, auto: false };
  if (pending || d.mergeStateStatus === 'UNSTABLE') return { icon: '🟡', text: t('boards.msPending'), cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'UNKNOWN' || d.mergeable === 'UNKNOWN') return { icon: '⏳', text: t('boards.msUnknown'), cls: 'muted', can: true, auto: false };
  return { icon: '✅', text: t(d.checks.length ? 'boards.msReadyChecks' : 'boards.msReady', { base: d.baseRefName }), cls: 'ok', can: true, auto: false };
}

function checksList(checks: GhCheck[]) {
  const order: GhCheck['state'][] = ['fail', 'pending', 'pass', 'skip'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return h(
    'ul.gh-checks',
    {},
    ...sorted.map((c) => h('li', {}, h('span', { 'aria-label': c.state }, CHECK_ICON[c.state]), c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.name) : h('span', {}, c.name))),
  );
}

// ---- Comment box --------------------------------------------------------------------------------

interface CommentBox {
  el: HTMLElement;
  /** Names the GitHub account the comment goes out as, once the window knows it. */
  setViewer(login: string): void;
  /** Stops waiting for an answer; the window closed. */
  dispose(): void;
}

/**
 * Where you comment on an issue or a PR's conversation. It goes out through the server's gh, so
 * as that account rather than as you. The draft is kept per item until it is posted, so Esc or a
 * closed window doesn't lose it.
 */
function commentBox(kind: 'issue' | 'pull', number: number, itemUrl: string, net: Net, onPosted: (c: GhComment) => void): CommentBox {
  const draftKey = `${DRAFT_KEY}${itemUrl}`;
  const waitKey = `${kind}#${number}`;
  let busy = false;
  let timer = 0;
  const ta = h('textarea', { rows: 4, placeholder: t('boards.commentPlaceholder'), 'aria-label': t('boards.commentAria') }) as HTMLTextAreaElement;
  ta.value = pref<string>(draftKey, '');
  const shown = h('div.gh-compose-preview.hidden');
  const write = h('button.btn.on', { type: 'button' }, t('boards.write'));
  const preview = h('button.btn', { type: 'button' }, t('boards.preview'));
  const who = h('span.grow', {}, t('boards.postsAsOffice'));
  const post = h('button.btn.primary', { type: 'button' }, t('boards.comment'));
  const result = h('div.gh-merge-result.error.hidden');
  const el = h(
    'article.gh-card.gh-compose',
    {},
    h('header', {}, h('b', {}, t('boards.addComment')), h('span.grow'), h('div.seg', {}, write, preview)),
    h('div.gh-compose-body', {}, ta, shown),
    result,
    h('div.gh-compose-foot', {}, who, post),
  );

  const sync = () => {
    post.disabled = busy || !ta.value.trim();
    ta.readOnly = busy;
    post.textContent = t(busy ? 'boards.posting' : 'boards.comment');
  };
  const saveDraft = () => {
    if (ta.value) savePref(draftKey, ta.value);
    else
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // storage blocked
      }
  };
  const setPreview = (on: boolean) => {
    write.classList.toggle('on', !on);
    preview.classList.toggle('on', on);
    ta.classList.toggle('hidden', on);
    shown.classList.toggle('hidden', !on);
    if (on) shown.replaceChildren(ta.value.trim() ? markdown(ta.value, itemUrl) : h('p.gh-quiet', {}, t('boards.nothingToPreview')));
    else ta.focus();
  };
  const fail = (text: string) => {
    result.textContent = text;
    result.classList.remove('hidden');
  };
  const settle = () => {
    commentWaiters.delete(waitKey);
    clearTimeout(timer);
    busy = false;
  };
  const submit = () => {
    const body = ta.value;
    if (busy || !body.trim()) return;
    busy = true;
    result.classList.add('hidden');
    sync();
    commentWaiters.set(waitKey, (msg) => {
      settle();
      if (msg.comment) {
        ta.value = '';
        saveDraft();
        setPreview(false);
        onPosted(msg.comment);
      } else fail(msg.error ?? t('boards.commentRejected'));
      sync();
    });
    // The office drops messages while it's disconnected, and then no answer comes.
    timer = window.setTimeout(() => {
      settle();
      fail(t('boards.commentNoAnswer'));
      sync();
    }, 45_000);
    net.send({ t: 'gh.comment', kind, number, body });
  };

  ta.addEventListener('input', () => (saveDraft(), sync()));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  });
  write.addEventListener('click', () => setPreview(false));
  preview.addEventListener('click', () => setPreview(true));
  post.addEventListener('click', submit);
  sync();
  return {
    el,
    setViewer(login) {
      if (login) who.textContent = t('boards.postsAs', { login });
    },
    dispose: settle,
  };
}

// ---- Prompts for workers ------------------------------------------------------------------------

/** What a pull request's prompts fill in. */
function pullVars(it: GhPull) {
  return { number: it.number, title: it.title, url: it.url, branch: it.headRefName, base: it.baseRefName };
}

function reviewPrompt(it: GhPull) {
  return officePrompt('pull.review', pullVars(it));
}

function mergeCommand(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return `gh pr merge ${it.number} --${method}${deleteBranch ? ' --delete-branch' : ''} --repo ${nameWithOwner(it.url)}`;
}

function mergeVars(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return { ...pullVars(it), repo: nameWithOwner(it.url), merge: mergeCommand(it, method, deleteBranch) };
}

function fixAndMergePrompt(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return officePrompt('pull.fixMerge', mergeVars(it, method, deleteBranch));
}

function fixConflictsPrompt(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return officePrompt('pull.fixConflicts', mergeVars(it, method, deleteBranch));
}

function pullContext(it: GhPull) {
  return officePrompt('pull.ask', pullVars(it));
}

function issueContext(it: GhIssue) {
  return officePrompt('issue.ask', issueVars(it));
}

// ---- Merge dialog -------------------------------------------------------------------------------

function openMerge(it: GhPull, d: GhPullDetail, net: Net, handToWorker: () => void, onMerged: () => void) {
  const st = mergeStatus(d);
  const methods = d.repo.methods;
  let { method, deleteBranch } = mergePref(methods);
  let busy = false;

  const methodBtns = h('div.seg');
  const go = h('button.btn.primary', { type: 'button' });
  const auto = h('input', { type: 'checkbox', id: 'merge-auto' }) as HTMLInputElement;
  auto.checked = st.auto && st.cls !== 'ok';
  const renderMethods = () => {
    methodBtns.replaceChildren(
      ...methods.map((m) =>
        h('button.btn', { type: 'button', class: m === method ? 'on' : '', onclick: () => ((method = m), savePref(MERGE_KEY, { method, deleteBranch }), renderMethods()) }, t(METHOD_LABEL[m])),
      ),
    );
    go.textContent = auto.checked ? t('boards.mergeWhenReady') : `🔀 ${t(METHOD_LABEL[method])}`;
  };
  auto.addEventListener('change', renderMethods);
  const del = h('input', { type: 'checkbox', id: 'merge-del' }) as HTMLInputElement;
  del.checked = deleteBranch;
  del.addEventListener('change', () => {
    deleteBranch = del.checked;
    savePref(MERGE_KEY, { method, deleteBranch });
  });
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, t('boards.cancel'));
  // Conflicts can't be merged from here, so fixing them is the main button.
  const worker = conflicted(d)
    ? h('button.btn.primary', { type: 'button', title: t('boards.fixConflictsWorkerTitle') }, t('boards.fixConflictsWorker'))
    : h('button.btn', { type: 'button', title: t('boards.handTitle') }, t('boards.handToWorker'));

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': t('boards.mergeAria', { n: it.number }) },
    h('header', {}, h('h2', {}, t('boards.mergeHeading', { n: it.number }))),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, h('small', {}, `${it.headRefName} → ${it.baseRefName}`)),
      h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text),
      d.checks.length ? checksList(d.checks) : null,
      h('label', { style: 'margin-top:14px' }, t('boards.mergeHow')),
      methodBtns,
      h('label.gh-check', { for: 'merge-del' }, del, t('boards.deleteAfter', { branch: it.headRefName })),
      st.auto ? h('label.gh-check', { for: 'merge-auto', title: t('boards.autoTitle') }, auto, t('boards.autoLabel')) : null,
      result,
    ),
    h('footer', {}, st.can || conflicted(d) ? null : worker, h('span.grow'), cancel, conflicted(d) ? worker : go),
  );
  renderMethods();
  if (!st.can) go.disabled = true;

  const modal = openModal(el, { onClose: () => mergeWaiters.delete(it.number) });
  cancel.addEventListener('click', () => modal.close());
  worker.addEventListener('click', () => {
    modal.close();
    handToWorker();
  });
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), t(auto.checked && st.auto ? 'boards.askingAuto' : 'boards.merging'));
    mergeWaiters.set(it.number, (msg) => {
      mergeWaiters.delete(it.number);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onMerged();
    });
    net.send({ t: 'gh.merge', number: it.number, method, deleteBranch, auto: auto.checked && st.auto });
  });
  setTimeout(() => (st.can ? go : cancel).focus(), 30);
}

// ---- Close dialog -------------------------------------------------------------------------------

const REASON_LABEL: Record<GhCloseReason, Key> = { completed: 'boards.reasonCompleted', 'not planned': 'boards.reasonNotPlanned' };

/** Closes an issue (as completed or not planned) or a PR without merging, with an optional comment. */
function openClose(kind: 'issue' | 'pull', it: GhIssue | GhPull, net: Net, onClosed: () => void) {
  const key = `${kind}:${it.number}`;
  const pull = kind === 'pull' ? (it as GhPull) : null;
  let reason: GhCloseReason = 'completed';
  let busy = false;

  const go = h('button.btn.danger', { type: 'button' });
  const reasons = h('div.seg');
  const renderReasons = () => {
    reasons.replaceChildren(...(Object.keys(REASON_LABEL) as GhCloseReason[]).map((r) => h('button.btn', { type: 'button', class: r === reason ? 'on' : '', onclick: () => ((reason = r), renderReasons()) }, t(REASON_LABEL[r]))));
    go.textContent = t(pull ? 'boards.closePullBtn' : reason === 'completed' ? 'boards.closeAsCompleted' : 'boards.closeAsNotPlanned');
  };
  const comment = h('textarea', { rows: 4, placeholder: t('boards.closeComment'), 'aria-label': t('boards.closeCommentAria') }) as HTMLTextAreaElement;
  const del = h('input', { type: 'checkbox', id: 'close-del' }) as HTMLInputElement;
  const w = pull && workerForPull(store.workers.values(), pull);
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, t('boards.cancel'));

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': t(pull ? 'boards.closePullAria' : 'boards.closeIssueAria', { n: it.number }) },
    h('header', {}, h('h2', {}, t(pull ? 'boards.closePullHeading' : 'boards.closeIssueHeading', { n: it.number }))),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, pull ? h('small', {}, `${pull.headRefName} → ${pull.baseRefName}`) : null),
      pull
        ? h('div.gh-status.muted', {}, h('span', {}, 'ℹ️'), `${t('boards.closePullNote')}${w ? t('boards.closePullWorker', { name: w.name }) : ''}`)
        : h('label', {}, t('boards.closeWhy')),
      pull ? h('label.gh-check', { for: 'close-del' }, del, t('boards.deleteToo', { branch: pull.headRefName })) : reasons,
      comment,
      result,
    ),
    h('footer', {}, h('span.grow'), cancel, go),
  );
  renderReasons();

  const modal = openModal(el, { onClose: () => closeWaiters.delete(key) });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), t(pull ? 'boards.closingPull' : 'boards.closingIssue'));
    closeWaiters.set(key, (msg) => {
      closeWaiters.delete(key);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onClosed();
    });
    net.send({ t: 'gh.close', kind, number: it.number, comment: comment.value.trim() || undefined, reason: pull ? undefined : reason, deleteBranch: !!pull && del.checked });
  });
  setTimeout(() => comment.focus(), 30);
}

// ---- Label picker -------------------------------------------------------------------------------

/**
 * Picks an issue's or PR's labels from the repo's own, like GitHub's sidebar: tick them on and off,
 * then save, and the office's gh account adds and takes off the difference.
 */
export function openLabels(kind: 'issue' | 'pull', it: GhIssue | GhPull, net: Net, onSaved?: (labels: GhLabel[]) => void) {
  const key = `${kind}:${it.number}`;
  const had = new Set(it.labels.map((l) => l.name));
  const on = new Set(had);
  const heading = t(kind === 'pull' ? 'boards.labelsOnPull' : 'boards.labelsOnIssue', { n: it.number });
  const manage = `${repoUrlOf(it.url)}/labels`;
  let repo: GhLabel[] | null = null;
  let error = '';
  let busy = false;
  let timer = 0;
  /** Each row and the text the filter looks in. */
  const rows = new Map<HTMLElement, string>();

  const filter = h('input', { type: 'text', placeholder: t('boards.filterLabels'), 'aria-label': t('boards.filterLabelsAria') }) as HTMLInputElement;
  const list = h('ul.gh-labels');
  const none = h('p.gh-quiet.hidden');
  const result = h('div.gh-merge-result.hidden');
  const summary = h('span.grow');
  const cancel = h('button.btn', { type: 'button' }, t('boards.cancel'));
  const save = h('button.btn.primary', { type: 'button' }, t('boards.saveLabels'));
  const el = h(
    'div.modal.gh-merge.gh-labeler',
    { role: 'dialog', 'aria-label': heading },
    h('header', {}, h('h2', {}, `🏷️ ${heading}`)),
    h('div.body', {}, h('p.gh-merge-title', {}, it.title), filter, list, none, result),
    h('footer', {}, summary, cancel, save),
  );

  const changes = () => ({ add: [...on].filter((n) => !had.has(n)), remove: [...had].filter((n) => !on.has(n)) });
  const sync = () => {
    const { add, remove } = changes();
    save.disabled = busy || (!add.length && !remove.length);
    save.textContent = t(busy ? 'boards.saving' : 'boards.saveLabels');
    summary.textContent = add.length || remove.length ? [...add.map((l) => `+${l}`), ...remove.map((l) => `−${l}`)].join('  ') : t('boards.labelCount', { n: on.size });
    for (const box of list.querySelectorAll('input')) box.disabled = busy;
  };
  const applyFilter = () => {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const [row, text] of rows) {
      const hit = !q || text.includes(q);
      row.classList.toggle('hidden', !hit);
      if (hit) shown++;
    }
    const empty = !!repo && !shown;
    none.classList.toggle('hidden', !empty);
    if (empty)
      none.replaceChildren(q ? t('boards.noLabelMatch', { q: filter.value.trim() }) : t('boards.repoNoLabels'), h('a', { href: manage, target: '_blank', rel: 'noopener noreferrer' }, t('boards.makeLabel')));
  };
  const row = (l: GhLabel) => {
    const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
    box.checked = on.has(l.name);
    box.addEventListener('change', () => {
      if (box.checked) on.add(l.name);
      else on.delete(l.name);
      sync();
    });
    const li = h('li', {}, h('label.gh-check', {}, box, labelChip(l), l.description ? h('small', {}, l.description) : null));
    rows.set(li, `${l.name}\n${l.description ?? ''}`.toLowerCase());
    return li;
  };
  const render = () => {
    rows.clear();
    // The ones it has first, then the rest, each A to Z. Worked out once, so a row never jumps away from the pointer.
    const byName = (a: GhLabel, b: GhLabel) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const known = new Map((repo ?? []).map((l) => [l.name, l]));
    const mine = it.labels.map((l) => known.get(l.name) ?? l).sort(byName);
    const rest = (repo ?? []).filter((l) => !had.has(l.name)).sort(byName);
    list.replaceChildren(...[...mine, ...rest].map(row));
    if (error) list.append(h('li', {}, errorBox(error, load)));
    else if (!repo) list.append(h('li', {}, spinnerRow(t('boards.loadingLabels'))));
    applyFilter();
    sync();
  };
  const load = () => {
    error = '';
    repo = null;
    render();
    getJson<GhLabel[]>('/api/gh/labels')
      .then((l) => (repo = l))
      .catch((err) => (error = (err as Error).message))
      .finally(render);
  };
  const settle = () => {
    labelWaiters.delete(key);
    clearTimeout(timer);
    busy = false;
  };
  const fail = (text: string) => {
    result.className = 'gh-merge-result error';
    result.replaceChildren(text);
    sync();
  };
  const submit = () => {
    const { add, remove } = changes();
    if (busy || (!add.length && !remove.length)) return;
    busy = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), t('boards.savingLabels'));
    sync();
    labelWaiters.set(key, (msg) => {
      settle();
      if (!msg.labels) return fail(msg.error ?? t('boards.labelsRejected'));
      modal.close();
      onSaved?.(msg.labels);
    });
    // The office drops messages while it's disconnected, and then no answer comes.
    timer = window.setTimeout(() => {
      settle();
      fail(t('boards.labelsNoAnswer'));
    }, 45_000);
    net.send({ t: 'gh.labels', kind, number: it.number, add, remove });
  };

  filter.addEventListener('input', applyFilter);
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) submit();
    // Enter in the filter ticks (or unticks) the first label it shows.
    else if (e.target === filter) [...rows.keys()].find((r) => !r.classList.contains('hidden'))?.querySelector('input')?.click();
    else return;
    e.preventDefault();
  });
  const modal = openModal(el, { onClose: settle });
  cancel.addEventListener('click', () => modal.close());
  save.addEventListener('click', submit);
  load();
  setTimeout(() => filter.focus(), 30);
}

/** The button that opens the label picker, after an issue's or PR's labels. */
function labelButton(kind: 'issue' | 'pull', it: () => GhIssue | GhPull, net: Net, onSaved: (labels: GhLabel[]) => void) {
  const has = it().labels.length > 0;
  return h('button.btn.gh-label-edit', { type: 'button', title: t('boards.changeLabels'), 'aria-label': t('boards.changeLabels'), onclick: () => openLabels(kind, it(), net, onSaved) }, t(has ? 'boards.editLabels' : 'boards.addLabels'));
}

// ---- The PR window ------------------------------------------------------------------------------

export function openPull(first: GhPull, net: Net, actions: BoardActions) {
  let it = first;
  const itemUrl = it.url;
  const reviewed = new Reviewed(it.url);
  let detail: GhPullDetail | null = null;
  let detailError = '';
  let files: DiffFile[] | null = null;
  let diffError = '';
  let tab: 'conversation' | 'files' = pref<string>(TAB_KEY, '') === 'files' ? 'files' : 'conversation';
  let mode: 'tree' | 'list' = pref<string>(FILES_KEY, '') === 'list' ? 'list' : 'tree';
  let filter = '';
  let current = '';
  const collapsedDirs = new Set<string>();
  /** Files you opened or closed yourself; the rest follow the defaults (reviewed ones closed). */
  const open = new Map<string, boolean>();
  const sections = new Map<string, { sec: HTMLElement; body: HTMLElement; box: HTMLInputElement; built: boolean; big: boolean }>();

  // --- Frame
  const pill = h('span.pill');
  const title = h('h2');
  const reload = h('button.btn', { type: 'button', title: t('boards.reloadTitle') }, '🔄');
  const close = h('button.btn.close', { 'aria-label': t('boards.close') }, '✕');
  const meta = h('div.gh-meta');
  const tabConv = h('button.gh-tab', { type: 'button', role: 'tab' });
  const tabFiles = h('button.gh-tab', { type: 'button', role: 'tab' });
  const conv = h('div.gh-conv');
  // The comment box stays put while the conversation above it is redrawn, so a load finishing
  // doesn't take the focus (or the text) away from someone typing.
  const thread = h('div.gh-items');
  const comment = commentBox('pull', it.number, itemUrl, net, (c) => {
    if (!detail) return loadAll();
    detail.comments.push(c);
    renderConv();
    renderFrame();
  });
  conv.append(h('div.gh-col', {}, thread, comment.el));
  const filesPane = h('div.pd');
  const footBtns = h('span.gh-foot');
  const el = h(
    'div.modal.gh-window',
    { role: 'dialog', 'aria-label': t('boards.pullAria', { n: it.number }), tabindex: -1 },
    h('header', {}, pill, title, reload, close),
    meta,
    h('nav.gh-tabs', { role: 'tablist' }, tabConv, tabFiles),
    h('div.gh-body', {}, conv, filesPane),
    h('footer', {}, h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, t('boards.openOnGithub')), footBtns),
  );

  const handToWorker = () => {
    const p = mergePref(detail?.repo.methods ?? ['squash', 'merge', 'rebase']);
    if (detail && conflicted(detail)) actions.assign(fixConflictsPrompt(it, p.method, p.deleteBranch), t('boards.fixConflictsTask', { n: it.number }));
    else actions.assign(fixAndMergePrompt(it, p.method, p.deleteBranch), t('boards.fixUpTask', { n: it.number }));
  };

  const renderFrame = () => {
    const [word, cls] = stateOf(it);
    pill.className = `pill ${cls}`;
    pill.textContent = word;
    title.textContent = `#${it.number} ${it.title}`;
    title.title = it.title;
    const commits = detail ? t('boards.commits', { n: detail.commits }) : t('boards.itsCommits');
    meta.replaceChildren(
      ...nodes(
      avatar(it.author),
      h('b', {}, it.author),
      h('span', {}, t(it.state === 'MERGED' ? 'boards.mergedInto' : 'boards.wantsToMerge', { commits })),
      h('code', {}, it.baseRefName),
      h('span', {}, t('boards.from')),
      h('code', {}, it.headRefName),
      h('span.gh-pm', {}, h('span.add', {}, `+${it.additions}`), ' ', h('span.del', {}, `−${it.deletions}`)),
      ...it.labels.map(labelChip),
      labelButton('pull', () => it, net, (labels) => ((it = { ...it, labels }), renderFrame())),
      it.reviewDecision ? h('span.gh-badge', { class: REVIEW_BADGE[it.reviewDecision]?.[1] ?? '' }, it.reviewDecision === 'REVIEW_REQUIRED' ? t('boards.reviewRequired') : (reviewBadge(it.reviewDecision)?.[0] ?? it.reviewDecision.toLowerCase())) : null,
      ),
    );
    const done = files ? files.filter((f) => reviewed.mark(f) === 'reviewed').length : 0;
    tabConv.replaceChildren(...nodes(t('boards.tabConversation'), detail ? h('span.gh-count', {}, String(detail.comments.length + detail.reviews.length + detail.reviewComments.filter((c) => !c.replyTo).length)) : null));
    tabFiles.replaceChildren(...nodes(t('boards.tabFiles'), files ? h('span.gh-count', {}, String(files.length)) : null, files?.length ? h('span.gh-progress', { class: done === files.length ? 'all' : '' }, `✓ ${done}/${files.length}`) : null));
    tabConv.classList.toggle('on', tab === 'conversation');
    tabFiles.classList.toggle('on', tab === 'files');
    tabConv.setAttribute('aria-selected', String(tab === 'conversation'));
    tabFiles.setAttribute('aria-selected', String(tab === 'files'));
    conv.classList.toggle('hidden', tab !== 'conversation');
    filesPane.classList.toggle('hidden', tab !== 'files');

    const isOpen = it.state === 'OPEN';
    const conflicts = !!detail && conflicted(detail);
    const merge = h(conflicts ? 'button.btn' : 'button.btn.primary', { type: 'button', disabled: !detail, title: t(detail ? 'boards.mergeTitle' : 'boards.loading') }, t('boards.mergeBtn'));
    merge.addEventListener('click', () => detail && openMerge(it, detail, net, handToWorker, loadAll));
    const w = workerForPull(store.workers.values(), it);
    footBtns.replaceChildren(
      ...nodes(
      w ? h('button.btn', { type: 'button', onclick: () => actions.goToDesk(w.deskId) }, t('boards.goToDesk', { name: w.name })) : null,
      h('button.btn', { type: 'button', title: t('boards.askPullTitle'), onclick: () => actions.ask(pullContext(it), t('boards.askPullTask', { n: it.number })) }, t('boards.askWorker')),
      isOpen ? h('button.btn', { type: 'button', onclick: () => actions.assign(reviewPrompt(it), t('boards.reviewTask', { n: it.number })) }, t('boards.review')) : null,
      isOpen
        ? h('button.btn', { type: 'button', title: t('boards.panelTitle'), onclick: () => actions.meeting({ pattern: 'review', pr: it.number, title: t('boards.panelTask', { n: it.number }), prompt: officePrompt('pull.panel', pullVars(it)) }) }, t('boards.panel'))
        : null,
      conflicts
        ? h('button.btn.primary', { type: 'button', title: t('boards.fixConflictsTitle'), onclick: handToWorker }, t('boards.fixConflicts'))
        : isOpen
          ? h('button.btn', { type: 'button', title: t('boards.fixCommentsTitle'), onclick: handToWorker }, t('boards.fixComments'))
          : null,
      isOpen ? h('button.btn', { type: 'button', title: t('boards.closePrTitle'), onclick: () => openClose('pull', it, net, loadAll) }, t('boards.closePr')) : null,
      isOpen ? merge : null,
      ),
    );
  };

  // --- Conversation
  const showInDiff = (c: GhReviewComment) => {
    setTab('files');
    requestAnimationFrame(() => revealLine(c.path, c.side, c.line));
  };

  const renderConv = () => {
    thread.replaceChildren(commentCard({ id: 'body', author: it.author, body: detail?.body ?? it.body, createdAt: it.createdAt, url: it.url }, itemUrl, t('boards.openedThis')));
    if (detailError) return thread.append(errorBox(detailError, loadAll));
    if (!detail) return thread.append(spinnerRow(t('boards.loadingConversation')));
    const d = detail;
    const replies = repliesOf(d.reviewComments);
    const items: { at: string; node: HTMLElement }[] = [
      ...d.comments.map((c) => ({ at: c.createdAt, node: commentCard(c, itemUrl, t('boards.commented')) })),
      ...d.reviews.map((r) => ({ at: r.createdAt, node: commentCard(r, itemUrl, '', reviewBadge(r.state) ?? [r.state?.toLowerCase() ?? t('boards.reviewed'), '']) })),
      ...d.reviewComments
        .filter((c) => !c.replyTo)
        .map((c) => ({
          at: c.createdAt,
          node: h(
            'article.gh-card.gh-thread',
            {},
            h(
              'header',
              {},
              h('span', {}, '💬'),
              h('code', { title: c.path }, `${c.path}${c.line ? `:${c.line}` : ''}`),
              c.line == null ? h('span.gh-badge.muted', {}, t('boards.outdated')) : null,
              h('span.grow'),
              c.line != null ? h('button.btn', { type: 'button', onclick: () => showInDiff(c) }, t('boards.showInDiff')) : null,
            ),
            renderThread(c, replies, itemUrl),
          ),
        })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    thread.append(...items.map((x) => x.node));
    if (!items.length) thread.append(h('p.gh-quiet', {}, t('boards.noReviews')));

    const st = mergeStatus(d);
    const box = h('section.gh-mergebox', { class: st.cls }, h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text), d.checks.length ? checksList(d.checks) : null);
    if (it.state === 'OPEN' && st.can) box.append(h('div.gh-mergebox-go', {}, h('button.btn.primary', { type: 'button', onclick: () => openMerge(it, d, net, handToWorker, loadAll) }, t('boards.mergeBtn'))));
    if (conflicted(d)) box.append(h('div.gh-mergebox-go', {}, h('button.btn.primary', { type: 'button', onclick: handToWorker }, t('boards.fixConflictsWorker'))));
    else if (it.state === 'OPEN' && !st.can && !d.isDraft) box.append(h('div.gh-mergebox-go', {}, h('button.btn', { type: 'button', onclick: handToWorker }, t('boards.haveWorkerFix'))));
    thread.append(box);
  };

  // --- Files
  /** The files in the order the sidebar lists them, after the filter. */
  let order: DiffFile[] = [];
  const shown = () => {
    if (!files) return [];
    const q = filter.trim().toLowerCase();
    const list = mode === 'tree' ? treeOrder(buildTree(files)) : files;
    return q ? list.filter((f) => f.path.toLowerCase().includes(q)) : list;
  };

  const isOpenFile = (f: DiffFile) => open.get(f.path) ?? reviewed.mark(f) !== 'reviewed';

  const buildBody = (f: DiffFile) => {
    const s = sections.get(f.path)!;
    s.body.replaceChildren();
    s.built = true;
    s.body.append(renderFileDiff(f, detail?.reviewComments ?? [], itemUrl));
  };

  let budget = 0;
  const syncSection = (f: DiffFile) => {
    const s = sections.get(f.path)!;
    const mark = reviewed.mark(f);
    const isOpen = isOpenFile(f);
    s.sec.classList.toggle('closed', !isOpen);
    s.sec.classList.toggle('reviewed', mark === 'reviewed');
    s.box.checked = mark === 'reviewed';
    s.sec.querySelector('.pd-stale')?.classList.toggle('hidden', mark !== 'stale');
    if (!isOpen || s.built) return;
    // Big files and lock files wait for a click, so a huge PR doesn't lock up the window.
    if (s.big && !open.get(f.path)) {
      s.body.replaceChildren(
        h('div.pd-big', {}, looksGenerated(f.path) ? t('boards.generatedFile') : t('boards.largeDiff', { n: f.lines.length }), h('button.btn', { type: 'button', onclick: () => (open.set(f.path, true), buildBody(f)) }, t('boards.showDiff'))),
      );
      return;
    }
    buildBody(f);
  };

  const setReviewed = (f: DiffFile, on: boolean, advance = false) => {
    reviewed.set(f, on);
    open.delete(f.path);
    const s = sections.get(f.path);
    const pane = filesPane.querySelector<HTMLElement>('.pd-main');
    syncSection(f);
    // Closing a file you were reading: keep its header in view instead of jumping past the next one.
    if (on && s && pane && s.sec.offsetTop < pane.scrollTop) pane.scrollTop = s.sec.offsetTop;
    if (on && advance) {
      const next = order.slice(order.indexOf(f) + 1).find((x) => reviewed.mark(x) !== 'reviewed');
      if (next) scrollToFile(next.path);
    }
    renderSide();
    renderFrame();
  };

  const scrollToFile = (p: string, reveal = false) => {
    const s = sections.get(p);
    const pane = filesPane.querySelector<HTMLElement>('.pd-main');
    const f = files?.find((x) => x.path === p);
    if (!s || !pane || !f) return;
    if (reveal && !isOpenFile(f)) {
      open.set(p, true);
      syncSection(f);
    }
    pane.scrollTop = s.sec.offsetTop;
    setCurrent(p);
  };

  const revealLine = (p: string, side: 'LEFT' | 'RIGHT', line: number | null) => {
    const f = files?.find((x) => x.path === p);
    const s = sections.get(p);
    if (!f || !s) return;
    open.set(p, true);
    syncSection(f);
    if (!s.built) buildBody(f);
    const row = s.body.querySelector<HTMLElement>(side === 'LEFT' ? `.pd-l[data-old="${line}"]:not(.add)` : `.pd-l[data-new="${line}"]`);
    const pane = filesPane.querySelector<HTMLElement>('.pd-main')!;
    if (!row) return scrollToFile(p);
    // Rows sit in .pd-main's coordinates (it's the positioned ancestor), like the sections.
    pane.scrollTop = row.offsetTop - pane.clientHeight / 3;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1600);
    setCurrent(p);
  };

  const side = h('aside.pd-side');
  const fileList = h('ul.pd-files', { role: 'tree' });
  const filterInput = h('input', { type: 'text', placeholder: t('boards.filterFiles'), 'aria-label': t('boards.filterFilesAria') }) as HTMLInputElement;
  filterInput.addEventListener('input', () => {
    filter = filterInput.value;
    renderFiles();
  });

  const setCurrent = (p: string) => {
    if (current === p) return;
    current = p;
    for (const li of fileList.querySelectorAll<HTMLElement>('li[data-path]')) {
      const on = li.dataset.path === p;
      li.classList.toggle('on', on);
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
  };

  const checkBtn = (f: DiffFile) => {
    const mark = reviewed.mark(f);
    return h(
      'button.pd-tick',
      {
        type: 'button',
        class: mark,
        title: t(mark === 'reviewed' ? 'boards.tickReviewed' : mark === 'stale' ? 'boards.tickStale' : 'boards.tickMark'),
        'aria-pressed': String(mark === 'reviewed'),
        onclick: ((e: Event) => {
          e.stopPropagation();
          setReviewed(f, mark !== 'reviewed');
        }) as EventListener,
      },
      mark === 'reviewed' ? '✓' : mark === 'stale' ? '!' : '',
    );
  };

  const countComments = (p: string) => detail?.reviewComments.filter((c) => c.path === p && !c.replyTo).length ?? 0;

  const fileRow = (f: DiffFile, depth: number) => {
    const slash = f.path.lastIndexOf('/');
    const n = countComments(f.path);
    return h(
      'li.pd-row',
      { 'data-path': f.path, class: `${current === f.path ? 'on' : ''} ${reviewed.mark(f)}`, style: `--depth:${depth}`, role: 'treeitem', title: f.path, onclick: () => scrollToFile(f.path, true) },
      checkBtn(f),
      h('span.pd-st', { class: f.status, title: statusWord(f.status) }, f.status),
      // The name first and its folder after, so a narrow sidebar cuts the folder, not the name.
      h('span.pd-path', {}, f.path.slice(slash + 1), mode === 'list' && slash >= 0 ? h('span.dir', {}, ` ${f.path.slice(0, slash)}`) : null),
      n ? h('span.pd-c', { title: t('boards.nComments', { n }) }, `💬${n}`) : null,
      h('span.gh-pm', {}, f.binary ? h('span.bin', {}, t('boards.bin')) : h('span', {}, h('span.add', {}, `+${f.additions}`), ' ', h('span.del', {}, `−${f.deletions}`))),
    );
  };

  const dirRows = (d: TreeDir, depth: number, visible: Set<DiffFile>, out: HTMLElement[]) => {
    for (const sub of d.dirs) {
      const inside = treeOrder(sub).filter((f) => visible.has(f));
      if (!inside.length) continue;
      const shut = collapsedDirs.has(sub.path) && !filter;
      const all = inside.every((f) => reviewed.mark(f) === 'reviewed');
      out.push(
        h(
          'li.pd-dir',
          {
            style: `--depth:${depth}`,
            role: 'treeitem',
            'aria-expanded': String(!shut),
            title: sub.path,
            onclick: () => {
              if (collapsedDirs.has(sub.path)) collapsedDirs.delete(sub.path);
              else collapsedDirs.add(sub.path);
              renderSide();
            },
          },
          h('span.pd-caret', {}, shut ? '▸' : '▾'),
          h('span', {}, '📁'),
          h('span.pd-path', {}, sub.name),
          all ? h('span.pd-done', { title: t('boards.dirReviewed') }, '✓') : null,
        ),
      );
      if (!shut) dirRows(sub, depth + 1, visible, out);
    }
    for (const f of d.files) if (visible.has(f)) out.push(fileRow(f, depth));
  };

  const renderSide = () => {
    if (!files) return;
    const rows: HTMLElement[] = [];
    if (mode === 'tree') dirRows(buildTree(files), 0, new Set(order), rows);
    else rows.push(...order.map((f) => fileRow(f, 0)));
    if (!rows.length) rows.push(h('li.pd-none', {}, t(filter ? 'boards.noFilesMatch' : 'boards.noFiles')));
    fileList.replaceChildren(...rows);
    const done = files.filter((f) => reviewed.mark(f) === 'reviewed').length;
    const bar = side.querySelector<HTMLElement>('.pd-bar i');
    if (bar) bar.style.width = `${files.length ? (100 * done) / files.length : 0}%`;
    const txt = side.querySelector<HTMLElement>('.pd-done-txt');
    if (txt) txt.textContent = t('boards.filesReviewed', { done, n: files.length });
  };

  const renderFiles = () => {
    order = shown();
    renderSide();
    const main = filesPane.querySelector<HTMLElement>('.pd-main');
    if (!main || !files) return;
    main.replaceChildren(...order.map((f) => sections.get(f.path)!.sec));
    if (!order.length) main.append(h('div.pd-note', {}, t('boards.noFilesFilter')));
  };

  const setupFiles = () => {
    const was = filesPane.querySelector<HTMLElement>('.pd-main')?.scrollTop ?? 0;
    filesPane.replaceChildren();
    sections.clear();
    if (diffError) return filesPane.append(errorBox(diffError, loadAll));
    if (!files) return filesPane.append(spinnerRow(t('boards.loadingDiff')));
    const modeBtn = (m: 'tree' | 'list', label: string) =>
      h(
        'button.btn',
        {
          type: 'button',
          class: mode === m ? 'on' : '',
          onclick: () => {
            mode = m;
            savePref(FILES_KEY, m);
            for (const b of side.querySelectorAll('.pd-mode .btn')) b.classList.toggle('on', b.textContent === label);
            renderFiles();
          },
        },
        label,
      );
    side.replaceChildren(
      h('div.pd-side-head', {}, h('div.seg.pd-mode', {}, modeBtn('tree', t('boards.modeTree')), modeBtn('list', t('boards.modeList'))), h('div.pd-bar', {}, h('i')), h('div.pd-done-txt')),
      filterInput,
      fileList,
      h('div.pd-keys', {}, h('span.key', {}, 'J'), h('span.key', {}, 'K'), t('boards.keysNext'), h('span.key', {}, 'V'), t('boards.keysReviewed')),
    );
    const main = h('div.pd-main', { tabindex: -1 });
    budget = 0;
    for (const f of files) {
      const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
      box.addEventListener('change', () => setReviewed(f, box.checked));
      const body = h('div.pd-fbody');
      const n = countComments(f.path);
      const big = looksGenerated(f.path) || f.lines.length > 800 || budget > 6000;
      if (!big) budget += f.lines.length;
      const sec = h(
        'section.pd-file',
        { 'data-path': f.path },
        h(
          'header.pd-fh',
          {},
          h('button.pd-fold', { type: 'button', 'aria-label': t('boards.foldFile'), onclick: () => (open.set(f.path, !isOpenFile(f)), syncSection(f)) }),
          h('span.pd-st', { class: f.status, title: statusWord(f.status) }, f.status),
          h('span.pd-fpath', { title: f.path }, f.status === 'R' && f.oldPath ? `${f.oldPath} → ${f.path}` : f.path),
          h('span.gh-pm', {}, f.binary ? h('span.bin', {}, t('boards.binary')) : h('span', {}, h('span.add', {}, `+${f.additions}`), ' ', h('span.del', {}, `−${f.deletions}`))),
          n ? h('span.pd-c', {}, `💬 ${n}`) : null,
          h('span.pd-stale.hidden', { title: t('boards.staleTitle') }, t('boards.stale')),
          h('label.pd-viewed', { title: t('boards.viewedTitle') }, box, t('boards.viewed')),
        ),
        body,
      );
      sections.set(f.path, { sec, body, box, built: false, big });
      syncSection(f);
    }
    main.addEventListener('scroll', () => {
      if (spy) return;
      spy = requestAnimationFrame(() => {
        spy = 0;
        const top = main.scrollTop + 12;
        let at = '';
        for (const f of order) {
          const s = sections.get(f.path)!;
          if (s.sec.offsetTop > top) break;
          at = f.path;
        }
        if (at) setCurrent(at);
      });
    });
    filesPane.append(side, main);
    renderFiles();
    main.scrollTop = was;
    if (!current && order[0]) setCurrent(order[0].path);
  };
  let spy = 0;

  const step = (dir: 1 | -1) => {
    const i = order.findIndex((f) => f.path === current);
    const next = order[Math.max(0, Math.min(order.length - 1, i + dir))];
    if (next) scrollToFile(next.path, true);
  };

  el.addEventListener('keydown', (e) => {
    if (tab !== 'files' || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input[type=text], textarea')) return;
    if (e.key === 'j' || e.key === 'n') step(1);
    else if (e.key === 'k' || e.key === 'p') step(-1);
    else if (e.key === 'v') {
      const f = files?.find((x) => x.path === current);
      if (f) setReviewed(f, reviewed.mark(f) !== 'reviewed', true);
    } else return;
    e.preventDefault();
  });

  const setTab = (to: typeof tab) => {
    tab = to;
    savePref(TAB_KEY, to);
    renderFrame();
    if (to === 'files') filesPane.querySelector<HTMLElement>('.pd-main')?.focus({ preventScroll: true });
  };
  tabConv.addEventListener('click', () => setTab('conversation'));
  tabFiles.addEventListener('click', () => setTab('files'));

  // --- Loading
  let generation = 0;
  function loadAll() {
    const g = ++generation;
    detailError = '';
    diffError = '';
    renderConv();
    getJson<GhPullDetail>(`/api/gh/pull?number=${it.number}`)
      .then((d) => {
        if (g !== generation) return;
        detail = d;
        comment.setViewer(d.viewer);
        it = { ...it, state: d.state, isDraft: d.isDraft, reviewDecision: d.reviewDecision };
        // Line comments go into the diff, so draw it again with them.
        if (files) setupFiles();
      })
      .catch((err) => g === generation && (detailError = (err as Error).message))
      .finally(() => g === generation && (renderFrame(), renderConv()));
    getText(`/api/gh/pull/diff?number=${it.number}`)
      .then((text) => {
        if (g !== generation) return;
        files = parseDiff(text);
      })
      .catch((err) => g === generation && (diffError = (err as Error).message))
      .finally(() => g === generation && (setupFiles(), renderFrame()));
    renderFrame();
  }
  reload.addEventListener('click', () => {
    net.send({ t: 'gh.refresh' });
    loadAll();
  });

  const unsub = store.on('pulls', () => {
    const fresh = store.pulls.items.find((p) => p.number === it.number);
    if (!fresh) return;
    it = detail ? { ...fresh, state: fresh.state === 'OPEN' ? detail.state : fresh.state } : fresh;
    renderFrame();
  });
  const modal: Modal = openModal(el, {
    doing: t('boards.doingPull', { n: it.number }),
    onClose: () => {
      unsub();
      comment.dispose();
    },
  });
  close.addEventListener('click', () => modal.close());
  renderFrame();
  setupFiles();
  loadAll();
  setTimeout(() => el.focus({ preventScroll: true }), 30);
}

// ---- The issue window -----------------------------------------------------------------------------

export function openIssue(first: GhIssue, net: Net, actions: BoardActions) {
  let it = first;
  const itemUrl = it.url;
  let detail: GhIssueDetail | null = null;
  let error = '';
  const close = h('button.btn.close', { 'aria-label': t('boards.close') }, '✕');
  const pill = h('span.pill');
  const conv = h('div.gh-conv');
  const thread = h('div.gh-items');
  const comment = commentBox('issue', it.number, itemUrl, net, (c) => {
    if (!detail) return load();
    detail.comments.push(c);
    render();
  });
  conv.append(h('div.gh-col', {}, thread, comment.el));
  // The footer stays put and renderFrame only shows, hides and relabels, so a board refresh never
  // pulls focus out of the provider picker.
  const closeIssue = h('button.btn', { type: 'button', title: t('boards.closeIssueTitle'), onclick: () => openClose('issue', it, net, load) }, t('boards.closeIssue'));
  const queueProvider = providerPicker(store.project, `issue-provider-${it.number}`, t('boards.queueOn'));
  const addIssueToQueue = () => {
    if (!queueProvider.valid()) return;
    modal.close();
    actions.queue(issuePrompt(it), `#${it.number} ${it.title}`, it.number, queueProvider.value(), queueProvider.model(), queueProvider.effort());
  };
  const queue = h('button.btn', { type: 'button', onclick: addIssueToQueue }) as HTMLButtonElement;
  const pickUp = h('button.btn', { type: 'button', title: t('boards.pickUpTitle'), onclick: () => actions.pickUp(it) }, t('boards.pickUp'));
  const meta = h('div.gh-meta');
  const el = h(
    'div.modal.gh-window.issue',
    { role: 'dialog', 'aria-label': t('boards.issueAria', { n: it.number }) },
    h('header', {}, pill, h('h2', { title: it.title }, `#${it.number} ${it.title}`), close),
    meta,
    h('div.gh-body', {}, conv),
    h(
      'footer',
      {},
      h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, t('boards.openOnGithub')),
      h('button.btn', { type: 'button', title: t('boards.askIssueTitle'), onclick: () => actions.ask(issueContext(it), t('boards.askIssueTask', { n: it.number })) }, t('boards.askWorker')),
      h('button.btn', { type: 'button', title: t('boards.meetingTitle'), onclick: () => actions.meeting(issueMeeting(it.number, it.title)) }, t('boards.meeting')),
      closeIssue,
      queueProvider.element,
      queue,
      pickUp,
      h('button.btn.primary', { type: 'button', onclick: () => actions.assign(issuePrompt(it), t('boards.handIssueTask', { n: it.number })) }, t('boards.handToWorker')),
    ),
  );
  const renderFrame = () => {
    const isOpen = it.state === 'OPEN';
    meta.replaceChildren(
      ...nodes(
        avatar(it.author),
        h('b', {}, it.author),
        h('span', {}, t('boards.openedAgo', { ago: timeAgo(it.createdAt) })),
        it.assignees.length ? h('span', {}, `· 👤 ${it.assignees.join(', ')}`) : null,
        ...it.labels.map(labelChip),
        labelButton('issue', () => it, net, (labels) => ((it = { ...it, labels }), renderFrame())),
      ),
    );
    pill.className = `pill ${isOpen ? 'done' : 'offline'}`;
    pill.textContent = t(isOpen ? 'boards.pillOpen' : 'boards.pillClosed');
    const task = store.taskForIssue(it.number);
    const onQueue = !!task && task.status !== 'done';
    closeIssue.classList.toggle('hidden', !isOpen);
    pickUp.classList.toggle('hidden', !isOpen);
    queueProvider.element.classList.toggle('hidden', !isOpen || onQueue);
    queue.classList.toggle('hidden', !isOpen);
    queue.disabled = onQueue;
    queue.title = onQueue ? '' : t('boards.queueIssueTitle');
    queue.textContent = onQueue ? (task!.status === 'running' ? t('boards.workerOnIt', { name: task!.workerName ?? t('boards.aWorkerCap') }) : t('boards.onQueue')) : t('boards.addToQueueBtn');
  };
  const render = () => {
    thread.replaceChildren(commentCard({ id: 'body', author: it.author, body: detail?.body ?? it.body, createdAt: it.createdAt, url: it.url }, itemUrl, t('boards.openedThis')));
    if (error) thread.append(errorBox(error, load));
    else if (!detail) thread.append(spinnerRow(t('boards.loadingComments')));
    else if (!detail.comments.length) thread.append(h('p.gh-quiet', {}, t('boards.noComments')));
    else thread.append(...detail.comments.map((c) => commentCard(c, itemUrl, t('boards.commented'))));
  };
  let generation = 0;
  function load() {
    const g = ++generation;
    error = '';
    render();
    getJson<GhIssueDetail>(`/api/gh/issue?number=${it.number}`)
      .then((d) => {
        if (g !== generation) return;
        detail = d;
        it = { ...it, state: d.state };
        comment.setViewer(d.viewer);
      })
      .catch((err) => g === generation && (error = (err as Error).message))
      .finally(() => g === generation && (renderFrame(), render()));
  }
  const unsubs = [
    store.on('issues', () => {
      const fresh = store.issues.items.find((i) => i.number === it.number);
      if (!fresh) return;
      // The board can lag behind a close made from here.
      it = detail ? { ...fresh, state: fresh.state === 'OPEN' ? detail.state : fresh.state } : fresh;
      renderFrame();
    }),
    store.on('queue', renderFrame),
  ];
  const modal = openModal(el, {
    doing: t('boards.doingIssue', { n: it.number }),
    onClose: () => {
      comment.dispose();
      unsubs.forEach((u) => u());
    },
  });
  close.addEventListener('click', () => modal.close());
  renderFrame();
  load();
}
