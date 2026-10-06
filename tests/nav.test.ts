import test from 'node:test';
import assert from 'node:assert/strict';
import { BALCONY, BALCONY_DOOR, BOARDS, DARTBOARD, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, EXIT_STAIRS, FLOOR, JUKEBOX, MEETING_ROOM, MEETING_SEATS, PARACHUTE, POOL_TABLE, ROAD, SEATS, SNAKE_CABINET, STATIONS, TV, WINDOWS } from '../src/shared/layout.js';
import { walkable, wayHome, wayIn, wayToBalcony, type Pt } from '../src/shared/nav.js';

test('a worker sent home walks round the furniture, out the exit door and off along the sidewalk', () => {
  for (const seat of [...SEATS, ...STATIONS, ...MEETING_SEATS]) {
    const way = wayHome(seat);
    // It hops down right beside where it sat.
    assert.ok(Math.hypot(way[0][0] - seat.x, way[0][1] - seat.z) < 1.2, `${seat.id} hops down beside its seat`);
    const out = way.findIndex(([x]) => x < FLOOR.minX);
    assert.ok(out > 1, `${seat.id} leaves by the exit`);
    // From the aisle to the door, every step is on open floor.
    for (let i = 2; i < out; i++) {
      const [x0, z0] = way[i - 1];
      const [x1, z1] = way[i];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        assert.ok(walkable(x, z), `${seat.id} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    // Through the doorway, not the wall beside it.
    for (const [, z] of [way[out - 1], way[out]]) assert.ok(Math.abs(z - EXIT_DOOR.u) < EXIT_DOOR.width / 2 - 0.2, `${seat.id} goes through the door`);
    // Down the steps outside, then away along the sidewalk.
    assert.ok(way.slice(out).every(([x, z]) => x < EXIT_STAIRS.minX + 1 || z > ROAD.minZ - 2.1), `${seat.id} stays off the building`);
    const [ex, ez] = way[way.length - 1];
    assert.ok(ez > ROAD.minZ - 2 && ez < ROAD.minZ && ex < EXIT_STAIRS.minX - 10, `${seat.id} ends up down the sidewalk`);
  }
});

/** Every step from a to b is on open floor. */
function clear(a: Pt, b: Pt, what: string) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2);
  for (let k = 0; k <= n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n;
    const z = a[1] + ((b[1] - a[1]) * k) / n;
    assert.ok(walkable(x, z), `${what} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
}

test('a worker called to a meeting walks from the elevator, in through the meeting room door, to beside its chair', () => {
  for (const seat of MEETING_SEATS) {
    const way = wayIn(seat);
    const [x0, z0] = way[0];
    assert.ok(Math.abs(x0 - ELEVATOR.x) < 0.6 && z0 > ELEVATOR_FRONT && z0 < ELEVATOR_FRONT + 1.2, `${seat.id} steps out of the elevator`);
    // It ends beside its chair, and gets there on open floor.
    const [ex, ez] = way[way.length - 1];
    assert.ok(Math.hypot(ex - seat.x, ez - seat.z) < 1.3, `${seat.id} ends beside its chair`);
    for (let i = 1; i < way.length - 1; i++) clear(way[i - 1], way[i], seat.id);
    // Into the room through its doorway, not the glass.
    const crossing = way.findIndex(([, z], i) => i > 0 && way[i - 1][1] < MEETING_ROOM.minZ && z >= MEETING_ROOM.minZ);
    assert.ok(crossing > 0, `${seat.id} goes into the room`);
    const [[ax, az], [bx, bz]] = [way[crossing - 1], way[crossing]];
    const x = ax + ((bx - ax) * (MEETING_ROOM.minZ - az)) / (bz - az);
    assert.ok(x > MEETING_ROOM.door.x0 && x < MEETING_ROOM.door.x1, `${seat.id} goes in by the door (x ${x.toFixed(2)})`);
  }
});

test('upstairs, with no exit door, a worker sent home walks out onto the balcony to the railing', () => {
  for (const seat of [...SEATS, ...STATIONS, ...MEETING_SEATS]) {
    const way = wayToBalcony(seat);
    assert.ok(Math.hypot(way[0][0] - seat.x, way[0][1] - seat.z) < 1.2, `${seat.id} hops down beside its seat`);
    const out = way.findIndex(([, z]) => z > FLOOR.maxZ);
    assert.ok(out > 1, `${seat.id} goes out onto the balcony`);
    for (let i = 2; i < out; i++) {
      const [x0, z0] = way[i - 1];
      const [x1, z1] = way[i];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        assert.ok(walkable(x, z), `${seat.id} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    // Through the balcony doors, then straight across to the railing.
    for (const [x] of way.slice(out - 1)) assert.ok(Math.abs(x - BALCONY_DOOR.u) < BALCONY_DOOR.width / 2 - 0.3, `${seat.id} goes through the balcony doors`);
    const [jx, jz] = way[way.length - 1];
    assert.deepEqual([jx, jz], [PARACHUTE.jump.x, PARACHUTE.jump.z]);
    assert.ok(jz < BALCONY.maxZ && jz > BALCONY.maxZ - 0.6, `${seat.id} ends up at the railing`);
  }
});

test('the dartboard hangs at regulation height between the Services board and the TV, with its lane kept clear', () => {
  assert.equal(DARTBOARD.y, 1.73);
  assert.ok(Math.abs(DARTBOARD.x - DARTBOARD.oche.x - 2.37) < 1e-9, 'the oche is 2.37 m from the face');
  // On the wall, clear of the Services board and the TV (with their frames) either side of it.
  const half = DARTBOARD.cabinet.width / 2 + DARTBOARD.cabinet.door;
  const services = BOARDS.services;
  assert.ok(DARTBOARD.z - half > services.z + (services.width + 0.3) / 2, 'clear of the Services board');
  assert.ok(DARTBOARD.z + half < TV.z - (TV.width + 0.3) / 2, 'clear of the TV');
  // The dog keeps out of the lane, but you can walk up to the oche and stand behind it to throw.
  for (let x = DARTBOARD.oche.x + 0.3; x < FLOOR.maxX; x += 0.1) assert.ok(!walkable(x, DARTBOARD.z), `the lane at x ${x.toFixed(2)} is kept clear`);
  assert.ok(walkable(DARTBOARD.oche.x - 0.3, DARTBOARD.oche.z), 'you can stand at the oche');
});

test('the Snake machine stands against the east wall between the TV and the jukebox, with room to play it', () => {
  const half = SNAKE_CABINET.width / 2 + 0.13;
  assert.ok(SNAKE_CABINET.z - half > TV.z + (TV.width + 0.3) / 2, 'clear of the TV');
  assert.ok(SNAKE_CABINET.z + half < JUKEBOX.z - JUKEBOX.width / 2 - 0.05, 'clear of the jukebox');
  assert.ok(!walkable(SNAKE_CABINET.x, SNAKE_CABINET.z), 'nobody walks through it');
  // The floor in front of it, where you stand to play and others watch over your shoulder, is open.
  for (const dz of [-0.4, 0, 0.4]) assert.ok(walkable(SNAKE_CABINET.x - 1, SNAKE_CABINET.z + dz), `you can stand in front of it at ${dz}`);
});

test('the pool table stands out on open floor, with room to cue from every side', () => {
  const pool = POOL_TABLE;
  assert.ok(pool.y >= 0.74 && pool.y <= 0.8, 'the cloth is at table height');
  assert.ok(pool.outer.length > pool.length && pool.outer.width > pool.width, 'the rails go round the cloth');
  // Its frame, in the room's axes.
  const along = Math.abs(Math.cos(pool.rotY));
  const across = Math.abs(Math.sin(pool.rotY));
  const hx = (along * pool.outer.length + across * pool.outer.width) / 2;
  const hz = (across * pool.outer.length + along * pool.outer.width) / 2;
  assert.ok(!walkable(pool.x, pool.z), 'nobody walks through the table');
  // Everywhere round it, from just off the frame (past how far the dog keeps from it) out to `clear`,
  // is open floor: no desk, chair, bean bag, plant or wall is near enough to get in the way of a cue.
  assert.ok(pool.clear >= 1.5, 'a cue (1.47 m) fits behind the cue ball from any rail');
  assert.ok(pool.x - hx - pool.clear > FLOOR.minX && pool.x + hx + pool.clear < FLOOR.maxX, 'clear of the east and west walls');
  assert.ok(pool.z - hz - pool.clear > FLOOR.minZ && pool.z + hz + pool.clear < FLOOR.maxZ, 'clear of the north and south walls');
  for (let x = pool.x - hx - pool.clear; x <= pool.x + hx + pool.clear + 1e-9; x += 0.05) {
    for (let z = pool.z - hz - pool.clear; z <= pool.z + hz + pool.clear + 1e-9; z += 0.05) {
      const out = Math.max(Math.abs(x - pool.x) - hx, Math.abs(z - pool.z) - hz);
      if (out < 0.6) continue;
      assert.ok(walkable(x, z), `the floor round the table is open at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
  // The cue rack hangs on the south wall between the balcony doors and the next window, clear of both.
  const r0 = pool.rack.x - pool.rack.width / 2;
  const r1 = pool.rack.x + pool.rack.width / 2;
  for (const o of [BALCONY_DOOR, ...WINDOWS.filter((w) => w.wall === 'south')]) {
    assert.ok(r1 < o.u - o.width / 2 - 0.2 || r0 > o.u + o.width / 2 + 0.2, `the rack is clear of the opening at ${o.u}`);
  }
  // You can still walk up to it and to the balcony doors past the table.
  assert.ok(walkable(pool.rack.x, FLOOR.maxZ - pool.rack.depth - 0.5), 'you can walk up to the cue rack');
});
