import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { checkGalleryUrl, DemoGallery, GO_LIVE_GAP_MS, GO_LIVE_PROMPT, GoLive } from '../src/server/golive.js';
import type { ServiceInfo, WorkerInfo } from '../src/shared/protocol.js';
import { ROOF } from '../src/shared/rooftop.js';

test('the Demo-Galerie is an https address, or none', () => {
  assert.deepEqual(checkGalleryUrl('  https://websites-demo.onrender.com  '), { url: 'https://websites-demo.onrender.com/' });
  assert.deepEqual(checkGalleryUrl('https://demo.example.com/galerie/'), { url: 'https://demo.example.com/galerie/' });
  assert.deepEqual(checkGalleryUrl(''), { url: null });
  assert.deepEqual(checkGalleryUrl('   '), { url: null });
  for (const bad of ['http://demo.onrender.com/', 'javascript:alert(1)', 'https://user:pw@demo.onrender.com/', 'ftp://x.y/', 'file:///etc/passwd']) {
    const r = checkGalleryUrl(bad);
    assert.ok('error' in r && r.error.key === 'gallery.notHttps', bad);
  }
  for (const bad of ['demo.onrender.com', 'not a url', 42, null, undefined, `https://x.com/${'a'.repeat(3000)}`]) {
    const r = checkGalleryUrl(bad);
    assert.ok('error' in r && r.error.key === 'gallery.notLink', String(bad).slice(0, 40));
  }
});

test("a floor's Demo-Galerie is kept in its .agent-office folder, and a broken file is none", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'demogallery-'));
  const g = new DemoGallery(dir);
  assert.equal(g.url, null);
  assert.ok('error' in g.set('http://nope.example/', 'Ann'));
  assert.deepEqual(g.set('https://demo.onrender.com', 'Ann'), { url: 'https://demo.onrender.com/', changed: true });
  assert.deepEqual(g.set('https://demo.onrender.com/', 'Bob'), { url: 'https://demo.onrender.com/', changed: false });
  assert.equal(new DemoGallery(dir).url, 'https://demo.onrender.com/', 'after a restart');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'demogallery.json'), 'utf8')).by, 'Ann');
  assert.deepEqual(g.set('', 'Bob'), { url: null, changed: true });
  assert.equal(new DemoGallery(dir).url, null);
  writeFileSync(path.join(dir, 'demogallery.json'), '{"url":"javascript:alert(1)"}');
  assert.equal(new DemoGallery(dir).url, null);
  writeFileSync(path.join(dir, 'demogallery.json'), 'not json');
  assert.equal(new DemoGallery(dir).url, null);
});

const svc = (port: number, workerId: string, title?: string): ServiceInfo => ({ port, host: '127.0.0.1', pid: 1, command: 'vite', workerId, ...(title ? { title } : {}), since: 0 });
const worker = (id: string, name: string, more: Partial<WorkerInfo> = {}): WorkerInfo =>
  ({ id, name, kind: 'agent', provider: 'claude', status: 'done', deskId: 'desk-1', color: '#fff', acked: true, createdBy: 'x', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], ...more }) as WorkerInfo;

test("🚀 Live gehen prompts the worker whose service the port is, and only a running Claude worker that isn't busy", () => {
  const services = new Map([
    [5173, svc(5173, 'w1', 'SHK Spreewerk')],
    [5174, svc(5174, 'w2')],
    [5175, svc(5175, 'w3')],
    [5176, svc(5176, 'w4')],
    [5177, svc(5177, 'w5')],
  ]);
  const workers = new Map([
    ['w1', worker('w1', 'Ada')],
    ['w2', worker('w2', 'Bo', { status: 'working' })],
    ['w3', worker('w3', 'Cy', { status: 'exited' })],
    ['w4', worker('w4', 'Di', { provider: 'codex' })],
    ['w5', worker('w5', 'Ed', { kind: 'shell', provider: undefined })],
  ]);
  const prompts: [string, string, string][] = [];
  const live = new GoLive({
    service: (port) => services.get(port),
    worker: (id) => workers.get(id),
    prompt: (id, text, by) => void prompts.push([id, text, by]),
  });

  const r = live.go(5173, 'Ann', 1000);
  assert.ok(!('error' in r));
  assert.equal(r.worker.name, 'Ada');
  assert.equal(r.service, 'SHK Spreewerk');
  assert.deepEqual(prompts, [['w1', GO_LIVE_PROMPT, 'Ann']]);
  assert.equal(GO_LIVE_PROMPT, 'Live gehen: veröffentliche die Webseite in der Demo-Galerie.');

  const key = (port: unknown, now = 1000) => {
    const e = live.go(port, 'Ann', now);
    return 'error' in e ? e.error.key : 'ok';
  };
  // Once per service for a while: the same press again is refused, saying when it can go again.
  const again = live.go(5173, 'Bob', 1000 + 30_000);
  assert.ok('error' in again && again.error.key === 'golive.again' && again.error.params?.s === 90);
  assert.equal(key(5173, 1000 + GO_LIVE_GAP_MS), 'ok');
  assert.equal(key(5174), 'golive.busy');
  assert.equal(key(5175), 'golive.asleep');
  assert.equal(key(5176), 'golive.notClaude');
  assert.equal(key(5177), 'golive.notClaude');
  for (const bad of [9999, 0, 70000, 1.5, '5173', null]) assert.equal(key(bad), 'tv.notService', String(bad));
  assert.equal(prompts.length, 2, 'only the two good presses prompted anyone');

  // The worker stopped between the board and the press: refused, and the next press still may.
  const stopped = new GoLive({ service: (port) => services.get(port), worker: (id) => workers.get(id), prompt: () => 'Worker is not running' });
  assert.equal((stopped.go(5173, 'Ann') as { error: { key: string } }).error.key, 'golive.asleep');
});

