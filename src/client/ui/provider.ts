import type { AgentChoice, AgentEffort, AgentProvider, ClaudeModel, ProjectInfo, Usage } from '../../shared/protocol';
import { AGENT_EFFORTS, CLAUDE_MODELS } from '../../shared/protocol';
import { store } from '../state';
import { t } from '../i18n';
import { h } from './dom';

export const PROVIDER_LABEL: Record<AgentProvider, string> = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
  custom: t('windows.provider.custom'),
};

export const CLAUDE_MODEL_LABEL: Record<ClaudeModel, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

export const EFFORT_LABEL: Record<AgentEffort, string> = {
  low: t('windows.provider.effortLow'),
  medium: t('windows.provider.effortMedium'),
  high: t('windows.provider.effortHigh'),
  xhigh: t('windows.provider.effortXhigh'),
  max: t('windows.provider.effortMax'),
};

/** A short badge for the task card / sidebar: "Opus", "Opus · High", or the raw OpenCode model id. */
export function modelBadge(provider: AgentProvider | undefined, model: string | undefined, effort: AgentEffort | undefined): string | undefined {
  if (!model && !effort) return undefined;
  if (provider === 'claude') {
    const label = model && model in CLAUDE_MODEL_LABEL ? CLAUDE_MODEL_LABEL[model as ClaudeModel] : undefined;
    const parts = [label, effort ? EFFORT_LABEL[effort] : undefined].filter((v): v is string => !!v);
    return parts.length ? parts.join(' · ') : undefined;
  }
  return model;
}

/** Providers the server says this project can start. */
export function supportedProviders(project: ProjectInfo | null): AgentProvider[] {
  const values = project?.agentProviders?.filter((p): p is AgentProvider => p === 'claude' || p === 'opencode' || p === 'codex' || p === 'custom') ?? [];
  if (values.length) return [...new Set(values)];
  return project?.defaultProvider && PROVIDER_LABEL[project.defaultProvider] ? [project.defaultProvider] : ['claude'];
}

/** Resolve old workers/tasks that have no provider metadata to the configured default. */
export function resolvedProvider(provider: AgentProvider | undefined, project: ProjectInfo | null): AgentProvider {
  // A worker/task keeps its identity even if the office was later restarted with a
  // configuration that no longer offers that provider.
  if (provider && PROVIDER_LABEL[provider]) return provider;
  const configured = project?.defaultProvider;
  return configured && PROVIDER_LABEL[configured] ? configured : supportedProviders(project)[0];
}

export function providerLabel(provider: AgentProvider | undefined, project: ProjectInfo | null): string {
  return PROVIDER_LABEL[resolvedProvider(provider, project)];
}

export function providerUsageTracked(provider: AgentProvider | undefined, project: ProjectInfo | null, usage?: Usage): boolean {
  const selected = resolvedProvider(provider, project);
  return selected === 'claude' || ((selected === 'opencode' || selected === 'codex' || selected === 'custom') && usage !== undefined);
}

export type ProviderUsageState = 'tracked' | 'waiting' | 'untracked';

/** Distinguishes a provider with no first report from one whose metrics are intentionally unavailable. */
export function providerUsageState(provider: AgentProvider | undefined, project: ProjectInfo | null, usage?: Usage): ProviderUsageState {
  const selected = resolvedProvider(provider, project);
  if (selected === 'claude') return usage ? 'tracked' : 'waiting';
  if (selected === 'opencode') return usage ? 'tracked' : 'waiting';
  if (selected === 'codex') return usage ? 'tracked' : 'waiting';
  if (selected === 'custom') return usage ? 'tracked' : 'untracked';
  return 'untracked';
}

export function providerUsageNote(provider: AgentProvider): string {
  if (provider === 'claude') return t('windows.provider.usageClaude');
  if (provider === 'codex') return t('windows.provider.usageCodex');
  if (provider === 'custom') return t('windows.provider.usageCustom');
  return t('windows.provider.usageOpenCode');
}

/**
 * The worker a new one starts on unless someone picks another: the one set in ⚙️ Settings, or the
 * office's --agent on its own default model.
 */
export function officeChoice(project: ProjectInfo | null): AgentChoice {
  const picked = store.prompts.agent;
  if (picked && supportedProviders(project).includes(picked.provider)) {
    return { provider: picked.provider, ...(picked.model ? { model: picked.model } : {}), ...(picked.effort ? { effort: picked.effort } : {}) };
  }
  return { provider: resolvedProvider(project?.defaultProvider, project) };
}

