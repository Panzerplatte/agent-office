import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { MachineState, MemBalloon, MemDrop } from '../shared/protocol.js';

/** How often the CPU and memory are read. */
const SAMPLE_MS = 5_000;
/** How many readings the wall monitor graphs: the last five minutes. */
const HISTORY = 60;
/** Memory this full, or the CPU this busy over the last CPU_WINDOW readings (30 s), is a machine under pressure. */
const MEM_PRESSURE = 90;
const CPU_PRESSURE = 90;
const CPU_WINDOW = 6;
/** A virtio balloon holding less than this is noise, not the host taking memory back. */
export const BALLOON_SHOWN = 256 * 2 ** 20;
/** The total going down by this much (share of the most it had, and at least MEM_DROP_MIN) since the office started is worth telling. */
const MEM_DROP = 0.25;
const MEM_DROP_MIN = 2 ** 30;
/** The highest worker limit there is: past this it isn't a limit. */
export const MAX_WORKER_LIMIT = 500;

/** What hiring asks of the office's machine: whether it can take one more worker. */
export interface Capacity {
  /** Why the office can't take another worker (it's at its worker limit), if it can't. */
  full(): string | undefined;
  /** How many more workers it has room for: Infinity with no limit, below 0 once it's over. */
  room(): number;
}

interface Saved {
  limit: number;
  by: string;
  at: number;
}

/** A worker limit as given: a whole number from 1 to MAX_WORKER_LIMIT, or undefined when it isn't one. */
export function parseWorkerLimit(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_WORKER_LIMIT ? n : undefined;
}

/** Every core's busy and idle time so far; two of these a few seconds apart give how busy it was. */
export function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { idle, total };
}

/** Where the machine reads its memory from, so tests can hand it fake /proc files. */
export interface MemorySource {
  /** Linux's /proc/meminfo and /proc/vmstat; elsewhere neither exists and nothing changes. */
  meminfo?: string;
  vmstat?: string;
  /** The kernel's page size, bytes: what /proc/vmstat counts balloon pages in. */
  pageSize?: number;
  platform?: NodeJS.Platform;
}

/** A /proc file's "name value" or "name: value kB" lines, as numbers. */
function procFields(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split('\n')) {
    const m = /^(\w+):?\s+(\d+)/.exec(line);
    if (m) out.set(m[1]!, Number(m[2]));
  }
  return out;
}

/**
 * Bytes the virtio memory balloon holds now (pages blown in minus pages let out, times the page
 * size): memory the VM's host took back, which has already left MemTotal. Undefined when
 * /proc/vmstat doesn't say (no balloon driver, or not Linux).
 */
export function balloonBytes(vmstat: string, pageSize = 4096): number | undefined {
  const f = procFields(vmstat);
  const inflate = f.get('balloon_inflate');
  if (inflate === undefined) return undefined;
  return Math.max(0, inflate - (f.get('balloon_deflate') ?? 0)) * pageSize;
}

/** MemTotal and MemAvailable from /proc/meminfo, bytes; undefined when it doesn't have them. */
export function parseMeminfo(meminfo: string): { total: number; available: number } | undefined {
  const f = procFields(meminfo);
  const total = f.get('MemTotal');
  const available = f.get('MemAvailable') ?? f.get('MemFree');
  if (!total || available === undefined) return undefined;
  return { total: total * 1024, available: available * 1024 };
}

/** The balloon when it holds more than a little: what the host took back and what the machine started with. */
export function balloonOf(taken: number | undefined, memTotal: number): MemBalloon | undefined {
  if (taken === undefined || taken < BALLOON_SHOWN) return undefined;
  return { taken, original: memTotal + taken };
}

let pageSizeAsked: Promise<number> | undefined;
/** The kernel's page size (4 KiB nearly everywhere, 16 or 64 KiB on some ARM machines). */
function systemPageSize(): Promise<number> {
  pageSizeAsked ??= new Promise((resolve) => {
    execFile('getconf', ['PAGESIZE'], { timeout: 2000 }, (err, out) => {
      const n = Number(String(out).trim());
      resolve(!err && Number.isInteger(n) && n >= 4096 ? n : 4096);
    });
  });
  return pageSizeAsked;
}

