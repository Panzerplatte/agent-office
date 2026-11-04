// The lobby: a glass-fronted room at street level, in the garage under the bottom floor, with a
// door from the lot out front and the elevator back up to the floors. It isn't a place of its own
// like the roof (ROOF) or the casino: it's the street level of the bottom floor, so whoever is in it
// is on that floor, down at the street, and everyone in it sees everyone else in it. Down on the
// street of a floor higher up (after a parachute jump, say), walking in through the door takes you
// over to the bottom floor's lobby.
//
// Everything here is at street level (STREET_Y) as seen from the bottom floor; from a floor higher
// up it's all that many storeys further down (see streetBelow), and the client moves it there.
// Shared by the client (which builds it and rides its elevator) and the tests.

import { FLOOR, STREET_Y, WALL_T } from './layout.js';

/** A rectangle on the ground, x and z. */
export interface LobbyRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The room, walls included: in the garage's front east corner, between the Ferraris parked either
 * side of it, from the front of the garage (where the lot starts) back to the elevator. Its front
 * wall stands on the garage's open front, flush with the building's south face.
 */
export const LOBBY = { minX: 6.2, maxX: 11.5, minZ: 0.35, maxZ: FLOOR.maxZ + WALL_T } as const;
/** How thick its walls are. */
export const LOBBY_WALL = 0.14;
/** Floor to ceiling: from the street up to the underside of the bottom floor's slab. */
export const LOBBY_HEIGHT = -STREET_Y - 0.3;

/** The glass front door from the lot: `x` its middle along the front wall, `width` its opening. It slides open as someone comes up to it. */
export const LOBBY_DOOR = { x: 7.8, width: 1.6, height: 2.4 } as const;

/**
 * The lobby's elevator: against the back wall, its doors facing the front door across the room.
 * It's its own little car (the shaft upstairs is against the office's north wall): `x` the middle
 * of its doors, `front` where they are.
 */
export const LOBBY_ELEVATOR = { x: 8.6, width: 2.4, depth: 2.25, doorWidth: 1.3, doorHeight: 2.3, wall: 0.12, front: LOBBY.minZ + 2.25 } as const;
/** The inside of its car, where you stand to ride. */
export const LOBBY_CAR: LobbyRect = {
  minX: LOBBY_ELEVATOR.x - LOBBY_ELEVATOR.width / 2 + LOBBY_ELEVATOR.wall,
  maxX: LOBBY_ELEVATOR.x + LOBBY_ELEVATOR.width / 2 - LOBBY_ELEVATOR.wall,
  minZ: LOBBY.minZ + LOBBY_WALL,
  maxZ: LOBBY_ELEVATOR.front - LOBBY_ELEVATOR.wall,
};

/** The reception desk, on the east side facing the room; the receptionist stands behind it. */
export const RECEPTION = { minX: 9.95, maxX: 10.7, minZ: 6.6, maxZ: 9.4, height: 1.05 } as const;
/** The sofa along the west wall, facing the reception desk across the room, and the low table in front of it. */
export const LOBBY_SOFA = { minX: LOBBY.minX + LOBBY_WALL, maxX: LOBBY.minX + LOBBY_WALL + 0.85, minZ: 7.6, maxZ: 9.9 } as const;
export const LOBBY_TABLE = { minX: LOBBY_SOFA.maxX + 0.35, maxX: LOBBY_SOFA.maxX + 0.95, minZ: 8.15, maxZ: 9.35, height: 0.42 } as const;
/** The potted plants, in the corners and either side of the elevator: [x, z, scale]. */
export const LOBBY_PLANTS: readonly (readonly [x: number, z: number, scale: number])[] = [
  [LOBBY.minX + 0.55, LOBBY.maxZ - 0.75, 1.15],
  [LOBBY.maxX - 0.55, LOBBY.maxZ - 0.75, 1.15],
  [LOBBY.minX + 0.5, LOBBY.minZ + 0.6, 1],
  [LOBBY.maxX - 0.5, LOBBY.minZ + 0.6, 1],
];
/** The floor directory on the west wall, by the elevator: `z` its middle along the wall, `y` over the floor. */
export const LOBBY_DIRECTORY = { z: 4.6, y: 1.75, width: 1.6, height: 1.9 } as const;
/** The building's name, big on the east wall behind the reception desk. */
export const LOBBY_NAME = { z: 8, y: 2.35 } as const;
/** The column of the garage that stands in the lobby's front wall, east of the door (see world/outside.ts). */
export const LOBBY_COLUMN = { x: 9.6, z: FLOOR.maxZ + WALL_T - 0.25, half: 0.25 } as const;

/** Whether (x, z) is inside the lobby, between its walls (the elevator's car counts). */
export function inLobby(x: number, z: number): boolean {
  const w = LOBBY_WALL;
  return x > LOBBY.minX + w && x < LOBBY.maxX - w && z > LOBBY.minZ + w && z < LOBBY.maxZ - w;
}

/** Whether (x, z) is in the lobby elevator's car. */
export function inLobbyCar(x: number, z: number): boolean {
  return x > LOBBY_CAR.minX && x < LOBBY_CAR.maxX && z > LOBBY_CAR.minZ && z < LOBBY_CAR.maxZ;
}

/** Where you stand in the car on arriving: its middle, facing out of its doors (+z), a little apart from anyone else. */
export function lobbyCarSpot(rand: () => number = Math.random): { x: number; z: number } {
  return {
    x: LOBBY_ELEVATOR.x + (rand() - 0.5) * 0.7,
    z: (LOBBY_CAR.minZ + LOBBY_CAR.maxZ) / 2 + (rand() - 0.5) * 0.5,
  };
}