/** "Claude Code · Opus · High", "Claude Code", "OpenCode · anthropic/claude-sonnet-4". */
export function choiceLabel(choice: AgentChoice): string {
  const badge = modelBadge(choice.provider, choice.model, choice.effort);
  return badge ? `${PROVIDER_LABEL[choice.provider]} · ${badge}` : PROVIDER_LABEL[choice.provider];
}

export interface ProviderPicker {
  element: HTMLElement;
  value(): AgentProvider;
  /** The optional initial model override: an OpenCode provider/model id, or a Claude model alias. */
  model(): string | undefined;
  /** The optional Claude reasoning effort. */
  effort(): AgentEffort | undefined;
  /** Reports a visible field error for an invalid nonempty OpenCode model. */
  valid(): boolean;
}

export interface AgentFields extends ProviderPicker {
  /** Puts the fields on this provider, model and effort. */
  set(choice: AgentChoice): void;
  /** What they're on now. */
  choice(): AgentChoice;
}

const MODEL_MAX = 256;
let modelList: string[] | null = null;
let modelListAt = 0;
let modelRequest: Promise<string[]> | null = null;

function validModel(value: string): boolean {
  if (value.length === 0 || value.length > MODEL_MAX || /[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

function fetchOpenCodeModels(): Promise<string[]> {
  if (modelList && Date.now() - modelListAt < 60_000) return Promise.resolve(modelList);
  if (modelRequest) return modelRequest;
  modelRequest = fetch('/api/agents/opencode/models', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: unknown };
      const models = Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === 'string' && validModel(m)) : [];
      modelList = [...new Set(models)];
      modelListAt = Date.now();
      return modelList;
    })
    .finally(() => {
      modelRequest = null;
    });
  return modelRequest;
}

/**
 * The provider, model and effort fields: a provider selector that never offers a provider outside
 * the server's metadata, with a model (and, for Claude, reasoning effort) picker underneath.
 */
export function agentFields(project: ProjectInfo | null, id: string, initial: AgentChoice, label = t('windows.provider.label')): AgentFields {
  const options = supportedProviders(project);
  const fallback = resolvedProvider(project?.defaultProvider, project);
  const select = h('select.provider-select', { id, 'aria-label': t('windows.provider.select') }) as HTMLSelectElement;
  for (const provider of options) select.append(h('option', { value: provider }, PROVIDER_LABEL[provider]));
  const note = h('small.provider-note');
  const modelInput = h('input', {
    type: 'text',
    id: `${id}-model`,
    list: `${id}-models`,
    placeholder: t('windows.provider.openCodeDefault'),
    'aria-label': t('windows.provider.openCodeModel'),
    autocomplete: 'off',
    maxlength: MODEL_MAX,
  }) as HTMLInputElement;
  const modelHint = h('small.provider-model-hint', {}, t('windows.provider.modelHint'));
  const modelListEl = h('datalist', { id: `${id}-models` });
  const modelChoice = h('div.provider-model', {}, h('label', { for: `${id}-model` }, t('windows.provider.openCodeModel')), modelInput, modelListEl, modelHint);

  const claudeModelSelect = h('select', { id: `${id}-claude-model`, 'aria-label': t('windows.provider.claudeModel') }) as HTMLSelectElement;
  claudeModelSelect.append(h('option', { value: '' }, t('windows.provider.claudeDefault')));
  for (const m of CLAUDE_MODELS) claudeModelSelect.append(h('option', { value: m }, CLAUDE_MODEL_LABEL[m]));
  const effortSelect = h('select', { id: `${id}-effort`, 'aria-label': t('windows.provider.effortSelect') }) as HTMLSelectElement;
  effortSelect.append(h('option', { value: '' }, t('windows.provider.default')));
  for (const e of AGENT_EFFORTS) effortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const claudeChoice = h(
    'div.provider-model.claude-model',
    {},
    h('label', { for: `${id}-claude-model` }, t('windows.provider.model')),
    claudeModelSelect,
    h('label', { for: `${id}-effort` }, t('windows.provider.effort')),
    effortSelect,
    h('small.provider-model-hint', {}, t('windows.provider.costHint')),
  );

  const element = h('div.provider-choice', {}, h('label', { for: id }, label), select, note, modelChoice, claudeChoice);
  /** OpenCode's model suggestions, asked for only once someone can see the field. */
  const loadModels = () => {
    if (select.value !== 'opencode' || !element.isConnected || element.closest('.hidden')) return;
    modelHint.textContent = modelList ? t('windows.provider.modelHintChoose') : t('windows.provider.modelHintLoading');
    void fetchOpenCodeModels()
      .then((models) => {
        modelListEl.replaceChildren(...models.map((model) => h('option', { value: model })));
        modelHint.textContent = t('windows.provider.modelHintChoose');
      })
      .catch(() => {
        modelHint.textContent = t('windows.provider.modelHintUnavailable');
      });
  };
  const setModelVisibility = (provider: AgentProvider) => {
    const openCode = provider === 'opencode';
    note.textContent = providerUsageNote(provider);
    modelChoice.classList.toggle('hidden', !openCode);
    modelInput.disabled = !openCode;
    claudeChoice.classList.toggle('hidden', provider !== 'claude');
    loadModels();
  };
  const set = (c: AgentChoice) => {
    select.value = options.includes(c.provider) ? c.provider : options.includes(fallback) ? fallback : options[0];
    const claude = select.value === 'claude';
    claudeModelSelect.value = claude && c.model && (CLAUDE_MODELS as readonly string[]).includes(c.model) ? c.model : '';
    effortSelect.value = claude && c.effort ? c.effort : '';
    modelInput.value = select.value === 'opencode' && c.model ? c.model : '';
    modelInput.setCustomValidity('');
    setModelVisibility(select.value as AgentProvider);
  };
  set(initial);
  select.addEventListener('change', () => setModelVisibility(select.value as AgentProvider));
  modelInput.addEventListener('focus', loadModels);
  modelInput.addEventListener('input', () => modelInput.setCustomValidity(''));
  const value = () => (options.includes(select.value as AgentProvider) ? (select.value as AgentProvider) : fallback);
  const effort = () => (select.value === 'claude' && effortSelect.value ? (effortSelect.value as AgentEffort) : undefined);
  const model = () => {
    if (select.value === 'claude') return claudeModelSelect.value || undefined;
    if (select.value !== 'opencode') return undefined;
    const v = modelInput.value;
    return validModel(v) ? v : undefined;
  };
  return {
    element,
    value,
    effort,
    model,
    set,
    choice: () => ({ provider: value(), ...(model() ? { model: model() } : {}), ...(effort() ? { effort: effort() } : {}) }),
    valid: () => {
      if (select.value !== 'opencode' || !modelInput.value) {
        modelInput.setCustomValidity('');
        return true;
      }
      const okay = validModel(modelInput.value);
      modelInput.setCustomValidity(okay ? '' : t('windows.provider.modelInvalid'));
      if (!okay) modelInput.reportValidity();
      return okay;
    },
  };
}

