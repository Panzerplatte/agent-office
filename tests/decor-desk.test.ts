import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Decor } from '../src/server/decor.js';
import {
  DESK_FRAME_BORDER,
  DESK_KEEPOUT,
  DESK_PICTURE_MAX,
  DESK_PICTURE_MIN,
  DESK_TOP,
  clampToDesk,
  deskFootprint,
  deskFrames,
  deskHalf,
  deskPictureSize,
  deskPose,
  deskSpotFree,
  sanitizePlacement,
  standDepth,
  toDesk,
  type Decoration,
  type DeskPlacement,
} from '../src/shared/decor.js';
import { DESKS } from '../src/shared/layout.js';

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} ≈ ${b}`);
const poster = { url: 'https://example.com/cat.png', wall: 'north', u: 0, y: 2, w: 2, h: 1, frame: 0 } as const;
/** In the front corner left of the laptop, as the worker sees it: free on every desk. */
const photo = { url: 'https://example.com/dog.jpg', on: 'desk', desk: 'desk-1', dx: -0.8, dz: 0.25, w: 0.2, h: 0.15, frame: 1 } as const;

const ok = <T>(v: T | string): T => {
  assert.ok(typeof v !== 'string', `refused: ${v as string}`);
  return v as T;
};

test('a desk picture is sized 10 to 30 cm on its longest side, in its image’s shape', () => {
  assert.deepEqual(deskPictureSize(0.2, 2), { w: 0.2, h: 0.1 });
  assert.deepEqual(deskPictureSize(0.2, 0.5), { w: 0.1, h: 0.2 });
  // A poster-sized size comes down to the biggest desk frame, a tiny one up to the smallest.
  assert.equal(Math.max(...Object.values(deskPictureSize(1.2, 1.5))), DESK_PICTURE_MAX);
  assert.equal(Math.max(...Object.values(deskPictureSize(0.01, 1.5))), DESK_PICTURE_MIN);
  near(deskPictureSize(1.2, 1.5).w / deskPictureSize(1.2, 1.5).h, 1.5);
  for (const bad of [NaN, Infinity, -1]) {
    const { w, h } = deskPictureSize(bad, 1);
    assert.ok(w >= DESK_PICTURE_MIN && w <= DESK_PICTURE_MAX && w === h, String(bad));
  }
});

test('a turned desk frame is boxed by its turned footprint', () => {
  const fw = 0.1 + DESK_FRAME_BORDER;
  const fd = standDepth(0.15) / 2;
  assert.deepEqual(deskHalf(0.2, 0.15, 0), { hx: fw, hz: fd });
  assert.deepEqual(deskHalf(0.2, 0.15, 90), { hx: fd, hz: fw });
  assert.deepEqual(deskHalf(0.2, 0.15, 180), deskHalf(0.2, 0.15, 0));
  const d = deskHalf(0.2, 0.15, 45);
  near(d.hx, (fw + fd) * Math.SQRT1_2);
  near(d.hz, (fw + fd) * Math.SQRT1_2);
  const fp = deskFootprint({ dx: 0.3, dz: -0.1, w: 0.2, h: 0.15, rot: 0 });
  near(fp.x1 - fp.x0, 2 * fw);
  near((fp.x0 + fp.x1) / 2, 0.3);
  near((fp.z0 + fp.z1) / 2, -0.1);
});

test('desk spots: in a desk’s own frame and back', () => {
  for (const desk of DESKS) {
    for (const [dx, dz] of [
      [0, 0],
      [-0.8, 0.25],
      [1, -0.4],
    ]) {
      const p = deskPose(desk, dx, dz, 90);
      near(p.y, 0.78);
      near(p.rotY, desk.rotY + Math.PI / 2);
      const back = toDesk(desk, p.x, p.z);
      near(back.dx, dx, `${desk.id} dx`);
      near(back.dz, dz, `${desk.id} dz`);
    }
    // +z in the desk's frame is toward its chair (deskSeat puts it there too).
    const chairSide = deskPose(desk, 0, 0.5);
    near(Math.hypot(chairSide.x - (desk.x + Math.sin(desk.rotY) * 0.5), chairSide.z - (desk.z + Math.cos(desk.rotY) * 0.5)), 0);
  }
});

test('a frame stays on the desk top and clear of the laptop and the knick-knacks', () => {
  // Off the edge, it slides back on, all of it.
  for (const rot of [0, 45, 90]) {
    const at = clampToDesk(-5, 5, 0.3, 0.3, rot);
    const fp = deskFootprint({ ...at, w: 0.3, h: 0.3, rot });
    assert.ok(fp.x0 >= DESK_TOP.x0 - 1e-9 && fp.z1 <= DESK_TOP.z1 + 1e-9, `${rot}°`);
  }
  // In the middle is the laptop; the back corners have the mug, plant or books.
  assert.equal(deskSpotFree(deskFootprint({ dx: 0, dz: 0, w: 0.2, h: 0.2, rot: 0 })), false);
  assert.equal(deskSpotFree(deskFootprint({ dx: 0.85, dz: -0.3, w: 0.1, h: 0.1, rot: 0 })), false);
  assert.equal(deskSpotFree(deskFootprint({ dx: -0.85, dz: -0.3, w: 0.1, h: 0.1, rot: 0 })), false);
  const free = deskFootprint({ ...photo, rot: 0 });
  assert.equal(deskSpotFree(free), true);
  // Every desk has room for the biggest frame there, turned any way.
  for (const rot of [0, 45, 90, 135]) {
    const at = clampToDesk(-0.8, 0.25, DESK_PICTURE_MAX, DESK_PICTURE_MAX, rot);
    assert.ok(deskSpotFree(deskFootprint({ ...at, w: DESK_PICTURE_MAX, h: DESK_PICTURE_MAX, rot })), `${rot}°`);
  }
  // Another frame there is in the way, unless it's moved along enough.
  assert.equal(deskSpotFree(free, [deskFootprint({ ...photo, dx: -0.75, rot: 0 })]), false);
  assert.equal(deskSpotFree(free, [deskFootprint({ ...photo, dx: -0.75, dz: 0.25 + 0.3, rot: 0 })]), true);
  for (const k of DESK_KEEPOUT) assert.ok(k.x0 < k.x1 && k.z0 < k.z1);
});

test('sanitizing a desk placement', () => {
  const p = ok(sanitizePlacement(photo)) as DeskPlacement & { rot: number };
  assert.deepEqual(p, { url: 'https://example.com/dog.jpg', on: 'desk', desk: 'desk-1', dx: -0.8, dz: 0.25, w: 0.2, h: 0.15, frame: 1, rot: 0 });
  // Turns snap to 45°; sizes come into the desk range; the spot slides back onto the top.
  const big = ok(sanitizePlacement({ ...photo, w: 2, h: 1, rot: 50, dx: -9, dz: 9 })) as DeskPlacement;
  assert.equal(big.rot, 45);
  assert.equal(big.w, DESK_PICTURE_MAX);
  near(big.h, DESK_PICTURE_MAX / 2);
  const fp = deskFootprint(big);
  assert.ok(fp.x0 >= DESK_TOP.x0 - 1e-3 && fp.z1 <= DESK_TOP.z1 + 1e-3);
  // Wall fields left over don't matter on a desk, and desk ones don't on a wall.
  const mixed = ok(sanitizePlacement({ ...photo, wall: 'north', u: 1, y: 2 }));
  assert.equal(mixed.on, 'desk');
  assert.ok(!('wall' in mixed) && !('u' in mixed));
  const wall = ok(sanitizePlacement({ ...poster, desk: 'desk-1', dx: 0, dz: 0 }));
  assert.ok(!('desk' in wall) && !('dx' in wall));

  for (const [bad, why] of [
    [{ ...photo, desk: 'desk-999' }, 'unknown desk'],
    [{ ...photo, desk: undefined }, 'no desk'],
    [{ ...photo, desk: 'bean-1' }, 'not a desk'],
    [{ ...photo, dx: 0, dz: 0 }, 'on the laptop'],
    [{ ...photo, dx: 0.9, dz: -0.35 }, 'on the mug'],
    [{ ...photo, dx: 'left' }, 'no spot'],
    [{ ...photo, w: 0 }, 'no size'],
    [{ ...photo, url: 'javascript:alert(1)' }, 'bad link'],
    [{ ...photo, on: 'ceiling' }, 'nowhere'],
  ] as const) {
    assert.equal(typeof sanitizePlacement(bad), 'string', why);
  }
});

test('wall pictures stay as they were: no `on`, or `on: wall`', () => {
  const plain = ok(sanitizePlacement(poster));
  assert.ok(!('on' in plain), 'saved without on, as before desk frames');
  assert.equal(plain.on, undefined);
  assert.deepEqual(ok(sanitizePlacement({ ...poster, on: 'wall' })), plain);
  // The same placement as before desk frames came along.
  assert.deepEqual(plain, { url: 'https://example.com/cat.png', wall: 'north', u: 0, y: 2, w: 2, h: 1, frame: 0, rot: 0 });
});

test('the office keeps desk frames and old wall pictures, and frames on a desk don’t stand in each other', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-decor-desk-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // decor.json from before desk frames: wall pictures without `on`.
  writeFileSync(path.join(dir, 'decor.json'), JSON.stringify([{ ...poster, id: 'old1', by: 'Ada', at: 1 }]));
  const decor = new Decor(dir);
  assert.equal(decor.list().length, 1);
  assert.equal(decor.list()[0].on, undefined);
  assert.equal((decor.list()[0] as { wall?: string }).wall, 'north');

  const a = ok(decor.add(photo, 'Bo'));
  assert.equal(a.on, 'desk');
  // The same spot on that desk is taken; on the next desk it's free.
  assert.equal(typeof decor.add({ ...photo, dx: -0.75 }, 'Cy'), 'string');
  const b = ok(decor.add({ ...photo, desk: 'desk-2' }, 'Cy'));
  // Moving b onto a's desk next to it is refused, but a can be nudged on its own desk.
  assert.equal(typeof decor.update(b.id, { on: 'desk', desk: 'desk-1', dx: -0.78, dz: 0.25 }), 'string');
  const nudged = ok(decor.update(a.id, { on: 'desk', desk: 'desk-1', dx: -0.85, dz: 0.3 })) as DeskPlacement;
  assert.equal(nudged.dx, -0.85);
  // Editing a frame (a new title and turn) keeps it on its desk.
  const edited = ok(decor.update(a.id, { title: 'Rex', rot: 90 })) as DeskPlacement;
  assert.equal(edited.on, 'desk');
  assert.equal(edited.desk, 'desk-1');
  assert.equal(edited.rot, 90);
  // From the wall to a desk, and from a desk to the wall.
  const down = ok(decor.update('old1', { on: 'desk', desk: 'desk-3', dx: -0.8, dz: 0.2, w: 0.3, h: 0.15 }));
  assert.equal(down.on, 'desk');
  const up = ok(decor.update(b.id, { on: 'wall', wall: 'west', u: 0, y: 2, w: 1, h: 0.75 }));
  assert.equal(up.on, undefined);
  assert.ok(!('desk' in up) && !('dx' in up));
  assert.equal((up as { wall?: string }).wall, 'west');

  const reloaded = new Decor(dir);
  assert.deepEqual(reloaded.list(), decor.list());
  const saved = JSON.parse(readFileSync(path.join(dir, 'decor.json'), 'utf8')) as Decoration[];
  assert.deepEqual(
    saved.map((d) => [d.id, d.on ?? 'wall']),
    [
      ['old1', 'desk'],
      [a.id, 'desk'],
      [b.id, 'wall'],
    ],
  );
  assert.equal(deskFrames(reloaded.list(), 'desk-1').length, 1);
  assert.equal(deskFrames(reloaded.list(), 'desk-1', a.id).length, 0);
});
