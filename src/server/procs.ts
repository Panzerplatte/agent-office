import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MachineProcs, ProcGroup, ProcRow, WorkerStatus } from '../shared/protocol.js';

// 🖥️ This machine, process by process: who uses how much memory and CPU, and why. While someone has
// the breakdown open, every few seconds the office reads the process table (/proc on Linux, `ps`
// elsewhere), builds the process tree, and hands each worker the subtree under its terminal (and
// anything else that carries its AGENT_OFFICE_WORKER_ID), the office the rest of its own server and
// terminal hosts, and groups everything else by program. Nobody watching, nothing is read.

/** How often the table is read while someone watches. */
const SAMPLE_MS = 3_000;
/** The first CPU figures need a second reading: this soon after the first. */
const FIRST_GAP_MS = 1_000;
/** Rows per group, by memory and by CPU each (a process in both lists counts once). */
const TOP_ROWS = 5;
/** Other programs listed by name, by memory and by CPU each; the rest are one row. */
const TOP_OTHERS = 12;
/** A dev server running longer than this gets a hint: it may have been forgotten. */
const LONG_RUNNING_S = 60 * 60;
/** Under pressure, a group with this much of the machine (percent) is one of the reasons. */
const HEAVY_PCT = 10;
const MAX_CMD = 90;

/** One process as read from the table. */
export interface RawProc {
  pid: number;
  ppid: number;
  uid: number;
  user?: string;
  /** Its short name (comm): what it's listed by when its command line can't be shown. */
  name: string;
  /** Its whole command line, as read: never sent anywhere before safeCommand. */
  args: string;
  /** Resident memory, bytes. */
  rss: number;
  /** CPU time used so far, ms (Linux). */
  cpuMs?: number;
  /** Its CPU share of the whole machine now, percent, when the table says it (`ps`). */
  cpu?: number;
  /** When it started, ms since the epoch. */
  start?: number;
}

/** A worker and its terminal process. */
export interface WorkerRoot {
  id: string;
  /** Its terminal's process; none while it's asleep. */
  pid?: number;
  name: string;
  color: string;
  floor: string;
  status: WorkerStatus;
  task?: string;
  issue?: number;
  branch?: string;
}

/** Which processes are whose: everything breakdown() needs to know besides the table. */
export interface Owners {
  workers: WorkerRoot[];
  /** The office server's own process. */
  serverPid: number;
  /** The floors' terminal hosts (see ptys.ts). */
  hostPids: number[];
  /** Processes whose environment names a worker (AGENT_OFFICE_WORKER_ID): pid → worker id. */
  envWorkers?: Map<number, string>;
  /** The office's own user: other users' command lines aren't shown, only their programs' names. */
  uid: number;
}

export type OfficePart = 'server' | 'ptys' | 'tv' | 'helpers';
export type Owner = { kind: 'worker'; id: string } | { kind: 'office'; part: OfficePart };

/** The machine's own figures for the same moment. */
export interface MachineFigures {
  cpu: number | null;
  cores: number;
  memUsed: number;
  memTotal: number;
  pressure?: string;
  strain: { mem: boolean; cpu: boolean };
}

/** What a terminal host calls itself (ptyhost.ts sets process.title, which is its whole command line then). */
const PTY_HOST_TITLE = 'agent-office-ptys';
const CHROMIUM = /(?:^|\/)(?:chrome|chromium|chromium-browser|headless_shell|chrome-headless-shell|chrome_crashpad_handler)(?:\s|$)/;
const DEV_SERVER = /\b(?:vite|webpack(?:-dev-server)?|next|nuxt|astro|parcel|remix|http-server|live-server|nodemon|http\.server|runserver|serve)\b|\brun (?:dev|start|serve|preview)\b|\brails s(?:erver)?\b/;

// ---------------------------------------------------------------------------------------------
// Keeping secrets out of command lines.

