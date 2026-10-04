import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { FLOOR_STYLES, FLOOR_STYLE_DEFAULT, isFloorStyle } from '../src/shared/floorstyle.js';
import { FloorStyles } from '../src/server/floorstyle.js';
import { CASINO } from '../src/shared/casino.js';
import { ROOF } from '../src/shared/rooftop.js';

test('a floor style is the office or the bunker, and nothing else', () => {
  assert.deepEqual(FLOOR_STYLES, ['office', 'bunker']);
  assert.equal(FLOOR_STYLE_DEFAULT, 'office');
  for (const ok of ['office', 'bunker']) assert.ok(isFloorStyle(ok));
  for (const bad of ['Bunker', 'casino', '', null, undefined, 1, {}, ['bunker']]) assert.ok(!isFloorStyle(bad), String(bad));
});

test("a floor's style is kept in its .agent-office folder, and a broken or strange file is the office", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'floorstyle-'));
  const s = new FloorStyles(dir);
  assert.equal(s.style, 'office');
  assert.equal(s.set('office', 'Ann'), false, 'already the office');
  assert.equal(s.set('bunker', 'Ann'), true);
  assert.equal(s.set('bunker', 'Bob'), false);
  assert.equal(new FloorStyles(dir).style, 'bunker', 'after a restart');
  const saved = JSON.parse(readFileSync(path.join(dir, 'floorstyle.json'), 'utf8'));
  assert.deepEqual([saved.style, saved.by], ['bunker', 'Ann']);
  assert.equal(s.set('office', 'Bob'), true);
  assert.equal(new FloorStyles(dir).style, 'office');
  writeFileSync(path.join(dir, 'floorstyle.json'), '{"style":"castle"}');
  assert.equal(new FloorStyles(dir).style, 'office');
  writeFileSync(path.join(dir, 'floorstyle.json'), 'not json');
  assert.equal(new FloorStyles(dir).style, 'office');
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

test("anyone on a floor switches it to the bunker and back, everyone on it sees it, and it's remembered; not on the roof or in the casino", { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'floorstyle-office-'));
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
    const cid = join('Cid', CASINO);
    const dee = join('Dee', ROOF);
    assert.equal((await ann.next('welcome')).style, 'office');
    await bob.next('welcome');
    assert.equal((await cid.next('welcome')).style, 'office');
    assert.equal((await dee.next('welcome')).style, 'office');

    ann.send({ t: 'floorStyle.set', style: 'bunker' });
    for (const p of [ann, bob]) {
      assert.deepEqual(await p.next('floorStyle'), { t: 'floorStyle', floor: 'project', style: 'bunker' });
      const toast = await p.next('toast', (m) => m.key?.startsWith('floorStyle.'));
      assert.deepEqual([toast.key, toast.params], ['floorStyle.bunker', { who: 'Ann' }]);
    }
    assert.equal(JSON.parse(readFileSync(path.join(project, '.agent-office', 'floorstyle.json'), 'utf8')).style, 'bunker');
    // Again, or something that isn't a style: nothing happens.
    bob.send({ t: 'floorStyle.set', style: 'bunker' });
    bob.send({ t: 'floorStyle.set', style: 'castle' });
    // Not from the casino or the roof.
    cid.send({ t: 'floorStyle.set', style: 'office' });
    dee.send({ t: 'floorStyle.set', style: 'office' });
    assert.equal((await cid.next('toast')).key, 'floor.pickOne');
    assert.equal((await dee.next('toast')).key, 'floor.pickOne');
    // Whoever comes in later finds the bunker; the casino stays itself.
    const eve = join('Eve');
    assert.equal((await eve.next('welcome')).style, 'bunker');
    cid.send({ t: 'floor.go', floor: 'project' });
    assert.equal((await cid.next('floor.enter')).style, 'bunker');
    cid.send({ t: 'floor.go', floor: CASINO });
    assert.equal((await cid.next('floor.enter')).style, 'office');

    bob.send({ t: 'floorStyle.set', style: 'office' });
    assert.equal((await ann.next('floorStyle')).style, 'office');
    assert.deepEqual((await ann.next('toast', (m) => m.key?.startsWith('floorStyle.'))).key, 'floorStyle.office');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(ann.msgs.filter((m) => m.t === 'floorStyle').length, 2, 'only the real changes went out');
    assert.ok(!cid.msgs.some((m) => m.t === 'floorStyle'), 'the casino heard nothing of it');
    assert.ok(!dee.msgs.some((m) => m.t === 'floorStyle'), 'nor the roof');
  } finally {
    for (const ws of sockets) ws.close();
    await office.shutdown();
  }
});
