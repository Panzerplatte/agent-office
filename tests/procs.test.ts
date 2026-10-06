import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProcWatch, attribute, breakdown, cpuMark, cpuShares, parseEtime, parsePs, parseStat, safeCommand, type MachineFigures, type Owners, type RawProc } from '../src/server/procs.js';
import type { MachineProcs } from '../src/shared/protocol.js';

const MB = 2 ** 20;
const GB = 2 ** 30;
const NOW = 1_800_000_000_000;
const ME = 1000;

function proc(pid: number, ppid: number, args: string, rss: number, more: Partial<RawProc> = {}): RawProc {
  const name = args.split(' ')[0].split('/').pop() || 'kthread';
  return { pid, ppid, uid: ME, user: 'me', name, args, rss, start: NOW - 60_000, ...more };
}

/**
 * The machine: the office server with the TV's Chromium and a git under it, a terminal host with
 * Pixel's terminal (bash → vite → esbuild) and a session nobody claimed, Byte's terminal in the
 * office's own process (npm test), a dev server Pixel sent to the background, and other programs.
 */
function table(): RawProc[] {
  return [
    proc(1, 0, '/sbin/init', 12 * MB, { uid: 0, user: 'root', name: 'systemd' }),
    proc(2, 0, '', 0, { uid: 0, user: 'root', name: 'kthreadd' }),
    proc(30, 2, '', 0, { uid: 0, user: 'root', name: 'kworker/3:1' }),
    proc(31, 2, '', 0, { uid: 0, user: 'root', name: 'kworker/0:2' }),
    proc(100, 1, 'node /opt/agent-office/dist/server/cli.js --password hunter2 /home/me/proj', 300 * MB),
    proc(110, 100, '/home/me/.local/share/agent-office/chromium/chrome --headless --remote-debugging-pipe', 200 * MB),
    proc(111, 110, '/home/me/.local/share/agent-office/chromium/chrome --type=renderer', 150 * MB),
    proc(120, 100, 'git status --porcelain', 10 * MB),
    proc(130, 100, '/bin/bash -l', 5 * MB),
    proc(131, 130, 'npm test', 80 * MB),
    proc(200, 1, 'agent-office-ptys', 60 * MB, { name: 'agent-office-pt' }),
    proc(201, 200, 'claude --dangerously-skip-permissions', 400 * MB),
    proc(202, 201, '/bin/bash -c npm run dev', 4 * MB),
    proc(203, 202, 'node /home/me/proj/node_modules/.bin/vite --port 5173', 250 * MB, { start: NOW - 3 * 3600_000 }),
    proc(204, 203, '/home/me/proj/node_modules/@esbuild/linux-x64/bin/esbuild --service=0.21.5 --ping', 30 * MB),
    proc(210, 200, 'claude --resume abc', 100 * MB),
    proc(300, 1, 'python3 -m http.server 8000', 20 * MB, { start: NOW - 2 * 3600_000 }),
    proc(400, 1, '/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main --password=s3cret', 120 * MB, { uid: 113, user: 'postgres', name: 'postgres' }),
    proc(401, 400, 'postgres: checkpointer', 40 * MB, { uid: 113, user: 'postgres', name: 'postgres' }),
    proc(500, 1, '/usr/bin/sshd -D', 8 * MB, { uid: 0, user: 'root', name: 'sshd' }),
  ];
}

function owners(more: Partial<Owners> = {}): Owners {
  return {
    workers: [
      { id: 'w-pixel', pid: 201, name: 'Pixel', color: '#ff8a5b', floor: 'proj', status: 'working', task: 'Machine breakdown', issue: 98, branch: 'office/pixel-2ba3' },
      { id: 'w-byte', pid: 130, name: 'Byte', color: '#5bc0eb', floor: 'proj', status: 'idle' },
      { id: 'w-dot', name: 'Dot', color: '#9bc53d', floor: 'proj', status: 'exited' },
    ],
    serverPid: 100,
    hostPids: [200],
    envWorkers: new Map([[300, 'w-pixel']]),
    uid: ME,
    ...more,
  };
}

