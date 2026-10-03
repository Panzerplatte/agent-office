// The rooftop bar: the roof of the building, over its top floor. Nobody works up there. There's a DJ
// playing drum and bass under a rig of lights, a bar to drink at, and the city all around. The
// elevator goes up there from every floor. Shared by the server (who's up there, what they're
// holding) and the client (which builds it and plays the music).

/**
 * Where you are while you're on the roof (a peer's `floor`, and `floor.go`'s). It can never be a
 * project floor's id, which is only ever lowercase letters, digits and dashes.
 */
export const ROOF = '@roof';
export const ROOF_NAME = 'Rooftop bar';

/** What a drink comes in: a pint, a wine glass, a martini glass, a tall glass or a shot glass. */
export type Glass = 'pint' | 'wine' | 'martini' | 'highball' | 'shot';

export type DrinkId = 'beer' | 'wine' | 'martini' | 'maitai' | 'shot' | 'mojito' | 'water' | 'croupier' | 'highroller';

export interface Drink {
  id: DrinkId;
  name: string;
  emoji: string;
  /** What the menu says about it. */
  blurb: string;
  /**
   * How much it goes to your head. About 0.3 a drink is tipsy for half a minute or so; they add up,
   * and past BOOZE_LIMIT the bartender pours you a water instead. Water takes some of it away again.
   */
  strength: number;
  /** The drink in the glass. */
  color: string;
  glass: Glass;
  /** Only poured at the casino's bar, down in the basement (see shared/casino.ts). */
  casino?: true;
}

export const DRINKS: readonly Drink[] = [
  { id: 'beer', name: 'Lager', emoji: '🍺', blurb: 'Cold, from the tap', strength: 0.28, color: '#f2b134', glass: 'pint' },
  { id: 'wine', name: 'Red wine', emoji: '🍷', blurb: 'A generous pour', strength: 0.34, color: '#8e1c3c', glass: 'wine' },
  { id: 'martini', name: 'Martini', emoji: '🍸', blurb: 'Shaken, with an olive', strength: 0.45, color: '#e6f0c8', glass: 'martini' },
  { id: 'maitai', name: 'Mai tai', emoji: '🍹', blurb: 'Rum, lime, a little umbrella', strength: 0.45, color: '#ff8c42', glass: 'highball' },
  { id: 'shot', name: 'Tequila shot', emoji: '🥃', blurb: 'Salt, shot, lime. Careful', strength: 0.6, color: '#f7d488', glass: 'shot' },
  { id: 'mojito', name: 'Virgin mojito', emoji: '🍃', blurb: 'All of the mint, none of the rum', strength: 0, color: '#b7e4a0', glass: 'highball' },
  { id: 'water', name: 'Water', emoji: '💧', blurb: 'Clears your head a little', strength: -0.3, color: '#d6f1ff', glass: 'highball' },
  // The casino's own, on its bar's menu under the roof's.
  { id: 'croupier', name: "Croupier's Special", emoji: '🎰', blurb: 'Cherry, rum and a splash of luck. On the house', strength: 0.38, color: '#d62839', glass: 'martini', casino: true },
  { id: 'highroller', name: 'High roller', emoji: '🥂', blurb: 'Champagne, for when the chips are up', strength: 0.32, color: '#f3e5ab', glass: 'wine', casino: true },
];

export const DRINK_BY_ID = new Map(DRINKS.map((d) => [d.id, d]));

export function isDrink(v: unknown): v is DrinkId {
  return typeof v === 'string' && DRINK_BY_ID.has(v as DrinkId);
}

/**
 * The drink someone may hold where they are, or undefined: the bars are on the roof and in the
 * casino (`casino` says it's that one, which pours its own few too). Anywhere else it's put down.
 */
export function drinkAt(v: unknown, at: { roof: boolean; casino: boolean }): DrinkId | undefined {
  if (!isDrink(v) || !(at.roof || at.casino)) return undefined;
  return DRINK_BY_ID.get(v)!.casino && !at.casino ? undefined : v;
}

/** How drunk you can get: past this the bartender cuts you off and pours you a water. */
export const BOOZE_LIMIT = 1.6;
