import test from 'node:test';
import assert from 'node:assert/strict';
import { BEANBAGS, BOOKSHELF, CABINET, BALCONY_DOOR, DARTBOARD, DESKS, DESK_SIZE, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, FLOOR, GONG, JUKEBOX, KIOSK, LADDER, MEETING_ROOM, PLANTS, POLE, POLES, POOL_TABLE, SEATING, STAIRS, STATIONS, WHITEBOARD, seatPlace } from '../src/shared/layout.js';
import { HOOP } from '../src/shared/hoop.js';
import { deskPoint } from '../src/shared/nav.js';
import { FOOTPRINTS } from '../src/client/world/bunker/clutter/place.js';

type Rect = readonly [minX: number, maxX: number, minZ: number, maxZ: number];
const overlaps = (a: Rect, b: Rect) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];
const around = (x: number, z: number, r: number): Rect => [x - r, x + r, z - r, z + r];
const bounds = (pts: [number, number][]): Rect => [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];

/** Everything on the floor the props must keep clear of, with room to walk up to it or use it. */
function taken(): [string, Rect][] {
  const out: [string, Rect][] = [];
  const hw = DESK_SIZE.width / 2;
  const hd = DESK_SIZE.depth / 2;
  for (const d of DESKS) out.push([d.id, bounds([deskPoint(d, -hw, -hd), deskPoint(d, hw, -hd), deskPoint(d, -hw, 1.6), deskPoint(d, hw, 1.6)])]);
  // The overflow bean bags, their lap desks and the floor behind them to sit down from.
  for (const b of BEANBAGS) out.push([b.id, bounds([deskPoint(b, -0.62, -1.1), deskPoint(b, 0.62, -1.1), deskPoint(b, -0.62, 1.2), deskPoint(b, 0.62, 1.2)])]);
  for (const k of STATIONS) out.push([k.id, bounds([deskPoint(k, -KIOSK.width / 2, -1), deskPoint(k, KIOSK.width / 2, -1), deskPoint(k, -KIOSK.width / 2, KIOSK.stand + 0.35), deskPoint(k, KIOSK.width / 2, KIOSK.stand + 0.35)])]);
  for (const s of SEATING) if (!s.roof && !s.casino && s.y === 0 && s.z < FLOOR.maxZ) s.places.forEach((_, i) => out.push([`${s.id}:${i}`, around(seatPlace(s, i).x, seatPlace(s, i).z, 0.9)]));
  for (const [x, z, s] of PLANTS) out.push([`plant ${x},${z}`, around(x, z, 0.32 * s)]);
  // The doors, with a couple of meters of floor in front of each.
  out.push(['exit door', [FLOOR.minX, FLOOR.minX + 2, EXIT_DOOR.u - EXIT_DOOR.width / 2 - 0.15, EXIT_DOOR.u + EXIT_DOOR.width / 2 + 0.15]]);
  out.push(['balcony doors', [BALCONY_DOOR.u - BALCONY_DOOR.width / 2 - 0.2, BALCONY_DOOR.u + BALCONY_DOOR.width / 2 + 0.2, FLOOR.maxZ - 2, FLOOR.maxZ]]);
  out.push(['elevator', [ELEVATOR.x - ELEVATOR.width / 2, ELEVATOR.x + ELEVATOR.width / 2, FLOOR.minZ, ELEVATOR_FRONT + 2]]);
  out.push(['meeting room door', [MEETING_ROOM.door.x0 - 0.3, MEETING_ROOM.door.x1 + 0.3, MEETING_ROOM.minZ - 2, MEETING_ROOM.minZ + 1]]);
  out.push(['meeting room', [MEETING_ROOM.minX, MEETING_ROOM.maxX, MEETING_ROOM.minZ, MEETING_ROOM.maxZ]]);
  // The stairs to the loft, and the floor at their foot.
  out.push(['stairs', [STAIRS.fromX - 1.5, STAIRS.toX, STAIRS.minZ - 0.3, STAIRS.maxZ]]);
  // The dartboard's cabinet and its lane out to past the oche.
  const dart = DARTBOARD.cabinet.width / 2 + DARTBOARD.cabinet.door;
  out.push(['dart lane', [DARTBOARD.oche.x - 0.8, FLOOR.maxX, DARTBOARD.z - dart, DARTBOARD.z + dart]]);
  // The pool table, with room to cue from all round, and its cue rack.
  out.push(['pool table', [POOL_TABLE.x - POOL_TABLE.outer.length / 2 - POOL_TABLE.clear, POOL_TABLE.x + POOL_TABLE.outer.length / 2 + POOL_TABLE.clear, POOL_TABLE.z - POOL_TABLE.outer.width / 2 - POOL_TABLE.clear, POOL_TABLE.z + POOL_TABLE.outer.width / 2 + POOL_TABLE.clear]]);
  out.push(['cue rack', [POOL_TABLE.rack.x - POOL_TABLE.rack.width / 2, POOL_TABLE.rack.x + POOL_TABLE.rack.width / 2, FLOOR.maxZ - 1, FLOOR.maxZ]]);
  // The hoop's court, out to the free-throw line, and the ball's spot.
  out.push(['hoop court', [FLOOR.minX, HOOP.face + HOOP.line + 0.3, HOOP.z - 1.5, HOOP.z + 1.5]]);
  out.push(['coffee machine', [-17, -10.75, 10.4, FLOOR.maxZ]]);
  out.push(['jukebox', [JUKEBOX.x - JUKEBOX.depth / 2 - 1, FLOOR.maxX, JUKEBOX.z - JUKEBOX.width / 2, JUKEBOX.z + JUKEBOX.width / 2]]);
  out.push(['arcade cabinet', [CABINET.x - 1.2, FLOOR.maxX, CABINET.z - CABINET.width / 2, CABINET.z + CABINET.width / 2]]);
  out.push(['bookshelf', [BOOKSHELF.x - BOOKSHELF.width / 2, BOOKSHELF.x + BOOKSHELF.width / 2, FLOOR.maxZ - 1.2, FLOOR.maxZ]]);
  out.push(['gong', [GONG.x - GONG.width / 2 - 0.3, GONG.x + GONG.width / 2 + 0.4, FLOOR.minZ, GONG.z + 1.2]]);
  out.push(['whiteboard', [WHITEBOARD.x - WHITEBOARD.width / 2 - 0.3, WHITEBOARD.x + WHITEBOARD.width / 2 + 0.3, WHITEBOARD.z - 0.6, WHITEBOARD.z + 1.5]]);
  out.push(['ladder', [FLOOR.minX, FLOOR.minX + 1.5, LADDER.z - LADDER.width / 2 - 0.1, LADDER.z + LADDER.width / 2 + 0.1]]);
  for (const p of POLES) out.push(['pole', around(p.x, p.z, POLE.rail + 0.5)]);
  return out;
}

test('every bunker prop stands on the floor, against a wall', () => {
  for (const [name, r] of Object.entries(FOOTPRINTS)) {
    assert.ok(r[0] >= FLOOR.minX && r[1] <= FLOOR.maxX && r[2] >= FLOOR.minZ && r[3] <= FLOOR.maxZ, `${name} is off the floor`);
    const wall = Math.min(r[0] - FLOOR.minX, FLOOR.maxX - r[1], r[2] - FLOOR.minZ, FLOOR.maxZ - r[3]);
    // Or up against the meeting room's glass, which is a wall too.
    const glass = MEETING_ROOM.minZ - r[3];
    assert.ok(wall < 0.05 || (glass >= 0 && glass < 0.15), `${name} isn't against a wall`);
  }
});

test('no bunker prop is in the way of a desk, a seat, a door, a game or a walkway to one', () => {
  for (const [name, r] of Object.entries(FOOTPRINTS))
    for (const [what, t] of taken()) assert.ok(!overlaps(r, t), `${name} is in the way of ${what}`);
});
