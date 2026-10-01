import * as THREE from 'three';
import { DART_COLORS, type Dart, type DartsGame, type DartsSeat, type DartsState } from '../../shared/darts';
import { DARTBOARD, FLOOR } from '../../shared/layout';
import { BOARD, type DartboardView, type ShownTurn } from './dartboard';
import { toonUnique } from './toon';

// The darts on a floor's board, as everyone there sees them: each one the office says was thrown
// flies in a short arc from where its player stands at the oche, sticks where it landed in their
// colour, and comes out again a moment after the turn's over, the way they get pulled out.

// ---- Where players stand ----------------------------------------------------------------------------

/** Where each colour's player stands along the oche (meters along it from the middle), so nobody stands on anyone. */
const SPOTS = [-0.28, 0.28, -0.84, 0.84];
/** How far back from the throw line you stand: your toes are just behind it. */
const TOE_BACK = 0.18;
/** Where a dart leaves the hand: this high, this far out in front, and this far to the right. */
const HAND_UP = 1.62;
const HAND_OUT = 0.32;
const HAND_RIGHT = 0.16;

/** Where the player with `color` (one of DART_COLORS) stands at the oche, facing the board (`facing`: 0 is +z, turning toward +x). */
export function ocheSpot(color: string): { x: number; z: number; facing: number } {
  const i = Math.max(0, (DART_COLORS as readonly string[]).indexOf(color));
  const x = DARTBOARD.oche.x - TOE_BACK;
  const z = DARTBOARD.oche.z + SPOTS[i];
  return { x, z, facing: Math.atan2(DARTBOARD.x - x, DARTBOARD.z - z) };
}

/** Where the dart leaves the hand of the player with `color`, in the world. */
export function handAt(color: string, target = new THREE.Vector3()): THREE.Vector3 {
  const s = ocheSpot(color);
  const sin = Math.sin(s.facing);
  const cos = Math.cos(s.facing);
  return target.set(s.x + sin * HAND_OUT - cos * HAND_RIGHT, HAND_UP, s.z + cos * HAND_OUT + sin * HAND_RIGHT);
}

// ---- Throwing ---------------------------------------------------------------------------------------

/** The meter's sweet spot (0–1): let go of Space with the meter here and the dart goes where you aimed. */
export const SWEET = 0.72;
/** Too hard and the dart flies high, too soft and it drops: this many meters for the whole meter off the sweet spot. */
const POWER_DROP = 0.2;
/** And it scatters, this much (one standard deviation, meters) at the sweet spot, plus this much per whole meter off it. */
const SCATTER = 0.0045;
const SCATTER_OFF = 0.06;

/**
 * Where a dart aimed at board-local `aim` lands, let go with the meter at `power`: high or low by how
 * far off the sweet spot that is, and scattered a little more the further off it, and a little anyway.
 */
export function landing(aim: { x: number; y: number }, power: number, rand = Math.random): { x: number; y: number } {
  const off = power - SWEET;
  const spread = SCATTER + Math.abs(off) * SCATTER_OFF;
  // Two normally distributed numbers (Box–Muller).
  const r = Math.sqrt(-2 * Math.log(1 - rand()));
  const a = 2 * Math.PI * rand();
  return { x: aim.x + r * Math.cos(a) * spread, y: aim.y + off * POWER_DROP + r * Math.sin(a) * spread };
}

/** How far the aim sways (meters) at `amount` 1: a hand that's never quite still. */
const SWAY = 0.009;

/** Where the sway has taken the aim at `t` seconds, for a hand `amount` (0–1) unsteady: a slow, wandering figure-of-eight. */
export function sway(t: number, amount = 1): { x: number; y: number } {
  const a = SWAY * amount;
  return {
    x: a * (0.7 * Math.sin(t * 1.3) + 0.3 * Math.sin(t * 3.1 + 1.7)),
    y: a * (0.7 * Math.sin(t * 1.9 + 0.6) + 0.3 * Math.sin(t * 2.7 + 2.9)),
  };
}

// ---- What changed -----------------------------------------------------------------------------------

/** What happened on the board between two of the office's states of the game. */
export interface DartsNews {
  /** The darts thrown since, in order, and who threw them. */
  thrown: { dart: Dart; by: DartsSeat }[];
  /** The last of them ended the turn: went bust, won the game, or was the third. */
  turnOver: boolean;
  bust: boolean;
  won: boolean;
  /** The darts in the board came out without a turn ending: a new game, the game cleared, or its thrower left mid-turn. */
  cleared: boolean;
}

