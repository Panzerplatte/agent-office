import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { JUKEBOX_DEFAULT, JUKEBOX_TUNES, RADIO_STATIONS, STREAM, stationById, streamUrl, trackTitle } from '../src/shared/jukebox.js';
import { Jukebox } from '../src/server/jukebox.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'jukebox-radio-'));

test('the I Love Radio list: every channel once, I Love Radio first, each with a stream of its own', () => {
  assert.ok(RADIO_STATIONS.length >= 30);
  assert.equal(RADIO_STATIONS[0].name, 'I Love Radio');
  assert.equal(JUKEBOX_DEFAULT, RADIO_STATIONS[0].id);
  for (const key of ['id', 'name', 'channel', 'url'] as const) {
    assert.equal(new Set(RADIO_STATIONS.map((r) => r[key])).size, RADIO_STATIONS.length, `no two share a ${key}`);
  }
  for (const r of RADIO_STATIONS) {
    assert.match(r.id, /^[a-z0-9]+$/);
    assert.match(r.name, /^I Love /);
    assert.match(r.color, /^#[0-9a-f]{6}$/);
    const u = new URL(r.url);
    assert.equal(u.protocol, 'https:');
    assert.ok(['streams.ilovemusic.de', 'play.ilovemusic.de'].includes(u.hostname), r.url);
    // A station's id is its track: it mustn't be mistaken for a tune or a pasted stream.
    assert.ok(!JUKEBOX_TUNES.some((t) => t.id === r.id) && r.id !== STREAM);
  }
  for (const name of ['I Love 2 Dance', 'I Love Hip Hop', 'I Love Deutschrap Beste', 'I Love Chillhop', 'I Love The Sun', 'I Love Greatest Hits']) {
    assert.ok(RADIO_STATIONS.some((r) => r.name === name), name);
  }
});

test("a station's title is its name, and its stream comes from the list", () => {
  const hiphop = stationById('ilovehiphop')!;
  assert.equal(trackTitle({ track: 'ilovehiphop' }), 'I Love Hip Hop');
  assert.equal(streamUrl({ track: 'ilovehiphop' }), hiphop.url);
  // Even with a url along with it, a station plays its own stream.
  assert.equal(streamUrl({ track: 'ilovehiphop', url: 'https://example.com/x.mp3' }), hiphop.url);
  assert.equal(trackTitle({ track: STREAM, url: 'https://radio.example.com/live.mp3' }), 'radio.example.com · live.mp3');
  assert.equal(streamUrl({ track: STREAM, url: 'https://radio.example.com/live.mp3' }), 'https://radio.example.com/live.mp3');
  assert.equal(trackTitle({ track: 'coffee-break' }), 'Coffee Break');
  assert.equal(streamUrl({ track: 'coffee-break' }), undefined);
});

test('a jukebox never played is set to I Love Radio, and off', () => {
  const s = new Jukebox(tmp()).state();
  assert.deepEqual([s.on, s.track], [false, 'iloveradio']);
  assert.equal(new Jukebox(tmp()).title(), 'I Love Radio');
});

test('only stations on the list play, not any link or name passed as one', () => {
  const box = new Jukebox(tmp());
  assert.deepEqual(box.play({ track: 'ilovechillhop' }, 'Ann'), { changed: true });
  const s = box.state();
  assert.deepEqual([s.on, s.track, s.url, s.by], [true, 'ilovechillhop', undefined, 'Ann']);
  assert.equal(box.title(), 'I Love Chillhop');
  assert.equal(box.radio(), true);
  for (const track of ['https://streams.ilovemusic.de/iloveradio99.mp3', 'iloveradio99', 'I Love Radio', STREAM, 42]) {
    assert.ok('error' in box.play({ track }, 'Bob'), String(track));
  }
  assert.equal(box.state().track, 'ilovechillhop');
  // A tune isn't radio; a pasted stream is.
  box.play({ track: 'rainy-window' }, 'Ann');
  assert.equal(box.radio(), false);
  box.play({ url: 'https://radio.example.com/live' }, 'Ann');
  assert.equal(box.radio(), true);
});

test('skip goes on to the next station (round to the first), and from a tune to the next tune', () => {
  const box = new Jukebox(tmp());
  box.play({ track: RADIO_STATIONS[0].id }, 'Ann');
  box.skip('Ann');
  assert.equal(box.state().track, RADIO_STATIONS[1].id);
  box.play({ track: RADIO_STATIONS.at(-1)!.id }, 'Ann');
  box.skip('Ann');
  assert.equal(box.state().track, RADIO_STATIONS[0].id);
  box.play({ track: JUKEBOX_TUNES[0].id }, 'Ann');
  box.skip('Ann');
  assert.equal(box.state().track, JUKEBOX_TUNES[1].id);
  box.play({ url: 'https://radio.example.com/live' }, 'Ann');
  box.skip('Ann');
  assert.equal(box.state().track, JUKEBOX_TUNES[0].id);
});

test('saved jukeboxes load as before, a station comes back, and an unknown one falls back to I Love Radio', () => {
  const saved = (s: object) => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'jukebox.json'), JSON.stringify(s));
    return new Jukebox(dir).state();
  };
  const tune = saved({ on: true, track: 'late-commit', by: 'Ann', startedAt: 5 });
  assert.deepEqual([tune.on, tune.track, tune.by, tune.startedAt], [true, 'late-commit', 'Ann', 5]);
  const stream = saved({ on: false, track: STREAM, url: 'https://radio.example.com/live', startedAt: 5 });
  assert.deepEqual([stream.on, stream.track, stream.url], [false, STREAM, 'https://radio.example.com/live']);
  const station = saved({ on: true, track: 'ilovethesun', startedAt: 5 });
  assert.deepEqual([station.on, station.track, station.url], [true, 'ilovethesun', undefined]);
  // A station's file round-trips too.
  const dir = tmp();
  new Jukebox(dir).play({ track: 'ilovegreatesthits' }, 'Bob');
  assert.equal(new Jukebox(dir).state().track, 'ilovegreatesthits');
  const gone = saved({ on: true, track: 'iloveradio-that-closed', startedAt: 5 });
  assert.deepEqual([gone.on, gone.track], [false, JUKEBOX_DEFAULT]);
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

