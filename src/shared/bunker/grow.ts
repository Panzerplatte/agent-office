// The grow area along the west wall: a row of pots, each with soil, a seed of a strain, a lamp over
// it and water. A plant goes seedling → vegetative → flowering → ready, from a minute all told for the
// cheap strain to 25 for the premium one, as long as it has water (a dry plant wilts, loses quality and
// in the end dies), faster under a lamp; now and then it gets pests that want spraying. Harvested, it's raw weed (a loose unit of the
// strain's product) in your stash, ready for the packing table. It's a game: the strains are made up.
//
// The model is one pure step (growStep), run by the server's tick and by the page to count the timers
// down between the office's updates. Shared by the server (server/bunker/grow.ts) and the client
// (world/drugbunker/grow.ts, ui/bunker/grow.ts).
import { bunkerItem, itemsOf, type BunkerItem } from './items.js';

/** Pots everyone starts with, and the most the row along the wall holds (more are bought at the PC: the `pot` item). */
export const START_POTS = 4;
export const MAX_POTS = 8;

/** A plant's stages, in order. */
export const GROW_STAGES = ['seedling', 'vegetative', 'flowering', 'ready'] as const;
export type GrowStage = (typeof GROW_STAGES)[number];

/** How a strain grows: how long each of its first three stages takes (s, with no lamp of its own), and how much it gives. */
export interface Strain {
  /** Its seed (an item id). */
  seed: string;
  /** Seconds per stage with no lamp of its own (seedling, vegetative and flowering each take this long; a lamp makes it quicker). */
  stage: number;
  /** Grams harvested from a plant looked after perfectly. */
  grams: number;
}

/**
 * The strains (by their seeds), a ladder from seed to harvest with no lamp: a cheap one in a minute,
 * one in 5, one in 10, and the expensive endgame one in 25 minutes, each giving more (and dearer)
 * weed than the one before, so the longer the wait the more a pot earns a minute.
 */
export const STRAINS: Readonly<Record<string, Strain>> = {
  'seed-skunk': { seed: 'seed-skunk', stage: 20, grams: 5 },
  'seed-kush': { seed: 'seed-kush', stage: 100, grams: 16 },
  'seed-haze': { seed: 'seed-haze', stage: 200, grams: 26 },
  'seed-royal': { seed: 'seed-royal', stage: 500, grams: 60 },
};

/** The strain of a seed, or undefined for anything that isn't one. */
export function strainOf(seed: unknown): Strain | undefined {
  return typeof seed === 'string' && Object.hasOwn(STRAINS, seed) ? STRAINS[seed] : undefined;
}

/** How fast a plant grows under each light: the room's tubes (no lamp of its own), a grow lamp, an LED panel; and the quality a better light adds at harvest. */
export const LIGHTS: Readonly<Record<string, { speed: number; bonus: number }>> = {
  none: { speed: 1, bonus: 0 },
  lamp: { speed: 1.6, bonus: 0 },
  'lamp-led': { speed: 2.5, bonus: 0.1 },
};

/** How good a plant starts out in each soil (its `care`, 0–1). */
export const SOILS: Readonly<Record<string, number>> = { soil: 0.65, 'soil-premium': 0.85 };

/** How long a full pot of water lasts while the plant grows (s): a new plant's half a pot sees the cheap strain through, the premium one wants it a few times. */
export const WATER_LASTS = 480;
/** Below this much water the plant's thirsty (the panel says so). */
export const THIRSTY = 0.25;
/** How much care a dry plant loses a second, and how long dry it lasts before it dies (s). */
export const WILT_RATE = 0.15 / 60;
export const DIES_AFTER = 240;
/** The chance a growing plant gets pests, per second (about once in 20 minutes: rare on the quick strains, likely on the premium one), how much care they eat a second, and how they slow it. */
export const PEST_RATE = 1 / 1200;
export const PEST_DAMAGE = 0.1 / 60;
export const PEST_SLOW = 0.5;
/** The longest step the model takes at once (s): longer ones are cut into these. */
export const MAX_STEP = 10;

/** A plant in a pot. */
export interface Plant {
  /** Its seed (a STRAINS key). */
  seed: string;
  /** How far grown, 0–3: each whole number is a stage done; 3 is ready. */
  growth: number;
  /** Water in the pot, 0–1. */
  water: number;
  /** How well it's been looked after, 0–1: the quality it'll have. */
  care: number;
  /** How long it's been dry (s), 0 while it has water. */
  dry: number;
  /** It has pests (spray them). */
  pests?: boolean;
  /** It died (dry for too long): clear the pot. */
  dead?: boolean;
}

/** A pot: its soil (an item id), the lamp over it (an item id), and what grows in it. */
export interface Pot {
  soil?: string;
  lamp?: string;
  plant?: Plant;
}

/** What the grow feature keeps for each person (BunkerPerson.grow, saved in bunker.json). */
export interface GrowState {
  pots: Pot[];
  /** When the plants were last brought up to date (the office's clock, ms). */
  at: number;
}

export function initialGrow(): GrowState {
  return { pots: Array.from({ length: START_POTS }, () => ({})), at: 0 };
}

/** What stage a plant's at. */
export function stageOf(plant: Plant): GrowStage {
  return GROW_STAGES[Math.min(3, Math.max(0, Math.floor(plant.growth)))];
}

