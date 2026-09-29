import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lang, setLang } from '../src/client/i18n/index.js';
import { serverError } from '../src/client/i18n/errors.js';
import pages from '../src/client/i18n/pages.js';

test('the sign-in pages know every error by the server’s own English, so a reworded one is caught here', () => {
  const server = ['server.ts', 'accounts.ts'].map((f) => readFileSync(new URL(`../src/server/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const [key, en] of Object.entries(pages.en)) {
    if (!key.startsWith('err')) continue;
    // `{name}` in ours is `${…}` in the server's.
    const re = new RegExp((en as string).split(/\{\w+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\$\\{[^}]+\\}'));
    assert.match(server, re, `pages.${key} is no longer something the server says`);
  }
});

test('an error from the server is said in your language, filled in, else as it came', () => {
  const was = lang();
  try {
    setLang('de');
    assert.equal(serverError('Wrong password', 'pages.loginFailed'), 'Falsches Passwort');
    assert.equal(serverError('Wrong password. With an account of your own, type your name too.', 'pages.loginFailed'), 'Falsches Passwort. Mit einem eigenen Konto gib auch deinen Namen ein.');
    assert.equal(serverError("There's already an account called Ada Lovelace", 'pages.joinFailed'), 'Es gibt schon ein Konto namens Ada Lovelace');
    assert.equal(serverError('Pick a password of at least 8 characters', 'pages.joinFailed'), 'Wähl ein Passwort mit mindestens 8 Zeichen');
    assert.equal(serverError('Something new from a newer server', 'pages.loginFailed'), 'Something new from a newer server');
    assert.equal(serverError(undefined, 'pages.loginFailed'), 'Anmelden hat nicht geklappt');
    setLang('en');
    assert.equal(serverError('Wrong password', 'pages.loginFailed'), 'Wrong password');
  } finally {
    setLang(was);
  }
});