/**
 * Memory the machine can still hand out, in bytes. On Linux os.freemem() is MemAvailable and on
 * Windows the available physical memory, but on macOS it counts only pages that were never used: a
 * few hundred MB on a Mac with half its memory to spare. There the kernel's own "memory free" level
 * (what `memory_pressure` prints) is the honest figure.
 */
function availableMemory(): Promise<number> {
  if (process.platform !== 'darwin') return Promise.resolve(os.freemem());
  return new Promise((resolve) => {
    execFile('sysctl', ['-n', 'kern.memorystatus_level'], { timeout: 2000 }, (err, out) => {
      const level = Number(String(out).trim());
      resolve(!err && Number.isFinite(level) && level >= 0 && level <= 100 ? (os.totalmem() * level) / 100 : os.freemem());
    });
  });
}

/**
 * The machine the office runs on: how busy its CPU and memory are (for the monitor on the wall, and
 * a warning before hiring while it's under pressure), and the most workers the office runs at once,
 * across every floor. That limit comes from --max-workers, or from ⚙️ Settings (kept in
 * .agent-office/machine.json), which can lower it but never raise it past --max-workers.
 */
export class Machine implements Capacity {
  private saved?: Saved;
  private path: string;
  private timer?: NodeJS.Timeout;
  private last = cpuTimes();
  private cpu = 0;
  private memUsed = 0;
  private memTotal = os.totalmem();
  /** The most memory the machine has had since the office started (0 before the first reading). */
  private memPeak = 0;
  private balloon?: MemBalloon;
  private history: [number, number][] = [];
  /** The worker count everyone was last told. */
  private told = -1;

  constructor(
    dataDir: string,
    /** --max-workers. */
    private ceiling: number | undefined,
    /** How many workers the office has now, on every floor. */
    private count: () => number,
    private onState: (state: MachineState) => void,
    private source: MemorySource = {},
  ) {
    this.path = path.join(dataDir, 'machine.json');
    this.restore();
    this.memUsed = os.totalmem() - os.freemem();
  }

  private get linux(): boolean {
    return (this.source.platform ?? process.platform) === 'linux';
  }

  /**
   * The memory really there now (total and available) and the balloon. On Linux it's read from
   * /proc, where a VM's host may have taken memory back through the virtio balloon: that has
   * already left MemTotal, so the total and what's used of it stay what the machine can use, and
   * the balloon is told on its own. Anything unreadable falls back to os.totalmem()/freemem().
   */
  private async readMemory(): Promise<{ total: number; available: number; balloon?: number }> {
    const linux = this.linux;
    const [meminfo, vmstat, pageSize] = await Promise.all([
      linux ? readFile(this.source.meminfo ?? '/proc/meminfo', 'utf8').catch(() => undefined) : undefined,
      linux ? readFile(this.source.vmstat ?? '/proc/vmstat', 'utf8').catch(() => undefined) : undefined,
      linux ? (this.source.pageSize ?? systemPageSize()) : 4096,
    ]);
    const mem = meminfo === undefined ? undefined : parseMeminfo(meminfo);
    const total = mem?.total ?? os.totalmem();
    const available = mem?.available ?? (await availableMemory());
    return { total, available, balloon: vmstat === undefined ? undefined : balloonBytes(vmstat, pageSize) };
  }

