import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STOREY, STREET_Y, ROAD, streetBelow } from '../src/shared/layout.js';
import { LOBBY, LOBBY_CAR, LOBBY_DOOR, LOBBY_ELEVATOR, LOBBY_WALL, directory, inLobby, inLobbyCar, lobbyBlocks, lobbyCarSpot, lobbyFloor, peopleInLobby, type LobbyBlock } from '../src/shared/lobby.js';

// A canvas that draws nothing: enough for the lobby's signs and directory to be built in Node (as in bunker.test.ts).
const noop = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop()),
    apply: () => undefined,
    set: () => true,
  });
const canvas = () => ({ width: 300, height: 150, style: {}, getContext: () => noop(), addEventListener() {}, toDataURL: () => '' });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas(), documentElement: { lang: 'en' }, fonts: { ready: new Promise(() => {}) } } });

const { buildLobby } = await import('../src/client/world/lobby.js');
const { buildGarage } = await import('../src/client/world/outside.js');

/** How far someone's middle stays from what's in the way (the player's half-width, about). */
const BODY = 0.3;
const STEP = 0.1;

/** Where someone can stand on the ground around and in the lobby, on a grid, with `blocks` in the way: flood-filled from `from`. */
function reachable(blocks: LobbyBlock[], from: { x: number; z: number }): (x: number, z: number) => boolean {
  const box = { minX: LOBBY.minX - 3, maxX: LOBBY.maxX + 3, minZ: LOBBY.minZ - 3, maxZ: LOBBY.maxZ + 3 };
  const nx = Math.round((box.maxX - box.minX) / STEP);
  const nz = Math.round((box.maxZ - box.minZ) / STEP);
  const free = (x: number, z: number) => !blocks.some((b) => x > b.minX - BODY && x < b.maxX + BODY && z > b.minZ - BODY && z < b.maxZ + BODY);
  const seen = new Uint8Array(nx * nz);
  const cell = (x: number, z: number) => [Math.round((x - box.minX) / STEP), Math.round((z - box.minZ) / STEP)] as const;
  const [sx, sz] = cell(from.x, from.z);
  assert.ok(free(from.x, from.z), 'the start is somewhere to stand');
  const queue = [[sx, sz]];
  seen[sz * nx + sx] = 1;
  while (queue.length) {
    const [i, j] = queue.pop()!;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen[b * nx + a]) continue;
      if (!free(box.minX + a * STEP, box.minZ + b * STEP)) continue;
      seen[b * nx + a] = 1;
      queue.push([a, b]);
    }
  }
  return (x, z) => {
    const [i, j] = cell(x, z);
    return i >= 0 && j >= 0 && i < nx && j < nz && !!seen[j * nx + i];
  };
}

const solid = (b: LobbyBlock) => b.what !== 'door' && b.what !== 'lift-door';
/** Just outside the front door, on the lot. */
const OUTSIDE = { x: LOBBY_DOOR.x, z: LOBBY.maxZ + 1 };
const CAR = { x: LOBBY_ELEVATOR.x, z: (LOBBY_CAR.minZ + LOBBY_CAR.maxZ) / 2 };

test('the lobby stands in the garage, clear of its cars, and in front of it is the lot', () => {
  const colliders: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  buildGarage(new THREE.Group(), colliders as never);
  // The garage's own walls, cars and columns: none of them reaches into the room (but the column that stands in its front wall).
  for (const c of colliders) {
    const overlaps = c.maxX > LOBBY.minX + LOBBY_WALL && c.minX < LOBBY.maxX - LOBBY_WALL && c.maxZ > LOBBY.minZ + LOBBY_WALL && c.minZ < LOBBY.maxZ - LOBBY_WALL - 0.5;
    assert.ok(!overlaps, `nothing of the garage's in the lobby: ${JSON.stringify(c)}`);
  }
  assert.ok(LOBBY.maxZ < ROAD.minZ - 5, 'the lot is out front, before the road');
});

test('the walkable area: in through the front door to the elevator, and nowhere else in', () => {
  const open = reachable(lobbyBlocks().filter(solid), OUTSIDE);
  assert.ok(open(LOBBY_DOOR.x, LOBBY.maxZ - 1), 'through the door');
  assert.ok(open(CAR.x, LOBBY_ELEVATOR.front + 0.5), 'up to the elevator doors');
  assert.ok(open(CAR.x, CAR.z), 'into the car, its doors open');
  // Every corner of the room you can stand in is reachable once you're in: the sofa, the desk, the plants are walked round.
  let inside = 0;
  let reached = 0;
  for (let x = LOBBY.minX + 0.5; x < LOBBY.maxX - 0.4; x += 0.25) {
    for (let z = LOBBY_ELEVATOR.front + 0.5; z < LOBBY.maxZ - 0.5; z += 0.25) {
      if (!inLobby(x, z)) continue;
      inside++;
      if (open(x, z)) reached++;
    }
  }
  assert.ok(reached / inside > 0.6, `most of the room is somewhere to stand (${reached}/${inside})`);
  // With the door shut there's no way in at all: the room has no other opening, from the lot or the garage.
  const walls = lobbyBlocks().filter((b) => b.what !== 'lift-door');
  const shut = reachable(walls, OUTSIDE);
  assert.ok(!shut(LOBBY_DOOR.x, LOBBY.maxZ - 1), 'the shut door is in the way');
  assert.ok(!shut(CAR.x, LOBBY_ELEVATOR.front + 0.5), 'there is no other way in');
});

