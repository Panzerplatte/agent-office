import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import {
  BOARD_SIZE,
  CHECKPOINTS,
  COURSE,
  COURSE_AREA,
  FLAG,
  GOAL,
  LONGEST_MS,
  QUICKEST_MS,
  START,
  atFlag,
  checkpointPiece,
  crossesStart,
  formatTime,
  pieceUnder,
  pieceX,
  type Piece,
} from '../src/shared/jumprun.js';
import { FLOOR, GOLF_HOLE, ROAD, STREET_Y, WALL_T, streetBelow } from '../src/shared/layout.js';
import { JumpRun, JumpRunTimes } from '../src/server/jumprun.js';
import { RunTracker, type RunInput } from '../src/client/jumprun.js';

// ---- The jump: the player's own numbers, read from player.ts so the course can't drift from them ---

const playerSrc = readFileSync(path.join(import.meta.dirname, '..', 'src', 'client', 'player.ts'), 'utf8');
const constant = (name: string): number => {
  const m = new RegExp(`^const ${name} = ([0-9.]+);`, 'm').exec(playerSrc);
  assert.ok(m, `player.ts has ${name}`);
  return Number(m[1]);
};
const RADIUS = constant('RADIUS');
const HEIGHT = constant('HEIGHT');
const STEP = constant('STEP');
const WALK = constant('WALK');
const JUMP_V = constant('JUMP_V');
const GRAVITY = constant('GRAVITY');
/** How high a jump goes. */
const APEX = (JUMP_V * JUMP_V) / (2 * GRAVITY);
/** How long a jump is in the air before it comes down onto something `up` higher (lower when negative). */
const airTime = (up: number) => (JUMP_V + Math.sqrt(JUMP_V * JUMP_V - 2 * GRAVITY * up)) / GRAVITY;

/** The footprint of a piece, with a mover anywhere along its rail. */
const sweep = (p: Piece) => {
  const amp = p.move?.amp ?? 0;
  return { minX: p.x - amp - p.w / 2, maxX: p.x + amp + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 };
};
/** The gap between two pieces' tops, edge to edge on the ground plan, with the movers where they come closest. */
function gap(a: Piece, b: Piece): number {
  let best = Infinity;
  const at = (p: Piece, s: number) => (p.move ? p.x + p.move.amp * s : p.x);
  for (let i = -20; i <= 20; i++) {
    for (let j = -20; j <= 20; j++) {
      const ax = at(a, i / 20);
      const bx = at(b, j / 20);
      const dx = Math.max(0, Math.abs(ax - bx) - (a.w + b.w) / 2);
      const dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
      best = Math.min(best, Math.hypot(dx, dz));
    }
  }
  return best;
}
const base = (p: Piece) => (p.on !== undefined ? COURSE[p.on].h : 0);
const bottom = (p: Piece) => p.h - (p.thick ?? p.h - base(p));

test('every step up the course is one a jump clears, with room to spare', () => {
  for (let i = 1; i < COURSE.length; i++) {
    const [a, b] = [COURSE[i - 1], COURSE[i]];
    const up = b.h - a.h;
    assert.ok(up <= APEX * 0.8, `piece ${i} is ${up.toFixed(2)} m up from ${i - 1}: a jump only goes ${APEX.toFixed(2)} m`);
    assert.ok(up > -1.2, `piece ${i} is a drop of ${(-up).toFixed(2)} m`);
  }
  // It climbs: the flag is the highest point, and every piece is above the street.
  assert.equal(Math.max(...COURSE.map((p) => p.h)), GOAL.h);
  assert.ok(GOAL.h > 6, 'the flag is high up');
  for (const p of COURSE) assert.ok(p.h > STEP, 'nothing you just walk onto from the street');
});

test('every gap on the course is one a walking jump clears, with room to spare', () => {
  for (let i = 1; i < COURSE.length; i++) {
    const [a, b] = [COURSE[i - 1], COURSE[i]];
    // You stand on a piece out to your radius past its edge, and land on one as far short of it.
    const need = Math.max(0, gap(a, b) - 2 * RADIUS);
    const reach = WALK * airTime(b.h - a.h);
    assert.ok(reach >= need * 1.3, `${i - 1} → ${i}: a ${need.toFixed(2)} m jump, but a walking jump up ${(b.h - a.h).toFixed(2)} m reaches ${reach.toFixed(2)} m`);
    // And there's a gap at all, or you'd just hop up: a few are steps up onto the next crate.
    assert.ok(gap(a, b) <= 2.6, `${i - 1} → ${i} is a long way`);
  }
  // Some real gaps to jump, not just steps.
  assert.ok(COURSE.slice(1).filter((p, i) => gap(COURSE[i], p) >= 1.2).length >= 5);
});