/** Option and variable names whose value is a secret. */
const SECRET_NAME = /token|secret|passw|pwd|api.?key|access.?key|private.?key|credential|cookie|auth|bearer|signature|session/i;
/** Values that look like a token on their own: known prefixes, or a long run of letters and digits. */
const TOKEN_LIKE = /^(?:gh[pousr]_|github_pat_|glpat-|sk-|sk_live_|pk_live_|rk_live_|xox[abprs]-|AKIA|ASIA|AIza|ya29\.|eyJ)|^(?=[A-Za-z0-9+_=-]*\d)(?=[A-Za-z0-9+_=-]*[A-Za-z])[A-Za-z0-9+_=-]{32,}$/;
const INTERPRETERS = /^(?:node|nodejs|bun|deno|tsx|ts-node)$/;
/** An interpreter's options that take the next word as their value. */
const INTERPRETER_VALUE = /^(?:-r|--require|--import|--loader|--experimental-loader|--env-file|--title)$/;
const HIDDEN = '***';

function secretValue(v: string): string {
  return v ? HIDDEN : v;
}

/** A URL without its password, and without the values of query parameters that look secret. */
function safeUrl(word: string): string {
  return word
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, `$1${HIDDEN}@`)
    .replace(/([?&;])([^=&;#\s]+)=([^&;#\s]*)/g, (all, sep: string, k: string, v: string) => (SECRET_NAME.test(k) || TOKEN_LIKE.test(v) ? `${sep}${k}=${secretValue(v)}` : all));
}

/** A path, cut to its last part: `/home/x/app/node_modules/.bin/vite` → `vite`. */
function shortPath(word: string): string {
  const file = /^file:\/\//i.test(word) ? word.slice(7) : word;
  return file.includes('/') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(file) ? path.posix.basename(file.replace(/\/+$/, '')) || file : file;
}

/**
 * A command line safe to show: paths cut to their last part, an interpreter dropped in front of its
 * script, and every value that looks secret blanked out (`--token x`, `--password=x`, `KEY=value`,
 * `Bearer x`, credentials and secret-looking query parameters in URLs, anything shaped like a
 * token), then trimmed to a line. `name` stands in for an empty command line (kernel threads).
 */
export function safeCommand(args: string, name = ''): string {
  const words = args.split(/\s+/).filter(Boolean);
  if (!words.length) return name ? `[${name}]` : '';
  const out: string[] = [];
  let hideNext = false;
  // `node --import tsx …/vite.js --port 5173` reads as `vite.js --port 5173`: the interpreter and its own options go.
  if (words.length > 1 && INTERPRETERS.test(path.posix.basename(words[0]))) {
    let i = 1;
    while (i < words.length - 1 && words[i].startsWith('-')) i += INTERPRETER_VALUE.test(words[i]) ? 2 : 1;
    if (i < words.length) words.splice(0, i);
  }
  for (const word of words) {
    if (hideNext) {
      out.push(HIDDEN);
      // `Authorization: Bearer x`: the scheme, then the secret.
      hideNext = /^(?:bearer|basic|token)$/i.test(word);
      continue;
    }
    // FOO=bar: a variable handed to the command; its value may well be a key.
    const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(word);
    if (assign) {
      out.push(`${assign[1]}=${secretValue(assign[2])}`);
      continue;
    }
    if (word.startsWith('-')) {
      const eq = word.indexOf('=');
      const flag = eq >= 0 ? word.slice(0, eq) : word;
      if (SECRET_NAME.test(flag)) {
        if (eq >= 0) out.push(`${flag}=${secretValue(word.slice(eq + 1))}`);
        else {
          out.push(flag);
          hideNext = true;
        }
        continue;
      }
      if (eq >= 0) {
        const v = word.slice(eq + 1);
        out.push(`${flag}=${TOKEN_LIKE.test(v) ? HIDDEN : shortPath(safeUrl(v))}`);
        continue;
      }
      out.push(word);
      continue;
    }
    if (/^(?:bearer|basic|token)$/i.test(word) || /^authorization:?$/i.test(word)) {
      out.push(word);
      hideNext = true;
      continue;
    }
    if (TOKEN_LIKE.test(word)) {
      out.push(HIDDEN);
      continue;
    }
    out.push(shortPath(safeUrl(word)));
  }
  const s = out.join(' ');
  return s.length > MAX_CMD ? `${s.slice(0, MAX_CMD - 1)}…` : s;
}

// ---------------------------------------------------------------------------------------------
// CPU from two readings.

/** What a reading keeps for the next one: each process's CPU time so far. */
export interface CpuMark {
  /** When it was taken, ms. */
  at: number;
  /** All cores' time that had passed, ms (see machine.ts cpuTimes). */
  total: number;
  /** pid → its CPU time so far and when it started (a reused pid is a new process). */
  procs: Map<number, { cpuMs: number; start?: number }>;
}

export function cpuMark(at: number, total: number, procs: RawProc[]): CpuMark {
  const m = new Map<number, { cpuMs: number; start?: number }>();
  for (const p of procs) if (p.cpuMs !== undefined) m.set(p.pid, { cpuMs: p.cpuMs, start: p.start });
  return { at, total, procs: m };
}

/**
 * Each process's share of the whole machine's CPU between two readings, percent (one busy core of
 * eight is 12.5): its CPU time since `prev`, over all cores' time since `prev`. A process that
 * started since then counts all of its time; one that was there but wasn't read counts nothing.
 * Processes whose table gives their share outright (`ps`) keep it. Undefined without two readings.
 */
export function cpuShares(prev: CpuMark | undefined, now: CpuMark, procs: RawProc[]): Map<number, number> | undefined {
  const out = new Map<number, number>();
  const spent = prev ? now.total - prev.total : 0;
  let any = false;
  for (const p of procs) {
    if (p.cpu !== undefined) {
      out.set(p.pid, p.cpu);
      any = true;
      continue;
    }
    if (!prev || spent <= 0 || p.cpuMs === undefined) continue;
    const was = prev.procs.get(p.pid);
    let used: number;
    if (was && was.start === p.start) used = p.cpuMs - was.cpuMs;
    else used = p.start !== undefined && p.start >= prev.at ? p.cpuMs : 0;
    out.set(p.pid, Math.max(0, Math.min(100, (used / spent) * 100)));
    any = true;
  }
  return any ? out : undefined;
}

// ---------------------------------------------------------------------------------------------
// Whose is what.

/**
 * Who each process belongs to: the subtree under a worker's terminal (or under a process whose
 * environment names the worker) is the worker's; what's left of the office server's subtree and its
 * terminal hosts' is the office's (the TV's Chromium, helpers like git and gh). The rest isn't in the map.
 */
export function attribute(procs: RawProc[], owners: Owners): Map<number, Owner> {
  const children = new Map<number, number[]>();
  const byPid = new Map<number, RawProc>();
  for (const p of procs) {
    byPid.set(p.pid, p);
    if (p.ppid === p.pid) continue;
    const list = children.get(p.ppid);
    if (list) list.push(p.pid);
    else children.set(p.ppid, [p.pid]);
  }
  const out = new Map<number, Owner>();
  /** Gives `root` and everything under it that nobody has yet to `owner(pid)`. */
  const claim = (root: number, owner: (p: RawProc) => Owner) => {
    const stack = [root];
    const seen = new Set<number>();
    while (stack.length) {
      const pid = stack.pop()!;
      if (seen.has(pid)) continue;
      seen.add(pid);
      const p = byPid.get(pid);
      if (!p) continue;
      if (!out.has(pid)) out.set(pid, owner(p));
      for (const c of children.get(pid) ?? []) stack.push(c);
    }
  };
  const known = new Set(owners.workers.map((w) => w.id));
  for (const w of owners.workers) {
    if (w.pid) claim(w.pid, () => ({ kind: 'worker', id: w.id }));
  }
  // Something a worker started that got away from its terminal (a dev server sent to the background).
  for (const [pid, id] of owners.envWorkers ?? []) {
    if (known.has(id) && !out.has(pid)) claim(pid, () => ({ kind: 'worker', id }));
  }
  const officePart = (p: RawProc, own: OfficePart): Owner => ({ kind: 'office', part: CHROMIUM.test(p.args || p.name) ? 'tv' : p.pid === owners.serverPid ? 'server' : own });
  claim(owners.serverPid, (p) => officePart(p, 'helpers'));
  // The terminal hosts: the ones the office knows, and any host a worker's terminal runs under
  // (one from before hosts said their pid).
  const hosts = new Set(owners.hostPids);
  for (const w of owners.workers) {
    const parent = w.pid ? byPid.get(byPid.get(w.pid)?.ppid ?? -1) : undefined;
    if (parent && parent.args === PTY_HOST_TITLE) hosts.add(parent.pid);
  }
  for (const pid of hosts) claim(pid, (q) => officePart(q, 'ptys'));
  return out;
}

// ---------------------------------------------------------------------------------------------
// The breakdown.

const round1 = (n: number) => Math.round(n * 10) / 10;

function row(p: RawProc, cpu: Map<number, number> | undefined, uid: number, now: number): ProcRow {
  return {
    pid: p.pid,
    cmd: p.uid === uid ? safeCommand(p.args, p.name) : p.name,
    rss: p.rss,
    cpu: cpu ? round1(cpu.get(p.pid) ?? 0) : null,
    age: p.start !== undefined ? Math.max(0, Math.round((now - p.start) / 1000)) : undefined,
  };
}

/** The biggest processes by memory and the busiest by CPU, biggest first. */
function topRows(list: RawProc[], cpu: Map<number, number> | undefined, n: number): RawProc[] {
  const byMem = [...list].sort((a, b) => b.rss - a.rss).slice(0, n);
  const byCpu = cpu ? [...list].sort((a, b) => (cpu.get(b.pid) ?? 0) - (cpu.get(a.pid) ?? 0)).slice(0, n) : [];
  return [...new Set([...byMem, ...byCpu])].sort((a, b) => b.rss - a.rss);
}

function group(kind: ProcGroup['kind'], id: string, label: string, list: RawProc[], cpu: Map<number, number> | undefined, uid: number, now: number): ProcGroup {
  const rows = topRows(list, cpu, TOP_ROWS).map((p) => row(p, cpu, uid, now));
  const hints = rows.filter((r) => r.age !== undefined && r.age >= LONG_RUNNING_S && DEV_SERVER.test(r.cmd)).map((r) => ({ cmd: r.cmd, age: r.age! }));
  return {
    kind,
    id,
    label,
    rss: list.reduce((n, p) => n + p.rss, 0),
    cpu: cpu ? round1(list.reduce((n, p) => n + (cpu.get(p.pid) ?? 0), 0)) : null,
    count: list.length,
    top: rows,
    hints,
  };
}

/** A kernel thread's name without its per-CPU number (kworker/3:1 → kworker), so they list as one. */
function programName(p: RawProc): string {
  return p.args ? p.name : p.name.replace(/\/.*$/, '');
}

/**
 * Who uses what: one group per worker (every worker, asleep ones with nothing), the office's own
 * parts, then other programs by name, the biggest first and the rest in one row. `rest` is what the
 * machine's figures have beyond all the processes, so everything adds up to them.
 */
export function breakdown(procs: RawProc[], owners: Owners, cpu: Map<number, number> | undefined, machine: MachineFigures, now = Date.now()): MachineProcs {
  const owner = attribute(procs, owners);
  const workers = new Map<string, RawProc[]>(owners.workers.map((w) => [w.id, []]));
  const office = new Map<OfficePart, RawProc[]>();
  const others = new Map<string, RawProc[]>();
  for (const p of procs) {
    const o = owner.get(p.pid);
    if (o?.kind === 'worker') workers.get(o.id)?.push(p);
    else if (o?.kind === 'office') {
      const list = office.get(o.part);
      if (list) list.push(p);
      else office.set(o.part, [p]);
    } else {
      const key = `${p.user ?? p.uid}\0${programName(p)}`;
      const list = others.get(key);
      if (list) list.push(p);
      else others.set(key, [p]);
    }
  }

  const groups: ProcGroup[] = [];
  for (const w of owners.workers) {
    const g = group('worker', w.id, w.name, workers.get(w.id) ?? [], cpu, owners.uid, now);
    g.worker = { name: w.name, color: w.color, floor: w.floor, status: w.status, task: w.task, issue: w.issue, branch: w.branch };
    groups.push(g);
  }
  for (const part of ['server', 'ptys', 'tv', 'helpers'] as const) {
    const list = office.get(part);
    if (list?.length) groups.push(group('office', part, part, list, cpu, owners.uid, now));
  }
  const programs = [...others].map(([key, list]) => {
    const [user, name] = key.split('\0');
    const g = group('other', `other:${user}:${name}`, name, list, cpu, owners.uid, now);
    g.user = user;
    return g;
  });
  const listed = new Set([
    ...[...programs].sort((a, b) => b.rss - a.rss).slice(0, TOP_OTHERS),
    ...(cpu ? [...programs].sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0)).slice(0, TOP_OTHERS) : []),
  ]);
  const unlisted = programs.filter((g) => !listed.has(g));
  groups.push(...[...listed].sort((a, b) => b.rss - a.rss));
  if (unlisted.length) {
    groups.push({
      kind: 'other',
      id: 'other:rest',
      label: '',
      rss: unlisted.reduce((n, g) => n + g.rss, 0),
      cpu: cpu ? round1(unlisted.reduce((n, g) => n + (g.cpu ?? 0), 0)) : null,
      count: unlisted.reduce((n, g) => n + g.count, 0),
      top: [],
      hints: [],
    });
  }

  // Under pressure: whoever holds a big share of what's under pressure, or at least the biggest.
  const { strain } = machine;
  for (const [what, on] of [['mem', strain.mem], ['cpu', strain.cpu]] as const) {
    if (!on) continue;
    const size = (g: ProcGroup) => (what === 'mem' ? (machine.memTotal ? (g.rss / machine.memTotal) * 100 : 0) : (g.cpu ?? 0));
    const candidates = groups.filter((g) => g.id !== 'other:rest');
    let heavy = candidates.filter((g) => size(g) >= HEAVY_PCT);
    if (!heavy.length) {
      const top = candidates.reduce<ProcGroup | undefined>((a, g) => (!a || size(g) > size(a) ? g : a), undefined);
      heavy = top && size(top) > 0 ? [top] : [];
    }
    for (const g of heavy) (g.heavy ??= []).push(what);
  }

  const rss = procs.reduce((n, p) => n + p.rss, 0);
  const used = cpu ? [...cpu.values()].reduce((n, c) => n + c, 0) : 0;
  return {
    at: now,
    cpu: machine.cpu,
    cores: machine.cores,
    memUsed: machine.memUsed,
    memTotal: machine.memTotal,
    pressure: machine.pressure,
    strain,
    groups,
    rest: { rss: machine.memUsed - rss, cpu: cpu && machine.cpu !== null ? round1(Math.max(0, machine.cpu - used)) : null },
    procs: procs.length,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the table.

/** The fields of /proc/<pid>/stat this needs. Undefined if it isn't one. */
export function parseStat(text: string): { name: string; ppid: number; ticks: number; startTicks: number; rssPages: number } | undefined {
  // The name is in parentheses and may hold spaces or parentheses itself.
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return undefined;
  const f = text.slice(close + 2).split(' ');
  // f[0] is field 3 (state): utime is 14, stime 15, starttime 22, rss 24.
  const n = (i: number) => Number(f[i - 3]);
  const out = { name: text.slice(open + 1, close), ppid: n(4), ticks: n(14) + n(15), startTicks: n(22), rssPages: n(24) };
  return Number.isFinite(out.ppid) && Number.isFinite(out.ticks) && Number.isFinite(out.rssPages) ? out : undefined;
}

/** `[[dd-]hh:]mm:ss` (ps etime) → seconds. */
export function parseEtime(s: string): number | undefined {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/**
 * `ps -axww -o pid=,ppid=,uid=,user=,rss=,%cpu=,etime=,args=` (macOS, or Linux without /proc). comm
 * can hold spaces, so it isn't asked for: a process's name is its command's first word. `%cpu` is
 * of one core, so it's divided by `cores` for a share of the whole machine.
 */
export function parsePs(text: string, cores: number, now = Date.now()): RawProc[] {
  const out: RawProc[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+([\d.,]+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const args = m[8].trim();
    const age = parseEtime(m[7]);
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      uid: Number(m[3]),
      user: m[4],
      name: path.posix.basename(args.split(/\s+/)[0] ?? ''),
      args,
      rss: Number(m[5]) * 1024,
      cpu: Number(m[6].replace(',', '.')) / Math.max(1, cores),
      start: age === undefined ? undefined : now - age * 1000,
    });
  }
  return out;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (_err, out) => resolve(out ?? ''));
  });
}

