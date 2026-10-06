import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Chips } from '../src/server/chips.js';
import { START_CHIPS, type ChipsState } from '../src/shared/chips.js';
import { CASINO_ROOM, CASINO_SHOP, SHOP_COUNTER, SHOP_DISPLAYS, casinoFootprints, casinoWalkable, shopFootprints } from '../src/shared/casino.js';
import { ELEVATOR } from '../src/shared/layout.js';
import { ONE_AT_A_TIME, SHOP_ITEMS, SHOP_MAX_PRICE, SHOP_MIN_PRICE, SHOP_SLOTS, nameColorOf, shopItem, shopItemOfReason, shopReason, tidyWorn } from '../src/shared/shop.js';
import { DESK_SIZE } from '../src/shared/layout.js';
import { hasModel, shopModel } from '../src/client/world/shopitems.js';

const A = 'account:ada';
const B = 'browser:0123456789abcdef0123';

/** A bank in a fresh folder, on a fixed clock, with every state it sent. */
function bank(dir = mkdtempSync(path.join(tmpdir(), 'agent-office-shop-'))) {
  const states: { id: string; state: ChipsState; reason?: string; quiet: boolean }[] = [];
  const chips = new Chips(dir, {
    now: () => new Date(2026, 9, 6, 10, 0).getTime(),
    saveAfter: 0,
    onChange: (id, state, entry, quiet) => states.push({ id, state, reason: entry?.reason, quiet }),
  });
  return { chips, states, dir };
}

/** Writes what's pending (before the folder goes) and removes the folder. */
function done(chips: Chips, dir: string) {
  chips.flush();
  rmSync(dir, { recursive: true });
}

const item = (id: string) => shopItem(id)!;

// ---- The catalogue ----------------------------------------------------------------------------------

test('the catalogue: unique ids, known slots, whole prices from cheap to high-roller, names in English and German', () => {
  assert.ok(SHOP_ITEMS.length >= 8);
  const ids = new Set<string>();
  for (const i of SHOP_ITEMS) {
    assert.match(i.id, /^[a-z][a-z0-9-]{1,30}$/, i.id);
    assert.ok(!ids.has(i.id), `${i.id} twice`);
    ids.add(i.id);
    assert.ok(SHOP_SLOTS.includes(i.slot), i.id);
    assert.ok(Number.isSafeInteger(i.price) && i.price >= SHOP_MIN_PRICE && i.price <= SHOP_MAX_PRICE, `${i.id}: ${i.price}`);
    for (const l of ['en', 'de'] as const) {
      assert.ok(i.name[l].trim(), `${i.id} has a ${l} name`);
      assert.ok(i.about[l].trim(), `${i.id} has a ${l} line`);
    }
    assert.ok(i.icon, i.id);
    // The ledger keeps reasons to 40 characters.
    assert.ok(shopReason(i).length <= 40, i.id);
    assert.equal(shopItemOfReason(shopReason(i)), i);
  }
  // Every slot has something, a few things are cheap and a few are goals for high rollers.
  for (const slot of SHOP_SLOTS) assert.ok(SHOP_ITEMS.some((i) => i.slot === slot), slot);
  assert.ok(SHOP_ITEMS.filter((i) => i.price <= 500).length >= 3, 'cheap ones');
  assert.ok(SHOP_ITEMS.filter((i) => i.price >= 5000).length >= 3, 'expensive ones');
  assert.equal(Math.max(...SHOP_ITEMS.map((i) => i.price)), SHOP_MAX_PRICE);
});

