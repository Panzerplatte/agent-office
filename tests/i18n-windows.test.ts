import test from 'node:test';
import assert from 'node:assert/strict';
import { lang, setLang } from '../src/client/i18n/index.js';
import { timeAgo } from '../src/client/ui/dom.js';

test('how long ago something was, in English and German', () => {
  const was = lang();
  const ago = (s: number) => timeAgo(Date.now() - s * 1000);
  try {
    setLang('en');
    assert.deepEqual([ago(5), ago(5 * 60), ago(3 * 3600), ago(86400), ago(4 * 86400)], ['just now', '5m ago', '3h ago', '1d ago', '4d ago']);
    setLang('de');
    assert.deepEqual([ago(5), ago(5 * 60), ago(3 * 3600), ago(86400), ago(4 * 86400)], ['gerade eben', 'vor 5 Min.', 'vor 3 Std.', 'vor 1 Tag', 'vor 4 Tagen']);
  } finally {
    setLang(was);
  }
});