const machine = (more: Partial<MachineFigures> = {}): MachineFigures => ({ cpu: 50, cores: 8, memUsed: 3 * GB, memTotal: 16 * GB, strain: { mem: false, cpu: false }, ...more });

test("each worker gets the subtree under its terminal, the office the rest of its own, other programs nothing", () => {
  const who = attribute(table(), owners());
  const of = (pid: number) => {
    const o = who.get(pid);
    return o ? (o.kind === 'worker' ? o.id : `office:${o.part}`) : 'other';
  };
  assert.deepEqual([201, 202, 203, 204].map(of), ['w-pixel', 'w-pixel', 'w-pixel', 'w-pixel']);
  // Started from its environment, after it got away from the terminal.
  assert.equal(of(300), 'w-pixel');
  // A terminal inside the office's own process is still the worker's, not the office's.
  assert.deepEqual([130, 131].map(of), ['w-byte', 'w-byte']);
  assert.equal(of(100), 'office:server');
  assert.deepEqual([110, 111].map(of), ['office:tv', 'office:tv']);
  assert.equal(of(120), 'office:helpers');
  // The terminal host and the session nobody claimed are the host's.
  assert.deepEqual([200, 210].map(of), ['office:ptys', 'office:ptys']);
  assert.deepEqual([1, 2, 30, 400, 401, 500].map(of), ['other', 'other', 'other', 'other', 'other', 'other']);
});

test('a terminal host the office has no pid for is found above a worker’s terminal', () => {
  const who = attribute(table(), owners({ hostPids: [] }));
  assert.deepEqual([200, 210].map((pid) => who.get(pid)), [{ kind: 'office', part: 'ptys' }, { kind: 'office', part: 'ptys' }]);
  // Without a worker under it, another office's host is just another program.
  const lone = attribute(table(), owners({ hostPids: [], workers: [] }));
  assert.equal(lone.get(200), undefined);
});

test('an environment naming a worker the office no longer has claims nothing', () => {
  const who = attribute(table(), owners({ envWorkers: new Map([[300, 'w-gone'], [203, 'w-byte']]) }));
  assert.equal(who.get(300), undefined);
  // The tree wins over the environment.
  assert.deepEqual(who.get(203), { kind: 'worker', id: 'w-pixel' });
});

test('the breakdown groups by worker, the office and program, and adds up to the machine', () => {
  const procs = table();
  const cpu = new Map(procs.map((p) => [p.pid, 0]));
  cpu.set(203, 12.5).set(131, 20).set(100, 3).set(400, 1).set(30, 0.5).set(31, 0.5);
  const s = breakdown(procs, owners(), cpu, machine(), NOW);
  const g = (id: string) => s.groups.find((x) => x.id === id)!;

  assert.deepEqual(s.groups.filter((x) => x.kind === 'worker').map((x) => x.id), ['w-pixel', 'w-byte', 'w-dot']);
  const pixel = g('w-pixel');
  assert.equal(pixel.count, 5);
  assert.equal(pixel.rss, (400 + 4 + 250 + 30 + 20) * MB);
  assert.equal(pixel.cpu, 12.5);
  assert.deepEqual(pixel.worker, { name: 'Pixel', color: '#ff8a5b', floor: 'proj', status: 'working', task: 'Machine breakdown', issue: 98, branch: 'office/pixel-2ba3' });
  // Its biggest processes, and why: vite has been up three hours, http.server two.
  assert.equal(pixel.top[0].cmd, 'claude --dangerously-skip-permissions');
  assert.ok(pixel.top.some((r) => r.cmd === 'vite --port 5173' && r.cpu === 12.5 && r.age === 3 * 3600));
  assert.deepEqual(pixel.hints.map((h) => h.cmd).sort(), ['python3 -m http.server 8000', 'vite --port 5173']);
  // Asleep: there, with nothing.
  assert.deepEqual([g('w-dot').count, g('w-dot').rss, g('w-dot').cpu], [0, 0, 0]);

  assert.deepEqual(s.groups.filter((x) => x.kind === 'office').map((x) => x.id), ['server', 'ptys', 'tv', 'helpers']);
  assert.equal(g('tv').rss, 350 * MB);
  assert.equal(g('ptys').count, 2);
  // The office's own command line has a password on it.
  assert.equal(g('server').top[0].cmd, 'cli.js --password *** proj');

  // Other programs by name and user; kernel threads as one; other users' command lines not shown.
  const pg = g('other:postgres:postgres');
  assert.equal(pg.count, 2);
  assert.equal(pg.rss, 160 * MB);
  assert.ok(pg.top.every((r) => r.cmd === 'postgres'));
  assert.equal(g('other:root:kworker').count, 2);
  assert.equal(g('other:root:kworker').cpu, 1);

  // Everything plus the rest is the machine's figures.
  const rss = s.groups.reduce((n, x) => n + x.rss, 0);
  assert.equal(rss + s.rest.rss, 3 * GB);
  const used = s.groups.reduce((n, x) => n + (x.cpu ?? 0), 0);
  assert.equal(Math.round((used + s.rest.cpu!) * 10) / 10, 50);
  assert.equal(s.procs, procs.length);
  assert.equal(s.groups.some((x) => x.heavy), false);
});

