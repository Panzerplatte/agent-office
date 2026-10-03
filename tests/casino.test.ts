import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLACKJACK_TABLE,
  CASHIER,
  CASINO,
  CASINO_ELEVATOR,
  CASINO_ROOM,
  CASINO_SEATING,
  POKER_TABLE,
  RED_NUMBERS,
  ROULETTE_TABLE,
  SLOT_MACHINES,
  SLOT_SIZE,
  WHEEL_ORDER,
  casinoFootprints,
  casinoSpotOf,
  casinoWalkable,
  rouletteColor,
  tableToWorld,
  worldToTable,
} from '../src/shared/casino.js';
import { ELEVATOR, ELEVATOR_CAR, ELEVATOR_FRONT, FLOOR, SEATING, SEATING_BY_ID, seatHere, seatPlace } from '../src/shared/layout.js';
import { ROOF } from '../src/shared/rooftop.js';

test("the casino is the office floor's size, with the elevator in its usual spot, and never a project floor's id", () => {
  assert.deepEqual({ minX: CASINO_ROOM.minX, maxX: CASINO_ROOM.maxX, minZ: CASINO_ROOM.minZ, maxZ: CASINO_ROOM.maxZ }, FLOOR);
  assert.equal(CASINO_ELEVATOR.x, ELEVATOR.x);
  assert.equal(CASINO_ELEVATOR.width, ELEVATOR.width);
  assert.equal(CASINO_ELEVATOR.door, ELEVATOR.doorWidth);
  assert.equal(CASINO_ELEVATOR.front, ELEVATOR_FRONT);
  assert.ok(!/^[a-z0-9-]+$/.test(CASINO), 'a floor id is lowercase letters, digits and dashes');
  assert.notEqual(CASINO, ROOF);
});

test('the wheel has every number from 0 to 36 once, in the single-zero order, red and black taking turns', () => {
  assert.equal(WHEEL_ORDER.length, 37);
  assert.deepEqual([...WHEEL_ORDER].sort((a, b) => a - b), Array.from({ length: 37 }, (_, i) => i));
  assert.equal(WHEEL_ORDER[0], 0);
  // Either side of the zero: 32 and 26, as on every European wheel.
  assert.equal(WHEEL_ORDER[1], 32);
  assert.equal(WHEEL_ORDER[36], 26);
  assert.equal(RED_NUMBERS.size, 18);
  assert.equal(rouletteColor(0), 'green');
  for (let i = 1; i < 37; i++) {
    const c = rouletteColor(WHEEL_ORDER[i]);
    assert.equal(c, i % 2 ? 'red' : 'black', `${WHEEL_ORDER[i]} is ${c}`);
  }
  // On the layout: 1 is red, 2 black, 10 and 11 both black, 19 red.
  assert.deepEqual([1, 2, 10, 11, 19, 28, 29].map(rouletteColor), ['red', 'black', 'black', 'black', 'red', 'black', 'black']);
});

test('the tables have their places: six at poker, five at blackjack, six at roulette, and four to six slot machines', () => {
  assert.equal(POKER_TABLE.seats.length, 6);
  assert.equal(BLACKJACK_TABLE.seats.length, 5);
  assert.equal(ROULETTE_TABLE.seats.length, 6);
  assert.ok(SLOT_MACHINES.length >= 4 && SLOT_MACHINES.length <= 6);
  const play = (g: string) => CASINO_SEATING.filter((s) => s.play === g);
  assert.equal(play('poker').length, 6);
  assert.equal(play('blackjack').length, 5);
  assert.equal(play('roulette').length, 6);
  assert.equal(play('slots').length, SLOT_MACHINES.length);
  for (const g of ['poker', 'blackjack', 'roulette', 'slots']) assert.deepEqual(play(g).map((s) => s.spot), play(g).map((_, i) => i), `${g}'s spots go 0, 1, 2…`);
  assert.deepEqual(casinoSpotOf('poker-3:0'), { game: 'poker', spot: 2 });
  assert.deepEqual(casinoSpotOf('slots-1:0'), { game: 'slots', spot: 0 });
  assert.equal(casinoSpotOf('casino-sofa-1:0'), undefined);
  assert.equal(casinoSpotOf('couch:0'), undefined);
  assert.equal(casinoSpotOf(undefined), undefined);
});

test("a table's own frame turns with it, both ways", () => {
  const t = { x: 3, z: -2, rotY: 0.7 };
  for (const p of [
    { x: 0, z: 0 },
    { x: 1.2, z: -0.4 },
    { x: -0.3, z: 0.9 },
  ]) {
    const w = tableToWorld(t, p);
    const back = worldToTable(t, w);
    assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.z - p.z) < 1e-9);
  }
  // At rotY 0 it's the world's axes from the table's middle.
  assert.deepEqual(tableToWorld({ x: 1, z: 2, rotY: 0 }, { x: 0.5, z: -0.5 }), { x: 1.5, z: 1.5 });
});

