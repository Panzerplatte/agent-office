import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CAT_NAMES, catDefaults, cleanCatName, type CatState } from '../src/shared/cat.js';
import { Cat } from '../src/server/cat.js';
import { walkable } from '../src/shared/nav.js';
import type { PeerInfo } from '../src/shared/protocol.js';
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

function withCat<T>(fn: (cat: Cat, sent: CatState[], dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'cat-'));
  const sent: CatState[] = [];
  const cat = new Cat('floor-1', dir, { people: () => [], dog: () => undefined, send: (s) => sent.push(s) });
  try {
    return fn(cat, sent, dir);
  } finally {
    cat.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const peer = (at: [number, number], over: Partial<PeerInfo> = {}) => ({ id: 'p1', name: 'Ada', floor: 'floor-1', x: at[0], y: 0, z: at[1], rotY: 0, ...over }) as PeerInfo;

test('a floor keeps the same cat name, one of the five from the issue', () => {
  assert.deepEqual(CAT_NAMES, ['Lucky', 'Lucy', 'Pumuckel', 'Chicko', 'Paula']);
  const seen = new Set<string>();
  for (const id of ['a', 'floor-1', 'my-repo', 'Panzerplatte/agent-office', 'x'.repeat(40), '12345']) {
    const d = catDefaults(id);
    assert.ok(CAT_NAMES.includes(d.name));
    assert.deepEqual(catDefaults(id), d);
    seen.add(d.name);
  }
  assert.ok(seen.size > 1, 'different floors get different cats');
});

test('cat names are cleaned like the dog’s', () => {
  assert.equal(cleanCatName('  Mi\u0007nka  '), 'Minka');
  assert.equal(cleanCatName('\u0000 '), '');
  assert.equal(cleanCatName('x'.repeat(100)).length, 24);
});

test('the cat starts out asleep somewhere it can be', () => {
  withCat((cat) => {
    const v = cat.view();
    assert.equal(v.name, catDefaults('floor-1').name);
    assert.equal(v.act, 'nap');
    assert.ok(walkable(...cat.here()));
  });
});

test('petting the cat makes it purr at you, if you can reach it', () => {
  withCat((cat, sent) => {
    const at = cat.here();
    assert.equal(cat.pet(peer([at[0] + 10, at[1]])), false, 'too far away');
    assert.equal(cat.pet(peer(at, { floor: 'floor-2' })), false, 'another floor');
    assert.equal(cat.pet(peer([at[0] + 1, at[1]])), true);
    const last = sent.at(-1)!;
    assert.equal(last.act, 'purr');
    assert.equal(last.petBy, 'Ada');
    assert.ok(Math.abs(last.face! - Math.PI / 2) < 1e-6, 'turns to whoever petted it');
    assert.equal(cat.pet(peer([at[0] + 1, at[1]])), false, 'not twice in a blink');
  });
});

test('renaming the cat is kept, and an empty name gives it back its first one', () => {
  withCat((cat, sent, dir) => {
    assert.equal(cat.rename('  Minka '), 'Minka');
    assert.equal(sent.at(-1)!.name, 'Minka');
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'cat.json'), 'utf8')), { name: 'Minka' });
    const again = new Cat('floor-1', dir, { people: () => [], dog: () => undefined, send: () => {} });
    assert.equal(again.catName, 'Minka');
    again.stop();
    assert.equal(cat.rename(''), catDefaults('floor-1').name);
  });
});

test('the cat talks in English and German', () => {
  inLang('en', () => {
    assert.equal(t('world.catPurringAt', { who: 'Ada' }), 'purring at Ada');
    assert.equal(t('windows.settings.officeCat'), 'Office cat');
  });
  inLang('de', () => {
    assert.equal(t('world.catPurringAt', { who: 'Ada' }), 'schnurrt Ada an');
    assert.equal(t('world.catNapping'), 'schläft zusammengerollt');
    assert.equal(t('windows.settings.officeCat'), 'Bürokatze');
  });
});
