import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { Machine, balloonBytes, parseMeminfo, parseWorkerLimit, type MemorySource } from '../src/server/machine.js';
import type { MachineState } from '../src/shared/protocol.js';

function fixture(ceiling?: number) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-machine-'));
  let workers = 0;
  const told: MachineState[] = [];
  const open = () => new Machine(dir, ceiling, () => workers, (s) => told.push(s));
  return { open, told, hire: (n = 1) => (workers += n), close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('worker limits are whole numbers from 1 up', () => {
  assert.equal(parseWorkerLimit('6'), 6);
  assert.equal(parseWorkerLimit(' 12 '), 12);
  for (const bad of ['0', '-1', '2.5', 'six', '', 0, 1.5, null, undefined, 10_000]) assert.equal(parseWorkerLimit(bad), undefined, String(bad));
});

test('no limit until one is set; then hiring past it is refused, across restarts', (t) => {
  const f = fixture(); t.after(() => f.close());
  const m = f.open();
  f.hire(5);
  assert.equal(m.limit, undefined);
  assert.equal(m.full(), undefined);
  assert.equal(m.room(), Infinity);
  assert.equal(m.setLimit(5, 'Ada'), undefined);
  assert.match(m.full() ?? '', /limit of 5 workers/);
  assert.equal(m.room(), 0);
  assert.deepEqual(f.told.at(-1)?.set?.limit, 5);
  // Kept on disk.
  const again = f.open();
  assert.equal(again.limit, 5);
  assert.equal(again.state().set?.by, 'Ada');
  assert.equal(again.setLimit(undefined, 'Ada'), undefined);
  assert.equal(again.full(), undefined);
});

test('--max-workers is a ceiling the office can go under but not over', (t) => {
  const f = fixture(4); t.after(() => f.close());
  const m = f.open();
  assert.equal(m.limit, 4);
  f.hire(3);
  assert.equal(m.room(), 1);
  assert.match(m.setLimit(6, 'Ada') ?? '', /--max-workers 4/);
  assert.equal(m.limit, 4);
  assert.equal(m.setLimit(2, 'Ada'), undefined);
  assert.equal(m.limit, 2);
  assert.equal(m.room(), -1);
  assert.ok(m.full());
  // Taking the office's own limit off goes back to the ceiling.
  m.setLimit(undefined, 'Ada');
  assert.equal(m.limit, 4);
  assert.equal(m.state().ceiling, 4);
});

test('everyone hears when the worker count moves, and only then', (t) => {
  const f = fixture(); t.after(() => f.close());
  const m = f.open();
  m.workersChanged();
  const n = f.told.length;
  m.workersChanged();
  assert.equal(f.told.length, n);
  f.hire();
  m.workersChanged();
  assert.equal(f.told.length, n + 1);
  assert.equal(f.told.at(-1)?.workers, 1);
});

// ---------------------------------------------------------------------------------------------
// A VM's host taking memory back through the virtio balloon (/proc/vmstat on Linux).

const GB = 2 ** 30;
const PAGE = 4096;
/** What /proc/meminfo can say: whole kB. */
const kb = (gb: number) => Math.round((gb * GB) / 1024) * 1024;
const meminfo = (totalGb: number, availGb: number) => `MemTotal:       ${Math.round(totalGb * GB / 1024)} kB\nMemFree:        1000 kB\nMemAvailable:   ${Math.round(availGb * GB / 1024)} kB\nBuffers:        10 kB\n`;
const vmstat = (inflateGb: number, deflateGb = 0) => `nr_free_pages 1234\nballoon_inflate ${Math.round(inflateGb * GB / PAGE)}\nballoon_deflate ${Math.round(deflateGb * GB / PAGE)}\noom_kill 14\n`;

function procFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-proc-'));
  const files = { meminfo: path.join(dir, 'meminfo'), vmstat: path.join(dir, 'vmstat') };
  const told: MachineState[] = [];
  const open = (src: Partial<MemorySource> = {}) => new Machine(dir, undefined, () => 0, (s) => told.push(s), { ...files, pageSize: PAGE, platform: 'linux', ...src });
  return { files, open, told, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the balloon is read from /proc/vmstat: blown in minus let out, in pages', () => {
  assert.equal(balloonBytes(vmstat(2, 0.5), PAGE), 1.5 * GB);
  assert.equal(balloonBytes('balloon_inflate 7807232\nballoon_deflate 0\n', 4096), 7807232 * 4096);
  assert.equal(balloonBytes('balloon_inflate 10\nballoon_deflate 4\n', 65536), 6 * 65536);
  // No balloon driver: the counters aren't there.
  assert.equal(balloonBytes('nr_free_pages 1\noom_kill 0\n'), undefined);
  assert.equal(balloonBytes(''), undefined);
  assert.deepEqual(parseMeminfo(meminfo(1.5, 0.25)), { total: 1.5 * GB, available: 0.25 * GB });
  assert.equal(parseMeminfo('nothing here'), undefined);
});