test("the casino's seats are in SEATING with ids of their own, and only down in the casino", () => {
  const ids = SEATING.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'seat ids are unique');
  for (const s of CASINO_SEATING) {
    assert.equal(SEATING_BY_ID.get(s.id), s);
    assert.ok(s.casino && !s.roof, `${s.id} is the casino's`);
    assert.ok(seatHere(`${s.id}:0`, CASINO), `${s.id} from the casino`);
    assert.equal(seatHere(`${s.id}:0`, ROOF), undefined);
    assert.equal(seatHere(`${s.id}:0`, 'agent-office'), undefined);
  }
});

test('the furniture keeps off the walls, the elevator doors and itself', () => {
  const feet = casinoFootprints();
  for (const f of feet) {
    assert.ok(f.minX >= CASINO_ROOM.minX && f.maxX <= CASINO_ROOM.maxX && f.minZ >= CASINO_ROOM.minZ && f.maxZ <= CASINO_ROOM.maxZ, 'inside the room');
    // A clear landing in front of the elevator, two meters out and a meter either side of the doors.
    const clear = f.maxX < ELEVATOR.x - ELEVATOR.width / 2 - 1 || f.minX > ELEVATOR.x + ELEVATOR.width / 2 + 1 || f.minZ > ELEVATOR_FRONT + 2;
    assert.ok(clear, `something stands in front of the elevator at ${JSON.stringify(f)}`);
  }
  for (let i = 0; i < feet.length; i++) {
    for (let j = i + 1; j < feet.length; j++) {
      const a = feet[i];
      const b = feet[j];
      assert.ok(a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`);
    }
  }
});

/** Every spot on a 0.1 m grid you can walk to from the elevator car, keeping `r` off everything. */
function reachable(r: number): (x: number, z: number) => boolean {
  const step = 0.1;
  const nx = Math.round((CASINO_ROOM.maxX - CASINO_ROOM.minX) / step);
  const nz = Math.round((CASINO_ROOM.maxZ - CASINO_ROOM.minZ) / step);
  const seen = new Uint8Array(nx * nz);
  const at = (i: number, k: number) => [CASINO_ROOM.minX + i * step, CASINO_ROOM.minZ + k * step] as const;
  const start: [number, number] = [Math.round((ELEVATOR.x - CASINO_ROOM.minX) / step), Math.round(((ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2 - CASINO_ROOM.minZ) / step)];
  const queue = [start];
  seen[start[1] * nx + start[0]] = 1;
  while (queue.length) {
    const [i, k] = queue.pop()!;
    for (const [di, dk] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = i + di;
      const b = k + dk;
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen[b * nx + a]) continue;
      if (!casinoWalkable(...at(a, b), r)) continue;
      seen[b * nx + a] = 1;
      queue.push([a, b]);
    }
  }
  return (x, z) => {
    const i = Math.round((x - CASINO_ROOM.minX) / step);
    const k = Math.round((z - CASINO_ROOM.minZ) / step);
    // Near enough: any grid point within a step of it.
    for (const [di, dk] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (seen[(k + dk) * nx + i + di]) return true;
    return false;
  };
}

test('from the elevator you can walk to every seat, every slot machine and the cashier, and get up from each without getting stuck', () => {
  const canReach = reachable(0.3);
  for (const seat of CASINO_SEATING) {
    for (let i = 0; i < seat.places.length; i++) {
      const p = seatPlace(seat, i);
      // Where you step off to when you get up (see Player.sit): `out` in front of the place (behind it, negative).
      const ox = p.x + Math.sin(p.rotY) * p.out;
      const oz = p.z + Math.cos(p.rotY) * p.out;
      assert.ok(casinoWalkable(ox, oz), `${p.key}: getting up lands on open floor at (${ox.toFixed(2)}, ${oz.toFixed(2)})`);
      assert.ok(canReach(ox, oz), `${p.key}: you can walk there from the elevator`);
      assert.ok(!casinoFootprints().some((f) => p.x > f.minX && p.x < f.maxX && p.z > f.minZ && p.z < f.maxZ), `${p.key} isn't inside a table`);
    }
  }
  for (const m of SLOT_MACHINES) assert.ok(canReach(m.x + SLOT_SIZE.depth / 2 + 0.6, m.z), 'in front of each slot machine');
  assert.ok(canReach(CASHIER.x, CASHIER.front + 0.5), "the cashier's window");
});

test('the chairs at a table face it, and none sits on another', () => {
  for (const t of [POKER_TABLE, BLACKJACK_TABLE, ROULETTE_TABLE]) {
    for (const s of CASINO_SEATING.filter((x) => x.play === t.game)) {
      const toTable = Math.atan2(t.x - s.x, t.z - s.z);
      const off = Math.abs(Math.atan2(Math.sin(toTable - s.rotY), Math.cos(toTable - s.rotY)));
      assert.ok(off < Math.PI / 2.5, `${s.id} faces its table (off by ${off.toFixed(2)})`);
    }
  }
  const places = CASINO_SEATING.flatMap((s) => s.places.map((_, i) => seatPlace(s, i)));
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const d = Math.hypot(places[i].x - places[j].x, places[i].z - places[j].z);
      assert.ok(d > 0.55, `${places[i].key} and ${places[j].key} are ${d.toFixed(2)} m apart`);
    }
  }
});
