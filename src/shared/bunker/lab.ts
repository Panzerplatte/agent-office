// The lab bench on the north wall: the fictional products, made in little mini-games (ingredients, timing, temperature).
// Shared by the server (server/bunker/lab.ts) and the client (world/drugbunker/lab.ts, ui/bunker/lab.ts).
//
// It's a game: the products (PRODUCTS in items.ts), their "ingredients" and every step here are made
// up. A batch goes like this: you start it at the bench (its ingredients are used up then, and it needs
// its kit, which stays), play its mini-game in the panel, and the page says how well you did (0–1).
// Then it sits for a while (cooling, drying, settling) and you take it off the bench: a unit of
// product of that quality in your stash. One batch at a time.
import { countItem, type Inventory } from './index.js';

/** The three recipes, each with its own mini-game. */
export type RecipeId = 'glimmer' | 'fizz' | 'nebula';
/** The mini-games: hold a needle in a band on the burner, mix a powder and press tablets in rhythm, repeat a sequence of drops. */
export type LabGame = 'heat' | 'press' | 'drops';

export interface Recipe {
  id: RecipeId;
  /** The product it makes (a ProductKind's id). */
  product: string;
  /** How many grams one batch makes. */
  grams: number;
  /** Kit it needs at the bench (equipment items' ids): not used up. */
  kit: readonly string[];
  /** What it uses up: item id → how many. */
  ingredients: Readonly<Record<string, number>>;
  game: LabGame;
  /** The quickest a page can play its game (ms after starting): a finish sooner than that isn't believed. */
  minPlay: number;
  /** How long it sits on the bench after its game before you can take it (ms). */
  rest: number;
}

export const RECIPES: readonly Recipe[] = [
  // Blue gloop and fizzium salt in a flask over the burner, kept in the green, then cooled and broken up.
  { id: 'glimmer', product: 'glimmer', grams: 10, kit: ['burner', 'flasks'], ingredients: { gloop: 2, fizzium: 1 }, game: 'heat', minPlay: 15_000, rest: 30_000 },
  // A powder of fizzium salt and moon syrup, mixed to the shade on the card, pressed into tablets.
  { id: 'fizz', product: 'fizz', grams: 8, kit: ['press'], ingredients: { fizzium: 2, 'moon-syrup': 1 }, game: 'press', minPlay: 6_000, rest: 15_000 },
  // Drops of stardust, moon syrup and blue gloop into a flask in the right order, left to swirl.
  { id: 'nebula', product: 'nebula', grams: 6, kit: ['flasks'], ingredients: { stardust: 1, 'moon-syrup': 1, gloop: 1 }, game: 'drops', minPlay: 5_000, rest: 20_000 },
];

export const RECIPE_BY_ID: ReadonlyMap<string, Recipe> = new Map(RECIPES.map((r) => [r.id, r]));

/** The recipe with that id, or undefined. */
export function recipe(id: unknown): Recipe | undefined {
  return typeof id === 'string' ? RECIPE_BY_ID.get(id) : undefined;
}

/** The batch on the bench: being played (`playing`), or done and resting until `readyAt`. */
export interface LabBatch {
  recipe: RecipeId;
  /** When it was started (the office's clock, ms). */
  startedAt: number;
  /** How good it came out, 0–1, once its game is played. */
  quality?: number;
  /** When it can be taken off the bench, once its game is played. */
  readyAt?: number;
}

/** What the lab feature keeps for each person (BunkerPerson.lab, saved in bunker.json). */
export interface LabState {
  /** The batch on the bench, or null. */
  batch: LabBatch | null;
  /** How many batches they've taken off the bench, ever. */
  made: number;
}

/** How long a batch can be left unplayed before it's spoiled (the page was closed mid-game). */
export const LAB_ABANDON = 5 * 60_000;

/** Whether the batch is still waiting for its game to be played. */
export function playing(b: LabBatch | null | undefined): b is LabBatch & { quality: undefined } {
  return !!b && b.quality === undefined;
}