test('under pressure, the groups with a big share of what is under pressure are marked', () => {
  const procs = table();
  procs.push(proc(600, 1, 'java -Xmx8g -jar big.jar', 6 * GB, { uid: 0, user: 'root', name: 'java' }));
  const cpu = new Map(procs.map((p) => [p.pid, 0]));
  cpu.set(131, 40).set(203, 30).set(100, 5);
  const s = breakdown(procs, owners(), cpu, machine({ memUsed: 15 * GB, cpu: 95, strain: { mem: true, cpu: true } }), NOW);
  const heavy = Object.fromEntries(s.groups.filter((g) => g.heavy).map((g) => [g.id, g.heavy]));
  assert.deepEqual(heavy, { 'w-pixel': ['cpu'], 'w-byte': ['cpu'], 'other:root:java': ['mem'] });

  // Nobody past the mark: the biggest one is.
  const small = breakdown(table(), owners(), new Map([[131, 4]]), machine({ memUsed: 15 * GB, strain: { mem: true, cpu: true } }), NOW);
  assert.deepEqual(Object.fromEntries(small.groups.filter((g) => g.heavy).map((g) => [g.id, g.heavy])), { 'w-pixel': ['mem'], 'w-byte': ['cpu'] });
});

test('without two readings there is no CPU yet; with many programs the small ones are one row', () => {
  const procs = table();
  for (let i = 0; i < 30; i++) procs.push(proc(1000 + i, 1, `tool${i} --serve`, (i + 1) * MB, { name: `tool${i}` }));
  const s = breakdown(procs, owners(), undefined, machine({ cpu: null }), NOW);
  assert.ok(s.groups.every((g) => g.cpu === null));
  assert.equal(s.rest.cpu, null);
  const others = s.groups.filter((g) => g.kind === 'other');
  assert.equal(others.length, 13);
  const rest = others.at(-1)!;
  assert.equal(rest.id, 'other:rest');
  assert.equal(others.reduce((n, g) => n + g.count, 0), procs.filter((p) => !attribute(procs, owners()).has(p.pid)).length);
  assert.equal(s.groups.reduce((n, g) => n + g.rss, 0) + s.rest.rss, s.memUsed);
});