/** One of the lobby's solid bits, for walking into: a wall, the elevator's front, a piece of furniture. `door` is the front door's opening (shut, it's in the way). */
export interface LobbyBlock extends LobbyRect {
  what: 'wall' | 'glass' | 'elevator' | 'door' | 'lift-door' | 'furniture';
  /** How high it stands over the street (walls go up to the ceiling). */
  height: number;
}

/**
 * Everything solid in the lobby, as rectangles on the ground: its walls (the front one glass, with
 * the door's opening in it), the elevator's front either side of its doors, its doors, the front
 * door's panels, the reception desk, the sofa and its table, the plants. Shut doors are in the way;
 * leave out `door` and `lift-door` for where they are when they're open.
 */
export function lobbyBlocks(): LobbyBlock[] {
  const w = LOBBY_WALL;
  const H = LOBBY_HEIGHT;
  const L = LOBBY;
  const E = LOBBY_ELEVATOR;
  const D = LOBBY_DOOR;
  const out: LobbyBlock[] = [
    // West and east walls, and the back one.
    { what: 'wall', minX: L.minX, maxX: L.minX + w, minZ: L.minZ, maxZ: L.maxZ, height: H },
    { what: 'wall', minX: L.maxX - w, maxX: L.maxX, minZ: L.minZ, maxZ: L.maxZ, height: H },
    { what: 'wall', minX: L.minX, maxX: L.maxX, minZ: L.minZ, maxZ: L.minZ + w, height: H },
    // The glass front, either side of the door.
    { what: 'glass', minX: L.minX, maxX: D.x - D.width / 2, minZ: L.maxZ - w, maxZ: L.maxZ, height: H },
    { what: 'glass', minX: D.x + D.width / 2, maxX: L.maxX, minZ: L.maxZ - w, maxZ: L.maxZ, height: H },
    { what: 'door', minX: D.x - D.width / 2, maxX: D.x + D.width / 2, minZ: L.maxZ - w, maxZ: L.maxZ, height: D.height },
    // The garage's column in the front wall.
    { what: 'wall', minX: LOBBY_COLUMN.x - LOBBY_COLUMN.half, maxX: LOBBY_COLUMN.x + LOBBY_COLUMN.half, minZ: LOBBY_COLUMN.z - LOBBY_COLUMN.half, maxZ: LOBBY_COLUMN.z + LOBBY_COLUMN.half, height: H },
    // The elevator: its sides, the front either side of the doors, and the doors.
    { what: 'elevator', minX: E.x - E.width / 2, maxX: E.x - E.width / 2 + E.wall, minZ: L.minZ, maxZ: E.front, height: H },
    { what: 'elevator', minX: E.x + E.width / 2 - E.wall, maxX: E.x + E.width / 2, minZ: L.minZ, maxZ: E.front, height: H },
    { what: 'elevator', minX: E.x - E.width / 2, maxX: E.x - E.doorWidth / 2, minZ: E.front - E.wall, maxZ: E.front, height: H },
    { what: 'elevator', minX: E.x + E.doorWidth / 2, maxX: E.x + E.width / 2, minZ: E.front - E.wall, maxZ: E.front, height: H },
    { what: 'lift-door', minX: E.x - E.doorWidth / 2, maxX: E.x + E.doorWidth / 2, minZ: E.front - E.wall - 0.06, maxZ: E.front, height: H },
    // The furniture.
    { what: 'furniture', ...RECEPTION, height: RECEPTION.height },
    { what: 'furniture', minX: RECEPTION.minX, maxX: L.maxX - w, minZ: RECEPTION.maxZ - 0.5, maxZ: RECEPTION.maxZ, height: RECEPTION.height },
    { what: 'furniture', ...LOBBY_SOFA, height: 0.45 },
    { what: 'furniture', ...LOBBY_TABLE, height: LOBBY_TABLE.height },
  ];
  for (const [x, z, s] of LOBBY_PLANTS) {
    const r = 0.28 * s;
    out.push({ what: 'furniture', minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, height: 1.3 * s });
  }
  return out;
}

/** A line on the floor directory: what's on that level, top to bottom. */
export interface DirectoryLine {
  /** What the button in the elevator says: the floor's number, or 🍸 / L / 🎰. */
  level: string;
  name: string;
  kind: 'roof' | 'floor' | 'lobby' | 'casino';
}

/**
 * The floor directory by the elevator, top to bottom as the building stands: the rooftop bar, the
 * project floors (the top one first, numbered from 1 at the bottom), the lobby you're in, and the
 * casino in the basement. With no floors built yet there's only the lobby.
 */
export function directory(floors: readonly { name: string }[], names: { roof: string; lobby: string; casino: string }): DirectoryLine[] {
  if (!floors.length) return [{ level: 'L', name: names.lobby, kind: 'lobby' }];
  return [
    { level: '🍸', name: names.roof, kind: 'roof' },
    ...floors.map((f, i) => ({ level: String(i + 1), name: f.name, kind: 'floor' as const })).reverse(),
    { level: 'L', name: names.lobby, kind: 'lobby' },
    { level: '🎰', name: names.casino, kind: 'casino' },
  ];
}

/** Whose street level the lobby is: the bottom floor of the building (the first one that's built), or none yet. */
export function lobbyFloor(floors: readonly { id: string; cloning?: boolean }[]): string | undefined {
  return floors.find((f) => !f.cloning)?.id;
}

/** How many of `peers` are in the lobby: on its floor, down at the street (`street` is that floor's street level) and between its walls. */
export function peopleInLobby(peers: Iterable<{ floor?: string; x: number; y: number; z: number }>, floor: string | undefined, street = STREET_Y): number {
  if (!floor) return 0;
  let n = 0;
  for (const p of peers) if (p.floor === floor && Math.abs(p.y - street) < 1.2 && inLobby(p.x, p.z)) n++;
  return n;
}
