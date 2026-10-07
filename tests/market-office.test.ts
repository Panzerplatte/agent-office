import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { CASINO } from '../src/shared/casino.js';
import { SPREAD, payout } from '../src/shared/market.js';

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
  'The trading desk in the running office: the price ticks for everyone in the casino, a position opens and closes through the chips, and is kept per person',
  { skip: !bundled && 'needs the client bundle (npm run build)' },
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'market-office-'));
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
      assert.equal(welcome.market.symbol, 'AGNT');
      assert.ok(welcome.market.history.length >= 1);
      assert.deepEqual(welcome.marketMine, []);
      assert.equal(ann.msgs.find((m) => m.t === 'welcome').market, undefined, 'upstairs there is no desk');
      await cid.next('welcome');
      // The price ticks for everyone down there, the same.
      const tick = await bob.next('market.tick');
      const same = await cid.next('market.tick', (m) => m.n === tick.n);
      assert.equal(same.price, tick.price);
      assert.ok(!ann.msgs.some((m) => m.t === 'market.tick'), 'not upstairs');
      await new Promise((r) => setTimeout(r, 300));
      const bobStart: number = bob.msgs.filter((m) => m.t === 'chips').at(-1)?.chips.balance ?? welcome.chips.balance;

      // Upstairs there's no desk; a bad order, or one for more than Bob has, opens nothing.
      ann.send({ t: 'market.open', stake: 10, side: 'long', lev: 2 });
      bob.send({ t: 'market.open', stake: 10_001, side: 'long', lev: 2 });
      bob.send({ t: 'market.open', stake: 10, side: 'long', lev: 11 });
      bob.send({ t: 'market.open', stake: bobStart + 1, side: 'long', lev: 1 });
      await new Promise((r) => setTimeout(r, 300));
      for (const p of [ann, bob, cid]) assert.ok(!p.msgs.some((m) => m.t === 'market.mine'));

      // A position: the stake comes off, Bob's pages hear it, everyone sees one more long.
      bob.send({ t: 'market.open', stake: 100, side: 'long', lev: 10 });
      // The stake's taken (the chips news comes first), then the position's there.
      await bob.next('chips', (m) => m.chips.balance === bobStart - 100);
      const mine = await bob.next('market.mine');
      assert.equal(mine.positions.length, 1);
      const p = mine.positions[0];
      assert.equal(p.wallet, undefined, "nobody's wallet goes out");
      assert.equal((await cid.next('market', (m) => m.market.longs === 1)).market.longs, 1);
      assert.ok(!cid.msgs.some((m) => m.t === 'market.mine'), "Cid doesn't hear Bob's positions");
      const price = bob.msgs.filter((m) => m.t === 'market.tick').at(-1).price;
      assert.ok(Math.abs(p.entry - price * (1 + SPREAD)) < 1e-6);

      // A page Bob opens later sees it too.
      const bob2 = await join('Bob', CASINO);
      assert.deepEqual((await bob2.next('welcome')).marketMine, [p]);

      // Closing pays its value at the price then (unless it was liquidated by a tick first).
      const before = bob.msgs.length;
      bob.send({ t: 'market.close', id: p.id });
      const after = await bob.next('market.mine', (m) => !!m.closed);
      const paid = bob.msgs.slice(before).find((m) => m.t === 'chips');
      assert.deepEqual(after.positions, []);
      const c = after.closed.close;
      assert.equal(c.won, c.why === 'liquidated' ? 0 : payout(p, c.price));
      if (c.won > 0) assert.equal(paid?.chips.balance, bobStart - 100 + c.won);
      assert.equal((await cid.next('market', (m) => m.market.recent.length > 0)).market.recent[0].name, 'Bob');
    } finally {
      for (const p of people) p.close();
      office.shutdown();
    }
  },
);