/** What `inv` is missing to start `r`: the kit and the ingredients short (item id → how many more). Empty when it can start. */
export function missingFor(r: Recipe, inv: Inventory): Record<string, number> {
  const short: Record<string, number> = {};
  for (const k of r.kit) if (countItem(inv, k) < 1) short[k] = 1;
  for (const [item, n] of Object.entries(r.ingredients)) {
    const have = countItem(inv, item);
    if (have < n) short[item] = n - have;
  }
  return short;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

// ---- The mini-games' rules (the panel plays them; these say how they score) ---------------------------------

/** The burner: the needle's scale is 0–100, the green band where it should stay, and where it boils over. */
export const HEAT = { band: [55, 72] as const, over: 92, seconds: 20, start: 20 } as const;

/**
 * One step of the burner's needle (`dt` s): it climbs while the flame's up and sinks while it isn't,
 * faster the further it is from the room's warmth, with a little wobble (`wobble`, −1–1) so it never
 * sits still.
 */
export function heatStep(temp: number, flame: boolean, dt: number, wobble = 0): number {
  const rate = flame ? 18 - temp * 0.08 : -(5 + temp * 0.1);
  return Math.min(100, Math.max(0, temp + (rate + wobble * 4) * dt));
}

/** Glimmer's quality: how much of the time the needle was in the green band (`inBand`, 0–1). Boiling over ruins it outright (null). */
export function heatQuality(inBand: number, boiledOver: boolean): number | null {
  if (boiledOver) return null;
  return clamp01(Math.pow(clamp01(inBand) * 1.15, 1.3));
}

/** The tablet press: how many tablets to press, and the zone the sweeping marker (0–1) has to be in. */
export const PRESS = { tablets: 8, zone: 0.12, period: 1.6 } as const;

/** Where the press's marker is (0–1) `t` seconds in: back and forth across the gauge. */
export function pressMarker(t: number, period: number = PRESS.period): number {
  const p = (((t / period) % 1) + 1) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

/** How good one press is: 1 dead on the zone's middle (`center`), down to 0 at its edge and outside. */
export function pressHit(marker: number, center: number, zone: number = PRESS.zone): number {
  const off = Math.abs(marker - center);
  return off >= zone ? 0 : 1 - off / zone;
}

/** How close a mix (`mix`, 0–1 of the slider) is to the card's shade (`target`): 1 spot on, 0 a third or more off. */
export function mixScore(mix: number, target: number): number {
  return clamp01(1 - Math.abs(mix - target) * 3);
}

/** Fizz tabs' quality: the mix counts for a third, the tablets (each press's pressHit, missing ones 0) for the rest. */
export function pressQuality(mix: number, hits: readonly number[]): number {
  const pressed = hits.slice(0, PRESS.tablets).reduce((s, v) => s + clamp01(v), 0) / PRESS.tablets;
  return clamp01(mix / 3 + (pressed * 2) / 3);
}

/** The drops: three rounds, each a longer sequence to repeat, from these three bottles. */
export const DROPS = { rounds: [3, 4, 5] as const, bottles: ['stardust', 'moon-syrup', 'gloop'] as const } as const;

/** A sequence of `n` drops (indexes into DROPS.bottles), from `rnd` (0–1). */
export function dropSequence(n: number, rnd: () => number = Math.random): number[] {
  return Array.from({ length: n }, () => Math.min(DROPS.bottles.length - 1, Math.floor(rnd() * DROPS.bottles.length)));
}

/** Nebula's quality: the share of all the drops (over every round) put in right, before each round's first mistake. */
export function dropsQuality(rightPerRound: readonly number[]): number {
  const total = DROPS.rounds.reduce((s, n) => s + n, 0);
  const right = DROPS.rounds.reduce((s, n, i) => s + Math.min(n, Math.max(0, Math.floor(rightPerRound[i] ?? 0))), 0);
  return clamp01(right / total);
}