test('the pieces are solid apart: none runs into another, and there is headroom over every top', () => {
  for (let i = 0; i < COURSE.length; i++) {
    for (let j = i + 1; j < COURSE.length; j++) {
      const [a, b] = [COURSE[i], COURSE[j]];
      if (a.on === j || b.on === i) continue;
      const sa = sweep(a);
      const sb = sweep(b);
      const overlapXZ = sa.minX < sb.maxX && sb.minX < sa.maxX && sa.minZ < sb.maxZ && sb.minZ < sa.maxZ;
      if (!overlapXZ) continue;
      // One over the other: the one under has a person's height (and a bit) over it.
      const [lo, hi] = a.h < b.h ? [a, b] : [b, a];
      assert.ok(bottom(hi) - lo.h >= HEIGHT + 0.1, `${i} and ${j} overlap, with no room between`);
    }
  }
  // Stacked crates stand on what they're on.
  for (const p of COURSE) {
    if (p.on === undefined) continue;
    const under = COURSE[p.on];
    assert.ok(Math.abs(p.x - under.x) + p.w / 2 <= under.w / 2 + 1e-9 && Math.abs(p.z - under.z) + p.d / 2 <= under.d / 2 + 1e-9, 'on top of it, not hanging off');
    assert.equal(bottom(p), under.h);
  }
});

test('the course is down on the street east of the building, clear of it, the road, the golf hole and the neighbours', () => {
  const pieces = COURSE.map(sweep);
  for (const s of pieces) {
    assert.ok(s.minX >= COURSE_AREA.minX && s.maxX <= COURSE_AREA.maxX && s.minZ >= COURSE_AREA.minZ && s.maxZ <= COURSE_AREA.maxZ);
    assert.ok(s.minX > FLOOR.maxX + WALL_T + 5, 'off to the east of the building and its side lot');
  }
  assert.ok(START.z < 21 && START.board.z + START.board.w / 2 < 21, 'the start is this side of the sidewalk');
  assert.ok(COURSE_AREA.maxZ < ROAD.minZ);
  // Golf: the hole is across the road.
  assert.ok(GOLF_HOLE.z - GOLF_HOLE.green > ROAD.maxZ && COURSE_AREA.maxZ < GOLF_HOLE.z - GOLF_HOLE.green);
  // The trees east of the building (outside.ts) and the neighbour to the east, at x 40.8 and on.
  for (const [x, z, s] of [
    [29, -6, 1.1],
    [30, 6, 1.25],
  ]) {
    for (const p of pieces) assert.ok(p.minX - x > 1.7 * s || Math.abs(z - (p.minZ + p.maxZ) / 2) > 10, 'clear of the tree');
  }
  assert.ok(COURSE_AREA.maxX < 40.8);
});

test('checkpoints come in order along the way, and the flag is on the last piece', () => {
  const numbered = COURSE.map((p) => p.checkpoint).filter((n): n is number => n !== undefined);
  assert.deepEqual(
    numbered,
    Array.from({ length: CHECKPOINTS }, (_, i) => i + 1),
  );
  assert.ok(CHECKPOINTS >= 2);
  assert.ok(!GOAL.checkpoint && !GOAL.move);
  assert.ok(Math.abs(FLAG.x - GOAL.x) < GOAL.w / 2 && Math.abs(FLAG.z - GOAL.z) < GOAL.d / 2, 'the flagpole stands on the goal');
  assert.ok(COURSE.filter((p) => p.move).length >= 2, 'a few moving platforms');
  // Each checkpoint is a piece you land on (not a mover), so you're put back somewhere steady.
  for (let n = 1; n <= CHECKPOINTS; n++) assert.ok(!checkpointPiece(n)!.move);
  const kinds = new Set(COURSE.map((p) => p.kind));
  for (const k of ['crate', 'pipe', 'scaffold', 'container', 'mover', 'goal'] as const) assert.ok(kinds.has(k), k);
});

