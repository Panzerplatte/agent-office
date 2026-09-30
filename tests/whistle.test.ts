import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOF } from '../src/shared/rooftop.js';
import { WHISTLE_EVERY, WHISTLE_SERVER_EVERY, WhistleGate, whistleHearers } from '../src/shared/whistle.js';

test('one whistle, then nothing until WHISTLE_EVERY has passed', () => {
  const g = new WhistleGate();
  const t0 = 1_000_000;
  assert.ok(g.take(t0), 'the first one');
  assert.ok(!g.take(t0), 'straight again');
  assert.ok(!g.take(t0 + WHISTLE_EVERY - 1), 'still too soon');
  assert.ok(g.take(t0 + WHISTLE_EVERY), 'after the wait');
});

test('mashing L for ten seconds gets one whistle a second or so through the server', () => {
  const g = new WhistleGate(WHISTLE_SERVER_EVERY);
  let passed = 0;
  for (let t = 0; t <= 10_000; t += 50) if (g.take(1_000_000 + t)) passed++;
  assert.equal(passed, 1 + Math.floor(10_000 / WHISTLE_SERVER_EVERY));
});

test("the server's gate lets through every whistle the page's does, even bunched up on the way", () => {
  const page = new WhistleGate();
  const server = new WhistleGate(WHISTLE_SERVER_EVERY);
  let t = 1_000_000;
  for (let i = 0; i < 50; i++) {
    t += 40;
    if (!page.take(t)) continue;
    // Up to 200 ms of jitter on the way, early or late.
    const arrives = t + (i % 2 ? 100 : -100);
    assert.ok(server.take(arrives), `whistle at ${t}`);
  }
});

test('everyone else on the same floor hears it, nobody on another floor or the roof does', () => {
  const people = [
    { id: 'ref', floor: 'alpha' },
    { id: 'a', floor: 'alpha' },
    { id: 'b', floor: 'alpha' },
    { id: 'c', floor: 'beta' },
    { id: 'd', floor: ROOF },
    { id: 'e' },
  ];
  const at = (p: { floor?: string }) => p.floor;
  assert.deepEqual(
    whistleHearers(people, people[0], at).map((p) => p.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    whistleHearers(people, people[4], at).map((p) => p.id),
    [],
    'alone on the roof',
  );
  assert.deepEqual(
    whistleHearers([...people, { id: 'f', floor: ROOF }], people[4], at).map((p) => p.id),
    ['f'],
    'the roof counts as a floor',
  );
  assert.deepEqual(whistleHearers(people, people[5], at), [], 'nowhere yet, so nobody');
});