let linuxConsts: Promise<{ pageSize: number; hz: number; boot: number; users: Map<number, string> }> | undefined;

/** Page size, clock ticks per second, boot time and user names: read once. */
function linuxConstants() {
  linuxConsts ??= (async () => {
    const [page, hz, statText, passwd] = await Promise.all([run('getconf', ['PAGESIZE']), run('getconf', ['CLK_TCK']), readFile('/proc/stat', 'utf8').catch(() => ''), readFile('/etc/passwd', 'utf8').catch(() => '')]);
    const users = new Map<number, string>();
    for (const line of passwd.split('\n')) {
      const [name, , uid] = line.split(':');
      if (name && uid) users.set(Number(uid), name);
    }
    return {
      pageSize: Number(page.trim()) || 4096,
      hz: Number(hz.trim()) || 100,
      boot: Number(/^btime (\d+)/m.exec(statText)?.[1] ?? 0) * 1000,
      users,
    };
  })();
  return linuxConsts;
}

async function readLinux(): Promise<RawProc[]> {
  const { pageSize, hz, boot, users } = await linuxConstants();
  const pids = (await readdir('/proc').catch(() => [] as string[])).filter((d) => /^\d+$/.test(d));
  const procs = await Promise.all(
    pids.map(async (d): Promise<RawProc | undefined> => {
      try {
        const [statText, cmdline, st] = await Promise.all([readFile(`/proc/${d}/stat`, 'utf8'), readFile(`/proc/${d}/cmdline`, 'utf8').catch(() => ''), stat(`/proc/${d}`)]);
        const s = parseStat(statText);
        if (!s) return undefined;
        return {
          pid: Number(d),
          ppid: s.ppid,
          uid: st.uid,
          user: users.get(st.uid) ?? String(st.uid),
          name: s.name,
          args: cmdline.replace(/\0+$/, '').replace(/\0/g, ' '),
          rss: s.rssPages * pageSize,
          cpuMs: (s.ticks * 1000) / hz,
          start: boot ? boot + (s.startTicks * 1000) / hz : undefined,
        };
      } catch {
        return undefined; // gone already
      }
    }),
  );
  return procs.filter((p): p is RawProc => !!p);
}

