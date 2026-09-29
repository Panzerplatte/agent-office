import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, format, lang, pickLang, setLang, t, tables } from '../src/client/i18n/index.js';

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
