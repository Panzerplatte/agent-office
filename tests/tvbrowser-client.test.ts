import test from 'node:test';
import assert from 'node:assert/strict';
import type { TvBrowserState } from '../src/shared/protocol.js';
import { TV_H, TV_W, TvBrowser, base64Bytes, fitRect, modsOf, pagePoint, tvCaption, wheelPixels, type Picture } from '../src/client/tvbrowser.js';

/** A canvas whose 2D context keeps a list of the pictures drawn on it. */
function fakeCanvas() {
  const drawn: unknown[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (k === 'drawImage' ? (pic: unknown) => drawn.push(pic) : () => {}),
    set: () => true,
  });
  return { canvas: { width: TV_W, height: TV_H, getContext: () => g } as unknown as HTMLCanvasElement, drawn };
}

/** A decoder you finish by hand, frame by frame, to see what happens while one is still decoding. */
function slowDecoder() {
  const waiting: { data: string; done: (p: Picture) => void }[] = [];
  const decode = (data: string) => new Promise<Picture>((done) => waiting.push({ data, done }));
  const pic = (data: string) => ({ width: 1280, height: 720, data, closed: false, close() { this.closed = true; } }) as unknown as Picture;
  return { decode, waiting, pic };
}

const site = (over: Partial<TvBrowserState> = {}): TvBrowserState => ({ port: 5173, url: 'http://localhost:5173/', title: 'Shop', by: 'Ada', width: 1280, height: 720, loading: false, ...over });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('frames land on the one texture the TV wears, never a new one', async () => {
  const { canvas, drawn } = fakeCanvas();
  const d = slowDecoder();
  const tv = new TvBrowser(canvas, d.decode);
  const texture = tv.texture;
  tv.setState(site());
  const before = texture.version;
  tv.frame('AAA');
  d.waiting.shift()!.done(d.pic('AAA'));
  await tick();
  assert.equal(tv.texture, texture);
  assert.ok(texture.version > before, 'the texture is marked for upload');
  assert.equal((tv.picture as unknown as { data: string }).data, 'AAA');
  assert.equal(drawn.length, 1);
});

test('frames that pile up while one decodes skip to the newest, and old pictures are closed', async () => {
  const { canvas } = fakeCanvas();
  const d = slowDecoder();
  const tv = new TvBrowser(canvas, d.decode);
  tv.setState(site());
  tv.frame('1');
  tv.frame('2');
  tv.frame('3');
  assert.equal(d.waiting.length, 1, 'one decode at a time');
  const first = d.pic('1');
  d.waiting.shift()!.done(first);
  await tick();
  assert.equal(d.waiting.length, 1);
  assert.equal(d.waiting[0].data, '3', 'frame 2 is skipped');
  d.waiting.shift()!.done(d.pic('3'));
  await tick();
  assert.equal((first as unknown as { closed: boolean }).closed, true);
  assert.equal((tv.picture as unknown as { data: string }).data, '3');
});

test('a frame decoded for the site before, or after the TV went off, is dropped', async () => {
  const { canvas } = fakeCanvas();
  const d = slowDecoder();
  const tv = new TvBrowser(canvas, d.decode);
  tv.setState(site());
  tv.frame('old');
  tv.setState(site({ port: 3000 }));
  const late = d.pic('old');
  d.waiting.shift()!.done(late);
  await tick();
  assert.equal(tv.picture, null);
  assert.equal((late as unknown as { closed: boolean }).closed, true);
  tv.setState(null);
  tv.frame('ignored');
  assert.equal(d.waiting.length, 0, 'no frames while the TV browser is off');
});

test('a title change keeps the picture; the caption says what is on', async () => {
  const { canvas } = fakeCanvas();
  const d = slowDecoder();
  const tv = new TvBrowser(canvas, d.decode);
  tv.setState(site());
  tv.frame('x');
  d.waiting.shift()!.done(d.pic('x'));
  await tick();
  tv.setState(site({ title: 'Shop · Cart' }));
  assert.ok(tv.picture);
  assert.equal(tvCaption(site()), '📺 Shop · 5173');
  assert.equal(tvCaption(site({ title: '', loading: true })), '📺 http://localhost:5173/ · 5173 ⏳');
});

test('the page fits the box, with bars beside a phone-sized page', () => {
  assert.deepEqual(fitRect(1280, 720, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 });
  const phone = fitRect(1280, 720, 390, 844);
  assert.equal(phone.h, 720);
  assert.ok(Math.abs(phone.w - (390 * 720) / 844) < 1e-9);
  assert.ok(Math.abs(phone.x - (1280 - phone.w) / 2) < 1e-9);
});

test('the mouse maps to 0..1 of the page, and the bars beside it are no page', () => {
  const page = { x: 100, y: 0, w: 200, h: 400 };
  assert.deepEqual(pagePoint(100, 0, page), { x: 0, y: 0 });
  assert.deepEqual(pagePoint(200, 300, page), { x: 0.5, y: 0.75 });
  assert.equal(pagePoint(50, 10, page), null);
  // A drag that leaves the page stays pinned to its edge.
  assert.deepEqual(pagePoint(50, 500, page, true), { x: 0, y: 1 });
});

test('modifier keys and wheel turns as the server takes them', () => {
  assert.equal(modsOf({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: true }), 9);
  assert.equal(modsOf({ altKey: false, ctrlKey: true, metaKey: true, shiftKey: false }), 6);
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }), { dx: 0, dy: 120 });
  assert.deepEqual(wheelPixels({ deltaX: 5, deltaY: -100, deltaMode: 0 }), { dx: 5, dy: -100 });
  assert.deepEqual([...base64Bytes(Buffer.from([255, 216, 255]).toString('base64'))], [255, 216, 255]);
});
