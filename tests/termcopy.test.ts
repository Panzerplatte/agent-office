import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSelection, copyKey, copyText, mouseIntent, type CopyEnv } from '../src/client/ui/termcopy.js';

/** A document just big enough for execCopy: records what was on the clipboard when 'copy' ran. */
function fakeDoc(allowCopy = true) {
  const log: string[] = [];
  let focused: { focus(): void; name: string } | null = { name: 'xterm', focus: () => log.push('refocus xterm') };
  const doc = {
    get activeElement() {
      return focused;
    },
    body: { append: (el: { value: string }) => log.push(`append ${JSON.stringify(el.value)}`) },
    copied: undefined as string | undefined,
    createElement: () => {
      const area = {
        value: '',
        style: { cssText: '' },
        setAttribute() {},
        focus: () => (focused = { name: 'area', focus() {} }),
        select() {},
        setSelectionRange() {},
        remove: () => log.push('remove'),
      };
      doc.lastArea = area;
      return area;
    },
    lastArea: undefined as { value: string } | undefined,
    execCommand(cmd: string) {
      log.push(`exec ${cmd}`);
      if (allowCopy && focused?.name === 'area') doc.copied = doc.lastArea!.value;
      return allowCopy;
    },
  };
  return { doc, log, env: (over: Partial<CopyEnv> = {}): CopyEnv => ({ secure: false, doc: doc as unknown as Document, ...over }) };
}

test('selection: padding at line ends goes, line breaks stay', () => {
  assert.equal(cleanSelection('$ npm test   \n  ok 1 - adds   \n\n  ok 2   '), '$ npm test\n  ok 1 - adds\n\n  ok 2');
  assert.equal(cleanSelection('a\r\nb  \r\nc'), 'a\nb\nc');
  // Empty rows after the last text (the rest of the screen) go, leading indentation stays.
  assert.equal(cleanSelection('    indented\n   \n\n'), '    indented');
  assert.equal(cleanSelection('   '), '');
  assert.equal(cleanSelection('one line'), 'one line');
});

test('copy over plain HTTP: the hidden textarea, synchronously, and focus goes back to the terminal', async () => {
  const { doc, log, env } = fakeDoc();
  const writes: string[] = [];
  const p = copyText('hello\nworld', env({ clipboard: { writeText: async (s) => void writes.push(s) }, secure: false }));
  // Already copied before anything was awaited: still inside the user's click or key press.
  assert.equal(doc.copied, 'hello\nworld');
  assert.equal(await p, true);
  assert.deepEqual(writes, [], 'no async clipboard outside a secure context');
  assert.deepEqual(log, ['append "hello\\nworld"', 'exec copy', 'remove', 'refocus xterm']);
});

test('copy without navigator.clipboard at all uses the fallback; a refused execCommand says so', async () => {
  assert.equal(await copyText('x', fakeDoc().env({ secure: true })), true);
  const refused = fakeDoc(false);
  assert.equal(await copyText('x', refused.env({ secure: true })), false);
  assert.ok(refused.log.includes('remove'), 'the textarea is cleaned up either way');
});

test('copy in a secure context uses the async clipboard, and falls back if it rejects', async () => {
  const ok = fakeDoc();
  const writes: string[] = [];
  assert.equal(await copyText('abc', ok.env({ secure: true, clipboard: { writeText: async (s) => void writes.push(s) } })), true);
  assert.deepEqual(writes, ['abc']);
  assert.equal(ok.doc.copied, undefined);

  const denied = fakeDoc();
  const rejecting = { writeText: () => Promise.reject(new Error('NotAllowedError')) };
  assert.equal(await copyText('abc', denied.env({ secure: true, clipboard: rejecting })), true);
  assert.equal(denied.doc.copied, 'abc');
});

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}, type = 'keydown') => ({
  type,
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

test('keys: Ctrl+Shift+C copies, Ctrl+C copies only with a selection and is the interrupt without', () => {
  const linux = false;
  assert.equal(copyKey(key('C', { ctrlKey: true, shiftKey: true }), true, linux), 'copy');
  assert.equal(copyKey(key('C', { ctrlKey: true, shiftKey: true }), false, linux), 'swallow');
  assert.equal(copyKey(key('c', { ctrlKey: true }), true, linux), 'copy');
  assert.equal(copyKey(key('c', { ctrlKey: true }), false, linux), null, 'Ctrl+C with nothing selected goes to the program');
  assert.equal(copyKey(key('c', { ctrlKey: true }, 'keyup'), true, linux), null, 'only keydown');
  assert.equal(copyKey(key('c'), true, linux), null, 'typing a c');
  assert.equal(copyKey(key('C', { shiftKey: true }), true, linux), null, 'typing a C');
  assert.equal(copyKey(key('c', { ctrlKey: true, altKey: true }), true, linux), null);
  assert.equal(copyKey(key('v', { ctrlKey: true, shiftKey: true }), true, linux), null);
  assert.equal(copyKey(key('c', { metaKey: true }), true, linux), null, 'the Windows key is no copy');
});

test('keys on a Mac: Cmd+C copies a selection, Ctrl+C still interrupts without one', () => {
  const mac = true;
  assert.equal(copyKey(key('c', { metaKey: true }), true, mac), 'copy');
  assert.equal(copyKey(key('c', { metaKey: true }), false, mac), null);
  assert.equal(copyKey(key('c', { ctrlKey: true }), false, mac), null);
  assert.equal(copyKey(key('c', { ctrlKey: true }), true, mac), 'copy');
});

const press = (button: number, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  button,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

test('mouse: Ctrl+right-click copies, with or without mouse tracking', () => {
  for (const tracking of [true, false]) {
    assert.equal(mouseIntent(press(2, { ctrlKey: true }), tracking, false), 'copy');
    assert.equal(mouseIntent(press(2, { ctrlKey: true }), tracking, true), 'copy');
    assert.equal(mouseIntent(press(2), tracking, false), null, 'a plain right-click is left alone');
  }
  // On a Mac Ctrl+click is the right-click.
  assert.equal(mouseIntent(press(0, { ctrlKey: true }), true, true), 'copy');
});

test('mouse: Ctrl+drag (Cmd+drag on a Mac) selects while the program tracks the mouse', () => {
  assert.equal(mouseIntent(press(0, { ctrlKey: true }), true, false), 'select');
  assert.equal(mouseIntent(press(0, { metaKey: true }), true, true), 'select');
  // Without tracking a plain drag already selects, and xterm handles Shift/Option itself.
  assert.equal(mouseIntent(press(0, { ctrlKey: true }), false, false), null);
  assert.equal(mouseIntent(press(0, { ctrlKey: true, shiftKey: true }), true, false), null);
  assert.equal(mouseIntent(press(0, { altKey: true }), true, true), null);
  assert.equal(mouseIntent(press(0), true, false), null, 'a plain click goes to the program');
  assert.equal(mouseIntent(press(1, { ctrlKey: true }), true, false), null);
});
