import test from 'node:test';
import assert from 'node:assert/strict';
import { lang, setLang, t } from '../src/client/i18n/index.js';
import { fmtGb } from '../src/client/world/machine.js';
import { lieText, pinText, type Flight } from '../src/client/world/golf.js';

function inLang<T>(l: 'en' | 'de', fn: () => T): T {
  const was = lang();
  setLang(l);
  try {
    return fn();
  } finally {
    setLang(was);
  }
}

test('the machine monitor counts cores and workers, one or many', () => {
  inLang('en', () => {
    assert.equal(t('world.machineCores', { n: 1 }), '1 core');
    assert.equal(t('world.machineCores', { n: 8 }), '8 cores');
    assert.equal(t('world.machineWorkers', { n: 1 }), '👷 1 worker · no limit');
    assert.equal(fmtGb(1.5 * 2 ** 30), '1.5 GB');
  });
  inLang('de', () => {
    assert.equal(t('world.machineCores', { n: 1 }), '1 Kern');
    assert.equal(t('world.machineWorkersOf', { n: 2, limit: 6 }), '👷 2 von 6 Workern');
    assert.equal(fmtGb(1.5 * 2 ** 30), '1,5 GB');
  });
});

test('a golf ball says where it stopped, with the distance written the local way', () => {
  const flight = { holed: false, lie: 'green', fromPin: 3.4 } as Flight;
  inLang('en', () => {
    assert.equal(lieText(flight), 'On the green · 3.4 m');
    assert.equal(pinText(0.4), '40 cm');
  });
  inLang('de', () => assert.equal(lieText(flight), 'Auf dem Grün · 3,4 m'));
});

test('the dog and the meeting board fall back to someone when there is no name', () => {
  inLang('en', () => {
    assert.equal(t('world.dogNapping', { who: 'Ada' }), "napping under Ada's desk");
    assert.equal(t('world.dogNapping', { who: '' }), "napping under a worker's desk");
    assert.equal(t('world.meetingNothingYet', { who: '', n: 0 }), 'Nothing written yet: the table is on it');
    assert.equal(t('world.meetingNothingYet', { who: 'Critic', n: 1 }), 'Nothing written yet: Critic is on it');
  });
  inLang('de', () => assert.equal(t('world.dogBarking', { who: '' }), 'bellt einen Worker an: braucht Eingabe'));
});