test('CPU is each process’s time between two readings over all cores’ time', () => {
  const before = [proc(1, 0, 'a', 0, { cpuMs: 1000, start: 10 }), proc(2, 0, 'b', 0, { cpuMs: 500, start: 10 }), proc(3, 0, 'c', 0, { cpuMs: 9000, start: 10 })];
  const prev = cpuMark(1000, 80_000, before);
  assert.equal(cpuShares(undefined, prev, before), undefined);
  // 3 s on 8 cores: 24,000 ms of CPU in all.
  const after = [
    proc(1, 0, 'a', 0, { cpuMs: 4000, start: 10 }), // 3000 ms: one core flat out, 12.5% of the machine
    proc(2, 0, 'b', 0, { cpuMs: 500, start: 10 }), // idle
    proc(3, 0, 'c2', 0, { cpuMs: 1200, start: 2000 }), // pid reused since: all of its 1200 ms
    proc(4, 0, 'd', 0, { cpuMs: 600, start: 3500 }), // new
    proc(5, 0, 'e', 0, { cpuMs: 99_000, start: 5 }), // was there but wasn't read: nothing to go on
  ];
  const shares = cpuShares(prev, cpuMark(4000, 104_000, after), after)!;
  assert.equal(shares.get(1), 12.5);
  assert.equal(shares.get(2), 0);
  assert.equal(shares.get(3), 5);
  assert.equal(shares.get(4), 2.5);
  assert.equal(shares.get(5), 0);
  // A counter going backwards never makes a negative share, nor one past the whole machine.
  const odd = [proc(1, 0, 'a', 0, { cpuMs: 10, start: 10 }), proc(2, 0, 'b', 0, { cpuMs: 1e9, start: 10 })];
  const s2 = cpuShares(prev, cpuMark(4000, 104_000, odd), odd)!;
  assert.deepEqual([s2.get(1), s2.get(2)], [0, 100]);
  // `ps` gives the share outright, from the first reading.
  const ps = [proc(9, 0, 'x', 0, { cpu: 7.5 })];
  assert.equal(cpuShares(undefined, cpuMark(0, 0, ps), ps)?.get(9), 7.5);
});