test('the doorway: a gap in the glass front, as wide as the door, that the door fills when shut', () => {
  const blocks = lobbyBlocks();
  const front = blocks.filter((b) => b.maxZ === LOBBY.maxZ && (b.what === 'glass' || b.what === 'door'));
  const glass = front.filter((b) => b.what === 'glass').sort((a, b) => a.minX - b.minX);
  const door = front.find((b) => b.what === 'door')!;
  assert.equal(glass.length, 2);
  assert.equal(glass[0].minX, LOBBY.minX);
  assert.equal(glass[1].maxX, LOBBY.maxX);
  assert.equal(glass[0].maxX, door.minX);
  assert.equal(glass[1].minX, door.maxX);
  assert.ok(door.maxX - door.minX >= 2 * BODY + 0.6, 'wide enough to walk through');
  assert.ok(door.height >= 2.2, 'tall enough');
  // The door is in the lobby's own front, not in the way of the car parked out on the lot.
  assert.ok(inLobby(LOBBY_DOOR.x, LOBBY.maxZ - LOBBY_WALL - 0.05) && !inLobby(LOBBY_DOOR.x, LOBBY.maxZ + 0.05));
});

test('in the lobby, and in its car', () => {
  assert.ok(inLobby(CAR.x, CAR.z) && inLobbyCar(CAR.x, CAR.z));
  assert.ok(!inLobbyCar(LOBBY_DOOR.x, LOBBY.maxZ - 1));
  assert.ok(!inLobby(0, 0) && !inLobby(LOBBY_DOOR.x, LOBBY.maxZ + 1));
  for (let i = 0; i < 50; i++) {
    const s = lobbyCarSpot();
    assert.ok(inLobbyCar(s.x, s.z), 'you arrive in the car');
  }
});

test("the elevator's new stop: the lobby, between floor 1 and the casino, on the directory and the bottom floor's", () => {
  const names = { roof: 'Rooftop bar', lobby: 'Lobby', casino: 'Casino' };
  const lines = directory([{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }], names);
  assert.deepEqual(
    lines.map((l) => `${l.level} ${l.name}`),
    ['🍸 Rooftop bar', '3 gamma', '2 beta', '1 alpha', 'L Lobby', '🎰 Casino'],
  );
  assert.deepEqual(directory([], names), [{ level: 'L', name: 'Lobby', kind: 'lobby' }]);
  // It's the street level of the bottom floor that's built.
  assert.equal(lobbyFloor([{ id: 'new', cloning: true }, { id: 'first' }, { id: 'second' }]), 'first');
  assert.equal(lobbyFloor([]), undefined);
  // Who's down there: on that floor, at the street, inside its walls.
  const peers = [
    { floor: 'first', x: CAR.x, y: STREET_Y, z: CAR.z },
    { floor: 'first', x: LOBBY_DOOR.x, y: STREET_Y, z: LOBBY.maxZ - 2 },
    { floor: 'first', x: CAR.x, y: 0, z: CAR.z }, // upstairs, over it
    { floor: 'first', x: LOBBY_DOOR.x, y: STREET_Y, z: LOBBY.maxZ + 2 }, // out on the lot
    { floor: 'second', x: CAR.x, y: STREET_Y, z: CAR.z }, // another floor's street
  ];
  assert.equal(peopleInLobby(peers, 'first'), 2);
  assert.equal(peopleInLobby(peers, undefined), 0);
});

test('the built lobby: its colliders and elevator go down with the street, and its doors open', () => {
  const lobby = buildLobby({ sign: 'LOBBY', directory: 'Directory', building: 'AGENT OFFICE' });
  assert.equal(lobby.colliders.length, lobbyBlocks().length);
  assert.equal(lobby.interactables[0].kind, 'elevator');
  assert.equal(lobby.interactables[0].y, STREET_Y);
  assert.ok(lobby.elevator.colliders.length === 1);
  const door = lobby.colliders[lobbyBlocks().findIndex((b) => b.what === 'door')];
  const lift = lobby.elevator.colliders[0];
  const wall = lobby.colliders[0];
  assert.equal(wall.bottom, STREET_Y);

  // Three floors up, it's three storeys further down.
  lobby.setLevel(3);
  assert.equal(lobby.group.position.y, -3 * STOREY);
  assert.equal(lobby.interactables[0].y, streetBelow(3));
  assert.ok(Math.abs(wall.bottom! - streetBelow(3)) < 1e-9);
  assert.ok(door.top > streetBelow(3) + 2 && door.top < streetBelow(3) + 3, 'the shut door stands on that street');

  // Someone walks up to the front door: it slides open, and is out of the way; they walk off, it shuts.
  const street = streetBelow(3);
  for (let i = 0; i < 20; i++) lobby.update(0.1, [{ x: LOBBY_DOOR.x, y: street, z: LOBBY.maxZ + 1 }]);
  assert.ok(door.top < street, 'open');
  for (let i = 0; i < 20; i++) lobby.update(0.1, [{ x: LOBBY_DOOR.x, y: street, z: LOBBY.maxZ + 8 }]);
  assert.ok(door.top > street + 2, 'shut again');
  // Someone upstairs, over the door, doesn't open it.
  for (let i = 0; i < 20; i++) lobby.update(0.1, [{ x: LOBBY_DOOR.x, y: 0, z: LOBBY.maxZ + 1 }]);
  assert.ok(door.top > street + 2);

  // The elevator's doors open when it arrives, and shut (in the way at once) when it leaves.
  assert.ok(lift.top > street);
  lobby.elevator.setOpen(true);
  for (let i = 0; i < 20; i++) lobby.update(0.1, []);
  assert.ok(lobby.elevator.open && lobby.elevator.settled && lift.top < street);
  lobby.elevator.setOpen(false);
  assert.ok(lift.top > street, 'shut at once for walking');
  // Back on the bottom floor, all of it is back at the street.
  lobby.setLevel(0);
  assert.equal(wall.bottom, STREET_Y);
  assert.ok(lift.top > STREET_Y + 2);
});
