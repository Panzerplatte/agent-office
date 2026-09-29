import { fmtCost, fmtTokens, tokensOf, type AgentProvider, type Usage } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { providerUsageState, providerUsageTracked, resolvedProvider } from './provider';
import { t } from '../i18n';

export { fmtCost, fmtTokens, tokensOf };

function displayedCost(u: Usage): string {
  return u.costKnown === false ? t('windows.usage.costUnavailable') : fmtCost(u.cost);
}

const tokens = (n: number) => t('windows.usage.tokens', { n: fmtTokens(n) });

/** The input/output, reasoning and cache lines of a tooltip. */
function breakdown(input: number, output: number, reasoning: number, cacheWrite: number, cacheRead: number): string[] {
  return [
    t('windows.usage.inputOutput', { input: fmtTokens(input), output: fmtTokens(output) }),
    t('windows.usage.reasoning', { n: fmtTokens(reasoning) }),
    t('windows.usage.cache', { write: fmtTokens(cacheWrite), read: fmtTokens(cacheRead) }),
  ];
}

/** e.g. "$0.42 · 38k tokens"; OpenCode's amount is explicitly an estimate. */
export function usageLabel(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true
    ? t('windows.usage.costUnavailable')
    : u.costKnown === false
      ? t('windows.usage.costUnavailable')
      : provider === 'opencode'
        ? t('windows.usage.reported', { cost: fmtCost(u.cost) })
        : fmtCost(u.cost);
  return `${u.incomplete ? t('windows.usage.partial') : ''}${money} · ${tokens(tokensOf(u))}`;
}

/** The breakdown behind a figure, for a tooltip. */
export function usageTitle(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true ? t('windows.usage.costUnavailable') : u.costKnown === false ? t('windows.usage.costUnavailable') : fmtCost(u.cost);
  const calls = provider === 'codex' || u.callsKnown === false
    ? t('windows.usage.callsUnavailable')
    : provider === 'opencode'
      ? t('windows.usage.reportedCalls', { n: u.calls })
      : t('windows.usage.apiCalls', { n: u.calls });
  return [
    ...(u.incomplete ? [t('windows.usage.partialMetrics')] : []),
    provider === 'codex'
      ? t('windows.usage.codexBreakdown', { money, calls })
      : provider === 'opencode'
        ? t('windows.usage.opencodeBreakdown', { money, calls })
        : t('windows.usage.moneyOverCalls', { money, calls }),
    ...breakdown(u.input, u.output, u.reasoning ?? 0, u.cacheWrite, u.cacheRead),
  ].join('\n');
}

export function overBudget(): boolean {
  const s = store.usage;
  return s.budget !== undefined && s.today.cost >= s.budget;
}

/** New hires are refused: the daily budget is spent and the office runs with --budget-pause. */
export const hiringPaused = () => store.usage.pauseHiring && overBudget();

