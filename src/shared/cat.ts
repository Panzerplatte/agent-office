// The office cat, every floor's second pet. Like the dog (see dog.ts), the server decides what it does
// (see server/cat.ts) and sends one CatState per leg of its day, and every browser works out from that
// where it is. It walks the same way the dog does, so it shares dogAt and legSeconds.

import { DOG_NAME_MAX, cleanDogName } from './dog.js';

/** What the cat does once it gets where it's going. */
export type CatAct = 'sit' | 'loaf' | 'nap' | 'groom' | 'stretch' | 'purr';

export interface CatState {
  name: string;
  /** Which of CAT_COATS it wears. */
  coat: number;
  /** This leg: from where it was when the leg began, on through each point in turn. Never empty. */
  path: [number, number][];
  /** Meters per second along the path. */
  speed: number;
  /** How long ago the leg began, in ms, as of when the server sent it. */
  elapsed: number;
  act: CatAct;
  /** Which way it faces once it's there (rotation around y; 0 looks down +z). */
  face?: number;
  /** Purring: who just petted it. */
  petBy?: string;
}

export const CAT_NAME_MAX = DOG_NAME_MAX;

/** A new floor's cat is called one of these until someone names it in ⚙️ Settings. */
export const CAT_NAMES = ['Lucky', 'Lucy', 'Pumuckel', 'Chicko', 'Paula'];

/** Coats: [fur; belly, muzzle and paws; inside its ears and its nose]. */
export const CAT_COATS: [string, string, string][] = [
  ['#f2a65a', '#fff3e0', '#f7a1a8'], // ginger
  ['#2b2b33', '#3a3a44', '#f2a0b0'], // black
  ['#9aa3ad', '#eef1f4', '#f4a3ae'], // grey
  ['#fbf8f2', '#ffffff', '#ffb3c1'], // white
  ['#7a5a43', '#e8d5c0', '#e99aa3'], // tabby brown
  ['#d9c3a5', '#f7efe3', '#f0a6a6'], // cream
];

/** A name for a floor's cat, and a coat, picked from its id so it keeps them (and isn't the dog's pick). */
export function catDefaults(floorId: string): { name: string; coat: number } {
  let h = 7;
  for (const ch of floorId) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return { name: CAT_NAMES[h % CAT_NAMES.length], coat: (h >>> 8) % CAT_COATS.length };
}

/** Takes control characters out and trims to CAT_NAME_MAX; '' when nothing's left. */
export function cleanCatName(raw: string): string {
  return cleanDogName(raw);
}