const NOTHING: DartsNews = { thrown: [], turnOver: false, bust: false, won: false, cleared: false };

/**
 * What changed between `prev` and `next` (each the floor's game, or null with none). Every dart is
 * its own message from the office, so there's at most one turn's worth of darts between them.
 */
export function dartsNews(prev: DartsGame | null, next: DartsGame | null): DartsNews {
  if (!next) return { ...NOTHING, cleared: !!prev };
  // A new game: there was none, or the last one was over.
  if (!prev || (prev.over && !next.over)) return { ...NOTHING, cleared: true };
  const up = prev.players[prev.up];
  if (!up) return NOTHING;
  const last = next.turns.at(-1);
  const ended = next.turns.length !== prev.turns.length || JSON.stringify(last) !== JSON.stringify(prev.turns.at(-1));
  if (ended && last && last.player === up.id) {
    const thrown = last.darts.slice(prev.darts.length).map((dart) => ({ dart, by: up }));
    return { thrown, turnOver: true, bust: last.bust, won: next.winner === up.id, cleared: false };
  }
  if (next.players[next.up]?.id === up.id && next.darts.length > prev.darts.length) {
    return { ...NOTHING, thrown: next.darts.slice(prev.darts.length).map((dart) => ({ dart, by: up })) };
  }
  if (next.darts.length < prev.darts.length || next.players[next.up]?.id !== up.id) return { ...NOTHING, cleared: prev.darts.length > 0 };
  return NOTHING;
}

// ---- The darts --------------------------------------------------------------------------------------

/** A dart, in meters: the steel point, the tungsten barrel, the shaft and the flights. */
const TIP = 0.03;
const BARREL = 0.046;
const SHAFT = 0.036;
const FLIGHT = 0.036;
/** How far into the board the point goes. */
const SINK = 0.012;
/** How long a dart takes from the hand to the board (seconds), and how high its arc goes over the straight line. */
const FLY = 0.38;
const ARC = 0.13;
/** How long the darts stay in the board after a turn (ms), for everyone to see, before they're pulled out. */
export const PULL_AFTER = 1800;
/** Pulling them out: they come back this far, shrinking away, in this long (seconds). */
const PULL_BACK = 0.12;
const PULL_TIME = 0.35;

const steel = toonUnique('#d7dbe0');
const tungsten = toonUnique('#7b8089');
const shaftMat = toonUnique('#26262b');
// Too thin to outline: the outline would be thicker than the thing.
steel.userData.outlineParameters = { visible: false };
shaftMat.userData.outlineParameters = { visible: false };
const flightMats = new Map<string, THREE.Material>();
const geos = {
  tip: new THREE.ConeGeometry(0.0018, TIP, 6).rotateX(-Math.PI / 2).translate(0, 0, TIP / 2),
  barrel: new THREE.CylinderGeometry(0.0034, 0.0038, BARREL, 8).rotateX(Math.PI / 2).translate(0, 0, TIP + BARREL / 2),
  shaft: new THREE.CylinderGeometry(0.0022, 0.0022, SHAFT, 6).rotateX(Math.PI / 2).translate(0, 0, TIP + BARREL + SHAFT / 2),
  // Two fins crossed, from the back of the shaft: a kite shape, wider at the back.
  flight: (() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.017, 0.012);
    shape.lineTo(0.017, FLIGHT);
    shape.lineTo(-0.017, FLIGHT);
    shape.lineTo(-0.017, 0.012);
    shape.closePath();
    const one = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    one.translate(0, 0, TIP + BARREL + SHAFT - 0.012);
    return one;
  })(),
};

function flightMat(color: string): THREE.Material {
  let m = flightMats.get(color);
  if (!m) {
    const toon = toonUnique(color);
    toon.side = THREE.DoubleSide;
    flightMats.set(color, (m = toon));
  }
  return m;
}

/** Darts are drawn this much bigger than life, so you can make them out from across the room. */
const LOOKS = 1.35;

