import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Decor } from '../src/server/decor.js';
import { FRAME_BORDER, clampToWall, frameHalf, frameRect, normalizeRot, overlaps, pictureSize, sanitizePlacement } from '../src/shared/decor.js';
import { FLOOR, WALL_HEIGHT } from '../src/shared/layout.js';

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} ≈ ${b}`);
const picture = { url: 'https://example.com/cat.png', wall: 'north', u: 0, y: 2, w: 2, h: 1, frame: 0 } as const;

test('turns snap to 45° steps in [0, 360), and anything else is 0', () => {
  assert.equal(normalizeRot(0), 0);
  assert.equal(normalizeRot(45), 45);
  assert.equal(normalizeRot(50), 45);
  assert.equal(normalizeRot(360), 0);
  assert.equal(normalizeRot(405), 45);
  assert.equal(normalizeRot(-45), 315);
  assert.equal(normalizeRot(-360), 0);
  for (const bad of [undefined, null, '90', NaN, Infinity, {}]) assert.equal(normalizeRot(bad), 0);
});

test('a turned frame is boxed by its rotated corners', () => {
  const fw = 1 + FRAME_BORDER;
  const fh = 0.5 + FRAME_BORDER;
  assert.deepEqual(frameHalf(2, 1, 0), { hw: fw, hh: fh });
  // On its side, width and height swap.
  assert.deepEqual(frameHalf(2, 1, 90), { hw: fh, hh: fw });
  assert.deepEqual(frameHalf(2, 1, 270), { hw: fh, hh: fw });
  assert.deepEqual(frameHalf(2, 1, 180), { hw: fw, hh: fh });
  // At 45°, both halves are (fw + fh)·√½.
  const d = frameHalf(2, 1, 45);
  near(d.hw, (fw + fh) * Math.SQRT1_2);
  near(d.hh, (fw + fh) * Math.SQRT1_2);
  near(frameHalf(2, 1, 135).hw, d.hw);

  const r = frameRect({ ...picture, rot: 90 });
  near(r.u1 - r.u0, 2 * fh);
  near(r.y1 - r.y0, 2 * fw);
  // No rot is upright.
  assert.deepEqual(frameRect(picture), frameRect({ ...picture, rot: 0 }));
});

test('overlap checks see the turned box', () => {
  // A wide, low picture with a small one above it: clear while upright, in the way once the wide one turns.
  const a = { ...picture, u: 0, y: 3, w: 2, h: 0.4 };
  const b = { ...picture, u: 0, y: 4.3, w: 0.5, h: 0.5 };
  assert.equal(overlaps(frameRect(a), frameRect(b)), false);
  assert.equal(overlaps(frameRect({ ...a, rot: 90 }), frameRect(b)), true);
  assert.equal(overlaps(frameRect({ ...a, rot: 45 }), frameRect(b)), true);
});

test('clamping keeps a turned frame on the wall', () => {
  // Aimed at the north-west corner, low down: the whole turned box stays clear of the edge and the floor.
  for (const rot of [0, 45, 90, 135]) {
    const at = clampToWall('north', FLOOR.minX, 0, 2, 0.6, rot)!;
    assert.ok(at, `${rot}°`);
    const r = frameRect({ wall: 'north', u: at.u, y: at.y, w: 2, h: 0.6, rot });
    assert.ok(r.u0 >= FLOOR.minX + 0.15 - 1e-9, `${rot}°: ${r.u0}`);
    assert.ok(r.y0 >= 0.4 - 1e-9, `${rot}°: ${r.y0}`);
  }
  // Turned, it has to sit further in than upright.
  const upright = clampToWall('north', FLOOR.minX, 0, 2, 0.6, 0)!;
  const turned = clampToWall('north', FLOOR.minX, 0, 2, 0.6, 90)!;
  assert.ok(turned.u < upright.u);
  assert.ok(turned.y > upright.y);
});

test('a picture shrinks to fit under the ceiling when turned', () => {
  const room = WALL_HEIGHT - 0.4 - 0.05;
  const wide = pictureSize(3.4, 5);
  assert.equal(wide.w, 3.4);
  for (const rot of [45, 90]) {
    const { w, h } = pictureSize(3.4, 5, rot);
    near(w / h, 5, `${rot}°: keeps its shape`);
    const { hh } = frameHalf(w, h, rot);
    assert.ok(2 * hh <= room + 1e-9, `${rot}°: ${2 * hh}`);
    assert.ok(clampToWall('north', 0, 3, w, h, rot), `${rot}°: hangs`);
  }
  // Small pictures don't change.
  assert.deepEqual(pictureSize(1, 1.5, 45), pictureSize(1, 1.5));
});

test('a placement without a turn is upright, and a turn is tidied', () => {
  const plain = sanitizePlacement(picture);
  assert.ok(typeof plain !== 'string');
  assert.equal(plain.rot, 0);
  const turned = sanitizePlacement({ ...picture, rot: -90 });
  assert.ok(typeof turned !== 'string');
  assert.equal(turned.rot, 270);
  assert.equal((sanitizePlacement({ ...picture, rot: 'sideways' }) as { rot: number }).rot, 0);
});

test('the office keeps a picture’s turn, and older pictures load upright', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-decor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // decor.json from before pictures could turn.
  writeFileSync(path.join(dir, 'decor.json'), JSON.stringify([{ ...picture, id: 'old1', by: 'Ada', at: 1 }]));
  const decor = new Decor(dir);
  assert.equal(decor.list()[0].rot, 0);

  const added = decor.add({ ...picture, u: 5, rot: 45 }, 'Bo');
  assert.ok(typeof added !== 'string');
  assert.equal(added.rot, 45);
  // A patch that leaves the turn out keeps it; one that has it changes it.
  const moved = decor.update(added.id, { u: 6 });
  assert.ok(typeof moved !== 'string');
  assert.equal(moved.rot, 45);
  const turned = decor.update('old1', { rot: 135 });
  assert.ok(typeof turned !== 'string');
  assert.equal(turned.rot, 135);

  const saved = JSON.parse(readFileSync(path.join(dir, 'decor.json'), 'utf8')) as { id: string; rot: number }[];
  assert.deepEqual(
    saved.map((d) => [d.id, d.rot]),
    [
      ['old1', 135],
      [added.id, 45],
    ],
  );
  const reloaded = new Decor(dir);
  assert.deepEqual(
    reloaded.list().map((d) => d.rot),
    [135, 45],
  );
});