test('the catalogue: name colours have a colour, desk things a spot of their own on the desk, and everything a model', () => {
  for (const i of SHOP_ITEMS) {
    if (i.slot === 'name') assert.match(i.color ?? '', /^#[0-9a-f]{6}$/i, i.id);
    else assert.equal(i.color, undefined, i.id);
    if (i.slot !== 'desk') {
      assert.equal(i.spot, undefined, i.id);
      continue;
    }
    assert.ok(i.spot, `${i.id} has a spot`);
    const { dx, dz } = i.spot!;
    // On the desk top, and clear of the laptop in the middle of it.
    assert.ok(Math.abs(dx) < DESK_SIZE.width / 2 - 0.08 && Math.abs(dz) < DESK_SIZE.depth / 2 - 0.08, `${i.id} on the desk`);
    assert.ok(Math.abs(dx) > 0.35, `${i.id} clear of the laptop`);
  }
  const desk = SHOP_ITEMS.filter((i) => i.slot === 'desk');
  for (const a of desk) for (const b of desk) if (a !== b) assert.ok(Math.hypot(a.spot!.dx - b.spot!.dx, a.spot!.dz - b.spot!.dz) >= 0.2, `${a.id} and ${b.id} apart`);
  for (const i of SHOP_ITEMS) {
    assert.ok(hasModel(i), `${i.id} has a model`);
    assert.ok(shopModel(i), i.id);
  }
});

test('what you wear is kept tidy: owned items only, one hat, glasses and name colour at a time, desk things together', () => {
  const owned = ['party-hat', 'top-hat', 'sunglasses', 'cactus', 'trophy', 'name-gold', 'name-mint'];
  assert.deepEqual(tidyWorn(['party-hat', 'top-hat', 'cactus', 'trophy', 'crown', 'nope', 42, 'cactus'], owned), ['top-hat', 'cactus', 'trophy']);
  assert.deepEqual(tidyWorn(['name-gold', 'name-mint'], owned), ['name-mint']);
  for (const slot of ONE_AT_A_TIME) assert.notEqual(slot, 'desk');
  assert.equal(nameColorOf(['top-hat', 'name-gold']), item('name-gold').color);
  assert.equal(nameColorOf(['top-hat']), undefined);
});

// ---- Buying ---------------------------------------------------------------------------------------------

test('buying with enough chips: off the balance with a shop line in the ledger, yours, and on straight away', () => {
  const { chips, states, dir } = bank();
  const hat = item('party-hat');
  assert.equal(chips.buy(A, hat.id), null);
  assert.equal(chips.balance(A), START_CHIPS - hat.price);
  const e = chips.ledger(A)[0];
  assert.equal(e.amount, -hat.price);
  assert.equal(e.reason, 'shop:party-hat');
  assert.equal(e.balance, START_CHIPS - hat.price);
  const s = chips.state(A);
  assert.deepEqual(s.items, ['party-hat']);
  assert.deepEqual(s.worn, ['party-hat']);
  assert.deepEqual(chips.worn(A), ['party-hat']);
  // Their page heard it, with a toast (not quiet).
  const last = states.at(-1)!;
  assert.equal(last.reason, 'shop:party-hat');
  assert.equal(last.quiet, false);
  assert.deepEqual(last.state.items, ['party-hat']);
  // A second hat goes on in its place; the first is still theirs.
  assert.equal(chips.buy(A, 'beanie'), null);
  assert.deepEqual(chips.state(A).items, ['party-hat', 'beanie']);
  assert.deepEqual(chips.worn(A), ['beanie']);
  done(chips, dir);
});

test('buying without enough chips changes nothing, and nor does buying twice or something that isn’t sold', () => {
  const { chips, states, dir } = bank();
  const crown = item('crown');
  assert.ok(crown.price > START_CHIPS);
  assert.equal(chips.buy(A, crown.id), 'chips');
  assert.equal(chips.balance(A), START_CHIPS);
  assert.deepEqual(chips.ledger(A), []);
  assert.equal(chips.state(A).items, undefined);
  assert.equal(states.length, 0);
  // Exactly enough is enough: down to nothing.
  const { chips: c2, dir: d2 } = bank();
  assert.equal(c2.award(B, item('cowboy-hat').price - START_CHIPS, 'test'), true);
  assert.equal(c2.buy(B, 'cowboy-hat'), null);
  assert.equal(c2.balance(B), 0);
  assert.equal(c2.buy(B, 'rubber-duck'), 'chips');
  // Twice: no.
  assert.equal(chips.buy(A, 'sunglasses'), null);
  const after = chips.balance(A);
  assert.equal(chips.buy(A, 'sunglasses'), 'owned');
  assert.equal(chips.balance(A), after);
  // Not on sale, or not a someone.
  for (const bad of ['', 'nope', 'shop:crown', null, 7, { id: 'crown' }]) assert.equal(chips.buy(A, bad), 'item', String(bad));
  assert.equal(chips.buy('someone', 'cap'), 'item');
  assert.equal(chips.balance(A), after);
  done(chips, dir);
  done(c2, d2);
});

test('credit from the bank spends at the shop like any other chips', () => {
  const { chips, dir } = bank();
  assert.equal(chips.buy(A, 'top-hat'), 'chips');
  assert.equal(chips.credit(A, 10_000), null);
  assert.equal(chips.buy(A, 'top-hat'), null);
  assert.equal(chips.balance(A), START_CHIPS + 10_000 - item('top-hat').price);
  // Still owed in full: buying doesn't touch the debt.
  assert.equal(chips.owed(A), 10_000);
  done(chips, dir);
});

test('putting things on and taking them off: only what you have, quietly', () => {
  const { chips, states, dir } = bank();
  chips.award(A, 20_000, 'test');
  for (const id of ['cap', 'top-hat', 'cactus', 'lava-lamp', 'name-mint']) assert.equal(chips.buy(A, id), null, id);
  assert.deepEqual(chips.worn(A), ['top-hat', 'cactus', 'lava-lamp', 'name-mint']);
  const n = states.length;
  assert.equal(chips.wear(A, 'cap', true), true);
  assert.deepEqual(chips.worn(A), ['cap', 'cactus', 'lava-lamp', 'name-mint']);
  assert.equal(states.length, n + 1);
  assert.equal(states.at(-1)!.quiet, true);
  assert.equal(states.at(-1)!.reason, undefined);
  assert.equal(chips.wear(A, 'cactus', false), true);
  assert.deepEqual(chips.worn(A), ['cap', 'lava-lamp', 'name-mint']);
  // Nothing changes: not theirs, not a thing, or already so.
  assert.equal(chips.wear(A, 'crown', true), false);
  assert.equal(chips.wear(A, 'nope', true), false);
  assert.equal(chips.wear(A, 'cap', true), false);
  assert.equal(chips.wear(B, 'cap', true), false);
  // Taking everything off.
  for (const id of chips.worn(A)) chips.wear(A, id, false);
  assert.deepEqual(chips.worn(A), []);
  assert.deepEqual(chips.state(A).items, ['cap', 'top-hat', 'cactus', 'lava-lamp', 'name-mint']);
  done(chips, dir);
});

test('the leaderboard shows a bought name colour, and looks go by name', () => {
  const { chips, dir } = bank();
  chips.seen(A, { name: 'Ada', color: '#123456' });
  chips.seen(B, { name: 'Bo' });
  chips.award(A, 20_000, 'test');
  assert.equal(chips.buy(A, 'name-gold'), null);
  assert.equal(chips.buy(A, 'trophy'), null);
  const top = chips.top();
  assert.equal(top.find((r) => r.name === 'Ada')?.nameColor, item('name-gold').color);
  assert.equal(top.find((r) => r.name === 'Bo')?.nameColor, undefined);
  assert.deepEqual(chips.looks(), { Ada: ['trophy', 'name-gold'] });
  chips.wear(A, 'name-gold', false);
  assert.equal(chips.top().find((r) => r.name === 'Ada')?.nameColor, undefined);
  done(chips, dir);
});

// ---- Kept on disk -----------------------------------------------------------------------------------------

test('what you bought (and what you have on) is kept across restarts, in chips.json', () => {
  const first = bank();
  first.chips.award(A, 5000, 'test');
  assert.equal(first.chips.buy(A, 'cowboy-hat'), null);
  assert.equal(first.chips.buy(A, 'sunglasses'), null);
  assert.equal(first.chips.buy(A, 'cactus'), null);
  first.chips.wear(A, 'sunglasses', false);
  first.chips.flush();
  const balance = first.chips.balance(A);
  const again = bank(first.dir).chips;
  assert.equal(again.balance(A), balance);
  assert.deepEqual(again.state(A).items, ['cowboy-hat', 'sunglasses', 'cactus']);
  assert.deepEqual(again.worn(A), ['cowboy-hat', 'cactus']);
  assert.equal(again.buy(A, 'cowboy-hat'), 'owned');
  done(again, first.dir);
});

test('a saved inventory is read carefully: things no longer sold drop out, and only what you have can be on', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-shop-'));
  const file = path.join(dir, 'chips.json');
  const wallet = { balance: 50, ledger: [], day: '2026-10-06', earned: {}, last: {}, online: 0, seen: new Date(2026, 9, 6).getTime() };
  writeFileSync(
    file,
    JSON.stringify({
      wallets: {
        [A]: { ...wallet, items: ['top-hat', 'gone-hat', 'top-hat', 5, 'cactus'], worn: ['top-hat', 'crown', 'cactus', 'gone-hat'] },
        [B]: { ...wallet, items: 'top-hat', worn: ['top-hat'] },
      },
      once: [],
    }),
  );
  const { chips } = bank(dir);
  assert.deepEqual(chips.state(A).items, ['top-hat', 'cactus']);
  assert.deepEqual(chips.worn(A), ['top-hat', 'cactus']);
  assert.equal(chips.state(B).items, undefined);
  assert.deepEqual(chips.worn(B), []);
  // And it writes back what it read.
  chips.flush();
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.wallets[A].items, ['top-hat', 'cactus']);
  done(chips, dir);
});

