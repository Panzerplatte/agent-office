import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOTES, EMOTE_BURST, EMOTE_EASE_OUT, EMOTE_EVERY, EmoteBucket, isEmote, stoppedAt } from '../src/shared/emotes.js';
import { emoteEnvelope } from '../src/client/world/character.js';

test('the wheel has the six emotes from the issue, each with an emoji', () => {
  assert.deepEqual(
    EMOTES.map((e) => e.id),
    ['wave', 'thumbs', 'clap', 'dance', 'point', 'facepalm'],
  );
  for (const e of EMOTES) assert.ok(e.emoji && e.label && e.seconds > 0);
});

test('only known emotes get through', () => {
  assert.ok(isEmote('wave'));
  assert.ok(!isEmote('moonwalk'));
  assert.ok(!isEmote(1));
  assert.ok(!isEmote(undefined));
});

test('a burst of emotes, then one every EMOTE_EVERY ms', () => {
  const b = new EmoteBucket();
  const t0 = 1_000_000;
  for (let i = 0; i < EMOTE_BURST; i++) assert.ok(b.take(t0), `emote ${i + 1} of the burst`);
  assert.ok(!b.take(t0), 'one too many');
  assert.ok(!b.take(t0 + EMOTE_EVERY * 0.9), 'still too soon');
  assert.ok(b.take(t0 + EMOTE_EVERY), 'one more after a wait');
  assert.ok(!b.take(t0 + EMOTE_EVERY + 10));
});

test('mashing the keys never gets more through than the burst plus the refill', () => {
  const b = new EmoteBucket();
  let passed = 0;
  // Ten seconds of pressing an emote key every 50 ms.
  for (let t = 0; t <= 10_000; t += 50) if (b.take(1_000_000 + t)) passed++;
  assert.equal(passed, EMOTE_BURST + Math.floor(10_000 / EMOTE_EVERY));
});

test("the server's more lenient bucket lets through everything the page's does, even bunched up on the way", () => {
  const page = new EmoteBucket();
  const server = new EmoteBucket(EMOTE_EVERY * 0.8);
  // Sent as fast as the page allows for ten seconds. The opening burst is held up on the wire and
  // arrives late, all at once; the next one gets there straight away.
  let sent = 0;
  for (let t = 1_000_000; t <= 1_010_000; t += 50) {
    if (!page.take(t)) continue;
    const delay = sent++ < EMOTE_BURST ? 300 : 0;
    assert.ok(server.take(t + delay), `emote ${sent} sent at ${t} arrives at ${t + delay}`);
  }
  assert.ok(sent > EMOTE_BURST + 3);
});

test('dance, clap and wave loop; dance for as long as you like, the others up to a cap', () => {
  const loops = EMOTES.filter((e) => e.loop).map((e) => e.id);
  assert.deepEqual(loops, ['wave', 'clap', 'dance']);
  for (const e of EMOTES.filter((e) => e.loop)) {
    if (e.id === 'dance') assert.equal(e.seconds, Infinity, 'dance is endless');
    else assert.ok(Number.isFinite(e.seconds) && e.seconds >= 5 && e.seconds <= 30, `${e.id} stops by itself after ${e.seconds}s`);
  }
  assert.deepEqual(EMOTES.filter((e) => e.seconds === Infinity).map((e) => e.id), ['dance'], 'only a looping emote can be endless');
});

test('the one-shots are as they were', () => {
  const oneShots = Object.fromEntries(EMOTES.filter((e) => !e.loop).map((e) => [e.id, e.seconds]));
  assert.deepEqual(oneShots, { thumbs: 1.8, point: 2, facepalm: 2.4 });
});

test('a looping emote stays at full swing, with no dip from one cycle to the next', () => {
  for (const end of [10, Infinity]) {
    for (let t = 0.2; t < Math.min(end - EMOTE_EASE_OUT, 600); t += 0.01) assert.equal(emoteEnvelope(t, end), 1, `at ${t.toFixed(2)}s`);
  }
});

test('stopping eases out the way running out does', () => {
  const t = 123.4;
  const end = stoppedAt(t, Infinity);
  assert.equal(end, t + EMOTE_EASE_OUT);
  // Just the same curve as an emote that was always going to end then.
  for (let d = 0; d <= EMOTE_EASE_OUT; d += 0.05) assert.ok(Math.abs(emoteEnvelope(t + d, end) - emoteEnvelope(1 + d, 1 + EMOTE_EASE_OUT)) < 1e-9);
  assert.equal(emoteEnvelope(t, end), 1, 'no jump when X goes down');
  assert.equal(emoteEnvelope(end, end), 0, 'all the way out at the end');
  let last = 1;
  for (let d = 0; d <= EMOTE_EASE_OUT; d += 0.02) {
    const k = emoteEnvelope(t + d, end);
    assert.ok(k <= last + 1e-9, 'only ever on its way down');
    last = k;
  }
});

test('stopping near the end, or stopping twice, never makes an emote last longer', () => {
  assert.equal(stoppedAt(9.9, 10), 10);
  const once = stoppedAt(3, 10);
  assert.equal(stoppedAt(3.2, once), once);
});
