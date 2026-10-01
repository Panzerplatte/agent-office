import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FLOOR } from '../shared/layout.js';
import { catDefaults, cleanCatName, type CatAct, type CatState } from '../shared/cat.js';
import { dogAt, legSeconds } from '../shared/dog.js';
import { nearestWalkable, route, walkable, type Pt } from '../shared/nav.js';
import type { PeerInfo } from '../shared/protocol.js';

// ---- Its day ------------------------------------------------------------------------------------

/** Cosy spots it likes: round the lounge rug, by the bean bags, the warm corner by the kitchen. */
const COSY: Pt[] = [
  [15.2, 0.4],
  [11.6, 0.2],
  [13, 2.2],
  [13.6, -2.4],
  [-12.5, 10.8],
  [-15.5, 10.6],
];

const STROLL = 0.9;
const DASH = 2.6;
/** How long a pat lasts, purring and all. */
const PET_MS = 3400;
/** It keeps this far from the dog when it picks somewhere to settle. */
const DOG_ROOM = 2;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toward = (from: Pt, to: Pt) => Math.atan2(to[0] - from[0], to[1] - from[1]);

type Mode = 'nap' | 'loaf' | 'groom' | 'stroll' | 'visit' | 'pet';

export interface CatEnv {
  /** Everyone on this floor, where they stand now. */
  people(): PeerInfo[];
  /** Where the floor's dog is now, to keep out of its way. */
  dog(): Pt | undefined;
  /** To everyone on this floor. */
  send(cat: CatState): void;
}

type Leg = Omit<CatState, 'name' | 'coat' | 'elapsed'> & { start: number };

/**
 * A floor's cat. It mostly naps, loafs and washes itself on the lounge rug or wherever it likes,
 * strolls about now and then, and sometimes wanders over to sit by someone. Pet it and it purrs (the
 * browsers do the purring; see client/world/cat.ts). It keeps out of the dog's way. Its name is kept
 * in the floor's .agent-office/cat.json.
 */
export class Cat {
  private name: string;
  private readonly coat: number;
  private readonly fallbackName: string;
  private readonly file: string;
  private leg: Leg;
  private mode: Mode = 'nap';
  private timer?: NodeJS.Timeout;
  private lastPet = 0;
  private stopped = false;

  constructor(
    readonly floorId: string,
    dataDir: string,
    private env: CatEnv,
  ) {
    const d = catDefaults(floorId);
    this.fallbackName = d.name;
    this.coat = d.coat;
    this.file = path.join(dataDir, 'cat.json');
    this.name = this.load() ?? d.name;
    // Curled up somewhere cosy when the office opens.
    const spot = nearestWalkable(pick(COSY));
    this.leg = { path: [spot], speed: 0, act: 'nap', face: rand(-Math.PI, Math.PI), start: Date.now() - 60_000 };
    this.wake(rand(15_000, 40_000));
  }

  view(): CatState {
    const { start, ...leg } = this.leg;
    return { name: this.name, coat: this.coat, ...leg, elapsed: Date.now() - start };
  }

  /** Where it is right now. */
  here(): Pt {
    const p = dogAt(this.leg, (Date.now() - this.leg.start) / 1000);
    return [p.x, p.z];
  }

  /** Which way it's facing right now. */
  private facing(): number {
    return dogAt(this.leg, (Date.now() - this.leg.start) / 1000).heading;
  }

  get catName(): string {
    return this.name;
  }

  /** Someone gave it a pat: it stops, turns to them and purrs for everyone to see. */
  pet(by: PeerInfo): boolean {
    if (by.floor !== this.floorId || by.y > 1) return false;
    const now = Date.now();
    if (now - this.lastPet < 400) return false;
    const at = this.here();
    if (Math.hypot(by.x - at[0], by.z - at[1]) > 3.5) return false;
    this.lastPet = now;
    this.mode = 'pet';
    this.go([at], 0, 'purr', { face: toward(at, [by.x, by.z]), petBy: by.name });
    // Mostly it settles down right there, content; now and then it's had enough and wanders off.
    this.wake(PET_MS, () => (Math.random() < 0.65 ? this.settle(Math.random() < 0.5 ? 'loaf' : 'groom', rand(15_000, 35_000)) : this.think()));
    return true;
  }

