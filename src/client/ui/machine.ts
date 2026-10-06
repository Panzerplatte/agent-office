import type { ClientMsg, MachineProcs, ProcGroup, ProcRow } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal } from './dom';
import { locale, t } from '../i18n';
import { loadColor } from '../world/machine';

export type ProcSort = 'mem' | 'cpu';

export interface MachineHooks {
  send: (msg: ClientMsg) => void;
  /** The worker is on your floor: send it home (asks first). */
  sendHome: (workerId: string) => void;
  /** ⚙️ Settings, where the worker limit is. */
  settings: () => void;
}

const SORT_KEY = 'ao-machine-sort';
/** The breakdown is open: after a reconnect the office has to be asked for it again. */
let open = false;

export function machineOpen(): boolean {
  return open;
}

/** 1.2 GB, 340 MB, 12 MB. */
export function fmtBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  const [v, unit] = abs >= 2 ** 30 ? [bytes / 2 ** 30, 'GB'] : [bytes / 2 ** 20, 'MB'];
  const digits = Math.abs(v) < 10 && unit === 'GB' ? 1 : 0;
  return `${v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

export function fmtCpu(pct: number | null): string {
  if (pct === null) return '…';
  return `${pct.toLocaleString(locale(), { maximumFractionDigits: pct < 10 ? 1 : 0 })}%`;
}

/** 45 s, 12 min, 3 h, 2 d. */
export function fmtAge(s: number): string {
  if (s < 60) return t('windows.machine.ageS', { n: s });
  if (s < 3600) return t('windows.machine.ageM', { n: Math.floor(s / 60) });
  if (s < 86400) return t('windows.machine.ageH', { n: Math.floor(s / 3600) });
  return t('windows.machine.ageD', { n: Math.floor(s / 86400) });
}

/** Groups in a section, the biggest by `sort` first; everything not listed stays last. */
export function sortGroups(groups: ProcGroup[], sort: ProcSort): ProcGroup[] {
  const size = (g: ProcGroup) => (sort === 'mem' ? g.rss : (g.cpu ?? 0));
  return [...groups].sort((a, b) => Number(a.id === 'other:rest') - Number(b.id === 'other:rest') || size(b) - size(a) || a.label.localeCompare(b.label));
}

const OFFICE_PARTS = {
  server: ['windows.machine.office.server', 'windows.machine.officeWhy.server'],
  ptys: ['windows.machine.office.ptys', 'windows.machine.officeWhy.ptys'],
  tv: ['windows.machine.office.tv', 'windows.machine.officeWhy.tv'],
  helpers: ['windows.machine.office.helpers', 'windows.machine.officeWhy.helpers'],
} as const;
const officePart = (id: string) => OFFICE_PARTS[id as keyof typeof OFFICE_PARTS] ?? OFFICE_PARTS.helpers;

function groupName(g: ProcGroup): string {
  if (g.kind === 'worker') return g.worker?.name ?? g.label;
  if (g.kind === 'office') return t(officePart(g.id)[0]);
  if (g.id === 'other:rest') return t('windows.machine.otherRest', { n: g.count });
  return g.count > 1 ? `${g.label} ×${g.count}` : g.label;
}

function groupMeta(g: ProcGroup, floors: number): string {
  if (g.kind === 'worker' && g.worker) {
    const w = g.worker;
    return [
      w.issue ? `#${w.issue}` : '',
      w.task ?? '',
      w.branch ? `🌿 ${w.branch}` : '',
      floors > 1 ? `🏢 ${w.floor}` : '',
      g.count ? t('windows.machine.procCount', { n: g.count }) : t('windows.machine.asleep'),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (g.kind === 'office') return [t(officePart(g.id)[1]), t('windows.machine.procCount', { n: g.count })].join(' · ');
  if (g.id === 'other:rest') return t('windows.machine.otherRestWhy');
  return [g.user ? t('windows.machine.user', { user: g.user }) : '', g.count > 1 ? t('windows.machine.procCount', { n: g.count }) : ''].filter(Boolean).join(' · ');
}