/** A dart in `color`, its point at the origin and its flights back along +z. */
export function buildDart(color: string): THREE.Group {
  const g = new THREE.Group();
  g.scale.setScalar(LOOKS);
  g.add(new THREE.Mesh(geos.tip, steel), new THREE.Mesh(geos.barrel, tungsten), new THREE.Mesh(geos.shaft, shaftMat));
  const fin = new THREE.Mesh(geos.flight, flightMat(color));
  const cross = fin.clone();
  cross.rotation.z = Math.PI / 2;
  g.add(fin, cross);
  for (const c of g.children) c.castShadow = true;
  return g;
}

/**
 * How far into the board's own frame a dart at (x, y) stops, its point just in whatever it hit: the
 * board, the back of the cabinet, a door's chalkboard, or the wall.
 */
function surfaceAt(x: number, y: number): number {
  if (Math.hypot(x, y) <= BOARD.radius) return 0;
  const { cabinet: cab } = DARTBOARD;
  const wall = -(FLOOR.maxX - DARTBOARD.x);
  const inside = Math.abs(y) < cab.height / 2;
  if (inside && Math.abs(x) > cab.width / 2 && Math.abs(x) < cab.width / 2 + cab.door) return wall + 0.04;
  return wall;
}

interface InBoard {
  obj: THREE.Group;
  dart: Dart;
  by: DartsSeat;
  /** In the board's own frame: where it left the hand, and where it lands. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Seconds into its flight; Infinity once it's in. */
  t: number;
  /** Whether this one ended the turn, and how. */
  end: { bust: boolean; won: boolean } | null;
}

const UNIT_Z = new THREE.Vector3(0, 0, -1);
const vel = new THREE.Vector3();
const world = new THREE.Vector3();

/**
 * The darts in the board: flying in from the oche, stuck in it, and pulled out after the turn. It
 * follows the office's state of the game (see follow), so everyone on the floor sees the same darts.
 */
export class BoardDarts {
  private darts: InBoard[] = [];
  private pulled: { obj: THREE.Group; t: number }[] = [];
  /** When (performance.now()) the darts in the board come out, once a turn's over; 0 with nothing to pull. */
  private pullAt = 0;
  /** The turn being thrown, or whose darts are in the board: the darts as far as they've landed. */
  shown: ShownTurn | null = null;
  /** A dart landed (in the world at `at`): the last of its turn carries how the turn ended. */
  onLand: ((dart: Dart, by: DartsSeat, at: THREE.Vector3, end: { bust: boolean; won: boolean } | null) => void) | null = null;
  /** What the board shows changed: a dart landed, or they came out. */
  onChange: (() => void) | null = null;

  constructor(private readonly board: DartboardView) {}

  /** Whether a finished turn's darts are still in the board, about to be pulled out. */
  get pulling(): boolean {
    return this.pullAt > 0;
  }

  /** Whether the board's still busy with the last darts: one in the air, or a finished turn's still in it. */
  get busy(): boolean {
    return this.pullAt > 0 || this.darts.some((d) => d.t < FLY);
  }

  /**
   * The office's new state of the game (`prev` the one before, on this floor). `fresh`: you just
   * arrived (or came back), so whatever's in the board is just there, not thrown. Says what changed.
   */
  follow(prev: DartsState | null, next: DartsState, fresh: boolean): DartsNews {
    const g = next.game;
    if (fresh) {
      this.clear(true);
      // A game that's over keeps its winning darts in the board.
      const turn = g && (g.darts.length ? { player: g.players[g.up]?.id ?? '', darts: g.darts, bust: false } : g.over ? g.turns.at(-1) : undefined);
      const by = turn && g.players.find((p) => p.id === turn.player);
      if (turn && by) {
        for (const dart of turn.darts) this.stick(dart, by);
        this.shown = { player: by.id, darts: [...turn.darts], bust: turn.bust, done: g.over || turn.bust };
      }
      this.onChange?.();
      return NOTHING;
    }
    const news = dartsNews(prev?.game ?? null, g);
    if (news.cleared) this.clear(false);
    if (news.thrown.length && this.pullAt) this.clear(false);
    // The scoreboard follows the darts, not the office: it's this turn's until they've landed and come out.
    const first = news.thrown[0];
    if (first && (this.shown?.player !== first.by.id || this.shown.done)) this.shown = { player: first.by.id, darts: [], bust: false, done: false };
    news.thrown.forEach(({ dart, by }, i) => {
      const last = i === news.thrown.length - 1 && news.turnOver;
      this.launch(dart, by, last ? { bust: news.bust, won: news.won } : null, i * 0.12);
    });
    if (news.cleared || first) this.onChange?.();
    return news;
  }