test('the movers slide to and fro; pieceUnder finds what you stand on, the highest first', () => {
  const mover = COURSE.find((p) => p.move)!;
  assert.equal(pieceX(mover, 0), mover.x);
  assert.ok(Math.abs(pieceX(mover, mover.move!.period / 4) - (mover.x + mover.move!.amp)) < 1e-9);
  assert.equal(pieceUnder(mover.x, mover.z, 0, 0), COURSE.indexOf(mover));
  assert.equal(pieceUnder(mover.x, mover.z, 0, mover.move!.period / 4), -1, 'it moved away');
  // The crate on the container, not the container.
  const crate = COURSE.findIndex((p) => p.on !== undefined);
  assert.equal(pieceUnder(COURSE[crate].x, COURSE[crate].z), crate);
  assert.equal(pieceUnder(0, 0), -1);
});

test('the start line counts going in, on it, not coming back out or beside it', () => {
  const x = (START.x0 + START.x1) / 2;
  assert.ok(crossesStart(x, START.z + 0.1, START.z - 0.1));
  assert.ok(!crossesStart(x, START.z - 0.1, START.z + 0.1));
  assert.ok(!crossesStart(START.x1 + 0.5, START.z + 0.1, START.z - 0.1));
  assert.ok(atFlag(FLAG.x, FLAG.z) && !atFlag(GOAL.x - GOAL.w / 2, GOAL.z + GOAL.d / 2));
});

test('times read as seconds, with minutes past one', () => {
  assert.equal(formatTime(42070), '42.07');
  assert.equal(formatTime(62350), '1:02.35');
  assert.equal(formatTime(9005), '9.01');
});

// ---- A run, frame by frame --------------------------------------------------------------------------

/** Standing (on your feet) at the middle of piece `i`'s top, on floor `index`. */
const on = (i: number, index = 0): RunInput => {
  const street = streetBelow(index);
  const p = COURSE[i];
  return { x: p.x, z: p.z, y: street + p.h, street, grounded: true, t: 0, here: true };
};
const ground = (x: number, z: number, index = 0): RunInput => ({ x, z, y: streetBelow(index), street: streetBelow(index), grounded: true, t: 0, here: true });
const cp = (n: number) => COURSE.indexOf(checkpointPiece(n)!);

test('a run: over the line, the checkpoints in order, a fall back to the last one, and the flag', () => {
  const r = new RunTracker();
  const x = (START.x0 + START.x1) / 2;
  assert.deepEqual(r.step(ground(x, START.z + 1)), []);
  assert.deepEqual(r.step(ground(x, START.z - 0.05)), [{ e: 'start' }]);
  assert.ok(r.running);
  // Walking up to the first crate isn't falling.
  assert.deepEqual(r.step(ground(x, COURSE[0].z + 1)), []);
  assert.deepEqual(r.step(on(0)), []);
  assert.deepEqual(r.step(on(1)), []);
  // In the air: nothing.
  assert.deepEqual(r.step({ ...on(2), grounded: false, y: 5 }), []);
  assert.deepEqual(r.step(on(cp(1))), [{ e: 'checkpoint', n: 1 }]);
  assert.deepEqual(r.step(on(cp(1))), [], 'once');
  // Off the mover onto the street: back on the checkpoint.
  const fell = r.step(ground(36, 4));
  const p1 = checkpointPiece(1)!;
  assert.deepEqual(fell, [{ e: 'back', n: 1, to: { x: p1.x, y: STREET_Y + p1.h, z: p1.z } }]);
  assert.ok(r.running);
  // The flag before checkpoint 2 doesn't finish it.
  assert.deepEqual(r.step({ ...on(COURSE.length - 1), x: FLAG.x, z: FLAG.z }), []);
  assert.deepEqual(r.step(on(cp(2))), [{ e: 'checkpoint', n: 2 }]);
  assert.deepEqual(r.step({ ...on(COURSE.length - 1), x: FLAG.x - 0.3, z: FLAG.z }), [{ e: 'finish' }]);
  assert.ok(!r.running);
});