/** A thin bar: how much of the machine it takes. */
function bar(pct: number, color: string): HTMLElement {
  const w = Math.max(0, Math.min(100, pct));
  return h('span.mp-bar', {}, h('span', { style: `width:${w}%;background:${color}` }));
}

function figures(rss: number, cpu: number | null, total: number): HTMLElement {
  const memPct = total ? (rss / total) * 100 : 0;
  return h(
    'div.mp-figs',
    {},
    h('span.mp-fig', { title: t('windows.machine.memTitle') }, bar(memPct, loadColor(memPct * 2)), h('b', {}, fmtBytes(rss))),
    h('span.mp-fig', { title: t('windows.machine.cpuTitle') }, bar(cpu ?? 0, loadColor((cpu ?? 0) * 2)), h('b', {}, fmtCpu(cpu))),
  );
}

function procRow(p: ProcRow): HTMLElement {
  return h(
    'li',
    {},
    h('code.mp-cmd', { title: `PID ${p.pid}` }, p.cmd || '?'),
    p.age !== undefined ? h('span.mp-age', {}, fmtAge(p.age)) : '',
    h('span.mp-num', {}, fmtBytes(p.rss)),
    h('span.mp-num', {}, fmtCpu(p.cpu)),
  );
}

/**
 * 🖥️ This machine, process by process (E at the monitor on the wall): every worker with the processes
 * under its terminal and what it's on, the office's own processes, and everything else on the
 * machine, by memory or by CPU, adding up to the machine's figures. The office only reads the
 * process table while this is open.
 */