// ---- The room -------------------------------------------------------------------------------------------------

test('the shop is a room of its own behind the main hall’s south wall, its doorway clear of the hall’s things', () => {
  const S = CASINO_SHOP.room;
  const D = CASINO_SHOP.door;
  assert.ok(S.minZ >= CASINO_ROOM.maxZ, 'behind the south wall');
  assert.ok(S.minX >= CASINO_ROOM.minX && S.maxX <= CASINO_ROOM.maxX, 'under the hall’s width');
  assert.ok(D.x - D.width / 2 > S.minX + 0.5 && D.x + D.width / 2 < S.maxX - 0.5, 'the doorway opens into it');
  assert.ok(D.height < S.height && S.height <= CASINO_ROOM.height);
  // Nothing in the hall stands in front of the doorway.
  for (const f of casinoFootprints()) assert.ok(!(f.maxX > D.x - D.width / 2 - 0.5 && f.minX < D.x + D.width / 2 + 0.5 && f.maxZ > CASINO_ROOM.maxZ - 1.5), 'the way in is clear');
  // The counter and the displays are inside the room.
  for (const f of shopFootprints()) assert.ok(f.minX >= S.minX && f.maxX <= S.maxX && f.minZ >= S.minZ && f.maxZ <= S.maxZ, 'inside the shop');
  assert.equal(SHOP_DISPLAYS.length, 3);
  assert.ok(casinoWalkable(SHOP_COUNTER.x, SHOP_COUNTER.front - 0.6), 'you can stand at the counter');
  assert.equal(casinoWalkable(SHOP_COUNTER.x, SHOP_COUNTER.front + 0.3), false, 'not on it');
  assert.equal(casinoWalkable(D.x + D.width, CASINO_ROOM.maxZ + 0.15), false, 'not through the wall beside the door');
  assert.ok(casinoWalkable(D.x, CASINO_ROOM.maxZ + 0.15), 'through the doorway');
});

