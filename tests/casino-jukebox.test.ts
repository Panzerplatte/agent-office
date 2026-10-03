import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { CASINO, CASINO_BAR, CASINO_JUKEBOX, CASINO_LOUNGE, CASINO_ROOM, CASINO_SEATING, casinoWalkable } from '../src/shared/casino.js';
import { FLOOR, JUKEBOX } from '../src/shared/layout.js';
import { Jukebox } from '../src/server/jukebox.js';

test("the casino's jukebox keeps its own state, apart from a floor's, even in the same data dir", () => {
  // With one project, the office's data dir is that project's .agent-office.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'casino-jukebox-'));
  const floor = new Jukebox(dir);
  const casino = new Jukebox(dir, 'casino-jukebox.json');
  assert.deepEqual(floor.play({ track: 'coffee-break' }, 'Ann'), { changed: true });
  assert.equal(casino.state().on, false);
  assert.deepEqual(casino.play({ track: 'late-commit' }, 'Bob'), { changed: true });
  casino.skip('Bob');
  assert.equal(floor.state().track, 'coffee-break');
  assert.equal(casino.state().track, 'green-build');
  floor.stop('Ann');
  assert.equal(casino.state().on, true);
  // Each comes back as it was after a restart.
  assert.deepEqual([new Jukebox(dir).state().on, new Jukebox(dir).state().track], [false, 'coffee-break']);
  const again = new Jukebox(dir, 'casino-jukebox.json').state();
  assert.deepEqual([again.on, again.track, again.by], [true, 'green-build', 'Bob']);
});

test("the casino's jukebox stands against the east wall by the lounge, like the office's, with room to use it", () => {
  assert.deepEqual({ ...CASINO_JUKEBOX, x: 0, z: 0 }, { ...JUKEBOX, x: 0, z: 0 });
  assert.equal(CASINO_JUKEBOX.x, CASINO_ROOM.maxX - (FLOOR.maxX - JUKEBOX.x));
  assert.ok(CASINO_JUKEBOX.z - CASINO_JUKEBOX.width / 2 > CASINO_BAR.maxZ, 'south of the bar');
  assert.ok(CASINO_JUKEBOX.z + CASINO_JUKEBOX.width / 2 < CASINO_ROOM.maxZ - 1, "clear of the corner's palm");
  assert.ok(Math.hypot(CASINO_JUKEBOX.x - CASINO_LOUNGE.x, CASINO_JUKEBOX.z - CASINO_LOUNGE.z) < 10);
  // You can't walk into it, but you can stand where you use it (in front, as in the office: 1.3 m out).
  assert.equal(casinoWalkable(CASINO_JUKEBOX.x, CASINO_JUKEBOX.z, 0.1), false);
  assert.ok(casinoWalkable(CASINO_JUKEBOX.x - 1.3, CASINO_JUKEBOX.z));
  for (const s of CASINO_SEATING) assert.ok(Math.hypot(s.x - CASINO_JUKEBOX.x, s.z - CASINO_JUKEBOX.z) > 1.2, `${s.id} is clear of it`);
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

interface Person {
  msgs: any[];
  send(msg: object): void;
  next(t: string, ok?: (m: any) => boolean): Promise<any>;
  close(): void;
}

test('everyone in the casino hears its jukebox, a floor its own, and joining the casino gets what it plays', { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'casino-jukebox-office-'));
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
  const people: Person[] = [];
  const join = async (name: string, floor?: string): Promise<Person> => {
    const chips = Buffer.from(name.padEnd(16, '_')).toString('hex');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&chips=${chips}${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`, { headers: { cookie, origin } });
    const msgs: any[] = [];
    const waiting: (() => void)[] = [];
    ws.on('message', (d) => {
      msgs.push(JSON.parse(String(d)));
      for (const w of waiting.splice(0)) w();
    });
    let seen = 0;
    const p: Person = {
      msgs,
      send: (msg) => ws.send(JSON.stringify(msg)),
      // The next message of type `t` (after the last one this took), that `ok` likes.
      next: (t, ok = () => true) =>
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
      close: () => ws.close(),
    };
    people.push(p);
    return p;
  };
  try {
    const ann = await join('Ann');
    const bob = await join('Bob', CASINO);
    assert.equal((await ann.next('welcome')).floor, 'project');
    const welcome = await bob.next('welcome');
    assert.equal(welcome.floor, CASINO);
    assert.equal(welcome.jukebox.on, false);

    // Ann puts a tune on upstairs, Bob another down in the casino: each hears only their own.
    ann.send({ t: 'jukebox.play', track: 'coffee-break' });
    assert.equal((await ann.next('jukebox')).state.track, 'coffee-break');
    bob.send({ t: 'jukebox.play', track: 'late-commit' });
    const down = await bob.next('jukebox');
    assert.deepEqual([down.state.on, down.state.track, down.state.by], [true, 'late-commit', 'Bob']);
    const toast = await bob.next('toast');
    assert.deepEqual([toast.key, toast.params], ['jukebox.playing', { who: 'Bob', title: 'Late Commit' }]);
    bob.send({ t: 'jukebox.skip' });
    assert.equal((await bob.next('jukebox')).state.track, 'green-build');
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!ann.msgs.some((m) => m.t === 'jukebox' && m.state.by === 'Bob'), "upstairs doesn't hear the casino's");
    assert.ok(!bob.msgs.some((m) => m.t === 'jukebox' && m.state.by === 'Ann'), "the casino doesn't hear a floor's");

    // Whoever comes down to the casino gets what it plays: straight in, or by elevator.
    const cid = await join('Cid', CASINO);
    const cidIn = await cid.next('welcome');
    assert.deepEqual([cidIn.jukebox.on, cidIn.jukebox.track], [true, 'green-build']);
    ann.send({ t: 'floor.go', floor: CASINO });
    const annDown = await ann.next('floor.enter');
    assert.deepEqual([annDown.floor, annDown.jukebox.track, annDown.jukebox.by], [CASINO, 'green-build', 'Bob']);
    // Back up, the floor's own again.
    ann.send({ t: 'floor.go', floor: 'project' });
    const annUp = await ann.next('floor.enter');
    assert.deepEqual([annUp.floor, annUp.jukebox.track, annUp.jukebox.by], ['project', 'coffee-break', 'Ann']);
    // Turning the casino's off is heard down there, not upstairs.
    cid.send({ t: 'jukebox.stop' });
    assert.equal((await bob.next('jukebox')).state.on, false);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!ann.msgs.some((m) => m.t === 'jukebox' && m.state.by === 'Cid'));
  } finally {
    for (const p of people) p.close();
    office.shutdown();
  }
});