test('command lines lose their secrets', () => {
  const cases: [string, string][] = [
    ['node /opt/app/server.js --token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'server.js --token ***'],
    ['curl -H Authorization: Bearer abc.def.ghi https://api.example.com', 'curl -H Authorization: *** *** https://api.example.com'],
    ['psql postgres://admin:hunter2@db.local:5432/app', 'psql postgres://***@db.local:5432/app'],
    ['git clone https://x-access-token:ghs_123456789@github.com/o/r.git', 'git clone https://***@github.com/o/r.git'],
    ['wget https://example.com/file?id=7&access_token=abc123&x=1', 'wget https://example.com/file?id=7&access_token=***&x=1'],
    ['env GITHUB_TOKEN=ghp_x OPENAI_API_KEY=sk-123 npm run dev', 'env GITHUB_TOKEN=*** OPENAI_API_KEY=*** npm run dev'],
    ['app --api-key=AKIAABCDEFGHIJKLMNOP --port=8080 --config=/etc/app/conf.yml', 'app --api-key=*** --port=8080 --config=conf.yml'],
    ['mysql --password secretpw -u root', 'mysql --password *** -u root'],
    ['tool sk-ant-api03-abcdefghijklmnop', 'tool ***'],
    ['tool dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgdmFsdWUgMTIz', 'tool ***'],
    ['/home/me/proj/node_modules/.bin/vite --port 5173', 'vite --port 5173'],
    ['python3 -m http.server', 'python3 -m http.server'],
    ['/usr/bin/node --require /x/preflight.cjs --import file:///opt/tsx/loader.mjs /opt/app/src/server/cli.ts --port 4600', 'cli.ts --port 4600'],
    ['bash /home/me/.claude/shell-snapshots/snapshot-bash-1759000000000-abcdef.sh', 'bash snapshot-bash-1759000000000-abcdef.sh'],
  ];
  for (const [args, want] of cases) assert.equal(safeCommand(args), want, args);
  assert.equal(safeCommand('', 'kworker/0:1'), '[kworker/0:1]');
  const long = safeCommand(`claude ${'word '.repeat(60)}`);
  assert.ok(long.length <= 90 && long.endsWith('…'));
  // Nothing that was a secret anywhere in the breakdown.
  const s = JSON.stringify(breakdown(table(), owners(), undefined, machine(), NOW));
  for (const secret of ['hunter2', 's3cret', '/home/me']) assert.ok(!s.includes(secret), secret);
});

test('the process table reads from /proc/<pid>/stat and from ps', () => {
  const stat = parseStat('4242 (Web Content (x)) S 4200 4242 4200 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 30 0 123456 987654321 2560 18446744073709551615');
  assert.deepEqual(stat, { name: 'Web Content (x)', ppid: 4200, ticks: 300, startTicks: 123456, rssPages: 2560 });
  assert.equal(parseStat('garbage'), undefined);

  assert.equal(parseEtime('05:03'), 303);
  assert.equal(parseEtime('02:00:01'), 7201);
  assert.equal(parseEtime('3-01:00:00'), 3 * 86400 + 3600);
  assert.equal(parseEtime('nope'), undefined);

  const ps = parsePs(['  1     0     0 root      12000   0.0  3-01:00:00 /sbin/launchd', '512   1   501 me   204800  80,0  01:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=gpu', 'junk'].join('\n'), 8, NOW);
  assert.equal(ps.length, 2);
  assert.deepEqual(ps[1], { pid: 512, ppid: 1, uid: 501, user: 'me', name: 'Google', args: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=gpu', rss: 204800 * 1024, cpu: 10, start: NOW - 60_000 });
});

test('the table is only read while someone watches, and each watcher gets every reading', async () => {
  let reads = 0;
  let clock = { idle: 0, total: 0 };
  let cpuMs = 0;
  const sent: [MachineProcs, string[]][] = [];
  const envAsked: number[] = [];
  const watch = new ProcWatch({
    owners: () => ({ workers: owners().workers, serverPid: 100, hostPids: [200], uid: ME }),
    machine: () => ({ cores: 8, memUsed: 3 * GB, memTotal: 16 * GB, strain: { mem: false, cpu: false } }),
    cpuTimes: () => clock,
    cores: () => 8,
    send: (state, to) => sent.push([state, to]),
    read: async () => {
      reads++;
      return table().map((p) => (p.pid === 203 ? { ...p, cpuMs } : { ...p, cpuMs: 0 }));
    },
    readEnv: async (pid) => {
      envAsked.push(pid);
      return pid === 300 ? 'w-pixel' : undefined;
    },
    now: () => NOW,
  });
  assert.equal(await watch.sample(), undefined);
  assert.equal(reads, 0);

  watch.watch('ada');
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][1], ['ada']);
  assert.equal(sent[0][0].cpu, null);
  assert.equal(sent[0][0].groups.find((g) => g.id === 'w-pixel')?.count, 5);
  // Only processes nobody owns by the tree, of the office's own user, with a command line, had their environment read.
  assert.ok(envAsked.includes(300) && !envAsked.includes(203) && !envAsked.includes(400) && !envAsked.includes(2));
  const asked = envAsked.length;

  // A second reading 3 s later on 8 cores; vite used a core and a half; the machine was a quarter busy.
  clock = { idle: 18_000, total: 24_000 };
  cpuMs = 4500;
  watch.watch('bob');
  const s = (await watch.sample())!;
  assert.deepEqual(sent.at(-1)![1], ['ada', 'bob']);
  assert.equal(s.cpu, 25);
  assert.equal(s.groups.find((g) => g.id === 'w-pixel')?.cpu, 18.8);
  assert.equal(s.rest.cpu, 6.3);
  // Environments are read once per process.
  assert.equal(envAsked.length, asked);

  watch.unwatch('ada');
  watch.unwatch('bob');
  assert.equal(watch.watching, 0);
  assert.equal(await watch.sample(), undefined);
  assert.equal(reads, 2);
  watch.stop();
});