// ---- In the running office ------------------------------------------------------------------------

const bundled = ['public', 'dist/public'].some((d) => existsSync(path.join(import.meta.dirname, '..', d, 'index.html')));

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  await new Promise((r) => srv.close(r));
  return port;
}

test("the floor's Demo-Galerie is set by anyone on it, everyone on it hears it, and it's in the floor view; Live gehen takes only a board's port", { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'golive-office-'));
  process.env.AGENT_OFFICE_HOME = path.join(root, 'home');
  const project = path.join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: project });
  const { loadConfig } = await import('../src/server/config.js');
  const { startServer } = await import('../src/server/server.js');
  const port = await freePort();
  const office = await startServer(loadConfig([project, '--port', String(port), '--password', 'dev', '--no-open']));
  const origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password: 'dev' }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const sockets: WebSocket[] = [];
  const join = (name: string, floor?: string) => {
    const chips = Buffer.from(name.padEnd(16, '_')).toString('hex');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&chips=${chips}${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`, { headers: { cookie, origin } });
    sockets.push(ws);
    const msgs: any[] = [];
    const waiting: (() => void)[] = [];
    ws.on('message', (d) => {
      msgs.push(JSON.parse(String(d)));
      for (const w of waiting.splice(0)) w();
    });
    let seen = 0;
    return {
      msgs,
      send: (msg: object) => ws.send(JSON.stringify(msg)),
      next: (t: string, ok: (m: any) => boolean = () => true): Promise<any> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`${name} never got ${t}`)), 5000);
          const look = () => {
            for (; seen < msgs.length; seen++) {
              if (msgs[seen].t === t && ok(msgs[seen])) {
                clearTimeout(timer);
                return resolve(msgs[seen++]);
              }
            }
            waiting.push(look);
          };
          look();
        }),
    };
  };
  try {
    const ann = join('Ann');
    const bob = join('Bob');
    const dee = join('Dee', ROOF);
    assert.equal((await ann.next('welcome')).demoGallery, null);
    await bob.next('welcome');
    await dee.next('welcome');

    ann.send({ t: 'demoGallery.set', url: 'http://insecure.example/' });
    assert.equal((await ann.next('toast')).key, 'gallery.notHttps');
    ann.send({ t: 'demoGallery.set', url: 'https://websites-demo.onrender.com' });
    for (const p of [ann, bob]) {
      assert.deepEqual(await p.next('demoGallery'), { t: 'demoGallery', floor: 'project', url: 'https://websites-demo.onrender.com/' });
      const toast = await p.next('toast', (m) => m.key === 'gallery.set');
      assert.deepEqual(toast.params, { who: 'Ann', url: 'https://websites-demo.onrender.com/' });
    }
    assert.equal(JSON.parse(readFileSync(path.join(project, '.agent-office', 'demogallery.json'), 'utf8')).url, 'https://websites-demo.onrender.com/');
    // Not from the roof.
    dee.send({ t: 'demoGallery.set', url: 'https://other.onrender.com/' });
    assert.equal((await dee.next('toast')).key, 'floor.pickOne');
    // Whoever comes in later finds it.
    const eve = join('Eve');
    assert.equal((await eve.next('welcome')).demoGallery, 'https://websites-demo.onrender.com/');

    // A port the services board doesn't list: refused, nobody prompted.
    bob.send({ t: 'service.golive', port: 5173 });
    assert.deepEqual((await bob.next('toast', (m) => m.key === 'tv.notService')).params, { port: 5173 });
    dee.send({ t: 'service.golive', port: 5173 });
    assert.equal((await dee.next('toast')).key, 'floor.pickOne');

    bob.send({ t: 'demoGallery.set', url: '' });
    assert.equal((await ann.next('demoGallery')).url, null);
    assert.equal((await ann.next('toast', (m) => m.key?.startsWith('gallery.'))).key, 'gallery.off');
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!dee.msgs.some((m) => m.t === 'demoGallery'), 'the roof heard nothing of it');
  } finally {
    for (const ws of sockets) ws.close();
    await office.shutdown();
  }
});
