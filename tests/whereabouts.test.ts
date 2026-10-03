import test from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../src/client/i18n/index.js';
import { whereabouts } from '../src/client/ui/whereabouts.js';
import { DANCE_FLOOR, ROOF_TABLES } from '../src/shared/layout.js';
import type { PeerInfo } from '../src/shared/protocol.js';
import { ROOF } from '../src/shared/rooftop.js';
import { CASHIER, CASINO, ROULETTE_TABLE } from '../src/shared/casino.js';

// The seats' words come from the i18n tables: in English, whatever language this machine is in.
setLang('en');

function peer(x: number, z: number, floor?: string, y = 0): PeerInfo {
  return { id: 'p', name: 'P', color: '#fff', look: { skin: 0, hair: 0, style: 0 }, x, y, z, rotY: 0, moving: false, voice: false, muted: false, sharing: false, floor };
}

test("the roof's corner over the meeting room is a tall table, not the meeting room", () => {
  const t = ROOF_TABLES.find((t) => t.x > 9 && t.z > 8)!;
  assert.equal(whereabouts(peer(t.x + 0.7, t.z, 'agent-office')), '🤝 in the meeting room');
  assert.equal(whereabouts(peer(t.x + 0.7, t.z, ROOF)), '🕯️ at a tall table');
});

test('up on the roof, the dance floor and the bar have their own words, and the rest none', () => {
  assert.equal(whereabouts(peer((DANCE_FLOOR.minX + DANCE_FLOOR.maxX) / 2, (DANCE_FLOOR.minZ + DANCE_FLOOR.maxZ) / 2, ROOF)), '🪩 on the dance floor');
  assert.equal(whereabouts(peer(11.5, 0, ROOF)), '🍸 at the bar');
  assert.equal(whereabouts(peer(0, 3, ROOF)), undefined);
  assert.equal(whereabouts({ ...peer(12, 0, ROOF), seat: 'roof-stool-3:0' }), '🪑 on the bar stool');
});

test("down in the casino, its tables, slots and cashier have their own words, and the office's rooms aren't down there", () => {
  assert.equal(whereabouts({ ...peer(-8, -5, CASINO), seat: 'poker-2:0' }), '🃏 at the poker table');
  assert.equal(whereabouts({ ...peer(-16.5, 0, CASINO), seat: 'slots-3:0' }), '🎰 at a slot machine');
  assert.equal(whereabouts(peer(ROULETTE_TABLE.x + 1, ROULETTE_TABLE.z + 1.6, CASINO)), '🎡 at the roulette wheel');
  assert.equal(whereabouts(peer(CASHIER.x, CASHIER.front + 0.6, CASINO)), '🪙 at the cashier');
  // The meeting room's corner of a floor is just casino floor down there.
  assert.equal(whereabouts(peer(12, 11.5, CASINO)), undefined);
  assert.equal(whereabouts(peer(12, 11.5, 'agent-office')), '🤝 in the meeting room');
});

test('a smoke break says whether it is a cigarette or a joint', () => {
  assert.equal(whereabouts({ ...peer(-8, 9), smoking: 'cigarette' }), '🚬 on a smoke break');
  assert.equal(whereabouts({ ...peer(-8, 9), smoking: 'joint' }), '🌿 smoking a joint');
});