export function openMachine(hooks: MachineHooks) {
  if (open) return;
  open = true;
  let sort: ProcSort = 'mem';
  try {
    if (localStorage.getItem(SORT_KEY) === 'cpu') sort = 'cpu';
  } catch {
    // no storage: memory first
  }
  const body = h('div.body.machine-procs');
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const tabs = h('div.os-tabs', { role: 'group', 'aria-label': t('windows.machine.sortBy') });
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('windows.machine.dialog'), style: 'width:min(860px,100%)' },
    h('header', {}, h('h2', {}, t('windows.machine.title')), tabs, close),
    body,
    h('footer', {}, h('span.grow', {}, t('windows.machine.footer'))),
  );

  const render = () => {
    tabs.replaceChildren(
      ...(['mem', 'cpu'] as const).map((s) =>
        h(
          'button.btn',
          {
            type: 'button',
            class: s === sort ? 'on' : '',
            'aria-pressed': String(s === sort),
            onclick: () => {
              sort = s;
              try {
                localStorage.setItem(SORT_KEY, s);
              } catch {
                // fine
              }
              render();
            },
          },
          t(s === 'mem' ? 'windows.machine.sortMem' : 'windows.machine.sortCpu'),
        ),
      ),
    );
    const s = store.machineProcs;
    if (!s) {
      body.replaceChildren(h('p.note', {}, t('windows.machine.reading')));
      return;
    }
    body.replaceChildren(summary(s));
    if (s.unsupported) {
      body.append(h('p.note', {}, t('windows.machine.unsupported')));
      return;
    }
    const floors = new Set(s.groups.flatMap((g) => (g.worker ? [g.worker.floor] : []))).size;
    for (const kind of ['worker', 'office', 'other'] as const) {
      const groups = sortGroups(
        s.groups.filter((g) => g.kind === kind),
        sort,
      );
      if (!groups.length && kind !== 'worker') continue;
      body.append(h('h3.mp-head', {}, t(`windows.machine.section.${kind}`)));
      if (!groups.length) {
        body.append(h('p.note', {}, t('windows.machine.noWorkers')));
        continue;
      }
      body.append(h('ul.mp-list', {}, ...groups.map((g) => groupItem(g, s, floors))));
    }
    // What no process accounts for, and that it all adds up.
    body.append(
      h(
        'ul.mp-list',
        {},
        h(
          'li.mp-group.mp-rest',
          {},
          h('div.mp-row', {}, h('div.svc-main', {}, h('div.svc-title', {}, t('windows.machine.rest')), h('div.svc-meta', {}, t(s.rest.rss < 0 ? 'windows.machine.restShared' : 'windows.machine.restWhy'))), figures(s.rest.rss, s.rest.cpu, s.memTotal)),
        ),
      ),
      h('p.note.mp-total', {}, t('windows.machine.total', { procs: s.procs, mem: fmtBytes(s.memUsed), cpu: fmtCpu(s.cpu) })),
    );
  };

  const summary = (s: MachineProcs): HTMLElement => {
    const memPct = s.memTotal ? Math.round((s.memUsed / s.memTotal) * 100) : 0;
    const box = h(
      'div.mp-summary',
      {},
      h('span', {}, t('windows.machine.summaryCpu', { cpu: fmtCpu(s.cpu), cores: s.cores })),
      h('span', {}, t('windows.machine.summaryMem', { used: fmtBytes(s.memUsed), total: fmtBytes(s.memTotal), pct: memPct })),
      h('span', {}, store.machine.limit === undefined ? t('windows.machine.summaryWorkers', { n: store.machine.workers }) : t('windows.machine.summaryWorkersOf', { n: store.machine.workers, limit: store.machine.limit })),
    );
    if (!s.pressure) return box;
    const settings = h('button.btn', { type: 'button' }, t('windows.machine.limitInSettings'));
    settings.addEventListener('click', () => hooks.settings());
    // In the reader's language (the office's own words are English).
    const parts = [s.strain.mem ? t('windows.machine.pressureMem', { pct: memPct }) : '', s.strain.cpu ? t('windows.machine.pressureCpu') : ''].filter(Boolean);
    const why = parts.length === 2 ? t('windows.machine.pressureAnd', { a: parts[0], b: parts[1] }) : (parts[0] ?? s.pressure);
    return h('div', {}, box, h('div.mp-pressure', {}, h('p', {}, t('windows.machine.pressure', { why })), settings));
  };

  const groupItem = (g: ProcGroup, s: MachineProcs, floors: number): HTMLElement => {
    const color = g.worker?.color ?? (g.kind === 'office' ? '#ff8a5b' : '#8d99ae');
    const heavy = g.heavy?.length ? h('span.mp-heavy', {}, t(g.heavy.length > 1 ? 'windows.machine.heavyBoth' : g.heavy[0] === 'mem' ? 'windows.machine.heavyMem' : 'windows.machine.heavyCpu')) : '';
    const actions: HTMLElement[] = [];
    if (g.kind === 'worker' && store.workers.has(g.id)) {
      const home = h('button.btn', { type: 'button', title: t('windows.machine.sendHomeTitle') }, t('windows.machine.sendHome'));
      home.addEventListener('click', () => hooks.sendHome(g.id));
      actions.push(home);
    }
    const rows = g.kind === 'other' && g.count < 2 ? [] : g.top;
    return h(
      'li.mp-group',
      { class: g.heavy?.length ? 'heavy' : '' },
      h(
        'div.mp-row',
        {},
        h('span.dot', { style: `background:${color}` }),
        h('div.svc-main', {}, h('div.svc-title', {}, groupName(g), heavy), h('div.svc-meta', {}, groupMeta(g, floors))),
        figures(g.rss, g.cpu, s.memTotal),
        ...actions,
      ),
      ...g.hints.map((hint) => h('p.mp-hint', {}, t(g.kind === 'worker' ? 'windows.machine.hintWorker' : 'windows.machine.hint', { cmd: hint.cmd, age: fmtAge(hint.age), name: groupName(g) }))),
      rows.length ? h('ul.mp-procs', {}, ...rows.map(procRow)) : '',
    );
  };

  const unsubs = [store.on('machineProcs', render), store.on('workers', render)];
  store.machineProcs = null;
  hooks.send({ t: 'machine.watch' });
  const modal = openModal(el, {
    doing: t('windows.machine.doing'),
    onClose: () => {
      open = false;
      unsubs.forEach((u) => u());
      hooks.send({ t: 'machine.unwatch' });
      store.machineProcs = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
