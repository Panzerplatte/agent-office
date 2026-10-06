import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { CASINO } from '../src/shared/casino.js';
import { fallMs, multipliers, payout, slotOf } from '../src/shared/plinko.js';

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

test(
  'Plinko in the running office: everyone in the casino sees a ball fall, only they can drop one, and it pays when it lands',
  { skip: !bundled && 'needs the client bundle (npm run build)' },
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'plinko-office-'));
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
      assert.deepEqual(welcome.plinko, { balls: [], recent: [] });
      assert.equal(ann.msgs.find((m) => m.t === 'welcome').plinko, undefined, 'upstairs there is no machine');
      await cid.next('welcome');
      // The day's bonus for coming in may still be on its way: Bob's balance is the last he heard.
      await new Promise((r) => setTimeout(r, 300));
      const bobStart: number = bob.msgs.filter((m) => m.t === 'chips').at(-1)?.chips.balance ?? welcome.chips.balance;

      // Upstairs there's no machine to drop at; and a bad drop, or one for more than Bob has, goes nowhere.
      ann.send({ t: 'plinko.drop', bet: 10, rows: 8, risk: 'low' });
      bob.send({ t: 'plinko.drop', bet: 10_001, rows: 8, risk: 'low' });
      bob.send({ t: 'plinko.drop', bet: 10, rows: 17, risk: 'low' });
      bob.send({ t: 'plinko.drop', bet: bobStart + 1, rows: 8, risk: 'low' });
      await new Promise((r) => setTimeout(r, 300));
      for (const p of [ann, bob, cid]) assert.ok(!p.msgs.some((m) => m.t === 'plinko.ball'));

      // A drop: everyone down there sees the same ball with the same path, and the bet comes off Bob's chips.
      bob.send({ t: 'plinko.drop', bet: 100, rows: 8, risk: 'high' });
      const { ball } = await cid.next('plinko.ball');
      // The bet's taken (the chips news comes first), then the ball's on its way.
      await bob.next('chips', (m) => m.chips.balance === bobStart - 100);
      const own = (await bob.next('plinko.ball')).ball;
      assert.deepEqual(own, ball);
      assert.equal(ball.name, 'Bob');
      assert.equal(ball.path.length, 8);
      assert.equal(ball.slot, slotOf(ball.path));
      assert.equal(ball.m, multipliers(8, 'high')[ball.slot]);
      assert.equal(ball.won, payout(100, ball.m));
      assert.equal(ball.wallet, undefined, "nobody's wallet goes out");
      // Someone coming down while it falls sees it, partway.
      const dee = await join('Dee', CASINO);
      const late = (await dee.next('welcome')).plinko;
      assert.equal(late.balls.length, 1);
      assert.ok(late.balls[0].age > 0 && late.balls[0].age < fallMs(8));
      // It lands, and Bob's paid then (nothing to pay for a 0-chip slot).
      const end = bobStart - 100 + ball.won;
      if (ball.won > 0) await bob.next('chips', (m) => m.chips.balance === end, fallMs(8) + 3000);
      else await new Promise((r) => setTimeout(r, fallMs(8) + 300));
      const after = await join('Eve', CASINO);
      const recent = (await after.next('welcome')).plinko;
      assert.deepEqual(recent.balls, []);
      assert.equal(recent.recent[0].m, ball.m);
      assert.equal(recent.recent[0].name, 'Bob');
    } finally {
      for (const p of people) p.close();
      office.shutdown();
    }
  },
);
