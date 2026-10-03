import type { ChipsEntry, ChipsState } from '../shared/chips';

const KEY = 'agent-office.chips-key';
let memoryKey = '';

/**
 * Who this browser is to the office's chips bank when you're on the shared password (with an account,
 * it goes by that instead): made up the first time, then kept, so your chips are still yours after a
 * reload or a restart. Sent when the page connects (see net.ts).
 */
export function chipsKey(): string {
  try {
    const k = localStorage.getItem(KEY);
    if (k) return k;
  } catch {
    // No storage: this page's own key, then.
  }
  memoryKey ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(KEY, memoryKey);
  } catch {
    // As above.
  }
  return memoryKey;
}

type Listener = (state: ChipsState, change?: ChipsEntry) => void;

/**
 * Your chips as the office last said: the balance and your latest changes. The casino's games read
 * the balance from here (and listen for changes) to show what you can bet; the office is the one
 * that changes it.
 */
export const chips = {
  state: { balance: 0, ledger: [] } as ChipsState,
  /** Whether the office has said yet (the HUD stays hidden until it has). */
  known: false,
  listeners: new Set<Listener>(),

  get balance(): number {
    return this.state.balance;
  },

  /** What the office said: in the welcome (no `change`), or a change to it. */
  set(state: ChipsState, change?: ChipsEntry) {
    this.state = state;
    this.known = true;
    for (const l of this.listeners) l(state, change);
  },

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  },
};