/** The sidebar's spend lines: what the workers at their desks cost, today's total and the budget. */
export function renderUsage() {
  const s = store.usage;
  let now = 0;
  let currentOpenCodeCost = 0;
  let currentOpenCodeTokens = 0;
  let currentOpenCodeInput = 0;
  let currentOpenCodeOutput = 0;
  let currentOpenCodeReasoning = 0;
  let currentOpenCodeCacheWrite = 0;
  let currentOpenCodeCacheRead = 0;
  let currentOpenCodeReports = 0;
  let currentOpenCodeCostUnknown = false;
  let currentOpenCodeIncomplete = false;
  let openCodeWaiting = false;
  let currentCodexCost = 0;
  let currentCodexTokens = 0;
  let currentCodexInput = 0;
  let currentCodexOutput = 0;
  let currentCodexReasoning = 0;
  let currentCodexCacheWrite = 0;
  let currentCodexCacheRead = 0;
  let currentCodexReports = 0;
  let currentCodexCostUnknown = false;
  let currentCodexIncomplete = false;
  let codexWaiting = false;
  let untracked = false;
  for (const w of store.workers.values()) {
    if (w.kind !== 'agent') continue;
    const provider = resolvedProvider(w.provider, store.project);
    const state = providerUsageState(provider, store.project, w.usage);
    if (state === 'untracked') untracked = true;
    if (provider === 'opencode') {
      if (!w.usage) {
        openCodeWaiting = true;
        continue;
      }
      currentOpenCodeReports++;
      if (w.usage.incomplete) currentOpenCodeIncomplete = true;
      currentOpenCodeTokens += tokensOf(w.usage);
      currentOpenCodeInput += w.usage.input;
      currentOpenCodeOutput += w.usage.output;
      currentOpenCodeReasoning += w.usage.reasoning ?? 0;
      currentOpenCodeCacheWrite += w.usage.cacheWrite;
      currentOpenCodeCacheRead += w.usage.cacheRead;
      if (w.usage.costKnown === false) currentOpenCodeCostUnknown = true;
      else currentOpenCodeCost += w.usage.cost;
    }
    if (provider === 'codex') {
      if (!w.usage) {
        codexWaiting = true;
        continue;
      }
      currentCodexReports++;
      if (w.usage.incomplete) currentCodexIncomplete = true;
      currentCodexTokens += tokensOf(w.usage);
      currentCodexInput += w.usage.input;
      currentCodexOutput += w.usage.output;
      currentCodexReasoning += w.usage.reasoning ?? 0;
      currentCodexCacheWrite += w.usage.cacheWrite;
      currentCodexCacheRead += w.usage.cacheRead;
      if (w.usage.costKnown !== true) currentCodexCostUnknown = true;
      else currentCodexCost += w.usage.cost;
    }
    if (providerUsageTracked(provider, store.project, w.usage) && w.usage?.costKnown !== false && !w.usage?.incomplete) now += w.usage?.cost ?? 0;
  }
  const head = $('workers-cost');
  head.textContent = now > 0 ? fmtCost(now) : '';
  head.title = t('windows.usage.workersCostTitle');

  const el = $('usage');
  const any = s.total.calls > 0 || s.budget !== undefined || untracked || currentOpenCodeReports > 0 || openCodeWaiting || currentCodexReports > 0 || codexWaiting;
  el.classList.toggle('hidden', !any);
  if (!any) return;
  const over = overBudget();
  el.classList.toggle('over', over);
  const rows: HTMLElement[] = [];
  if (s.total.calls > 0 || s.budget !== undefined) {
    rows.push(
      h(
        'div.row',
        {},
        h('span', {}, t('windows.usage.claudeToday')),
        h('b', { title: usageTitle(s.today, 'claude') }, displayedCost(s.today)),
        s.budget !== undefined ? h('span.muted', {}, t('windows.usage.ofBudget', { budget: fmtCost(s.budget) })) : h('span.muted', {}, `· ${tokens(tokensOf(s.today))}`),
      ),
    );
  }
  if (s.budget !== undefined) {
    const pct = Math.min(100, (s.today.cost / s.budget) * 100);
    const state = over ? (s.pauseHiring ? t('windows.usage.budgetSpentPaused') : t('windows.usage.budgetSpent')) : t('windows.usage.budgetPct', { pct: Math.round(pct) });
    rows.push(h('div.budget', { class: over ? 'over' : pct >= 80 ? 'near' : '', title: state, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, h('div.fill', { style: `width:${pct}%` })));
  }
  if (s.total.calls > 0 || s.budget !== undefined) rows.push(h('div.row.muted', { title: usageTitle(s.total, 'claude') }, t('windows.usage.claudeAllTime', { cost: displayedCost(s.total), tokens: tokens(tokensOf(s.total)) })));
  if (currentOpenCodeReports > 0) {
    const amount = currentOpenCodeCostUnknown ? t('windows.usage.costUnavailable') : t('windows.usage.reported', { cost: fmtCost(currentOpenCodeCost) });
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            t('windows.usage.opencodeDesksTitle'),
            ...breakdown(currentOpenCodeInput, currentOpenCodeOutput, currentOpenCodeReasoning, currentOpenCodeCacheWrite, currentOpenCodeCacheRead),
          ].join('\n'),
        },
        t('windows.usage.providerRow', {
          provider: 'OpenCode',
          which: currentOpenCodeIncomplete ? t('windows.usage.partialRow') : t('windows.usage.currentDesks'),
          amount,
          tokens: tokens(currentOpenCodeTokens),
        }),
      ),
    );
  }
  if (openCodeWaiting) rows.push(h('div.row.muted', { title: t('windows.usage.opencodeWaitingTitle') }, t('windows.usage.opencodeWaiting')));
  if (currentCodexReports > 0) {
    const amount = currentCodexCostUnknown ? t('windows.usage.costUnavailable') : fmtCost(currentCodexCost);
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            t('windows.usage.codexDesksTitle'),
            ...breakdown(currentCodexInput, currentCodexOutput, currentCodexReasoning, currentCodexCacheWrite, currentCodexCacheRead),
          ].join('\n'),
        },
        t('windows.usage.providerRow', {
          provider: 'Codex',
          which: currentCodexIncomplete ? t('windows.usage.partialRow') : t('windows.usage.currentDesks'),
          amount,
          tokens: tokens(currentCodexTokens),
        }),
      ),
    );
  }
  if (codexWaiting) rows.push(h('div.row.muted', { title: t('windows.usage.codexWaitingTitle') }, t('windows.usage.codexWaiting')));
  if (untracked) {
    rows.push(h('div.row.muted', { title: t('windows.usage.customTitle') }, t('windows.usage.customUntracked')));

  }
  el.replaceChildren(...rows);
}