test("a fall before the first checkpoint ends the run; so does walking off or leaving, on any floor's street", () => {
  const r = new RunTracker();
  const x = (START.x0 + START.x1) / 2;
  // Three floors up, the street's further down: the same course, lower.
  r.step(ground(x, START.z + 0.2, 3));
  assert.deepEqual(r.step(ground(x, START.z - 0.2, 3)), [{ e: 'start' }]);
  r.step(on(1, 3));
  assert.deepEqual(r.step(ground(x, 12, 3)), [{ e: 'fell' }]);
  assert.ok(!r.running);

  r.step(ground(x, START.z + 0.2));
  r.step(ground(x, START.z - 0.2));
  assert.deepEqual(r.step(ground(-30, 0)), [{ e: 'quit' }], 'off round the building');
  r.step(ground(x, START.z + 0.2));
  r.step(ground(x, START.z - 0.2));
  assert.deepEqual(r.step({ ...on(2), here: false }), [{ e: 'quit' }], 'up the elevator');
  assert.deepEqual(r.step({ ...ground(x, START.z - 0.2), here: false }), []);
  // Back down, it doesn't count as crossing the line from wherever you were before.
  assert.deepEqual(r.step(ground(x, START.z - 0.3)), []);
  assert.ok(!r.running);
});

test("only crossing on foot starts it: jumping over the line from the course doesn't", () => {
  const r = new RunTracker();
  const x = (START.x0 + START.x1) / 2;
  r.step({ ...ground(x, START.z + 0.2), y: STREET_Y + 1 });
  assert.deepEqual(r.step({ ...ground(x, START.z - 0.2), y: STREET_Y + 1, grounded: false }), []);
});

// ---- The office's clock and board -------------------------------------------------------------------

const atGoal = { x: FLAG.x, z: FLAG.z };
const runner = (id: string, name = id, where = atGoal) => ({ id, owner: `account:${name}`, name, color: '#ff0000', ...where });
const cpAt = (n: number) => ({ x: checkpointPiece(n)!.x, z: checkpointPiece(n)!.z });

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, go: (ms: number) => (now += ms) };
}

/** A whole run of `ms`, through every checkpoint, for `name`. */
function runOf(run: JumpRun, c: ReturnType<typeof clock>, name: string, ms: number) {
  run.start(name);
  for (let n = 1; n <= CHECKPOINTS; n++) assert.ok(run.checkpoint(runner(name, name, cpAt(n)), n));
  c.go(ms);
  return run.finish(runner(name));
}

test('the office times a run from the line to the flag by its own clock, and keeps each best on the board', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jumprun-'));
  const c = clock();
  const run = new JumpRun(new JumpRunTimes(dir), c.now);
  assert.deepEqual(runOf(run, c, 'ann', 30_000), { ok: true, ms: 30_000, rank: 1, best: true, first: true });
  assert.deepEqual(runOf(run, c, 'bob', 25_000), { ok: true, ms: 25_000, rank: 1, best: true, first: true });
  // Slower than her best: the board keeps her best.
  assert.deepEqual(runOf(run, c, 'ann', 40_000), { ok: true, ms: 40_000, rank: 2, best: false, first: false });
  assert.deepEqual(runOf(run, c, 'ann', 28_000), { ok: true, ms: 28_000, rank: 2, best: true, first: false });
  assert.deepEqual(
    run.times.top().map((s) => [s.name, s.ms]),
    [
      ['bob', 25_000],
      ['ann', 28_000],
    ],
  );
  // Still there after a restart.
  assert.deepEqual(
    new JumpRunTimes(dir).top().map((s) => [s.name, s.ms]),
    [
      ['bob', 25_000],
      ['ann', 28_000],
    ],
  );
  // Only the best BOARD_SIZE show; one further down isn't on it.
  for (let i = 0; i < BOARD_SIZE; i++) runOf(run, c, `p${i}`, 10_000 + i);
  assert.equal(run.times.top().length, BOARD_SIZE);
  const slow = runOf(run, c, 'slow', 90_000);
  assert.equal(slow.ok && slow.rank, null);
});

