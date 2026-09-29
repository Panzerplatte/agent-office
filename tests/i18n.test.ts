import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, format, lang, setLang, t, tables } from '../src/client/i18n/index.js';

test('without a saved pick or a browser language, the office is in English', () => {
  assert.equal(lang(), 'en');
  assert.equal(t('core.language'), '🌐 Language');
});

test('picking German switches every text to it', () => {
  setLang('de');
  try {
    assert.equal(lang(), 'de');
    assert.equal(t('core.language'), '🌐 Sprache');
  } finally {
    setLang('en');
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
