import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { relayRequest, relayUpgrade, tunneledPort } from '../src/server/relay.js';
import type { ServiceInfo } from '../src/shared/protocol.js';

const OFFICE = 4600;
const req = (host: string | undefined, extra: Record<string, string> = {}) =>
  ({ headers: { ...(host === undefined ? {} : { host }), ...extra } }) as unknown as http.IncomingMessage;
const port = (host: string | undefined) => tunneledPort(req(host), OFFICE);

test('p<port>.localhost on the office port is that service', () => {
  assert.equal(port('p5173.localhost:4600'), 5173);
  assert.equal(port('P3000.LOCALHOST:4600'), 3000);
  // No port: the office behind a reverse proxy on :80.
  assert.equal(port('p5173.localhost'), 5173);
});

test("p<port>.localhost through a tunnel to another local port still uses the subdomain's port", () => {
  // ssh -L 8080:localhost:4600 — the browser says :8080, the preview is still 5173.
  assert.equal(port('p5173.localhost:8080'), 5173);
});

test("p<office port>.localhost is the office itself, not a tunnel", () => {
  assert.equal(port('p4600.localhost:4600'), undefined);
  assert.equal(port('p4600.localhost'), undefined);
});

test('the old localhost:<port> tunnels work as before', () => {
  assert.equal(port('localhost:5173'), 5173);
  assert.equal(port('127.0.0.1:5173'), 5173);
  assert.equal(port('[::1]:5173'), 5173);
  assert.equal(port('app.localhost:5173'), 5173);
  assert.equal(port('localhost:4600'), undefined);
  assert.equal(port('app.localhost:4600'), undefined);
  assert.equal(port('localhost'), undefined);
});

test('other hosts are the office', () => {
  for (const h of [
    undefined,
    '',
    'office.example:4600',
    'p5173.office.example:4600',
    'p5173.localhost.evil.com:4600',
    'p.localhost:4600',
    'px5173.localhost:4600',
    'p0.localhost:4600',
    'p99999.localhost:4600',
    'p5173.localhost:',
    'p5173.localhost:4600:1',
    'localhost:0',
    'localhost:99999',
  ]) {
    assert.equal(port(h), undefined, String(h));
  }
});

test("a request the office itself relayed isn't relayed again", () => {
  assert.equal(tunneledPort(req('p5173.localhost:4600', { 'x-agent-office-relay': '1' }), OFFICE), undefined);
});

// What server.ts does with it: relay when services.lookup knows the port, else serve the office.
test('p<port>.localhost relays HTTP and WebSocket upgrades to a known service only', async (t) => {
  const upstream = http.createServer((r, res) => res.end(`svc ${r.url} ${r.headers.host}`));
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (ws) => ws.on('message', (m) => ws.send(`echo ${m}`)));
  await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', ok));
  const svcPort = (upstream.address() as AddressInfo).port;
  const svc = { port: svcPort, host: '127.0.0.1', command: 'vite' } as ServiceInfo;
  const lookup = (p: number) => (p === svcPort ? svc : undefined);

  const office = http.createServer((r, res) => {
    const p = tunneledPort(r, officePort);
    const s = p ? lookup(p) : undefined;
    if (p && s) return relayRequest(r, res, s);
    res.end('office');
  });
  office.on('upgrade', (r, socket, head) => {
    const p = tunneledPort(r, officePort);
    const s = p ? lookup(p) : undefined;
    if (p && s) return relayUpgrade(r, socket, head, s);
    socket.destroy();
  });
  await new Promise<void>((ok) => office.listen(0, '127.0.0.1', ok));
  const officePort = (office.address() as AddressInfo).port;
  t.after(() => {
    office.closeAllConnections();
    office.close();
    wss.close();
    upstream.closeAllConnections();
    upstream.close();
  });

  const get = (host: string) =>
    new Promise<string>((ok, no) => {
      http
        .get({ host: '127.0.0.1', port: officePort, path: '/@vite/client', headers: { host } }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => ok(body));
        })
        .on('error', no);
    });

  assert.equal(await get(`p${svcPort}.localhost:${officePort}`), `svc /@vite/client p${svcPort}.localhost:${officePort}`);
  assert.equal(await get(`p${svcPort === 1 ? 2 : 1}.localhost:${officePort}`), 'office', 'unknown port');
  assert.equal(await get(`p${officePort}.localhost:${officePort}`), 'office', 'the office port');
  assert.equal(await get(`localhost:${officePort}`), 'office');

  const ws = new WebSocket(`ws://127.0.0.1:${officePort}/`, { headers: { host: `p${svcPort}.localhost:${officePort}` } });
  const reply = await new Promise<string>((ok, no) => {
    ws.on('open', () => ws.send('hmr'));
    ws.on('message', (m) => ok(String(m)));
    ws.on('error', no);
  });
  ws.close();
  assert.equal(reply, 'echo hmr');
});