/** How fast a plant in `pot` grows (stages a second), as it is now: 0 for one that's dry, dead or done. */
export function growRate(pot: Pot): number {
  const p = pot.plant;
  const strain = strainOf(p?.seed);
  if (!p || !strain || p.dead || p.growth >= 3 || p.water <= 0) return 0;
  return (lightOf(pot).speed * (p.pests ? PEST_SLOW : 1)) / strain.stage;
}

/** The light over a pot. */
export function lightOf(pot: Pot): { speed: number; bonus: number } {
  return pot.lamp && Object.hasOwn(LIGHTS, pot.lamp) ? LIGHTS[pot.lamp] : LIGHTS.none;
}

/** Seconds until the plant in `pot` is ready, if it goes on like this (Infinity when it's not growing; 0 when it's ready). */
export function secondsLeft(pot: Pot): number {
  const p = pot.plant;
  if (!p || p.dead) return Infinity;
  if (p.growth >= 3) return 0;
  const rate = growRate(pot);
  return rate > 0 ? (3 - p.growth) / rate : Infinity;
}

/** What happened to a plant in a step (for the toasts). */
export type GrowNews = 'ready' | 'thirsty' | 'dry' | 'pests' | 'died';

/**
 * Lets `secs` seconds pass for the plant in `pot` (changed in place). `roll()` is a random number
 * 0–1 for the pests (the page passes none: it never guesses them). What happened, if anything.
 */
export function growStep(pot: Pot, secs: number, roll?: () => number): GrowNews[] {
  const news: GrowNews[] = [];
  const p = pot.plant;
  if (!p || p.dead || !(secs > 0)) return news;
  for (let left = secs; left > 1e-9; ) {
    const dt = Math.min(left, MAX_STEP);
    left -= dt;
    if (p.growth >= 3) break; // A ready plant waits to be harvested (it's had all it needs).
    const wasThirsty = p.water < THIRSTY;
    const wasDry = p.water <= 0;
    const rate = growRate(pot);
    if (p.water > 0) {
      // It drinks as it grows; the water runs out partway through the step, maybe.
      const wet = Math.min(dt, p.water * WATER_LASTS);
      p.growth = Math.min(3, p.growth + rate * wet);
      p.water = Math.max(0, p.water - dt / WATER_LASTS);
      if (p.water <= 0) p.dry += dt - wet;
    } else {
      p.dry += dt;
    }
    if (p.dry > 0) p.care -= WILT_RATE * Math.min(dt, p.dry);
    if (p.pests) p.care -= PEST_DAMAGE * dt;
    else if (roll && p.growth < 3 && roll() < PEST_RATE * dt) {
      p.pests = true;
      news.push('pests');
    }
    p.care = Math.max(0, p.care);
    if (p.dry >= DIES_AFTER) {
      p.dead = true;
      delete p.pests;
      news.push('died');
      break;
    }
    if (p.growth >= 3) news.push('ready');
    if (!wasDry && p.water <= 0) news.push('dry');
    else if (!wasThirsty && p.water < THIRSTY) news.push('thirsty');
  }
  return news;
}

/** What harvesting the (ready) plant in `pot` gives: its product, how many grams and how good. */
export function harvestOf(pot: Pot): { product: string; grams: number; quality: number } | null {
  const p = pot.plant;
  const strain = strainOf(p?.seed);
  const product = bunkerItem(p?.seed)?.grows;
  if (!p || !strain || !product || p.dead || p.growth < 3) return null;
  const quality = Math.min(1, Math.max(0, p.care + lightOf(pot).bonus));
  // A well-kept plant gives all of it, a neglected one down to half.
  const grams = Math.round(strain.grams * (0.5 + 0.5 * quality) * 10) / 10;
  return { product, grams, quality: Math.round(quality * 100) / 100 };
}

/** The items the grow area takes from your inventory, by what they're for. */
export function growItems(): { seeds: BunkerItem[]; soils: BunkerItem[]; lamps: BunkerItem[] } {
  return {
    seeds: itemsOf('seed').filter((i) => strainOf(i.id)),
    soils: itemsOf('soil').filter((i) => Object.hasOwn(SOILS, i.id)),
    lamps: itemsOf('lamp').filter((i) => Object.hasOwn(LIGHTS, i.id)),
  };
}

const num = (v: unknown, lo: number, hi: number, or: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : or);

/** A grow section as saved (anything at all), made safe. */
export function loadGrow(raw: unknown): GrowState {
  const out = initialGrow();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.at = num(r.at, 0, Number.MAX_SAFE_INTEGER, 0);
  if (!Array.isArray(r.pots)) return out;
  out.pots = r.pots.slice(0, MAX_POTS).map((rp): Pot => {
    const pot: Pot = {};
    if (!rp || typeof rp !== 'object') return pot;
    const { soil, lamp, plant } = rp as Record<string, unknown>;
    if (typeof soil === 'string' && Object.hasOwn(SOILS, soil)) pot.soil = soil;
    if (typeof lamp === 'string' && lamp !== 'none' && Object.hasOwn(LIGHTS, lamp)) pot.lamp = lamp;
    if (plant && typeof plant === 'object' && pot.soil) {
      const p = plant as Record<string, unknown>;
      if (strainOf(p.seed)) {
        pot.plant = { seed: p.seed as string, growth: num(p.growth, 0, 3, 0), water: num(p.water, 0, 1, 0), care: num(p.care, 0, 1, 0), dry: num(p.dry, 0, DIES_AFTER, 0) };
        if (p.pests === true) pot.plant.pests = true;
        if (p.dead === true) pot.plant.dead = true;
      }
    }
    return pot;
  });
  while (out.pots.length < START_POTS) out.pots.push({});
  return out;
}