/** The machine's process table: /proc on Linux, `ps` elsewhere; undefined where neither works (Windows). */
export async function readProcesses(cores: number): Promise<RawProc[] | undefined> {
  if (process.platform === 'win32') return undefined;
  if (process.platform === 'linux') {
    const procs = await readLinux();
    if (procs.length) return procs;
  }
  const text = await run('ps', ['-axww', '-o', 'pid=,ppid=,uid=,user=,rss=,%cpu=,etime=,args=']);
  const procs = parsePs(text, cores);
  return procs.length ? procs : undefined;
}

/** The worker a process's environment names (Linux), read once per process. */
async function envWorker(pid: number): Promise<string | undefined> {
  const env = await readFile(`/proc/${pid}/environ`, 'latin1').catch(() => '');
  return /(?:^|\0)AGENT_OFFICE_WORKER_ID=([^\0]+)/.exec(env)?.[1];
}

// ---------------------------------------------------------------------------------------------
// Sampling while someone watches.

export interface ProcWatchDeps {
  /** Who owns what right now (workers come and go between readings). */
  owners: () => Omit<Owners, 'envWorkers'>;
  /** The machine's figures, and all cores' time so far (ms) for the CPU math. */
  machine: () => Omit<MachineFigures, 'cpu'>;
  /** Every core's idle and total time so far, ms (machine.ts cpuTimes): the clock both the machine's and each process's CPU are measured on. */
  cpuTimes: () => { idle: number; total: number };
  cores: () => number;
  send: (state: MachineProcs, to: string[]) => void;
  read?: (cores: number) => Promise<RawProc[] | undefined>;
  readEnv?: (pid: number) => Promise<string | undefined>;
  now?: () => number;
}

