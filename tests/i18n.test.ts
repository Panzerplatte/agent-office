import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, format, lang, noticeText, pickLang, setLang, t, tables } from '../src/client/i18n/index.js';
import { notice } from '../src/shared/notices.js';

test('the language is the one you picked, else the browser’s first one there is, else English', () => {
  assert.equal(pickLang('de', ['en-US']), 'de');
  assert.equal(pickLang(null, ['fr-FR', 'de-AT', 'en']), 'de');
  assert.equal(pickLang('klingon', ['en-GB']), 'en');
  assert.equal(pickLang(null, ['fr']), 'en');
  assert.equal(pickLang(null, []), 'en');
});

test('picking a language switches every text to it', () => {
  const was = lang();
  try {
    setLang('en');
    assert.equal(t('core.language'), '🌐 Language');
    setLang('de');
    assert.equal(lang(), 'de');
    assert.equal(t('core.language'), '🌐 Sprache');
  } finally {
    setLang(was);
  }
});

test('placeholders are filled from the vars, and one without a value stays as it is', () => {
  assert.equal(format('{n} workers on {floor}', { n: 3 }), '3 workers on {floor}');
  assert.equal(format('{who} left', { who: 'Ada' }), 'Ada left');
});

test('every table has each language, with the same keys and nothing left blank', () => {
  for (const [name, table] of Object.entries(tables)) {
    const en = Object.keys(table.en).sort();
    for (const { id } of LANGS) {
      const texts = table[id as 'en' | 'de'];
      assert.deepEqual(Object.keys(texts).sort(), en, `${name}: ${id} has different keys than English`);
      for (const [key, text] of Object.entries(texts)) {
        assert.equal(typeof text, typeof table.en[key], `${name}.${key}: ${id} is a ${typeof text}, English a ${typeof table.en[key]}`);
        if (typeof text === 'string') assert.ok(text.trim(), `${name}.${key} is blank in ${id}`);
      }
    }
  }
});

test('a server notice carries the English as its text, for browsers that don’t know its key', () => {
  assert.deepEqual(notice('queue.finished', { who: 'Ada', task: '#12' }), { text: '📋 Ada finished #12', key: 'queue.finished', params: { who: 'Ada', task: '#12' } });
  assert.equal(notice('changes.discarded', { who: 'Ada', n: 1, name: 'Bob' }).text, "Ada discarded 1 uncommitted change at Bob's desk");
  assert.equal(notice('changes.discarded', { who: 'Ada', n: 3, name: 'Bob' }).text, "Ada discarded 3 uncommitted changes at Bob's desk");
  assert.equal(notice('issue.closed', { who: 'Ada', number: 7, notPlanned: 1, dropped: 0 }).text, 'Ada closed issue #7 as not planned');
  assert.equal(notice('budget.passed', { budget: '$5.00', spent: '$5.20', paused: 1 }).text, "💸 Today's spend passed the $5.00 budget ($5.20) — no new hires until tomorrow");
});

test('a toast from the server is said in your language by its key, else in the English it came with', () => {
  const was = lang();
  try {
    setLang('de');
    assert.equal(noticeText(notice('worker.sentHome', { who: 'Ada', name: 'Bob' })), 'Ada hat Bob nach Hause geschickt');
    assert.equal(noticeText(notice('meeting.called', { by: 'Ada', pattern: 'debate', label: 'Debate', title: 'Tabs', count: 3, rounds: 1, tokens: '90k' })), '🤝 Ada hat ein Debatten-Meeting einberufen: „Tabs“ (3 Worker, höchstens 1 Runde, 90k Tokens)');
    assert.equal(noticeText({ text: 'From a newer office', key: 'no.such.key', params: {} }), 'From a newer office');
    assert.equal(noticeText({ text: 'fatal: not a git repository' }), 'fatal: not a git repository');
    assert.equal(noticeText({ text: 'x', key: 'toString' }), 'x');
    setLang('en');
    assert.equal(noticeText(notice('worker.sentHome', { who: 'Ada', name: 'Bob' })), 'Ada sent Bob home');
  } finally {
    setLang(was);
  }
});
