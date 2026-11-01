// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const context = vm.createContext({ FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120, END_ZONE_DEPTH_YARDS: 10 });
for (const file of ['footballPlayGeometry', 'footballPlaySequence', 'footballMovement', 'scrimmageGeometry', 'footballTackles']) {
  vm.runInContext(stripTypeScriptTypes(readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8'),
    { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
const data = context.generateFootballPlaySequence();
assert.equal(data.players.length, 22);
assert.equal(data.sequence.length, 6);
assert.equal(data.ballEvents.length, 12);
assert.ok(data.players.every(player => player.positions.length === 265));
assert.equal(data.tackles.length, 6);
for (const event of data.tackles) {
  context.validateFootballTackle(event, data.players,
    (id, count) => data.players.find(player => player.id === id)?.positions[count] ?? null,
    264, data.tackles.filter(other => other !== event), data.ballEvents);
}
assert.deepEqual(data, context.generateFootballPlaySequence(), 'Sequence generation is deterministic');
const player = role => data.players.find(player => player.label === role);
for (const segment of data.sequence) {
  assert.match(segment.source, /^https:\/\/www\.footballplaybookdesigner\.com\/library\/article\//);
  assert.equal(segment.endCount - segment.startCount, 16);
  for (const player of data.players) {
    assert.deepEqual(player.positions[segment.startCount], player.positions[0], 'Every play starts in formation');
  }
}
for (const player of data.players) {
  assert.ok(player.positions.every(point => Number.isFinite(point.x) && Number.isFinite(point.z) &&
    Math.abs(point.x) <= 26.6665 && Math.abs(point.z) <= 60));
  for (const segment of data.sequence.slice(1)) {
    for (let count = segment.startCount - 31; count <= segment.startCount; count++) {
      const a = player.positions[count - 1], b = player.positions[count];
      assert.ok(Math.hypot(b.x - a.x, b.z - a.z) <= 1.25, 'Reset is a walk, not a teleport');
    }
  }
  assert.equal(context.scrimmagePlayerRoute(player.positions, data.players.indexOf(player)).length, 459,
    'Entrance, full six-play sequence, team return and band re-entry share the timeline');
}
for (const event of data.ballEvents) {
  assert.ok(data.players.some(player => player.id === event.toId));
  assert.ok(data.sequence.some(segment => event.startCount >= segment.startCount && event.endCount <= segment.endCount));
}
const at = (role, play, count) => player(role).positions[play * 48 + count];
assert.equal(at('TE', 1, 5).z, -6, 'Stick settles five yards beyond slot alignment');
assert.equal(at('WR3', 2, 5).z, -5, 'Smash hitch is five yards deep');
assert.ok(at('TE', 2, 16).x > at('TE', 2, 6).x, 'Smash slot breaks toward sideline');
assert.ok(at('TE', 3, 16).z > at('RB', 3, 16).z && at('WR3', 3, 16).z > at('TE', 3, 16).z,
  'Flood has three distinct depths on the right');
assert.equal(at('WR2', 4, 10).x, 0); assert.equal(at('TE', 4, 10).x, 0);
assert.ok(Math.abs(at('WR2', 4, 10).z - at('TE', 4, 10).z) < 1, 'Mesh crosses with separation under one yard');
const motion = { team: 'offense', role: 'LT', playStart: 0, playWindows: data.sequence };
assert.equal(context.footballMovement(motion, 20, 0, .1).gait, 'jog', 'Linemen walk back during resets');
assert.equal(context.footballMovement(motion, 48, 0, -.5).gait, 'block', 'Next snap restores blocking gait');
console.log('Football sequence passed: six sourced concepts, 22 continuous routes, walk resets, 12 ball events, one entrance and role gaits.');
