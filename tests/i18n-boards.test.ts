import test from 'node:test';
import assert from 'node:assert/strict';
import { lang, setLang, t } from '../src/client/i18n/index.js';

function inLang<T>(l: 'en' | 'de', fn: () => T): T {
  const was = lang();
  setLang(l);
  try {
    return fn();
  } finally {
    setLang(was);
  }
}

test('the queue board says where each task is in line', () => {
  inLang('en', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => t('boards.queueInLine', { n })),
      ['1st in line', '2nd in line', '3rd in line', '4th in line', '11th in line', '12th in line', '13th in line', '21st in line', '22nd in line', '101st in line', '111th in line'],
    );
  });
  inLang('de', () => assert.equal(t('boards.queueInLine', { n: 2 }), '2. in der Reihe'));
});

test('counts on the boards say one or many', () => {
  inLang('en', () => {
    assert.equal(t('boards.filesReviewed', { done: 0, n: 1 }), '0 of 1 file reviewed');
    assert.equal(t('boards.filesReviewed', { done: 2, n: 3 }), '2 of 3 files reviewed');
    assert.equal(t('boards.whyFailing', { n: 1 }), '1 check is failing');
    assert.equal(t('boards.changedFilesCount', { n: 1, more: 1 }), '1+ changed files');
  });
  inLang('de', () => {
    assert.equal(t('boards.queueSummary', { running: 1, waiting: 2, max: 3 }), '1 arbeitet · 2 warten · bis zu 3 gleichzeitig');
    assert.equal(t('boards.officeFull', { n: 1 }).includes('von 1 Worker erreicht'), true);
    assert.equal(t('boards.officeFull', { n: 4 }).includes('von 4 Workern erreicht'), true);
    assert.equal(t('boards.commitFiles', { n: 1 }), '✅ 1 Datei committen');
    assert.equal(t('boards.commitFiles', { n: 2 }), '✅ 2 Dateien committen');
  });
});