/**
 * Which worker to start: the office's default (⚙️ Settings), shown as a line, with an ✏️ Edit button
 * that opens the provider, model and effort fields to pick another for this one.
 */
export function providerPicker(project: ProjectInfo | null, id: string, label = t('windows.provider.worker')): ProviderPicker {
  let editing = false;
  const fields = agentFields(project, id, officeChoice(project));
  fields.element.classList.add('hidden');
  const current = h('span.provider-current');
  const edit = h('button.btn.small', { type: 'button', 'aria-expanded': 'false' }) as HTMLButtonElement;
  const element = h('div.provider-pick', {}, h('div.provider-summary', {}, h('span.provider-label', {}, label), current, edit), fields.element);
  const paint = () => {
    const def = officeChoice(project);
    current.textContent = choiceLabel(def);
    current.title = store.prompts.agent ? t('windows.provider.defaultSet') : t('windows.provider.defaultAgent');
    current.classList.toggle('hidden', editing);
    edit.textContent = editing ? t('windows.provider.useDefault') : t('windows.provider.edit');
    edit.title = editing ? t('windows.provider.backTo', { choice: choiceLabel(def) }) : t('windows.provider.editTip');
    edit.setAttribute('aria-expanded', String(editing));
    fields.element.classList.toggle('hidden', !editing);
  };
  edit.addEventListener('click', () => {
    editing = !editing;
    paint();
    // They open on the default as it is now.
    if (!editing) return;
    fields.set(officeChoice(project));
    (fields.element.querySelector('select') as HTMLSelectElement | null)?.focus();
  });
  paint();
  // The default can change while this is open; it goes once its window has closed.
  const off = store.on('prompts', () => (element.isConnected ? paint() : off()));
  return {
    element,
    value: () => (editing ? fields.value() : officeChoice(project).provider),
    model: () => (editing ? fields.model() : officeChoice(project).model),
    effort: () => (editing ? fields.effort() : officeChoice(project).effort),
    valid: () => !editing || fields.valid(),
  };
}