/** Reads the process table every few seconds for as long as anyone has 🖥️ This machine open. */
export class ProcWatch {
  private watchers = new Set<string>();
  private timer?: NodeJS.Timeout;
  private mark?: CpuMark;
  private times?: { idle: number; total: number };
  private busy = false;
  /** Whose each process is by its environment, by pid and start time (an environment never changes). */
  private envCache = new Map<string, string | null>();
  private last?: MachineProcs;

  constructor(private deps: ProcWatchDeps) {}

  watch(id: string) {
    const first = !this.watchers.size;
    this.watchers.add(id);
    if (first) {
      this.mark = undefined;
      this.times = undefined;
      void this.sample();
      this.schedule(FIRST_GAP_MS);
    } else if (this.last) this.deps.send(this.last, [id]);
  }

  unwatch(id: string) {
    this.watchers.delete(id);
    if (this.watchers.size) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.mark = undefined;
    this.times = undefined;
    this.last = undefined;
    this.envCache.clear();
  }

  get watching(): number {
    return this.watchers.size;
  }

  stop() {
    this.watchers.clear();
    this.unwatch('');
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.sample();
      if (this.watchers.size) this.schedule(SAMPLE_MS);
    }, ms);
    this.timer.unref();
  }

  /** One reading, sent to everyone watching. */
  async sample(): Promise<MachineProcs | undefined> {
    if (this.busy || !this.watchers.size) return undefined;
    this.busy = true;
    try {
      const now = (this.deps.now ?? Date.now)();
      const cores = this.deps.cores();
      const times = this.deps.cpuTimes();
      const procs = await (this.deps.read ?? readProcesses)(cores);
      if (!this.watchers.size) return undefined;
      const machine = this.deps.machine();
      // The machine's CPU since the last reading, on the same clock the processes' shares are on, so they add up to it.
      const was = this.times;
      const spent = was ? times.total - was.total : 0;
      const cpu = was && spent > 0 ? Math.round(Math.max(0, Math.min(100, (1 - (times.idle - was.idle) / spent) * 100)) * 10) / 10 : null;
      this.times = times;
      if (!procs) {
        const state: MachineProcs = { at: now, cpu, ...machine, groups: [], rest: { rss: machine.memUsed, cpu }, procs: 0, unsupported: true };
        this.deps.send(state, [...this.watchers]);
        return state;
      }
      const owners: Owners = { ...this.deps.owners() };
      owners.envWorkers = await this.envWorkers(procs, owners);
      const mark = cpuMark(now, times.total, procs);
      const shares = cpuShares(this.mark, mark, procs);
      this.mark = mark;
      const state = breakdown(procs, owners, shares, { ...machine, cpu }, now);
      this.last = state;
      this.deps.send(state, [...this.watchers]);
      return state;
    } finally {
      this.busy = false;
    }
  }

  /** Which of the processes nobody owns by the tree carry a worker's id in their environment (Linux, the office's own user). */
  private async envWorkers(procs: RawProc[], owners: Owners): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (process.platform !== 'linux' && !this.deps.readEnv) return out;
    const read = this.deps.readEnv ?? envWorker;
    const claimed = attribute(procs, owners);
    const live = new Set<string>();
    await Promise.all(
      procs.map(async (p) => {
        if (claimed.has(p.pid) || p.uid !== owners.uid || !p.args) return;
        const key = `${p.pid}:${p.start ?? ''}`;
        live.add(key);
        let id = this.envCache.get(key);
        if (id === undefined) {
          id = (await read(p.pid)) ?? null;
          this.envCache.set(key, id);
        }
        if (id) out.set(p.pid, id);
      }),
    );
    for (const key of this.envCache.keys()) if (!live.has(key)) this.envCache.delete(key);
    return out;
  }
}