test("a run doesn't count without a start, with a checkpoint skipped or not where it is, away from the flag, or impossibly quick", () => {
  const c = clock();
  const run = new JumpRun(new JumpRunTimes(mkdtempSync(path.join(os.tmpdir(), 'jumprun-'))), c.now);
  assert.deepEqual(run.finish(runner('ann')), { ok: false }, 'never started');
  run.start('ann');
  assert.equal(run.checkpoint(runner('ann', 'ann', cpAt(2)), 2), false, 'skipped the first');
  assert.equal(run.checkpoint(runner('ann', 'ann', atGoal), 1), false, 'not on it');
  assert.equal(run.checkpoint(runner('ann', 'ann', cpAt(1)), 1), true);
  c.go(20_000);
  assert.deepEqual(run.finish(runner('ann')), { ok: false }, 'missed checkpoint 2');
  assert.deepEqual(run.finish(runner('ann')), { ok: false }, 'and that run is over');

  run.start('bob');
  for (let n = 1; n <= CHECKPOINTS; n++) run.checkpoint(runner('bob', 'bob', cpAt(n)), n);
  c.go(20_000);
  assert.deepEqual(run.finish(runner('bob', 'bob', { x: START.x0, z: START.z })), { ok: false }, 'nowhere near the flag');

  assert.deepEqual(runOf(run, c, 'cid', QUICKEST_MS - 1), { ok: false }, 'too quick');
  assert.equal(runOf(run, c, 'cid', QUICKEST_MS).ok, true);

  // Gave up, or went on so long it's dropped.
  run.start('dan');
  run.quit('dan');
  assert.equal(run.running('dan'), false);
  run.start('eve');
  c.go(LONGEST_MS + 1);
  assert.equal(run.running('eve'), false);
  assert.deepEqual(
    run.times.top().map((s) => s.name),
    ['cid'],
  );
});

// ---- In the running office ------------------------------------------------------------------------

const bundled = ['public', 'dist/public'].some((d) => existsSync(path.join(import.meta.dirname, '..', d, 'index.html')));

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  await new Promise((r) => srv.close(r));
  return port;
}

test('in the office: the board on request, a run timed from the line to the flag, and the board for everyone', { skip: !bundled && 'needs the client bundle (npm run build)' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jumprun-office-'));
  process.env.AGENT_OFFICE_HOME = path.join(root, 'home');
  const project = path.join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: project });
  const { loadConfig } = await import('../src/server/config.js');
  const { startServer } = await import('../src/server/server.js');
  const port = await freePort();
  const office = await startServer(loadConfig([project, '--port', String(port), '--password', 'dev', '--no-open']));
  const origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password: 'dev' }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const sockets: WebSocket[] = [];
  const join = (name: string) => {
    const chips = Buffer.from(name.padEnd(16, '_')).toString('hex');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&chips=${chips}`, { headers: { cookie, origin } });
    sockets.push(ws);
    const msgs: any[] = [];
    const waiting: (() => void)[] = [];
    ws.on('message', (d) => {
      msgs.push(JSON.parse(String(d)));
      for (const w of waiting.splice(0)) w();
    });
    let seen = 0;
    return {
      send: (msg: object) => ws.send(JSON.stringify(msg)),
      next: (t: string) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`${name} never got ${t}`)), 5000);
          const look = () => {
            for (; seen < msgs.length; seen++) {
              if (msgs[seen].t === t) {
                clearTimeout(timer);
                return resolve(msgs[seen++]);
              }
            }
            waiting.push(look);
          };
          look();
        }),
    };
  };
  try {
    const ann = join('Ann');
    const bob = join('Bob');
    await ann.next('welcome');
    await bob.next('welcome');
    ann.send({ t: 'jumprun.board' });
    assert.deepEqual((await ann.next('jumprun')).board, []);
    const move = (x: number, z: number) => ann.send({ t: 'move', x, y: 0, z, rotY: 0, moving: true });

    // Straight to the flag from the line: no checkpoints, it doesn't count.
    ann.send({ t: 'jumprun.start' });
    move(FLAG.x, FLAG.z);
    ann.send({ t: 'jumprun.finish' });
    await ann.next('jumprun.void');

    // Through the checkpoints, where they are, and up to the flag: on the board, for everyone.
    ann.send({ t: 'jumprun.start' });
    for (let n = 1; n <= CHECKPOINTS; n++) {
      move(checkpointPiece(n)!.x, checkpointPiece(n)!.z);
      ann.send({ t: 'jumprun.checkpoint', n });
    }
    await new Promise((r) => setTimeout(r, QUICKEST_MS + 100));
    move(FLAG.x, FLAG.z);
    ann.send({ t: 'jumprun.finish' });
    const done = await ann.next('jumprun.done');
    assert.equal(done.rank, 1);
    assert.equal(done.best, true);
    assert.ok(done.ms >= QUICKEST_MS && done.ms < QUICKEST_MS + 3000);
    const board = await bob.next('jumprun');
    assert.deepEqual(
      board.board.map((s: { name: string }) => s.name),
      ['Ann'],
    );
    assert.deepEqual(board.record, { name: 'Ann', ms: done.ms });
  } finally {
    for (const ws of sockets) ws.close();
    await office.shutdown();
  }
});
