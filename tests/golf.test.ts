import test from 'node:test';
import assert from 'node:assert/strict';
import { lang, setLang } from '../src/client/i18n/index.js';
import { LOFT_START, PIN_YAW, newRound, roundFromJson, roundLanded, roundShot, roundText, roundToJson, type Landed } from '../src/client/world/golf.js';

function inLang<T>(l: 'en' | 'de', fn: () => T): T {
  const was = lang();
  setLang(l);
  try {
    return fn();
  } finally {
    setLang(was);
  }
}

const green = (fromPin: number): Landed => ({ holed: false, lie: 'green', fromPin });
const holed: Landed = { holed: true, lie: 'green', fromPin: 0 };
const lost: Landed = { holed: false, lie: 'lost', fromPin: NaN };

test('a round counts your shots and keeps your closest one', () => {
  let r = newRound(PIN_YAW, LOFT_START);
  r = roundLanded(roundShot(r), green(6));
  r = roundLanded(roundShot(r), lost);
  r = roundLanded(roundShot(r), green(9));
  assert.equal(r.shots, 3);
  assert.equal(r.best, 6);
  assert.equal(r.last?.fromPin, 9);
  inLang('en', () => assert.equal(roundText(r), '3 shots · closest 6.0 m · last: On the green · 9.0 m'));
  inLang('de', () => assert.equal(roundText(r), '3 Schläge · am nächsten 6,0 m · zuletzt: Auf dem Grün · 9,0 m'));
});

test('holing out ends the round, and the next shot starts a new one', () => {
  let r = roundLanded(roundShot(roundLanded(roundShot(newRound(PIN_YAW, LOFT_START)), green(3))), holed);
  inLang('en', () => assert.equal(roundText(r), '🏆 Holed in 2!'));
  inLang('de', () => assert.equal(roundText(r), '🏆 Eingelocht mit 2 Schlägen!'));
  r = roundShot(r);
  assert.equal(r.shots, 1);
  assert.equal(r.best, null);
  assert.equal(r.last, null);
});

test('a round comes back the same from localStorage, a lost ball and all', () => {
  const r = { ...roundLanded(roundShot(roundLanded(roundShot(newRound(0.3, 0.5)), green(4))), lost), aim: 0.3, loft: 0.5 };
  const back = roundFromJson(roundToJson(r));
  assert.ok(back);
  assert.equal(back.shots, 2);
  assert.equal(back.best, 4);
  assert.equal(back.aim, 0.3);
  assert.equal(back.loft, 0.5);
  assert.equal(back.last?.lie, 'lost');
  assert.ok(Number.isNaN(back.last?.fromPin));
});

test('nothing kept, or something that is not a round, starts afresh', () => {
  assert.equal(roundFromJson(null), null);
  assert.equal(roundFromJson('not json'), null);
  assert.equal(roundFromJson('{"shots":-1}'), null);
  // A wild aim or loft is put back in range.
  const r = roundFromJson('{"shots":2,"aim":9,"loft":"x"}');
  assert.equal(r?.aim, PIN_YAW);
  assert.equal(r?.loft, LOFT_START);
  inLang('en', () => assert.equal(roundText(newRound(PIN_YAW, LOFT_START)), 'First shot of the round'));
});
