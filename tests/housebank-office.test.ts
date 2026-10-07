import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Accounts } from '../src/server/accounts.js';
import { CASINO } from '../src/shared/casino.js';

// The house bank in the running office: anyone can take chips out of it, with or without accounts,
// never more than it holds, and everyone sees who took how much.

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
  /** Their balance, as the office last told them. */
  balance(): number;
  close(): void;
}

/** An office with `chips` in its house bank (and `withAccounts`: two accounts, Bob and Cid, password "password123"). */
async function office(chips: number, withAccounts: boolean) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'housebank-office-'));
  process.env.AGENT_OFFICE_HOME = path.join(root, 'home');
  const project = path.join(root, 'project');
  mkdirSync(path.join(project, '.agent-office'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: project });
  // What's in the bank already (the backfill's done, so it adds nothing).
  const none = { crash: '0', plinko: '0', roulette: '0', slots: '0', blackjack: '0', trading: '0', poker: '0' };
  writeFileSync(path.join(project, '.agent-office', 'housebank.json'), JSON.stringify({ total: String(chips), games: { crash: String(chips) }, withdrawals: [], backfill: none }));
  if (withAccounts) {
    const accounts = new Accounts(path.join(project, '.agent-office'));
    for (const name of ['Bob', 'Cid']) {
      const invite = accounts.invite('test', 'member', name);
      assert.ok(typeof invite !== 'string');
      assert.ok(typeof (await accounts.join(invite.token, name, 'password123')) !== 'string');
    }
  }
  const { loadConfig } = await import('../src/server/config.js');
  const { startServer } = await import('../src/server/server.js');
  const port = await freePort();
  const running = await startServer(loadConfig([project, '--port', String(port), '--password', 'dev', '--no-open']));
  const origin = `http://127.0.0.1:${port}`;
  const people: Person[] = [];
  const join = async (name: string, floor?: string, account = false): Promise<Person> => {
    const body = account ? { name, password: 'password123' } : { password: 'dev' };
    const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    assert.equal(login.status, 200, `${name} signs in`);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const key = Buffer.from(name.padEnd(16, '_')).toString('hex');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&chips=${key}${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`, { headers: { cookie, origin } });
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
      balance: () => msgs.filter((m) => m.t === 'chips' || m.t === 'welcome').at(-1)!.chips.balance,
      close: () => ws.close(),
    };
    people.push(p);
    await p.next('welcome');
    return p;
  };
  return {
    join,
    async stop() {
      for (const p of people) p.close();
      running.shutdown();
    },
  };
}

/** Bob and Cid each take chips out, then both try for more than is left at once: only what's there comes out. */
async function everyoneWithdraws(withAccounts: boolean) {
  const o = await office(1000, withAccounts);
  try {
    const ann = await o.join('Ann');
    const bob = await o.join('Bob', CASINO, withAccounts);
    const cid = await o.join('Cid', CASINO, withAccounts);
    assert.equal(bob.msgs.find((m) => m.t === 'welcome').houseBank.total, '1000', 'everyone sees the total');
    // The day's bonus for coming in may still be on its way.
    await new Promise((r) => setTimeout(r, 300));
    const bobStart = bob.balance();
    const cidStart = cid.balance();

    // Upstairs there's no machine to withdraw at.
    ann.send({ t: 'housebank.withdraw', amount: 10 });
    await ann.next('toast', (m) => m.key === 'housebank.casino');

    bob.send({ t: 'housebank.withdraw', amount: 300 });
    await bob.next('chips', (m) => m.chips.balance === bobStart + 300 && m.chips.ledger[0].reason === 'housebank');
    const after = await ann.next('housebank', (m) => m.bank.total === '700');
    assert.deepEqual(after.bank.withdrawals.map((w: any) => [w.amount, w.by]), [['300', 'Bob']], 'everyone sees who took how much, even upstairs');

    // Both at once for 600 of the 700: only the first gets it, the other is told there isn't enough.
    cid.send({ t: 'housebank.withdraw', amount: 600 });
    bob.send({ t: 'housebank.withdraw', amount: 600 });
    await cid.next('chips', (m) => m.chips.balance === cidStart + 600);
    await bob.next('toast', (m) => m.key === 'housebank.balance');
    await ann.next('housebank', (m) => m.bank.total === '100');
    assert.equal(bob.balance(), bobStart + 300);

    // All of what's left, then nothing more.
    bob.send({ t: 'housebank.withdraw', amount: 'all' });
    await bob.next('chips', (m) => m.chips.balance === bobStart + 400);
    const empty = await cid.next('housebank', (m) => m.bank.total === '0');
    assert.deepEqual(
      empty.bank.withdrawals.map((w: any) => [w.amount, w.by]),
      [
        ['100', 'Bob'],
        ['600', 'Cid'],
        ['300', 'Bob'],
      ],
    );
    cid.send({ t: 'housebank.withdraw', amount: 'all' });
    await cid.next('toast', (m) => m.key === 'housebank.balance');
    assert.equal(cid.balance(), cidStart + 600);
  } finally {
    await o.stop();
  }
}

test('without accounts, every player can take chips out of the house bank, never more than it holds', { skip: !bundled && 'needs the client bundle (npm run build)' }, () => everyoneWithdraws(false));

test('with accounts, every account can take chips out of the house bank, never more than it holds', { skip: !bundled && 'needs the client bundle (npm run build)' }, () => everyoneWithdraws(true));