  /** Renames it ('' goes back to its first name). Answers with the name it has now. */
  rename(raw: string): string {
    this.name = cleanCatName(raw) || this.fallbackName;
    try {
      writeFileSync(this.file, JSON.stringify({ name: this.name }, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the cat's name: ${(err as Error).message}`);
    }
    this.send();
    return this.name;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private load(): string | undefined {
    if (!existsSync(this.file)) return undefined;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { name?: unknown };
      return typeof saved.name === 'string' ? cleanCatName(saved.name) || undefined : undefined;
    } catch {
      return undefined;
    }
  }

  private send() {
    this.env.send(this.view());
  }

  private wake(ms: number, fn: () => void = () => this.think()) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(fn, ms);
  }

  /** Starts a leg from where it is now. */
  private go(pathPts: Pt[], speed: number, act: CatAct, extra: Pick<CatState, 'face' | 'petBy'> = {}) {
    this.leg = { path: pathPts, speed, act, ...extra, start: Date.now() };
    this.send();
  }

  /** Walks to `to` and says how long that takes, in ms. */
  private walkTo(to: Pt, speed: number, act: CatAct, extra: Pick<CatState, 'face'> = {}): number {
    const from = this.here();
    this.go([from, ...route(from, to).slice(1)], speed, act, extra);
    return legSeconds(this.leg) * 1000;
  }

  /** Not on top of the dog. */
  private roomy(p: Pt): boolean {
    const dog = this.env.dog();
    return !dog || dist(p, dog) > DOG_ROOM;
  }

  /** Picks what to do next. */
  private think() {
    if (this.stopped) return;
    const was = this.mode;
    const people = this.env.people().filter((p) => p.y < 0.5);
    const options: [number, () => void][] = [
      [was === 'nap' ? 1 : 3, () => this.napSomewhere()],
      [2, () => this.settle(pick(['loaf', 'groom'] as const), rand(12_000, 30_000))],
      [was === 'stroll' ? 0.5 : 1.5, () => this.stroll()],
    ];
    if (people.length) options.push([was === 'visit' ? 0.3 : 1, () => this.visit(pick(people))]);
    let roll = Math.random() * options.reduce((n, [w]) => n + w, 0);
    for (const [w, fn] of options) {
      roll -= w;
      if (roll <= 0) return fn();
    }
    options[0][1]();
  }

  /** Stays where it is, loafing or washing, and has a stretch when it's done. */
  private settle(act: 'loaf' | 'groom', ms: number) {
    this.mode = act;
    const at = this.here();
    this.go([at], 0, act, { face: this.facing() });
    this.wake(ms, () => this.stretch());
  }

  /** Off to somewhere cosy for a long nap. */
  private napSomewhere() {
    this.mode = 'nap';
    const at = this.here();
    const spots = COSY.map(nearestWalkable).filter((p) => dist(p, at) > 1 && this.roomy(p));
    const spot = spots.length ? pick(spots) : at;
    const ms = this.walkTo(spot, STROLL, 'nap', { face: rand(-Math.PI, Math.PI) });
    this.wake(ms + rand(40_000, 90_000), () => this.stretch());
  }

  /** A good long stretch on getting up, then on with its day. */
  private stretch() {
    if (this.stopped) return;
    this.go([this.here()], 0, 'stretch', { face: this.facing() });
    this.wake(rand(1800, 2600));
  }

  private stroll() {
    this.mode = 'stroll';
    const at = this.here();
    let spot: Pt = at;
    for (let i = 0; i < 30; i++) {
      const p: Pt = [rand(FLOOR.minX + 1, FLOOR.maxX - 1), rand(FLOOR.minZ + 1, FLOOR.maxZ - 1)];
      if (walkable(p[0], p[1]) && dist(p, at) > 3 && this.roomy(p)) {
        spot = p;
        break;
      }
    }
    // Now and then it bolts across the room for no reason at all.
    const ms = this.walkTo(spot, Math.random() < 0.15 ? DASH : STROLL, 'sit');
    this.wake(ms + rand(5000, 12_000));
  }

  /** Wanders over and sits near someone, looking up at them. */
  private visit(p: PeerInfo) {
    this.mode = 'visit';
    const person: Pt = [p.x, p.z];
    const side = Math.random() < 0.5 ? 1 : -1;
    const spot = nearestWalkable([p.x + Math.sin(p.rotY + side * 1.2) * 0.9, p.z + Math.cos(p.rotY + side * 1.2) * 0.9]);
    const ms = this.walkTo(spot, STROLL, 'sit', { face: toward(spot, person) });
    this.wake(ms + rand(6000, 14_000));
  }
}