test('everyone on a floor hears the station someone tunes to, by name', { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jukebox-radio-office-'));
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
  const join = (name: string) => {
    const chips = Buffer.from(name.padEnd(16, '_')).toString('hex');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&chips=${chips}`, { headers: { cookie, origin } });
    sockets.push(ws);
    const msgs: any[] = [];
    const waiting: (() => void)[] = [];
    ws.on('message', (d) => {
      msgs.push(JSON.parse(String(d)));
      for (const w of waiting.splice(0)) w();
    });
    let seen = 0;
    return {
      send: (msg: object) => ws.send(JSON.stringify(msg)),
      next: (t: string): Promise<any> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`${name} never got ${t}`)), 5000);
          const look = () => {
            for (; seen < msgs.length; seen++) {
              if (msgs[seen].t === t) {
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
    const welcome = await ann.next('welcome');
    assert.deepEqual([welcome.jukebox.on, welcome.jukebox.track], [false, 'iloveradio']);
    await bob.next('welcome');

    ann.send({ t: 'jukebox.play', track: 'ilovehiphop' });
    for (const p of [ann, bob]) {
      const j = await p.next('jukebox');
      assert.deepEqual([j.state.on, j.state.track, j.state.by], [true, 'ilovehiphop', 'Ann']);
      const toast = await p.next('toast');
      assert.deepEqual([toast.key, toast.params], ['jukebox.radio', { who: 'Ann', title: 'I Love Hip Hop' }]);
    }
    // A station that isn't on the list is refused, and nothing changes.
    bob.send({ t: 'jukebox.play', track: 'https://evil.example.com/x.mp3' });
    const no = await bob.next('toast');
    assert.deepEqual([no.key, no.level], ['jukebox.noSuchTune', 'warn']);
    bob.send({ t: 'jukebox.skip' });
    const skipped = await ann.next('jukebox');
    assert.equal(skipped.state.track, RADIO_STATIONS[RADIO_STATIONS.findIndex((r) => r.id === 'ilovehiphop') + 1].id);
  } finally {
    for (const ws of sockets) ws.close();
    office.shutdown();
  }
});