test('you can walk from the elevator into the shop, up to its counter and every display', () => {
  const step = 0.2;
  const S = CASINO_SHOP.room;
  const minX = CASINO_ROOM.minX;
  const minZ = CASINO_ROOM.minZ;
  const nx = Math.round((CASINO_ROOM.maxX - minX) / step);
  const nz = Math.round((S.maxZ - minZ) / step);
  const at = (i: number, k: number) => [minX + i * step, minZ + k * step] as const;
  const key = (i: number, k: number) => i * 10000 + k;
  const start: [number, number] = [Math.round((ELEVATOR.x - minX) / step), Math.round((CASINO_ROOM.minZ + 3 - minZ) / step)];
  assert.ok(casinoWalkable(...at(...start)), 'in front of the elevator');
  const seen = new Set([key(...start)]);
  const queue = [start];
  while (queue.length) {
    const [i, k] = queue.pop()!;
    for (const [a, b] of [
      [i + 1, k],
      [i - 1, k],
      [i, k + 1],
      [i, k - 1],
    ]) {
      if (a < 0 || b < 0 || a > nx || b > nz || seen.has(key(a, b)) || !casinoWalkable(...at(a, b))) continue;
      seen.add(key(a, b));
      queue.push([a, b]);
    }
  }
  const reached = (x: number, z: number) => seen.has(key(Math.round((x - minX) / step), Math.round((z - minZ) / step)));
  assert.ok(reached(SHOP_COUNTER.x, SHOP_COUNTER.front - 0.6), 'the counter');
  const [hats, desk, crown] = SHOP_DISPLAYS;
  assert.ok(reached(hats.maxX + 0.8, (hats.minZ + hats.maxZ) / 2), 'the hats');
  assert.ok(reached(desk.minX - 0.8, (desk.minZ + desk.maxZ) / 2), 'the desk things');
  assert.ok(reached((crown.minX + crown.maxX) / 2, crown.minZ - 0.6), 'the crown');
});
