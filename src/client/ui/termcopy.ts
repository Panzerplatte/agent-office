/**
 * Copying out of a terminal window (#115). The agents switch mouse tracking on, so a plain drag goes
 * to the program; xterm still selects on Shift+drag (Option+drag on macOS with
 * macOptionClickForcesSelection), and this adds Ctrl+drag (Cmd+drag on macOS). A selection is copied
 * with Ctrl+right-click, Ctrl+Shift+C (Cmd+C on macOS) or Ctrl+C, which stays an interrupt when
 * nothing is selected.
 */

/** The modifier keys and button of a mouse or key event, all the decisions below look at. */
export interface Mods {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * What xterm's getSelection() gave, ready for the clipboard: plain "\n" line breaks, no padding
 * spaces at the ends of lines (the terminal fills the rest of a row with them), no empty lines after
 * the last one with text.
 */
export function cleanSelection(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+$/, ''));
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/**
 * What a key press in the terminal means for copying. `copy` copies the selection, `swallow` keeps
 * the key from the program (Ctrl+Shift+C with nothing selected would otherwise interrupt it), null
 * lets it through as before. Only keydown counts.
 */
export function copyKey(e: Mods & { type: string; key: string }, hasSelection: boolean, mac = isMac()): 'copy' | 'swallow' | null {
  if (e.type !== 'keydown' || e.key.toLowerCase() !== 'c' || e.altKey) return null;
  if (mac && e.metaKey && !e.ctrlKey) return hasSelection ? 'copy' : null;
  if (e.metaKey || !e.ctrlKey) return null;
  if (e.shiftKey) return hasSelection ? 'copy' : 'swallow';
  // Plain Ctrl+C copies what's selected, like Windows Terminal; with nothing selected it's the interrupt.
  return hasSelection ? 'copy' : null;
}

/**
 * What pressing a mouse button in the terminal does: `copy` (Ctrl+right-click; on macOS
 * Ctrl+click is a right-click), `select` (Ctrl+drag, Cmd+drag on macOS, while the program tracks the
 * mouse: it's turned into the drag xterm selects with), or null for xterm's own handling.
 */
export function mouseIntent(e: Mods & { button: number }, tracking: boolean, mac = isMac()): 'copy' | 'select' | null {
  if (e.ctrlKey && (e.button === 2 || (mac && e.button === 0))) return 'copy';
  if (e.button !== 0 || !tracking || e.shiftKey || e.altKey) return null;
  return (mac ? e.metaKey : e.ctrlKey) ? 'select' : null;
}

/**
 * The same mousedown with the modifier xterm forces a selection with instead of Ctrl/Cmd, to send in
 * place of the original.
 */
export function selectingMouseDown(e: MouseEvent, mac = isMac()): MouseEvent {
  return new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: e.view,
    detail: e.detail,
    screenX: e.screenX,
    screenY: e.screenY,
    clientX: e.clientX,
    clientY: e.clientY,
    button: e.button,
    buttons: e.buttons,
    ctrlKey: false,
    metaKey: false,
    shiftKey: !mac,
    altKey: mac,
  });
}

/** Where copyText writes to: the async clipboard when the page has it, else the document for the fallback. */
export interface CopyEnv {
  clipboard?: { writeText(text: string): Promise<void> };
  /** navigator.clipboard only works in a secure context (HTTPS or localhost), not over plain HTTP on the LAN. */
  secure: boolean;
  doc: Document;
}

const browserEnv = (): CopyEnv => ({ clipboard: navigator.clipboard, secure: window.isSecureContext, doc: document });

/**
 * Puts text on the clipboard; resolves to whether it worked. Without the async clipboard the
 * fallback runs before anything is awaited, so it's still inside the click or key press that asked
 * for it (execCommand('copy') needs that).
 */
export async function copyText(text: string, env: CopyEnv = browserEnv()): Promise<boolean> {
  if (!env.clipboard || !env.secure) return execCopy(text, env.doc);
  try {
    await env.clipboard.writeText(text);
    return true;
  } catch {
    return execCopy(text, env.doc);
  }
}

/** The old way: select the text in a hidden textarea and have the browser copy it. */
export function execCopy(text: string, doc: Document): boolean {
  const focused = doc.activeElement as HTMLElement | null;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;';
  doc.body.append(area);
  let ok = false;
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    ok = doc.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  focused?.focus?.({ preventScroll: true });
  return ok;
}