  start() {
    // The memory now; the CPU takes two readings a while apart.
    this.last = cpuTimes();
    void this.sample(false);
    this.timer = setInterval(() => void this.sample(), SAMPLE_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** The most workers the office takes, or undefined for no limit. */
  get limit(): number | undefined {
    const set = this.saved?.limit;
    if (set === undefined) return this.ceiling;
    return this.ceiling === undefined ? set : Math.min(set, this.ceiling);
  }

  room(): number {
    const limit = this.limit;
    return limit === undefined ? Infinity : limit - this.count();
  }

  full(): string | undefined {
    const limit = this.limit;
    if (limit === undefined || this.count() < limit) return undefined;
    return `The office is at its limit of ${limit} worker${limit === 1 ? '' : 's'} on this machine — send one home before hiring another`;
  }

  state(): MachineState {
    const memTotal = this.memTotal;
    return {
      cpu: this.cpu,
      cores: os.cpus().length,
      memUsed: this.memUsed,
      memTotal,
      balloon: this.balloon && { ...this.balloon },
      memDrop: this.memDrop(),
      history: this.history.slice(),
      pressure: this.pressure(memTotal),
      workers: this.count(),
      limit: this.limit,
      ceiling: this.ceiling,
      set: this.saved && { ...this.saved },
    };
  }

  /** Sets the limit from ⚙️ Settings (undefined takes it off). Returns why it can't, if it can't. */
  setLimit(limit: number | undefined, by: string): string | undefined {
    if (limit !== undefined && this.ceiling !== undefined && limit > this.ceiling) {
      return `The office was started with --max-workers ${this.ceiling}, so the limit can't go above ${this.ceiling}`;
    }
    this.saved = limit === undefined ? undefined : { limit, by, at: Date.now() };
    this.persist();
    this.emit();
    return undefined;
  }

  /** A worker came, went or changed: when that moved the count, everyone hears the new one. */
  workersChanged() {
    if (this.count() !== this.told) this.emit();
  }

  /**
   * The total has gone down a lot since the office started (a VM's host taking memory back),
   * with the most it had: worth telling before everything gets slow.
   */
  memDrop(): MemDrop | undefined {
    if (!this.memPeak) return undefined;
    const lost = this.memPeak - this.memTotal;
    return lost >= MEM_DROP_MIN && lost >= this.memPeak * MEM_DROP ? { from: this.memPeak } : undefined;
  }

  /**
   * Which of memory and CPU are under pressure now, with how full or busy they are. Memory is what's
   * used of the memory really there (MemTotal, after any balloon), never of what the machine started with.
   */
  strain(memTotal = this.memTotal): { mem?: number; cpu?: number } {
    const out: { mem?: number; cpu?: number } = {};
    const mem = memTotal ? Math.round((this.memUsed / memTotal) * 100) : 0;
    if (mem >= MEM_PRESSURE) out.mem = mem;
    // Busy for a while, not a single build step.
    const recent = this.history.slice(-CPU_WINDOW);
    if (recent.length === CPU_WINDOW) {
      const cpu = Math.round(recent.reduce((n, [c]) => n + c, 0) / recent.length);
      if (cpu >= CPU_PRESSURE) out.cpu = cpu;
    }
    return out;
  }

  private pressure(memTotal: number): string | undefined {
    const { mem, cpu } = this.strain(memTotal);
    const why: string[] = [];
    if (mem !== undefined) why.push(`memory is ${mem}% used`);
    if (cpu !== undefined) why.push(`the CPU has been ${cpu}% busy for the last ${(CPU_WINDOW * SAMPLE_MS) / 1000} seconds`);
    return why.length ? why.join(' and ') : undefined;
  }

  /** Takes one reading now (the timer takes them every SAMPLE_MS); `cpu` false reads only the memory. */
  async sample(cpu = true) {
    if (cpu) {
      const now = cpuTimes();
      const total = now.total - this.last.total;
      if (total > 0) this.cpu = Math.max(0, Math.min(100, Math.round((1 - (now.idle - this.last.idle) / total) * 100)));
      this.last = now;
    }
    const mem = await this.readMemory();
    const memTotal = mem.total;
    this.memTotal = memTotal;
    this.memPeak = Math.max(this.memPeak, memTotal);
    this.memUsed = Math.max(0, Math.min(memTotal, memTotal - mem.available));
    this.balloon = balloonOf(mem.balloon, memTotal);
    if (cpu) {
      this.history.push([this.cpu, memTotal ? Math.round((this.memUsed / memTotal) * 100) : 0]);
      if (this.history.length > HISTORY) this.history.shift();
    }
    this.emit();
  }

  private emit() {
    const state = this.state();
    this.told = state.workers;
    this.onState(state);
  }

  private restore() {
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Saved>;
      const limit = parseWorkerLimit(s.limit);
      if (limit !== undefined) this.saved = { limit, by: typeof s.by === 'string' ? s.by : 'someone', at: typeof s.at === 'number' ? s.at : 0 };
    } catch {
      // never set
    }
  }

  private persist() {
    try {
      writeFileSync(this.path, JSON.stringify(this.saved ?? {}, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