test('no balloon: nothing about it, and the figures are /proc/meminfo', async (t) => {
  const f = procFixture(); t.after(() => f.close());
  writeFileSync(f.files.meminfo, meminfo(32, 24));
  writeFileSync(f.files.vmstat, vmstat(0));
  const m = f.open();
  await m.sample(false);
  const s = m.state();
  assert.equal(s.memTotal, 32 * GB);
  assert.equal(s.memUsed, 8 * GB);
  assert.equal(s.balloon, undefined);
  assert.equal(s.memDrop, undefined);
  assert.deepEqual(m.strain(), {});
});

test('a small balloon (under 256 MB) is left out', async (t) => {
  const f = procFixture(); t.after(() => f.close());
  writeFileSync(f.files.meminfo, meminfo(31.9, 20));
  writeFileSync(f.files.vmstat, vmstat(0.1));
  const m = f.open();
  await m.sample(false);
  assert.equal(m.state().balloon, undefined);
  assert.equal(m.state().memTotal, kb(31.9));
});

test('a big balloon: what the machine started with, what the host took, and strain on what is really there', async (t) => {
  const f = procFixture(); t.after(() => f.close());
  writeFileSync(f.files.meminfo, meminfo(1.6, 0.08));
  writeFileSync(f.files.vmstat, vmstat(29.8));
  const m = f.open();
  await m.sample(false);
  const s = m.state();
  assert.equal(s.memTotal, kb(1.6));
  assert.ok(Math.abs(s.memUsed - 1.52 * GB) < 1024 * 1024);
  assert.ok(s.balloon);
  assert.ok(Math.abs(s.balloon.taken - 29.8 * GB) < PAGE);
  assert.ok(Math.abs(s.balloon.original - 31.4 * GB) < 2 * PAGE);
  // 95% of the 1.6 GB really there: under pressure. Of 31.4 GB it would look like 5%.
  assert.equal(m.strain().mem, 95);
  assert.match(s.pressure ?? '', /memory is 95% used/);
  assert.equal(f.told.at(-1)?.balloon?.taken, s.balloon.taken);
});

test('the total going down a lot since the office started is told, and stops once it is back', async (t) => {
  const f = procFixture(); t.after(() => f.close());
  writeFileSync(f.files.meminfo, meminfo(32, 28));
  writeFileSync(f.files.vmstat, vmstat(0));
  const m = f.open();
  await m.sample(false);
  assert.equal(m.memDrop(), undefined);
  // A little less is nothing.
  writeFileSync(f.files.meminfo, meminfo(30, 26));
  writeFileSync(f.files.vmstat, vmstat(2));
  await m.sample(false);
  assert.equal(m.state().memDrop, undefined);
  writeFileSync(f.files.meminfo, meminfo(8, 2));
  writeFileSync(f.files.vmstat, vmstat(24));
  await m.sample(false);
  assert.deepEqual(m.state().memDrop, { from: 32 * GB });
  writeFileSync(f.files.meminfo, meminfo(32, 28));
  writeFileSync(f.files.vmstat, vmstat(24, 24));
  await m.sample(false);
  assert.equal(m.state().memDrop, undefined);
  assert.equal(m.state().balloon, undefined);
});

test('no /proc/vmstat or meminfo (not Linux, or not readable): the os figures, no balloon', async (t) => {
  const f = procFixture(); t.after(() => f.close());
  // Neither file was written.
  const m = f.open();
  await m.sample(false);
  assert.equal(m.state().memTotal, os.totalmem());
  assert.equal(m.state().balloon, undefined);
  // Elsewhere the files aren't even looked at.
  writeFileSync(f.files.meminfo, meminfo(1.6, 0.08));
  writeFileSync(f.files.vmstat, vmstat(29.8));
  const mac = f.open({ platform: 'darwin' });
  await mac.sample(false);
  assert.equal(mac.state().balloon, undefined);
  assert.equal(mac.state().memTotal, os.totalmem());
});
