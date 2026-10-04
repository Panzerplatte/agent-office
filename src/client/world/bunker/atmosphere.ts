import type { BunkerContext, BunkerPart } from './index';

// The bunker's atmosphere: what it sounds and feels like, and how it comes and goes.
//  - Ambient sound: a low hum of ventilation, the odd drip or pipe knock (a small block in sound.ts,
//    played through ctx.deps.sound while the bunker's on; set(false) stops it).
//  - The switching transition: set(on) is called on every switch (and on arriving on a floor that's
//    a bunker): e.g. a quick lights-down/lights-up, a rumble. Respect prefers-reduced-motion.
//  - Light flicker: now and then a lamp flickers (scale ctx.deps.lights in update, which runs after
//    the sky has set them; shell.ts dims them first).
//  - Dust: motes drifting in the lamp light (a Points cloud in ctx.group).
// Not here: anything built to stay (shell.ts, furniture.ts, props.ts).

/**
 * The bunker's sound, transition, flicker and dust. For now: nothing.
 */
export function buildAtmosphere(_ctx: BunkerContext): BunkerPart {
  return { dispose() {} };
}
