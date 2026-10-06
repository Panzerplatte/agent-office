import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { CASINO } from '../src/shared/casino.js';

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
  next(t: string, ok?: (m: any) => boolean, ms?: number): Promise<any>;
  close(): void;
}

test('Crash in the running office: everyone in the casino sees the round, only they can bet, and bets come off their chips', { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'crash-office-'));
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
      next: (t, ok = () => true, ms = 5000) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`${name} never got ${t}`)), ms);
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
    const cid = await join('Cid', CASINO);
    await ann.next('welcome');
    const welcome = await bob.next('welcome');
    // It's running already, nobody in it: bets open for the first round of the first series.
    assert.equal(welcome.crash.phase, 'betting');
    assert.deepEqual([welcome.crash.series, welcome.crash.of], [1, 1]);
    assert.ok(welcome.crash.odds.max >= 50 && welcome.crash.odds.back > 0.98);
    assert.deepEqual(welcome.crash.players, []);
    await cid.next('welcome');
    // The day's bonus for coming in may still be on its way: Bob's balance is the last he heard.
    await new Promise((r) => setTimeout(r, 300));
    const bobStart: number = bob.msgs.filter((m) => m.t === 'chips').at(-1)?.chips.balance ?? welcome.chips.balance;

    // Upstairs there's no screen to bet at.
    ann.send({ t: 'crash.bet', amount: 100 });
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!ann.msgs.some((m) => m.t === 'crash'));

    // Too much (over the limit, or over the balance) is turned down, and Bob's told how it really is.
    bob.send({ t: 'crash.bet', amount: 10_001 });
    assert.deepEqual((await bob.next('crash')).crash.players, []);
    bob.send({ t: 'crash.bet', amount: bobStart + 1 });
    assert.deepEqual((await bob.next('crash')).crash.players, []);

    // A bet: everyone down there sees it.
    bob.send({ t: 'crash.bet', amount: 100 });
    const seen = await cid.next('crash', (m) => m.crash.players.length === 1);
    assert.equal(seen.crash.phase, 'betting');
    assert.deepEqual([seen.crash.players[0].name, seen.crash.players[0].bet], ['Bob', 100]);
    assert.ok(seen.crash.left > 0 && seen.crash.left <= 10_000);
    assert.equal(seen.crash.crash, null);
    assert.equal((await bob.next('chips', (m) => m.chips.balance === bobStart - 100)).chips.balance, bobStart - 100);
    // The scoreboard next to the screen counts it, Bob's row marked on his page only, nobody's id on either.
    const board = (await bob.next('crash.board', (m) => m.board.wagered.length === 1)).board;
    assert.deepEqual(board.wagered[0], { name: 'Bob', wagered: 100, net: 0, rounds: 0, color: board.wagered[0].color, you: true });
    const cidBoard = (await cid.next('crash.board', (m) => m.board.wagered.length === 1)).board;
    assert.equal(cidBoard.wagered[0].you, undefined);
    assert.equal(cidBoard.wagered[0].id, undefined);
    assert.ok(!ann.msgs.some((m) => m.t === 'crash.board'), 'upstairs there is no board');
    // Too early to cash out; taking it back gives it back.
    bob.send({ t: 'crash.cashout' });
    assert.equal((await bob.next('crash')).crash.players[0].out, undefined);
    bob.send({ t: 'crash.cancel' });
    assert.equal((await cid.next('crash', (m) => m.crash.players.length === 0)).crash.phase, 'betting', 'the clock runs on with nobody in');
    assert.equal((await bob.next('chips', (m) => m.chips.balance === bobStart)).chips.balance, bobStart);
    assert.deepEqual((await cid.next('crash.board', (m) => m.board.wagered.length === 0)).board, { wagered: [], won: [] }, 'taken back: never wagered');

    // Nobody's in, and it takes off anyway when the 10 s are up: the office's timer runs it nonstop.
    const off = await cid.next('crash', (m) => m.crash.phase !== 'betting', 12_000);
    assert.ok(['running', 'crashed'].includes(off.crash.phase));
    assert.deepEqual(off.crash.players, []);
    assert.equal(off.crash.of, 1);

    // Auto-Start runs in the office, for as long as they're in the casino.
    const upstairs: string = ann.msgs.find((m) => m.t === 'welcome').floor;
    const dee = await join('Dee', CASINO);
    await dee.next('welcome');
    dee.send({ t: 'crash.autobet', auto: { base: 10, target: 2, onLoss: 100, onWin: 0 } });
    assert.equal((await dee.next('crash.auto')).auto.on, true);
    dee.send({ t: 'floor.go', floor: upstairs });
    const enter = await dee.next('floor.enter');
    assert.notEqual(enter.floor, CASINO);
    // Back down: it stopped as they left, and says why.
    dee.send({ t: 'floor.go', floor: CASINO });
    const back = await dee.next('floor.enter', (m) => m.floor === CASINO);
    assert.deepEqual([back.crashAuto.on, back.crashAuto.stopped], [false, 'left']);
    // Going offline stops it too.
    const eve = await join('Eve', CASINO);
    await eve.next('welcome');
    eve.send({ t: 'crash.autobet', auto: { base: 10, onLoss: 0, onWin: 0 } });
    assert.equal((await eve.next('crash.auto')).auto.on, true);
    eve.close();
    await new Promise((r) => setTimeout(r, 300));
    const eve2 = await join('Eve', CASINO);
    const again = await eve2.next('welcome');
    assert.deepEqual([again.crashAuto.on, again.crashAuto.stopped], [false, 'left']);
  } finally {
    for (const p of people) p.close();
    office.shutdown();
  }
});