  /** Every frame: the darts on their way in, and the ones coming out. */
  update(dt: number) {
    for (const d of this.darts) {
      if (d.t === Infinity) continue;
      d.t += dt;
      if (d.t < 0) continue;
      d.obj.visible = true;
      if (d.t >= FLY) {
        this.land(d);
        continue;
      }
      const u = d.t / FLY;
      d.obj.position.lerpVectors(d.from, d.to, u);
      d.obj.position.y += ARC * 4 * u * (1 - u);
      // Point first along the way it's going: up, then over, then down into the board.
      vel.subVectors(d.to, d.from).normalize();
      vel.y += (ARC * 4 * (1 - 2 * u)) / d.from.distanceTo(d.to);
      d.obj.quaternion.setFromUnitVectors(UNIT_Z, vel.normalize());
    }
    if (this.pullAt && performance.now() >= this.pullAt && !this.darts.some((d) => d.t < FLY)) {
      this.clear(false);
      this.onChange?.();
    }
    for (const p of this.pulled) {
      p.t += dt;
      const u = Math.min(1, p.t / PULL_TIME);
      p.obj.position.z += (dt / PULL_TIME) * PULL_BACK;
      p.obj.scale.setScalar(LOOKS * (1 - u * u));
      if (u >= 1) this.board.group.remove(p.obj);
    }
    this.pulled = this.pulled.filter((p) => p.t < PULL_TIME);
  }

  /** One the office says was thrown: from `by`'s hand at the oche to where it landed, `delay` seconds from now. */
  private launch(dart: Dart, by: DartsSeat, end: InBoard['end'], delay: number) {
    const obj = buildDart(by.color);
    obj.visible = false;
    const from = this.board.group.worldToLocal(handAt(by.color));
    const to = new THREE.Vector3(dart.x, dart.y, surfaceAt(dart.x, dart.y) - SINK);
    const d: InBoard = { obj, dart, by, from, to, t: -delay, end };
    this.board.group.add(obj);
    this.darts.push(d);
  }

  /** Puts one straight in the board, no flight. */
  private stick(dart: Dart, by: DartsSeat) {
    const obj = buildDart(by.color);
    const to = new THREE.Vector3(dart.x, dart.y, surfaceAt(dart.x, dart.y) - SINK);
    const d: InBoard = { obj, dart, by, from: handAt(by.color), to, t: Infinity, end: null };
    this.board.group.worldToLocal(d.from);
    this.board.group.add(obj);
    this.darts.push(d);
    this.settle(d);
  }

  private land(d: InBoard) {
    d.t = Infinity;
    d.obj.visible = true;
    this.settle(d);
    if (this.shown?.player !== d.by.id || this.shown.done) this.shown = { player: d.by.id, darts: [], bust: false, done: false };
    this.shown.darts.push(d.dart);
    if (d.end) {
      this.shown.bust = d.end.bust;
      this.shown.done = true;
      // The winning darts stay in till the next game; any other turn's come out after a moment.
      if (!d.end.won) this.pullAt = performance.now() + PULL_AFTER;
    }
    this.onLand?.(d.dart, d.by, this.board.toWorld(d.to.x, d.to.y, d.to.z, world), d.end);
    this.onChange?.();
  }

  /** In the board where it landed, pointing the way it came in, a little off true, as darts sit. */
  private settle(d: InBoard) {
    d.obj.position.copy(d.to);
    vel.subVectors(d.to, d.from).normalize();
    vel.y -= 0.25;
    vel.x += (Math.random() - 0.5) * 0.12;
    d.obj.quaternion.setFromUnitVectors(UNIT_Z, vel.normalize());
  }

  /** Pulls out every dart in the board: slipping out, or (`now`) just gone. */
  private clear(now: boolean) {
    for (const d of this.darts) {
      if (now || d.t !== Infinity) this.board.group.remove(d.obj);
      else this.pulled.push({ obj: d.obj, t: 0 });
    }
    this.darts = [];
    this.pullAt = 0;
    this.shown = null;
  }
}
